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
  const ids = await getIndex(env.RESERVATIONS);
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length !== ids.length) {
    await env.RESERVATIONS.put("res:index", JSON.stringify(uniqueIds));
  }
  const entries = [];
  for (const id of uniqueIds) {
    const raw = await env.RESERVATIONS.get(`res:${id}`);
    if (raw) entries.push(JSON.parse(raw));
  }
  entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return new Response(JSON.stringify(entries), {
    headers: { "Content-Type": "application/json", ...cors() },
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  if (!body.name || !body.date) {
    return new Response(JSON.stringify({ error: "name and date are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  const id = crypto.randomUUID();
  const entry = {
    id,
    name: String(body.name).slice(0, 200),
    contact: String(body.contact || "").slice(0, 200),
    email: String(body.email || "").slice(0, 200),
    type: String(body.type || "").slice(0, 200),
    date: String(body.date).slice(0, 10),
    time: String(body.time || "").slice(0, 5),
    guests: String(body.guests || "").slice(0, 20),
    notes: String(body.notes || "").slice(0, 1000),
    source: String(body.source || "Manuel").slice(0, 50),
    skipAutoDeposit: !!body.manual,
    status: "pending",
    depositLink: "",
    createdAt: Date.now(),
  };

  await env.RESERVATIONS.put(`res:${id}`, JSON.stringify(entry));
  const ids = await getIndex(env.RESERVATIONS);
  ids.push(id);
  await env.RESERVATIONS.put("res:index", JSON.stringify([...new Set(ids)]));

  return new Response(JSON.stringify({ ok: true, id }), {
    status: 201,
    headers: { "Content-Type": "application/json", ...cors() },
  });
}
