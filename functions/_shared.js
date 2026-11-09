import { spaceOf, minConsoText } from "./_spaces.js";
import { htmlToText, wrapEmail } from "./_mail-text.js";
// Vendredi (5) ou samedi (6), date au format AAAA-MM-JJ (jour calendaire, sans fuseau).
export function isWeekendNight(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!m) return false;
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return day === 5 || day === 6;
}

export function computeDepositAmount(entry) {
  const space = spaceOf(entry.type);
  const guests = parseInt(entry.guests, 10) || 0;
  if (space === "cave") return 250;
  // Table (Taverne) : caution uniquement le vendredi et le samedi, au-delà de 6 personnes.
  if (space === "table" && guests > 6 && isWeekendNight(entry.date)) return guests * 3;
  return null; // Bar (entier) sur devis, ou petite table : pas de règle automatique
}

const LOGO_URL = "https://yonkobar.com/icons/logo-192.png";

// Échappe les données saisies par le client avant de les insérer dans un email HTML.
export function escHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatDateFr(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

function row(label, value) {
  return `<tr><td style="padding:6px 0;color:#78726a;font-size:13px;width:120px">${label}</td><td style="padding:6px 0;color:#1a1a1a;font-size:14px;font-weight:600">${value}</td></tr>`;
}

const KARAOKE_NOTE = "Karaoké disponible uniquement en privatisation de la cave et lors des soirées organisées par l'établissement.";

export function buildEmailHtml(entry, opts = {}) {
  const title = opts.title || "Réservation confirmée";
  const intro = opts.intro || "Votre réservation au Yonko Bar est confirmée. Voici le récapitulatif :";
  const datePart = formatDateFr(entry.date);
  const minConso = minConsoText(entry);
  return wrapEmail(`
  <div style="background:#f4f1ec;padding:32px 16px;font-family:-apple-system,Helvetica,Arial,sans-serif">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e1d8">
      <tr>
        <td style="background:linear-gradient(135deg,#ff6e00,#ff8f3d);padding:28px 24px;text-align:center">
          <img src="${LOGO_URL}" width="52" height="52" alt="Yonko Bar" style="display:block;margin:0 auto 10px">
          <div style="color:#1c1c1c;font-size:18px;font-weight:700;letter-spacing:.02em">YONKO BAR</div>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 26px">
          <h1 style="font-size:17px;color:#1a1a1a;margin:0 0 14px">${title}</h1>
          <p style="font-size:14px;color:#1a1a1a;line-height:1.5;margin:0 0 18px">Bonjour ${escHtml(entry.name || "")},<br>${intro}</p>
          <table role="presentation" width="100%" style="border-top:1px solid #e6e1d8;border-bottom:1px solid #e6e1d8;padding:6px 0;margin-bottom:20px">
            ${row("Date", escHtml(datePart))}
            ${row("Heure", escHtml(entry.time || "à confirmer"))}
            ${row("Personnes", escHtml(entry.guests || "?"))}
            ${entry.type ? row("Espace", escHtml(entry.type)) : ""}
          </table>
          ${minConso ? `<p style="font-size:13px;color:#1a1a1a;background:#fff1e6;border:1px solid #ffd9b8;border-radius:8px;padding:10px 14px;margin:0 0 18px">${minConso}</p>` : ""}
          <p style="font-size:13px;color:#78726a;line-height:1.5;margin:0 0 18px">${KARAOKE_NOTE}</p>
          ${entry.depositLink ? `
            <p style="font-size:13.5px;color:#78726a;line-height:1.5;margin:0 0 16px">Pour finaliser, merci de valider votre caution ci-dessous. Le montant est simplement <b>autorisé</b> sur votre carte — il ne sera prélevé qu'en cas d'absence non annoncée.</p>
            <table role="presentation" width="100%"><tr><td align="center">
              <a href="${escHtml(entry.depositLink)}" style="background:#ff6e00;color:#1c1c1c;font-weight:700;font-size:14px;padding:13px 26px;border-radius:8px;text-decoration:none;display:inline-block">Valider ma caution${entry.depositAmount ? " — " + escHtml(entry.depositAmount) + "€" : ""}</a>
            </td></tr></table>
          ` : ""}
          ${opts.manageUrl ? `<p style="font-size:13px;color:#78726a;line-height:1.5;margin:22px 0 0">Suivez votre réservation, annulez-la jusqu'à 48 h avant ou écrivez-nous depuis votre espace :<br><a href="${escHtml(opts.manageUrl)}" style="color:#c25400;font-weight:600">Voir ma réservation</a></p>` : ""}
          <p style="font-size:13px;color:#78726a;margin:24px 0 0">À bientôt,<br>L'équipe du Yonko Bar</p>
        </td>
      </tr>
      <tr>
        <td style="background:#f9f7f4;padding:14px;text-align:center;font-size:11px;color:#a39c90">Yonko Bar — 15 rue Monsieur le Prince, Paris</td>
      </tr>
    </table>
  </div>
  `);
}

export async function sendDepositEmail(entry, env, opts = {}) {
  if (!entry.email) return { sent: false, reason: "no_email" };
  if (!env.RESEND_API_KEY) return { sent: false, reason: "resend_not_configured" };

  const html = buildEmailHtml(entry, opts);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "Yonko Bar <reservations@yonkobar.com>",
      to: [entry.email],
      subject: opts.subject || "Votre réservation au Yonko Bar",
      html,
      text: htmlToText(html),
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return { sent: false, reason: detail };
  }
  return { sent: true };
}
