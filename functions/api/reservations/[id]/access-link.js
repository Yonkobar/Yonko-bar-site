// POST /api/reservations/:id/access-link (dashboard) -> lien privé « Ma réservation » du client
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
  if (!entry.accessToken) {
    await ensureAccessToken(entry, env);
    await env.RESERVATIONS.put(`res:${entry.id}`, JSON.stringify(entry));
  }
  return Response.json({ ok: true, url: manageUrl(entry, env, new URL(request.url).origin) }, { headers: cors() });
}
