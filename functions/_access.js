// Lien privé « Ma réservation », vue publique, annulation client et messagerie.
// Le lien contient un jeton aléatoire ; la clé KV `tok:<jeton>` pointe vers l'id de la réservation.

export const CANCEL_HOURS = 48;
const MAX_MESSAGES = 200;
const MAX_TEXT = 2000;

export function siteUrl(env, origin) {
  return String(origin || env.SITE_URL || "https://yonkobar.com").replace(/\/$/, "");
}

export function manageUrl(entry, env, origin) {
  return entry.accessToken ? `${siteUrl(env, origin)}/ma-reservation?t=${entry.accessToken}` : "";
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Donne un jeton à la réservation s'il n'en a pas (l'appelant enregistre ensuite la réservation).
export async function ensureAccessToken(entry, env) {
  if (entry.accessToken) return entry.accessToken;
  const token = randomToken();
  await env.RESERVATIONS.put(`tok:${token}`, entry.id);
  entry.accessToken = token;
  return token;
}

export async function loadByToken(env, token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ""))) return null;
  const id = await env.RESERVATIONS.get(`tok:${token}`);
  if (!id) return null;
  const raw = await env.RESERVATIONS.get(`res:${id}`);
  if (!raw) return null;
  const entry = JSON.parse(raw);
  return entry.accessToken === token ? entry : null;
}

// Heure de Paris -> timestamp UTC (gère l'heure d'été).
export function parisToUtc(date, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  if (!m) return null;
  const t = /^(\d{2}):(\d{2})$/.exec(String(time || "")) || [null, "19", "00"];
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const asParis = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return guess - (asParis - guess);
}

export function cancelDeadline(entry) {
  const start = parisToUtc(entry.date, entry.time);
  return start === null ? null : start - CANCEL_HOURS * 3600 * 1000;
}

export function depositState(entry) {
  if (!entry.depositLink && !entry.depositStatus) return "none";
  if (entry.depositStatus === "deposee") return "deposee";
  if (entry.depositStatus === "autorisee") return "ok";
  if (entry.depositStatus === "debitee") return "debitee";
  if (entry.depositStatus === "liberee") return "liberee";
  return entry.depositLink ? "pending" : "none";
}

// Ce que le client peut voir : jamais l'email, le téléphone, les notes internes ni les identifiants Stripe.
export function publicView(entry, now = Date.now()) {
  const deadline = cancelDeadline(entry);
  const deposit = depositState(entry);
  const cancelled = entry.status === "declined";
  return {
    firstName: String(entry.name || "").trim().split(/\s+/)[0] || "",
    name: entry.name || "",
    date: entry.date || "",
    time: entry.time || "",
    guests: entry.guests || "",
    type: entry.type || "",
    status: entry.status,
    cancelledByClient: !!entry.cancelledByClient,
    cancelledOnPrivateaser: !!entry.cancelledOnPrivateaser,
    source: entry.source || "",
    createdAt: entry.createdAt || null,
    confirmedAt: entry.confirmationEmailSentAt || null,
    deposit: {
      state: deposit,
      amount: entry.depositAmount || null,
      link: deposit === "pending" ? entry.depositLink : "",
    },
    cancelDeadline: deadline,
    canCancel: !cancelled && deadline !== null && now < deadline,
    messages: (entry.messages || []).map((m) => ({ from: m.from, text: m.text, at: m.at })),
  };
}

export function addMessage(entry, from, text) {
  const clean = String(text || "").replace(/\r\n/g, "\n").trim().slice(0, MAX_TEXT);
  if (!clean) throw new Error("Message vide.");
  const list = entry.messages || [];
  if (list.length >= MAX_MESSAGES) throw new Error("Trop de messages sur cette réservation : appelez-nous.");
  const msg = { from, text: clean, at: Date.now() };
  entry.messages = [...list, msg];
  if (from === "client") entry.unreadForStaff = (entry.unreadForStaff || 0) + 1;
  return msg;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function sendMail(env, to, subject, html) {
  if (!to || !env.RESEND_API_KEY) return { sent: false, reason: !to ? "no_recipient" : "resend_not_configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM || "Yonko Bar <reservations@yonkobar.com>", to: [to], subject, html }),
    });
    return res.ok ? { sent: true } : { sent: false, reason: (await res.text()).slice(0, 300) };
  } catch (e) {
    return { sent: false, reason: String(e?.message || e).slice(0, 300) };
  }
}

function simpleMail(title, bodyHtml, buttonUrl, buttonLabel) {
  return `<div style="background:#f4f1ec;padding:32px 16px;font-family:-apple-system,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e6e1d8">
  <tr><td style="background:#171b20;padding:20px 24px;color:#ff7a1a;font-weight:700;letter-spacing:.14em;font-size:15px">YONKO BAR</td></tr>
  <tr><td style="padding:26px">
  <h1 style="font-size:17px;color:#1a1a1a;margin:0 0 14px">${esc(title)}</h1>
  <div style="font-size:14px;color:#1a1a1a;line-height:1.55">${bodyHtml}</div>
  ${buttonUrl ? `<p style="margin:22px 0 0"><a href="${esc(buttonUrl)}" style="background:#ff6e00;color:#1c1c1c;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block">${esc(buttonLabel)}</a></p>` : ""}
  <p style="font-size:13px;color:#78726a;margin:24px 0 0">L'équipe du Yonko Bar</p>
  </td></tr>
  <tr><td style="background:#f9f7f4;padding:14px;text-align:center;font-size:11px;color:#a39c90">Yonko Bar — 15 rue Monsieur le Prince, Paris</td></tr>
  </table></div>`;
}

function dateFr(date) {
  if (!date) return "";
  return new Date(date + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

// Message de l'équipe -> email au client avec le lien vers sa page.
export function mailClientNewMessage(entry, env, origin, text) {
  const body = `<p style="margin:0 0 12px">Bonjour ${esc(entry.name || "")},</p>
  <p style="margin:0 0 12px">Vous avez un nouveau message au sujet de votre réservation du ${esc(dateFr(entry.date))} :</p>
  <blockquote style="margin:0;padding:12px 14px;background:#fff4e5;border-radius:8px;white-space:pre-wrap">${esc(text)}</blockquote>`;
  return sendMail(env, entry.email, "Nouveau message du Yonko Bar", simpleMail("Nouveau message", body, manageUrl(entry, env, origin), "Répondre depuis ma réservation"));
}

// Message ou annulation du client -> email à l'équipe (NOTIFY_EMAIL, sinon contact@yonkobar.com).
export function mailStaff(entry, env, origin, subject, text) {
  const body = `<p style="margin:0 0 10px"><b>${esc(entry.name || "")}</b> · ${esc(dateFr(entry.date))} ${esc(entry.time || "")} · ${esc(entry.guests || "?")} pers.</p>
  <blockquote style="margin:0;padding:12px 14px;background:#f4f1ec;border-radius:8px;white-space:pre-wrap">${esc(text)}</blockquote>`;
  return sendMail(env, env.NOTIFY_EMAIL || "contact@yonkobar.com", subject, simpleMail(subject, body, `${siteUrl(env, origin)}/dashboard`, "Ouvrir le tableau de bord"));
}

export function mailClientCancelled(entry, env, origin) {
  const body = `<p style="margin:0 0 12px">Bonjour ${esc(entry.name || "")},</p>
  <p style="margin:0">Votre réservation du ${esc(dateFr(entry.date))}${entry.time ? " à " + esc(entry.time) : ""} est bien annulée.${entry.depositAmount ? " Votre carte de garantie ne sera pas débitée." : ""} À bientôt au Yonko !</p>`;
  return sendMail(env, entry.email, "Annulation de votre réservation au Yonko Bar", simpleMail("Réservation annulée", body, "", ""));
}
