import {notifyNewReservation} from '../../_push.js';
import { ensureAccessToken } from '../../_access.js';
import { loadAllReservations } from '../../_kv.js';
// GET  /api/reservations  -> liste des réservations (protégé par x-dashboard-key)
// POST /api/reservations  -> créer une réservation (appelé par le formulaire du site, public)

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-dashboard-key",
  };
}

async function getIndex(kv) {
  const raw = await kv.get("res:index");
  return raw ? JSON.parse(raw) : [];
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

export async function onRequestGet({ request, env }) {
  const key = request.headers.get("x-dashboard-key");
  if (!key || key !== env.DASHBOARD_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }
  const { entries, ids, uniqueIds } = await loadAllReservations(env);
  if (ids && uniqueIds.length !== ids.length) {
    await env.RESERVATIONS.put("res:index", JSON.stringify(uniqueIds));
  }
  entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return new Response(JSON.stringify(entries), {
    headers: { "Content-Type": "application/json", ...cors() },
  });
}

export async function onRequestPost({ request, env, waitUntil }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  const fail = (error, status = 400) => new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", ...cors() },
  });

  if (!body || typeof body !== "object" || !body.name || !body.date) {
    return fail("name and date are required");
  }

  // Création depuis le dashboard (clé valide) : seuls ces appels peuvent poser
  // les options internes (pas de caution auto, note cuisine).
  const fromDashboard = !!env.DASHBOARD_KEY && request.headers.get("x-dashboard-key") === env.DASHBOARD_KEY;

  if (!fromDashboard) {
    // Formulaire public : formats stricts pour éviter les données piégées.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) return fail("Date invalide.");
    if (body.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.time))) return fail("Heure invalide.");
    if (body.guests && !/^[1-9]\d{0,3}$/.test(String(body.guests))) return fail("Nombre de personnes invalide.");
    if (body.email && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(String(body.email).trim())) return fail("Email invalide.");

    // Anti-spam : 5 demandes max par heure et par adresse IP.
    const ip = request.headers.get("CF-Connecting-IP");
    if (ip) {
      const rlKey = `rl:res:${ip}`;
      const count = parseInt(await env.RESERVATIONS.get(rlKey), 10) || 0;
      if (count >= 5) return fail("Trop de demandes envoyées. Réessayez plus tard ou contactez-nous sur WhatsApp.", 429);
      await env.RESERVATIONS.put(rlKey, String(count + 1), { expirationTtl: 3600 });
    }
  }

  const id = crypto.randomUUID();
  const entry = {
    id,
    name: String(body.name).slice(0, 200),
    contact: String(body.contact || "").slice(0, 200),
    email: String(body.email || "").trim().slice(0, 200),
    type: String(body.type || "").slice(0, 200),
    date: String(body.date).slice(0, 10),
    time: String(body.time || "").slice(0, 5),
    guests: String(body.guests || "").slice(0, 20),
    notes: String(body.notes || "").slice(0, 1000),
    source: String(body.source || "Manuel").slice(0, 50),
    skipAutoDeposit: fromDashboard && !!body.manual,
    // Note interne (nourriture à préparer…) : uniquement depuis le dashboard.
    ...(fromDashboard && body.manual && body.kitchenNote ? { kitchenNote: String(body.kitchenNote).slice(0, 2000) } : {}),
    status: "pending",
    depositLink: "",
    createdAt: Date.now(),
  };

  // Lien privé « Ma réservation » (renvoyé au formulaire du site pour la page de confirmation).
  await ensureAccessToken(entry, env);
  await env.RESERVATIONS.put(`res:${id}`, JSON.stringify(entry));
  const ids = await getIndex(env.RESERVATIONS);
  ids.push(id);
  await env.RESERVATIONS.put("res:index", JSON.stringify([...new Set(ids)]));

  const notification = notifyNewReservation(env, request, entry);
  if (waitUntil) waitUntil(notification); else await notification;

  return new Response(JSON.stringify({ ok: true, id, token: entry.accessToken }), {
    status: 201,
    headers: { "Content-Type": "application/json", ...cors() },
  });
}
