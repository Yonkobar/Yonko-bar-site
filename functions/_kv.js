// Économie de lectures KV.
//
// Avant : chaque actualisation du dashboard (toutes les minutes, sur chaque appareil)
// relisait res:index + CHAQUE réservation (1 + N lectures).
// Maintenant : une copie de la liste complète (meta:res-snapshot) est gardée en KV avec un
// numéro de version (meta:res-rev). Toute écriture sur une clé res:* change res:rev, ce qui
// invalide la copie. Une actualisation sans changement coûte 2 lectures.

const RAW = Symbol.for("yonko.kv.raw");
// Hors du préfixe « res: » : le Worker de notifications parcourt toutes les clés res:* et
// les lit comme des réservations (une valeur non-JSON y faisait planter chaque passage).
const REV_KEY = "meta:res-rev";
const SNAPSHOT_KEY = "meta:res-snapshot";
const LEGACY_KEYS = ["res:rev", "res:snapshot"];
const legacyCleaned = new WeakSet(); // une fois par instance

function tracked(key) {
  return String(key || "").startsWith("res:");
}

export function rawKv(env) {
  const kv = env.RESERVATIONS;
  return (kv && kv[RAW]) || kv;
}

export function isTracked(env) {
  return !!(env.RESERVATIONS && env.RESERVATIONS[RAW]);
}

export async function bumpRev(kv) {
  await kv.put(REV_KEY, `${Date.now()}-${crypto.randomUUID()}`);
}

// Remplace env.RESERVATIONS par une version qui change res:rev après chaque écriture/suppression res:*.
// Idempotent. Si l'environnement n'est pas modifiable, rien ne change et la liste
// retombe sur la lecture complète (comportement d'origine, toujours juste).
export function installTracking(env) {
  try {
    const raw = env && env.RESERVATIONS;
    if (!raw || raw[RAW]) return;
    const wrapped = {
      [RAW]: raw,
      get: (...a) => raw.get(...a),
      getWithMetadata: (...a) => raw.getWithMetadata(...a),
      list: (...a) => raw.list(...a),
      async put(key, ...rest) {
        const out = await raw.put(key, ...rest);
        if (tracked(key)) await bumpRev(raw);
        return out;
      },
      async delete(key, ...rest) {
        const out = await raw.delete(key, ...rest);
        if (tracked(key)) await bumpRev(raw);
        return out;
      },
    };
    env.RESERVATIONS = wrapped;
  } catch {
    // environnement figé : on garde la lecture complète
  }
}

async function readAll(kv) {
  const raw = await kv.get("res:index");
  const ids = raw ? JSON.parse(raw) : [];
  const uniqueIds = [...new Set(ids)];
  const entries = [];
  for (let i = 0; i < uniqueIds.length; i += 20) {
    const batch = await Promise.all(uniqueIds.slice(i, i + 20).map((id) => kv.get(`res:${id}`)));
    for (const r of batch) if (r) entries.push(JSON.parse(r));
  }
  return { ids, uniqueIds, entries };
}

// Toutes les réservations de l'index. Renvoie { entries, ids, uniqueIds (null si copie utilisée) }.
export async function loadAllReservations(env) {
  const kv = rawKv(env);
  if (!isTracked(env)) return readAll(kv);

  const [rev, snapRaw] = await Promise.all([kv.get(REV_KEY), kv.get(SNAPSHOT_KEY)]);
  if (rev && snapRaw) {
    try {
      const snap = JSON.parse(snapRaw);
      if (snap.rev === rev && Array.isArray(snap.entries)) return { entries: snap.entries, ids: null, uniqueIds: null };
    } catch {}
  }

  // Copie absente ou périmée : on reconstruit. La version est lue AVANT la lecture complète :
  // si une écriture arrive pendant ce temps, res:rev change après elle et la copie sera rejetée.
  let current = rev;
  if (!current) {
    await bumpRev(kv);
    current = await kv.get(REV_KEY);
  }
  if (!legacyCleaned.has(kv)) {
    legacyCleaned.add(kv);
    await Promise.all(LEGACY_KEYS.map((k) => kv.delete(k).catch(() => {})));
  }
  const all = await readAll(kv);
  try {
    await kv.put(SNAPSHOT_KEY, JSON.stringify({ rev: current, entries: all.entries }));
  } catch {}
  return all;
}
