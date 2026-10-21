// POST /api/reservations/:id/send-confirmation
// Envoie (ou renvoie) l'email « Réservation confirmée » au client, avec ou sans caution.
// Si une carte de garantie reste à enregistrer, l'email contient le lien de caution.
import { sendDepositEmail } from "../../../_shared.js";
import { sendGuaranteeEmail } from "../../../_stripe-guarantee.js";
import { ensureAccessToken, manageUrl } from "../../../_access.js";

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

  if (!entry.email) {
    return Response.json({ error: "Aucun email client sur cette réservation." }, { status: 400, headers: cors() });
  }
  if (entry.status === "declined") {
    return Response.json({ error: "Réservation refusée ou annulée : pas d'email de confirmation." }, { status: 409, headers: cors() });
  }

  let emailResult;
  await ensureAccessToken(entry, env);
  const mUrl = manageUrl(entry, env, new URL(request.url).origin);
  try {
    const pendingCard = entry.depositLink && !["autorisee", "debitee", "deposee"].includes(entry.depositStatus);
    emailResult = pendingCard
      ? await sendGuaranteeEmail(entry, env, { subject: "Votre réservation au Yonko Bar est confirmée", manageUrl: mUrl })
      : await sendDepositEmail({ ...entry, depositLink: "" }, env, { subject: "Votre réservation au Yonko Bar est confirmée", manageUrl: mUrl });
  } catch (e) {
    emailResult = { sent: false, reason: String(e?.message || e).slice(0, 500) };
  }

  if (emailResult?.sent) {
    entry.emailSent = true;
    entry.confirmationEmailSentAt = Date.now();
    delete entry.confirmationEmailError;
  } else {
    entry.confirmationEmailError = String(emailResult?.reason || "email_not_sent").slice(0, 500);
  }
  await env.RESERVATIONS.put(`res:${entry.id}`, JSON.stringify(entry));

  return Response.json({ ok: !!emailResult?.sent, emailResult, entry }, { status: emailResult?.sent ? 200 : 502, headers: cors() });
}
