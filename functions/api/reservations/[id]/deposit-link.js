// POST /api/reservations/:id/deposit-link
// Crée un lien Stripe Checkout en mode SETUP pour enregistrer une carte de garantie.
import { createStripeGuaranteeLink, sendGuaranteeEmail } from "../../../_stripe-guarantee.js";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-dashboard-key",
  };
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

export async function onRequestPost({ request, env, params }) {
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

  const amountEuros = Number(body.amount);
  if (!amountEuros || amountEuros <= 0) {
    return Response.json(
      { error: "amount (in euros) is required" },
      { status: 400, headers: cors() }
    );
  }

  try {
    const origin = new URL(request.url).origin;
    const url = await createStripeGuaranteeLink(entry, amountEuros, origin, env);

    const emailResult = await sendGuaranteeEmail(entry, env);
    entry.emailSent = !!emailResult.sent;

    await env.RESERVATIONS.put(`res:${id}`, JSON.stringify(entry));

    return Response.json({ ok: true, url, entry, emailResult }, { headers: cors() });
  } catch (e) {
    return Response.json(
      { error: "stripe_error", detail: e.message },
      { status: 502, headers: cors() }
    );
  }
}
