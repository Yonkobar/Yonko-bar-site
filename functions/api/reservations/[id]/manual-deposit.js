// POST /api/reservations/:id/manual-deposit
// Valide manuellement une caution déposée au bar (espèces, chèque, CB sur place…).
// body : { amount?, note? } pour valider, { undo: true } pour annuler la validation.
// La caution manuelle n'est jamais débitable via Stripe (charge-deposit exige une carte enregistrée).
import { expireCheckoutSession } from "../../../_stripe-guarantee.js";

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

  if (body.undo === true) {
    if (entry.depositStatus !== "deposee") {
      return Response.json({ error: "Aucune caution déposée manuellement sur cette réservation." }, { status: 409, headers: cors() });
    }
    const previous = entry.manualDepositPrevious || {};
    for (const f of ["depositStatus", "depositGuaranteeStatus", "depositAmount"]) {
      if (previous[f] === undefined || previous[f] === null) delete entry[f];
      else entry[f] = previous[f];
    }
    delete entry.manualDepositAt;
    delete entry.manualDepositNote;
    delete entry.manualDepositPrevious;
    await env.RESERVATIONS.put(`res:${entry.id}`, JSON.stringify(entry));
    return Response.json({ ok: true, entry }, { headers: cors() });
  }

  if (["autorisee", "debitee", "deposee"].includes(entry.depositStatus)) {
    return Response.json({ error: "La caution de cette réservation est déjà validée." }, { status: 409, headers: cors() });
  }

  let amount = body.amount === undefined || body.amount === "" || body.amount === null
    ? Number(entry.depositAmount) || null
    : Number(body.amount);
  if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
    return Response.json({ error: "Montant de caution invalide." }, { status: 400, headers: cors() });
  }

  // Le client n'a plus besoin d'enregistrer sa carte : on ferme le lien Stripe s'il est encore ouvert.
  let stripeSession = null;
  if (entry.stripeCheckoutSessionId && env.STRIPE_SECRET_KEY) {
    stripeSession = await expireCheckoutSession(entry.stripeCheckoutSessionId, env);
  }

  entry.manualDepositPrevious = {
    depositStatus: entry.depositStatus ?? null,
    depositGuaranteeStatus: entry.depositGuaranteeStatus ?? null,
    depositAmount: entry.depositAmount ?? null,
  };
  entry.depositStatus = "deposee";
  entry.depositGuaranteeStatus = "deposee_manuellement";
  if (amount) entry.depositAmount = amount;
  entry.manualDepositAt = Date.now();
  entry.manualDepositNote = String(body.note || "Déposée au bar").slice(0, 200);

  await env.RESERVATIONS.put(`res:${entry.id}`, JSON.stringify(entry));
  return Response.json({ ok: true, entry, stripeSession }, { headers: cors() });
}
