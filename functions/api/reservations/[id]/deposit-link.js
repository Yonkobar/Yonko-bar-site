// POST /api/reservations/:id/deposit-link  { amount: 50 }  -> crée un lien de paiement Stripe et envoie l'email (protégé)
import { createStripeLink, sendDepositEmail } from "../../../_shared.js";

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
  const amountEuros = Number(body.amount);
  if (!amountEuros || amountEuros <= 0) {
    return new Response(JSON.stringify({ error: "amount (in euros) is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  const origin = new URL(request.url).origin;
  let url;
  try {
    url = await createStripeLink(entry, amountEuros, origin, env);
  } catch (e) {
    return new Response(JSON.stringify({ error: "stripe_error", detail: e.message }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  entry.depositLink = url;
  entry.depositAmount = amountEuros;
  const emailResult = await sendDepositEmail(entry, env);
  entry.emailSent = !!emailResult.sent;
  await env.RESERVATIONS.put(`res:${id}`, JSON.stringify(entry));

  return new Response(JSON.stringify({ ok: true, url, entry, emailResult }), {
    headers: { "Content-Type": "application/json", ...cors() },
  });
}
