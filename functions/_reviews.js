// Demande d'avis Google, envoyée une seule fois le lendemain de la visite.
// Pas de cron côté Pages : la vérification se fait quand le dashboard charge la liste
// (copie déjà en mémoire, aucune lecture KV en plus quand il n'y a rien à envoyer).
import { mailClientReview } from "./_access.js";

// Aucun rattrapage sur l'historique : seules les visites à partir de cette date sont concernées.
export const REVIEW_START_DATE = "2026-11-06";
const SEND_FROM_HOUR = 11; // heure de Paris, le lendemain de la visite
const MAX_DAYS_LATE = 3; // au-delà, on n'envoie plus (dashboard pas ouvert pendant plusieurs jours)
const MAX_ATTEMPTS = 3;
const MAX_PER_RUN = 10;

function parisParts(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour };
}

function shiftDate(date, days) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function reviewUrl(env) {
  if (env.GOOGLE_REVIEW_URL) return String(env.GOOGLE_REVIEW_URL);
  if (env.GOOGLE_PLACE_ID) return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(env.GOOGLE_PLACE_ID)}`;
  return "";
}

export function isReviewDue(e, now = Date.now()) {
  if (!e || e.status !== "accepted") return false;
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(String(e.email || "").trim())) return false;
  if (e.reviewRequestedAt || e.noReview) return false;
  if ((e.reviewRequestAttempts || 0) >= MAX_ATTEMPTS) return false;
  if (e.depositStatus === "debitee" || e.depositGuaranteeStatus === "debitee") return false; // no-show
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || ""))) return false;
  const { date: today, hour } = parisParts(now);
  if (e.date < REVIEW_START_DATE) return false;
  if (e.date >= today) return false; // la visite n'est pas passée
  if (e.date < shiftDate(today, -MAX_DAYS_LATE)) return false;
  if (e.date === shiftDate(today, -1) && hour < SEND_FROM_HOUR) return false;
  return true;
}

export function dueReviews(entries, env, now = Date.now()) {
  if (!env.RESEND_API_KEY || !reviewUrl(env)) return [];
  return (entries || []).filter((e) => isReviewDue(e, now)).slice(0, MAX_PER_RUN);
}

export async function sendDueReviews(env, due, now = Date.now()) {
  const url = reviewUrl(env);
  const results = [];
  for (const candidate of due) {
    try {
      // Relecture de la version à jour : la copie de liste peut être en retard.
      const raw = await env.RESERVATIONS.get(`res:${candidate.id}`);
      if (!raw) continue;
      const entry = JSON.parse(raw);
      if (!isReviewDue(entry, now)) continue;
      const r = await mailClientReview(entry, env, url);
      if (r.sent) {
        entry.reviewRequestedAt = now;
        delete entry.reviewRequestError;
      } else {
        entry.reviewRequestAttempts = (entry.reviewRequestAttempts || 0) + 1;
        entry.reviewRequestError = String(r.reason || "").slice(0, 300);
      }
      await env.RESERVATIONS.put(`res:${entry.id}`, JSON.stringify(entry));
      results.push({ id: entry.id, sent: !!r.sent });
    } catch (e) {
      results.push({ id: candidate.id, sent: false, error: String(e?.message || e).slice(0, 200) });
    }
  }
  return results;
}
