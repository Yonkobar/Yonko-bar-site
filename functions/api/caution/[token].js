// GET /api/caution/:token  -> lien PERMANENT de caution, envoyé au client par email.
// Retrouve la réservation par son jeton privé, puis redirige vers une page de paiement Stripe valide :
// - la page déjà créée si elle est encore ouverte (un scan antivirus ou un double clic ne crée rien de plus) ;
// - sinon une nouvelle (une Checkout Session Stripe se ferme au bout de 24 h maximum).
// Rien n'est débité : le client enregistre seulement une carte de garantie.
import { loadByToken } from "../../_access.js";
import { createStripeGuaranteeLink } from "../../_stripe-guarantee.js";

const HOUR = 3600 * 1000;
const MIN_REMAINING = 2 * HOUR; // on ne renvoie pas une page qui va se fermer dans l'heure qui vient

const GUARANTEE_DONE = ["enregistree", "liberee", "debitee", "deposee_manuellement", "ancienne_autorisation"];
const DEPOSIT_DONE = ["autorisee", "debitee", "deposee", "liberee"];

const baseHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
};

const redirect = (url) => new Response(null, { status: 302, headers: { ...baseHeaders, Location: url } });

function errorPage(manageHref) {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Caution · Yonko Bar</title></head>
<body style="margin:0;background:#171b20;color:#f4f1ec;font-family:-apple-system,Helvetica,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px">
<div style="max-width:420px;text-align:center"><h1 style="font-size:20px;margin:0 0 12px">Page de paiement indisponible</h1>
<p style="color:#cfc8bb;line-height:1.5;margin:0 0 20px">Impossible d’ouvrir la page pour enregistrer votre carte pour le moment. Rien n’a été débité. Réessayez dans quelques minutes, ou écrivez-nous depuis votre réservation.</p>
<a href="${manageHref}" style="background:#ff6e00;color:#1c1c1c;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block">Ma réservation</a></div></body></html>`;
  return new Response(html, { status: 502, headers: { ...baseHeaders, "Content-Type": "text/html; charset=utf-8" } });
}

// La page Stripe déjà créée est-elle encore ouverte (et pour assez longtemps) ?
export function sessionStillOpen(entry, now = Date.now()) {
  if (!entry.depositLink || !entry.stripeCheckoutSessionId) return false;
  const expires = Number(entry.depositLinkExpiresAt) || (Number(entry.depositLinkCreatedAt) ? Number(entry.depositLinkCreatedAt) + 24 * HOUR : 0);
  return expires - now > MIN_REMAINING;
}

// Une carte reste-t-elle à enregistrer pour cette réservation ?
export function needsCard(entry) {
  return entry.status !== "declined"
    && !!entry.depositLink
    && Number(entry.depositAmount) > 0
    && !GUARANTEE_DONE.includes(entry.depositGuaranteeStatus)
    && !DEPOSIT_DONE.includes(entry.depositStatus);
}

export async function onRequestGet({ request, env, params }) {
  const origin = new URL(request.url).origin;
  const entry = await loadByToken(env, params.token);
  if (!entry) return redirect(`${origin}/ma-reservation`); // jeton inconnu : la page affiche « réservation introuvable »

  const manageHref = `${origin}/ma-reservation?t=${encodeURIComponent(entry.accessToken)}`;
  if (!needsCard(entry)) return redirect(manageHref); // déjà validée, annulée ou sans caution : la page montre l'état

  if (sessionStillOpen(entry)) return redirect(entry.depositLink);

  try {
    const url = await createStripeGuaranteeLink(entry, Number(entry.depositAmount), origin, env);
    await env.RESERVATIONS.put(`res:${entry.id}`, JSON.stringify(entry));
    return redirect(url);
  } catch (e) {
    console.error("Lien de caution permanent : échec Stripe", String(e?.message || e).slice(0, 300));
    return errorPage(manageHref);
  }
}
