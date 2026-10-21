// POST /api/reservations/:id/messages (dashboard, protégé par x-dashboard-key)
//   { text }          -> message de l'équipe au client (+ email au client avec le lien de sa page)
//   { markRead: true } -> marque les messages du client comme lus
import { addMessage, ensureAccessToken, mailClientNewMessage } from "../../../_access.js";

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

  if (body.markRead === true) {
    if (entry.unreadForStaff) {
      entry.unreadForStaff = 0;
      await env.RESERVATIONS.put(`res:${entry.id}`, JSON.stringify(entry));
    }
    return Response.json({ ok: true, entry }, { headers: cors() });
  }

  let msg;
  try { msg = addMessage(entry, "bar", body.text); }
  catch (e) { return Response.json({ error: e.message }, { status: 400, headers: cors() }); }
  entry.unreadForStaff = 0;
  await ensureAccessToken(entry, env);
  await env.RESERVATIONS.put(`res:${entry.id}`, JSON.stringify(entry));

  const emailResult = entry.email
    ? await mailClientNewMessage(entry, env, new URL(request.url).origin, msg.text)
    : { sent: false, reason: "no_email" };
  return Response.json({ ok: true, entry, emailResult }, { headers: cors() });
}
