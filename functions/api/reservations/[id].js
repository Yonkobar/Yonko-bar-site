// PATCH /api/reservations/:id  -> mettre à jour le statut ou le lien de caution (protégé)

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-dashboard-key",
  };
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

export async function onRequestPatch({ request, env, params }) {
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

  if (body.status && ["pending", "accepted", "declined"].includes(body.status)) {
    entry.status = body.status;
  }
  if (typeof body.depositLink === "string") {
    entry.depositLink = body.depositLink.slice(0, 500);
  }

  await env.RESERVATIONS.put(`res:${id}`, JSON.stringify(entry));

  return new Response(JSON.stringify({ ok: true, entry }), {
    headers: { "Content-Type": "application/json", ...cors() },
  });
}
