// PATCH /api/reservations/:id  -> mettre à jour le statut ou le lien de caution (protégé)
import { computeDepositAmount, sendDepositEmail } from "../../_shared.js";
import { createStripeGuaranteeLink, sendGuaranteeEmail } from "../../_stripe-guarantee.js";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-dashboard-key",
  };
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

export async function onRequestDelete({ request, env, params }) {
  const key = request.headers.get("x-dashboard-key");
  if (!key || key !== env.DASHBOARD_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  const id = params.id;
  await env.RESERVATIONS.delete(`res:${id}`);
  const raw = await env.RESERVATIONS.get("res:index");
  const ids = raw ? JSON.parse(raw) : [];
  await env.RESERVATIONS.put("res:index", JSON.stringify(ids.filter((x) => x !== id)));

  return Response.json({ ok: true }, { headers: cors() });
}

export async function onRequestPatch({ request, env, params }) {
  const key = request.headers.get("x-dashboard-key");
  if (!key || key !== env.DASHBOARD_KEY) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: cors() });
  }

  const id = params.id;
  const raw = await env.RESERVATIONS.get(`res:${id}`);
  if (!raw) return Response.json({ error: "not found" }, { status: 404, headers: cors() });

  const entry = JSON.parse(raw);

  let body = {};
  try { body = await request.json(); } catch {}

  const wasAccepted = entry.status === "accepted";

  if (body.status && ["pending", "accepted", "declined"].includes(body.status)) {
    entry.status = body.status;
  }

  if (typeof body.depositLink === "string") {
    entry.depositLink = body.depositLink.slice(0, 500);
  }

  let stripeError = null;
  let emailResult = null;

  if (entry.status === "accepted" && !wasAccepted && !entry.depositLink && !entry.skipAutoDeposit) {
    const amount = computeDepositAmount(entry);

    if (amount) {
      try {
        const origin = new URL(request.url).origin;
        await createStripeGuaranteeLink(entry, amount, origin, env);
        emailResult = await sendGuaranteeEmail(entry, env);
        entry.emailSent = !!emailResult.sent;
      } catch (e) {
        stripeError = e.message;
      }
    } else {
      // Réservation sans caution : confirmation par email quand même.
      try {
        emailResult = await sendDepositEmail(entry, env);
        entry.emailSent = !!emailResult.sent;
        entry.confirmationEmailSentAt = emailResult.sent ? Date.now() : null;
      } catch (e) {
        emailResult = { sent: false, reason: String(e?.message || e) };
        entry.emailSent = false;
      }
    }
  }

  await env.RESERVATIONS.put(`res:${id}`, JSON.stringify(entry));

  return Response.json(
    { ok: true, entry, stripeError, emailResult },
    { headers: cors() }
  );
}
