// POST /api/sync-privateaser
// Lit le flux iCal Privateaser et synchronise les réservations.
// Protégé par x-dashboard-key.

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

function unfoldIcs(ics) {
  return String(ics || "").replace(/\r?\n[ \t]/g, "");
}

function unescapeIcs(s) {
  return (s || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseEvents(ics) {
  const normalized = unfoldIcs(ics);
  const blocks = normalized.split("BEGIN:VEVENT").slice(1);

  return blocks.map((block) => {
    const raw = block.split("END:VEVENT")[0];

    const get = (key) => {
      const m = raw.match(new RegExp(`(?:^|\\r?\\n)${key}(?:;[^:]*)?:(.*)`, "i"));
      return m ? m[1].trim() : "";
    };

    const url = unescapeIcs(get("URL"));
    const codeMatch = url.match(/bookings(?:%2F|\/)([A-Z0-9_-]+)(?:%3F|\?|$)/i);

    return {
      uid: unescapeIcs(get("UID")),
      code: codeMatch ? codeMatch[1] : unescapeIcs(get("UID")),
      summary: unescapeIcs(get("SUMMARY")),
      description: unescapeIcs(get("DESCRIPTION")),
      status: unescapeIcs(get("STATUS")).toUpperCase(),
      dtstart: get("DTSTART"),
    };
  });
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function mapPrivateaserStatus(ev) {
  const status = String(ev.status || "").toUpperCase();
  const text = normalizeText([ev.summary, ev.description].filter(Boolean).join(" "));

  if (status === "CANCELLED") return "declined";
  if (status === "TENTATIVE") return "pending";
  if (status === "CONFIRMED") return "accepted";

  if (
    text.includes("annule") ||
    text.includes("refuse") ||
    text.includes("declined")
  ) {
    return "declined";
  }

  if (
    text.includes("en attente") ||
    text.includes("a valider") ||
    text.includes("pending") ||
    text.includes("tentative")
  ) {
    return "pending";
  }

  if (
    text.includes("confirme") ||
    text.includes("valide") ||
    text.includes("accepted")
  ) {
    return "accepted";
  }

  return "accepted";
}

function toParisDateTime(dtstart) {
  const m = String(dtstart || "").match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/
  );

  if (!m) return { date: "", time: "" };

  const utc = new Date(
    Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  );

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(utc);

  const get = (type) => parts.find((p) => p.type === type)?.value || "";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
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
    return new Response(
      JSON.stringify({ error: "PRIVATEASER_ICS_URL not configured" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...cors() },
      }
    );
  }

  const icsRes = await fetch(env.PRIVATEASER_ICS_URL, {
    headers: { "Cache-Control": "no-cache" },
  });

  if (!icsRes.ok) {
    return new Response(JSON.stringify({ error: "failed to fetch ics feed" }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  const ics = await icsRes.text();
  const events = parseEvents(ics);

  let indexRaw = await env.RESERVATIONS.get("res:index");
  let ids = indexRaw ? [...new Set(JSON.parse(indexRaw))] : [];

  let body = {};
  try {
    body = await request.json();
  } catch {
  }

  let removed = 0;

  if (body.reset) {
    const survivors = [];

    for (const id of ids) {
      const raw = await env.RESERVATIONS.get(`res:${id}`);

      if (raw && JSON.parse(raw).source === "Privateaser") {
        await env.RESERVATIONS.delete(`res:${id}`);
        removed++;
      } else {
        survivors.push(id);
      }
    }

    ids = survivors;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const ev of events) {
    if (!ev.code) continue;

    const id = `priv-${ev.code}`;
    const existingRaw = await env.RESERVATIONS.get(`res:${id}`);
    const existing = existingRaw ? JSON.parse(existingRaw) : null;

    const nameMatch = ev.summary.match(/^(.*)\s-\s(\d+)$/);
    const name = nameMatch ? nameMatch[1].trim() : ev.summary;
    const guests = nameMatch ? nameMatch[2] : "";

    const descLines = ev.description
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const bookingType = descLines[1] || "";
    const phoneLine =
      descLines.find((line) => /^\+?\d[\d\s().-]{6,}$/.test(line)) || "";

    const { date, time } = toParisDateTime(ev.dtstart);
    if (!date) continue;

    const incomingStatus = mapPrivateaserStatus(ev);

    const entry = {
      id,
      name,
      contact: phoneLine,
      email: existing?.email || "",
      type: bookingType,
      date,
      time,
      guests,
      notes: existing?.notes || "Importé depuis Privateaser",
      status: incomingStatus,
      depositLink: existing?.depositLink || "",
      source: "Privateaser",
      skipAutoDeposit: true,
      createdAt: existing?.createdAt || Date.now(),
    };

    if (existing) {
      const merged = {
        ...existing,
        ...entry,
        email: existing.email || entry.email,
        depositLink: existing.depositLink || entry.depositLink,
        depositAmount: existing.depositAmount,
        depositStatus: existing.depositStatus,
        emailSent: existing.emailSent,
      };

      Object.keys(merged).forEach((k) => {
        if (merged[k] === undefined) delete merged[k];
      });

      if (JSON.stringify(existing) !== JSON.stringify(merged)) {
        await env.RESERVATIONS.put(`res:${id}`, JSON.stringify(merged));
        updated++;
      } else {
        skipped++;
      }
    } else {
      await env.RESERVATIONS.put(`res:${id}`, JSON.stringify(entry));
      ids.push(id);
      created++;
    }
  }

  await env.RESERVATIONS.put(
    "res:index",
    JSON.stringify([...new Set(ids)])
  );

  return new Response(
    JSON.stringify({
      ok: true,
      created,
      updated,
      skipped,
      removed,
      total: events.length,
    }),
    {
      headers: { "Content-Type": "application/json", ...cors() },
    }
  );
}
