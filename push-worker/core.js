export function parisClock(time) {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(time));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

// A deliberate allowlist prevents subscription endpoints from becoming an SSRF proxy.
export function validateSubscription(value) {
  if (!value || typeof value.endpoint !== 'string' || value.endpoint.length > 2048) return false;
  try {
    const u = new URL(value.endpoint);
    const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
    if (u.protocol !== 'https:' || u.port || u.username || u.password || u.hash || !allowed.includes(u.hostname)) return false;
    const decode = (s, length) => typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s) && atob(s.replace(/-/g, '+').replace(/_/g, '/')).length === length;
    return decode(value.keys?.p256dh, 65) && decode(value.keys?.auth, 16);
  } catch { return false; }
}

export function summary(entries, date) {
  const today = entries.filter(e => e.date === date && e.status !== 'declined');
  const accepted = today.filter(e => e.status === 'accepted').length;
  const pending = today.filter(e => e.status === 'pending').length;
  const guests = today.reduce((n, e) => n + Math.max(0, parseInt(e.guests, 10) || 0), 0);
  return { title: 'Yonko Bar · Récap de 14 h',
    body: `${today.length} réservation(s) aujourd’hui · ${accepted} acceptée(s) · ${pending} en attente · ${guests} personne(s).`,
    tag: `daily-${date}`, url: '/dashboard' };
}

export async function reservationKeys(kv) {
  let cursor;
  const names = [];
  do {
    const page = await kv.list({ prefix: 'res:', ...(cursor ? {cursor} : {}) });
    names.push(...page.keys.filter(k => k.name !== 'res:index').map(k => k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return names;
}

export async function readReservations(kv, keys) {
  const entries = [];
  for (let i = 0; i < keys.length; i += 20) {
    const batch = await Promise.all(keys.slice(i, i + 20).map(async key => {
      const raw = await kv.get(key);
      if (!raw) return null;
      // A corrupt record must fail the tick, not silently produce an incomplete recap.
      return { key, entry: JSON.parse(raw) };
    }));
    entries.push(...batch.filter(Boolean));
  }
  return entries;
}
