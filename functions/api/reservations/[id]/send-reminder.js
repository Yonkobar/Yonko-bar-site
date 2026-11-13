// POST /api/reservations/:id/send-reminder
// Relance par email un client qui n'a pas encore répondu : demande en attente, ou caution pas encore validée.
import { ensureAccessToken, mailClientReminder, needsPresence } from "../../../_access.js";

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

// Même règle que le bouton du dashboard : on attend une réponse du client.
function awaitingClient(entry) {
  if (entry.status === "pending") return true;
  if (needsPresence(entry)) return !entry.presenceConfirmedAt; // sans caution : on attend la confirmation de venue
  return !!entry.depositLink && !["autorisee", "debitee", "deposee"].includes(entry.depositStatus);
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
    return Response.json({ error: "Réservation refusée ou annulée : pas de relance." }, { status: 409, headers: cors() });
  }
  if (!awaitingClient(entry)) {
    return Response.json({ error: "Le client a déjà confirmé : rien à relancer." }, { status: 409, headers: cors() });
  }

  await ensureAccessToken(entry, env);
  let emailResult;
  try {
    emailResult = await mailClientReminder(entry, env, new URL(request.url).origin);
  } catch (e) {
    emailResult = { sent: false, reason: String(e?.message || e).slice(0, 500) };
  }

  if (emailResult?.sent) {
    entry.lastReminderAt = Date.now();
    entry.reminderCount = (entry.reminderCount || 0) + 1;
    delete entry.reminderError;
  } else {
    entry.reminderError = String(emailResult?.reason || "email_not_sent").slice(0, 500);
  }
  await env.RESERVATIONS.put(`res:${entry.id}`, JSON.stringify(entry));

  return Response.json({ ok: !!emailResult?.sent, emailResult, entry }, { status: emailResult?.sent ? 200 : 502, headers: cors() });
}
