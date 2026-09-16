// PATCH /api/reservations/:id  -> mettre à jour le statut ou le lien de caution (protégé)
import { computeDepositAmount, createStripeLink, sendDepositEmail } from "../../_shared.js";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-dashboard-key",
  };
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

export async function onRequestPatch({ request, env, params }) {
  const key = request.headers.get("x-dashboard-key");
  if (!key || key !== env.DASHBOARD_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  const id = params.id;
  const raw = await env.RESERVATIONS.get(`res:${id}`);
  if (!raw) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  const entry = JSON.parse(raw);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    body = {};
  }

  const wasAccepted = entry.status === "accepted";
  if (body.status && ["pending", "accepted", "declined"].includes(body.status)) {
    entry.status = body.status;
  }
  if (typeof body.depositLink === "string") {
    entry.depositLink = body.depositLink.slice(0, 500);
  }

  let stripeError = null;
  let emailResult = null;
  if (entry.status === "accepted" && !wasAccepted && !entry.depositLink) {
    const amount = computeDepositAmount(entry);
    if (amount) {
      try {
        const origin = new URL(request.url).origin;
        entry.depositLink = await createStripeLink(entry, amount, origin, env);
        entry.depositAmount = amount;
        emailResult = await sendDepositEmail(entry, env);
        entry.emailSent = !!emailResult.sent;
      } catch (e) {
        stripeError = e.message;
      }
    }
  }

  await env.RESERVATIONS.put(`res:${id}`, JSON.stringify(entry));

  return new Response(JSON.stringify({ ok: true, entry, stripeError, emailResult }), {
    headers: { "Content-Type": "application/json", ...cors() },
  });
}
