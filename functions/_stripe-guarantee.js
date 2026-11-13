import { buildEmailHtml } from "./_shared.js";
import { cautionUrl } from "./_access.js";
import { htmlToText } from "./_mail-text.js";

async function stripeRequest(path, env, params = null, method = "POST") {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: params ? params.toString() : undefined,
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    throw new Error(data?.error?.message || JSON.stringify(data) || `Stripe HTTP ${res.status}`);
  }
  return data;
}

export async function ensureStripeCustomer(entry, env) {
  if (entry.stripeCustomerId) return entry.stripeCustomerId;

  const params = new URLSearchParams();
  if (entry.email) params.set("email", entry.email);
  if (entry.name) params.set("name", entry.name);
  params.set("metadata[reservation_id]", entry.id);

  const customer = await stripeRequest("customers", env, params);
  entry.stripeCustomerId = customer.id;
  return customer.id;
}

export async function createStripeGuaranteeLink(entry, amountEuros, origin, env) {
  const customerId = await ensureStripeCustomer(entry, env);

  const params = new URLSearchParams();
  params.set("mode", "setup");
  params.append("payment_method_types[]", "card");
  params.set("customer", customerId);
  params.set("success_url", `${origin}/?caution=ok`);
  params.set("cancel_url", `${origin}/?caution=annule`);
  params.set("client_reference_id", entry.id);
  params.set("locale", "fr");

  // Les métadonnées de la Session suffisent pour retrouver la réservation
  // dans le webhook. Aucun paramètre SetupIntent supplémentaire n'est requis.
  params.set("metadata[reservation_id]", entry.id);
  params.set("metadata[deposit_amount]", String(amountEuros));

  // Texte affiché par Stripe sous le bouton de validation de la page de caution.
  const consent =
    `Rien n’est débité aujourd’hui. En validant, vous autorisez Yonko Bar à prélever jusqu’à ${amountEuros} € ` +
    `sur cette carte en cas d’absence non annoncée, selon les conditions de réservation.`;
  params.set("custom_text[submit][message]", consent);

  const session = await stripeRequest("checkout/sessions", env, params);

  if (!session?.url || !session?.id) {
    throw new Error("Stripe n'a pas renvoyé de lien Checkout valide.");
  }

  entry.depositLink = session.url;
  entry.depositAmount = amountEuros;
  entry.depositStatus = "lien_envoye";
  entry.depositGuaranteeStatus = "lien_envoye";
  entry.stripeCheckoutSessionId = session.id;
  entry.depositLinkCreatedAt = Date.now();
  entry.depositLinkExpiresAt = session.expires_at ? session.expires_at * 1000 : null;

  return session.url;
}

// Expire une Checkout Session encore ouverte (lien de caution remplacé).
// Stripe refuse si la session est déjà complétée ou expirée : c'est sans conséquence.
export async function expireCheckoutSession(sessionId, env) {
  if (!sessionId) return { expired: false, reason: "no_session" };
  try {
    await stripeRequest(`checkout/sessions/${encodeURIComponent(sessionId)}/expire`, env, new URLSearchParams());
    return { expired: true };
  } catch (e) {
    return { expired: false, reason: String(e?.message || e).slice(0, 300) };
  }
}

// Retire la carte enregistrée pour la caution chez Stripe (plus aucun débit possible).
export async function detachPaymentMethod(paymentMethodId, env) {
  if (!paymentMethodId) return { detached: false, reason: "no_payment_method" };
  try {
    await stripeRequest(`payment_methods/${encodeURIComponent(paymentMethodId)}/detach`, env, new URLSearchParams());
    return { detached: true };
  } catch (e) {
    return { detached: false, reason: String(e?.message || e).slice(0, 300) };
  }
}

export async function retrieveSetupIntent(setupIntentId, env) {
  return stripeRequest(`setup_intents/${encodeURIComponent(setupIntentId)}`, env, null, "GET");
}

export async function chargeStripeGuarantee(entry, amountEuros, env) {
  if (!entry.stripeCustomerId || !entry.stripePaymentMethodId) {
    throw new Error("Aucune carte enregistrée pour la caution de cette réservation.");
  }

  const params = new URLSearchParams();
  params.set("amount", String(Math.round(amountEuros * 100)));
  params.set("currency", "eur");
  params.set("customer", entry.stripeCustomerId);
  params.set("payment_method", entry.stripePaymentMethodId);
  params.set("confirm", "true");
  params.set("off_session", "true");
  params.set("description", `Caution réservation Yonko Bar — ${entry.name || entry.id}`);
  params.set("metadata[reservation_id]", entry.id);
  params.set("metadata[type]", "reservation_guarantee");

  return stripeRequest("payment_intents", env, params);
}

export async function sendGuaranteeEmail(entry, env, opts = {}) {
  if (!entry.email) return { sent: false, reason: "no_email" };
  if (!env.RESEND_API_KEY) return { sent: false, reason: "resend_not_configured" };

  // Le paragraphe et le bouton de caution sont dans buildEmailHtml (même texte avec ou sans lien Stripe).
  // Le bouton de l'email pointe vers le lien permanent du site (jamais directement vers Stripe, qui expire en 24 h).
  const permanent = cautionUrl(entry, env, opts.manageUrl ? new URL(opts.manageUrl).origin : undefined);
  const html = buildEmailHtml(permanent ? { ...entry, depositLink: permanent } : entry, opts);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "Yonko Bar <reservations@yonkobar.com>",
      to: [entry.email],
      subject: opts.subject || "Votre réservation au Yonko Bar — caution à valider",
      html,
      text: htmlToText(html),
    }),
  });

  if (!res.ok) {
    return { sent: false, reason: (await res.text()).slice(0, 500) };
  }
  // Le client a reçu un lien qui n'expire pas (le dashboard n'affiche plus « lien expiré » pour lui).
  if (permanent) entry.depositLinkPermanent = true;
  return { sent: true };
}
