// GET    /api/blocked-days              -> jours bloqués à venir (public : utilisé par le formulaire du site)
// POST   /api/blocked-days {date, space, reason}   -> bloque (protégé par x-dashboard-key)
// DELETE /api/blocked-days?date=…&space=…          -> débloque (protégé par x-dashboard-key)
import { BLOCKS_KEY, BLOCK_SPACES, BLOCK_REASONS, loadBlocks, parisToday } from "../_blocks.js";

const json = (data, status = 200, extra = {}) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store", ...extra } });

function authorized(request, env) {
  const key = request.headers.get("x-dashboard-key");
  return !!key && !!env.DASHBOARD_KEY && key === env.DASHBOARD_KEY;
}

function upcoming(blocks) {
  const today = parisToday();
  return blocks.filter((b) => b.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.space.localeCompare(b.space));
}

async function save(env, blocks) {
  // On ne garde que les jours à venir : la liste reste courte.
  await env.RESERVATIONS.put(BLOCKS_KEY, JSON.stringify(upcoming(blocks)));
}

export async function onRequestGet({ env }) {
  const blocks = upcoming(await loadBlocks(env)).map(({ date, space, reason }) => ({ date, space, reason }));
  return json(blocks, 200, { "Cache-Control": "public, max-age=60" });
}

export async function onRequestPost({ request, env }) {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  let body = {};
  try { body = await request.json(); } catch {}
  const date = String(body.date || "");
  const space = String(body.space || "all");
  const reason = String(body.reason || "complet");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Date invalide." }, 400);
  if (date < parisToday()) return json({ error: "Impossible de bloquer un jour passé." }, 400);
  if (!BLOCK_SPACES[space]) return json({ error: "Espace invalide." }, 400);
  if (!BLOCK_REASONS[reason]) return json({ error: "Motif invalide." }, 400);

  // Bloquer tout le bar remplace les blocages par espace de ce jour-là.
  const blocks = (await loadBlocks(env)).filter((b) => !(b.date === date && (b.space === space || space === "all")));
  blocks.push({ date, space, reason, createdAt: Date.now() });
  await save(env, blocks);
  return json({ ok: true, blocks: upcoming(blocks) });
}

export async function onRequestDelete({ request, env }) {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || "";
  const space = url.searchParams.get("space") || "";
  const blocks = (await loadBlocks(env)).filter((b) => !(b.date === date && b.space === space));
  await save(env, blocks);
  return json({ ok: true, blocks: upcoming(blocks) });
}
