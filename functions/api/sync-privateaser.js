// POST /api/sync-privateaser
// Synchronise le flux iCal Privateaser avec les réservations du dashboard.
// Répare automatiquement res:index pour les réservations Privateaser déjà présentes.
// Lit les statuts iCal quand ils sont fournis.
// Aucun reset ni suppression n'est effectué sauf si body.reset === true.

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

    const getLine = (key) => {
      const m = raw.match(new RegExp(`(?:^|\\r?\\n)${key}((?:;[^:]*)*):(.*)`, "i"));
      if (!m) return { params: "", value: "" };
      return { params: m[1] || "", value: (m[2] || "").trim() };
    };

    const uid = unescapeIcs(getLine("UID").value);
    const url = unescapeIcs(getLine("URL").value);
    const dtstartLine = getLine("DTSTART");
    const status = unescapeIcs(getLine("STATUS").value).toUpperCase();
    const summary = unescapeIcs(getLine("SUMMARY").value);
    const description = unescapeIcs(getLine("DESCRIPTION").value);

    const codeMatch =
      url.match(/bookings(?:%2F|\/)([A-Z0-9_-]+)(?:%3F|\?|$)/i) ||
      description.match(/bookings(?:%2F|\/)([A-Z0-9_-]+)(?:%3F|\?|$)/i);

    return {
      uid,
      code: codeMatch ? codeMatch[1] : uid,
      summary,
      description,
      status,
      dtstart: dtstartLine.value,
      dtstartParams: dtstartLine.params,
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

  if (text.includes("annule") || text.includes("refuse") || text.includes("declined")) {
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

  if (text.includes("confirme") || text.includes("valide") || text.includes("accepted")) {
    return "accepted";
  }

  return "accepted";
}

function partsInParis(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value || "";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function parseIcalDateTime(value) {
  const v = String(value || "").trim();

  let m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    return partsInParis(d);
  }

  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0));
    return partsInParis(d);
  }

  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (m) {
    return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
  }

  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})$/);
  if (m) {
    return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
  }

  m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    return { date: `${m[1]}-${m[2]}-${m[3]}`, time: "" };
  }

  return { date: "", time: "" };
}

function shortText(s, max = 160) {
  const clean = String(s || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
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

  const targetDates = new Set(["2026-09-26", "2026-10-22", "2026-10-30"]);
  const diagnosticByDate = {
    "2026-09-26": [],
    "2026-10-22": [],
    "2026-10-30": [],
  };

  for (const ev of events) {
    const parsed = parseIcalDateTime(ev.dtstart);
    if (parsed.date && targetDates.has(parsed.date)) {
      diagnosticByDate[parsed.date].push({
        uid: ev.uid || "",
        code: ev.code || "",
        summary: ev.summary || "",
        status: ev.status || "(aucun STATUS)",
        dtstart: ev.dtstart || "",
        dtstartParams: ev.dtstartParams || "",
        parsedTime: parsed.time || "",
        description: shortText(ev.description),
      });
    }
  }

  let indexRaw = await env.RESERVATIONS.get("res:index");
  let ids = indexRaw ? [...new Set(JSON.parse(indexRaw))] : [];

  let body = {};
  try {
    body = await request.json();
  } catch {}

  let removed = 0;

  if (body.reset === true) {
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
  const ignored = [];

  for (const ev of events) {
    if (!ev.code) {
      ignored.push({ reason: "missing_code", summary: ev.summary || "", dtstart: ev.dtstart || "" });
      continue;
    }

    const id = `priv-${ev.code}`;

    // Réparation automatique de l'index :
    // une réservation peut exister dans KV mais manquer de res:index.
    // Dans ce cas le synchroniseur la voit, mais le dashboard ne l'affiche pas.
    if (!ids.includes(id)) ids.push(id);

    const existingRaw = await env.RESERVATIONS.get(`res:${id}`);
    const existing = existingRaw ? JSON.parse(existingRaw) : null;

    const nameMatch = ev.summary.match(/^(.*)\s-\s(\d+)$/);
    const name = nameMatch ? nameMatch[1].trim() : (ev.summary || "Réservation Privateaser");
    const guests = nameMatch ? nameMatch[2] : (existing?.guests || "");

    const descLines = String(ev.description || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const bookingType = descLines[1] || existing?.type || "";
    const phoneLine =
      descLines.find((line) => /^\+?\d[\d\s().-]{6,}$/.test(line)) ||
      existing?.contact ||
      "";

    const { date, time } = parseIcalDateTime(ev.dtstart);

    if (!date) {
      ignored.push({
        reason: "unsupported_dtstart",
        code: ev.code,
        summary: ev.summary || "",
        dtstart: ev.dtstart || "",
        dtstartParams: ev.dtstartParams || "",
      });
      continue;
    }

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

  await env.RESERVATIONS.put("res:index", JSON.stringify([...new Set(ids)]));

  const diagPieces = Object.entries(diagnosticByDate).map(([date, list]) => {
    if (!list.length) return `${date}: ABSENTE DU FLUX`;
    return `${date}: ${list.length} événement(s) -> ${list.map(e => `${e.summary || e.code} [${e.status}] ${e.dtstart}`).join(" | ")}`;
  });

  const diagnostic = diagPieces.join(" || ");

  return new Response(
    JSON.stringify({
      ok: true,
      created,
      updated,
      removed,
      total: events.length,
      ignoredCount: ignored.length,
      ignored: ignored.slice(0, 25),
      diagnosticByDate,
      diagnostic,
      skipped: `${skipped} déjà à jour. INDEX-REPAIR-V2. DIAG: ${diagnostic}`,
    }),
    {
      headers: { "Content-Type": "application/json", ...cors() },
    }
  );
}

