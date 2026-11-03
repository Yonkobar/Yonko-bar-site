// POST /api/reservations/:id/messages (dashboard, protégé par x-dashboard-key)
//   { text }          -> message de l'équipe au client (+ email au client avec le lien de sa page)
//   { proposal: { date, time }, text? } -> propose un autre créneau (le client peut l'accepter depuis sa page)
//   { markRead: true } -> marque les messages du client comme lus
import { addMessage, buildProposal, slotLabel, ensureAccessToken, mailClientNewMessage } from "../../../_access.js";

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
  try {
    if (body.proposal && typeof body.proposal === "object") {
      const slot = buildProposal(entry, body.proposal);
      const note = String(body.text || "").trim();
      const text = `${note ? note + "\n\n" : ""}Nous vous proposons un autre créneau : ${slotLabel(slot.date, slot.time || entry.time)}. Vous pouvez l'accepter ou le refuser directement depuis votre page « Ma réservation ».`;
      // Une seule proposition ouverte à la fois : la nouvelle remplace les précédentes.
      for (const m of entry.messages || []) if (m.proposal?.status === "open") m.proposal.status = "replaced";
      msg = addMessage(entry, "bar", text, { proposal: { ...slot, status: "open" } });
    } else {
      msg = addMessage(entry, "bar", body.text);
    }
  } catch (e) { return Response.json({ error: e.message }, { status: 400, headers: cors() }); }
  entry.unreadForStaff = 0;
  await ensureAccessToken(entry, env);
  await env.RESERVATIONS.put(`res:${entry.id}`, JSON.stringify(entry));

  const emailResult = entry.email
    ? await mailClientNewMessage(entry, env, new URL(request.url).origin, msg.text, !!msg.proposal)
    : { sent: false, reason: "no_email" };
  return Response.json({ ok: true, entry, emailResult }, { headers: cors() });
}
