// POST /api/sync-privateaser  -> lit le flux iCal Privateaser et crée les réservations manquantes (protégé)

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

function unescapeIcs(s) {
  return (s || "").replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";");
}

function parseEvents(ics) {
  const blocks = ics.split("BEGIN:VEVENT").slice(1);
  return blocks.map((block) => {
    const raw = block.split("END:VEVENT")[0];
    const get = (key) => {
      const m = raw.match(new RegExp(`${key}(?:;[^:]*)?:(.*)`));
      return m ? m[1].trim() : "";
    };
    return {
      uid: get("UID"),
      summary: unescapeIcs(get("SUMMARY")),
      description: unescapeIcs(get("DESCRIPTION")),
      dtstart: get("DTSTART"),
    };
  });
}

function toParisDateTime(dtstart) {
  // dtstart format: 20260919T180000Z
  const m = dtstart.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return { date: "", time: "" };
  const utc = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(utc);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export async function onRequestPost({ request, env }) {
  const key = request.headers.get("x-dashboard-key");
  if (!key || key !== env.DASHBOARD_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  if (!env.PRIVATEASER_ICS_URL) {
    return new Response(JSON.stringify({ error: "PRIVATEASER_ICS_URL not configured" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  const icsRes = await fetch(env.PRIVATEASER_ICS_URL);
  if (!icsRes.ok) {
    return new Response(JSON.stringify({ error: "failed to fetch ics feed" }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }
  const ics = await icsRes.text();
  const events = parseEvents(ics);

  const indexRaw = await env.RESERVATIONS.get("res:index");
  const ids = indexRaw ? JSON.parse(indexRaw) : [];

  let created = 0;
  let skipped = 0;

  for (const ev of events) {
    if (!ev.uid) continue;
    const id = `priv-${ev.uid}`;
    const existing = await env.RESERVATIONS.get(`res:${id}`);
    if (existing) { skipped++; continue; }

    const nameMatch = ev.summary.match(/^(.*)\s-\s(\d+)$/);
    const name = nameMatch ? nameMatch[1].trim() : ev.summary;
    const guests = nameMatch ? nameMatch[2] : "";

    const descLines = ev.description.split("\n").map((l) => l.trim());
    const bookingType = descLines[1] || "";
    const phoneLine = descLines.find((l) => /^\+?\d[\d\s]{6,}$/.test(l)) || "";

    const { date, time } = toParisDateTime(ev.dtstart);
    if (!date) continue;

    const entry = {
      id,
      name,
      contact: phoneLine,
      email: "",
      type: bookingType,
      date,
      time,
      guests,
      notes: "Importé depuis Privateaser",
      status: "accepted",
      depositLink: "",
      source: "Privateaser",
      skipAutoDeposit: true,
      createdAt: Date.now(),
    };

    await env.RESERVATIONS.put(`res:${id}`, JSON.stringify(entry));
    ids.push(id);
    created++;
  }

  await env.RESERVATIONS.put("res:index", JSON.stringify([...new Set(ids)]));

  return new Response(JSON.stringify({ ok: true, created, skipped, total: events.length }), {
    headers: { "Content-Type": "application/json", ...cors() },
  });
}
