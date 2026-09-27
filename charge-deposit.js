// POST /api/reservations/:id/charge-deposit
// Débite manuellement la carte de garantie enregistrée. Action protégée par DASHBOARD_KEY.
import { chargeStripeGuarantee } from "../../../_stripe-guarantee.js";

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

  const raw = await env.RESERVATIONS.get(`res:${params.id}`);
  if (!raw) return Response.json({ error: "not found" }, { status: 404, headers: cors() });

  const entry = JSON.parse(raw);

  let body = {};
  try { body = await request.json(); } catch {}

  const amount = Number(body.amount || entry.depositAmount);
  if (!amount || amount <= 0) {
    return Response.json({ error: "Montant de caution invalide." }, { status: 400, headers: cors() });
  }

  if (entry.depositGuaranteeStatus !== "enregistree") {
    return Response.json(
      { error: "La carte de garantie n'est pas enregistrée ou a déjà été débitée." },
      { status: 409, headers: cors() }
    );
  }

  try {
    const intent = await chargeStripeGuarantee(entry, amount, env);

    entry.depositGuaranteeStatus = intent.status === "succeeded" ? "debitee" : intent.status;
    entry.depositStatus = intent.status === "succeeded" ? "debitee" : entry.depositStatus;
    entry.depositChargePaymentIntentId = intent.id;
    if (intent.status === "succeeded") entry.depositChargedAt = Date.now();

    await env.RESERVATIONS.put(`res:${entry.id}`, JSON.stringify(entry));

    return Response.json(
      { ok: true, paymentIntentId: intent.id, status: intent.status, entry },
      { headers: cors() }
    );
  } catch (e) {
    return Response.json(
      {
        error: "stripe_charge_error",
        detail: String(e.message || e),
        hint: "Si Stripe exige une nouvelle authentification du client, régénérez un lien de garantie.",
      },
      { status: 502, headers: cors() }
    );
  }
}
