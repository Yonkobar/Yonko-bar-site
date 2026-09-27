import { buildEmailHtml } from "./_shared.js";

async function stripeRequest(path, env, params = null, method = "POST") {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(params ? {"Content-Type": "application/x-www-form-urlencoded"} : {}),
    },
    body: params ? params.toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || JSON.stringify(data));
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

  params.set("metadata[reservation_id]", entry.id);
  params.set("metadata[deposit_amount]", String(amountEuros));

  params.set("setup_intent_data[usage]", "off_session");
  params.set("setup_intent_data[metadata][reservation_id]", entry.id);
  params.set("setup_intent_data[metadata][deposit_amount]", String(amountEuros));

  const consent =
    `En validant, vous autorisez Yonko Bar à enregistrer cette carte comme garantie ` +
    `et à débiter jusqu’à ${amountEuros} € en cas de non-présentation selon les conditions de réservation.`;
  params.set("custom_text[submit][message]", consent);

  const session = await stripeRequest("checkout/sessions", env, params);

  entry.depositLink = session.url;
  entry.depositAmount = amountEuros;
  entry.depositStatus = "lien_envoye";
  entry.depositGuaranteeStatus = "lien_envoye";
  entry.stripeCheckoutSessionId = session.id;
  entry.depositLinkCreatedAt = Date.now();
  entry.depositLinkExpiresAt = session.expires_at ? session.expires_at * 1000 : null;

  return session.url;
}

export async function retrieveSetupIntent(setupIntentId, env) {
  return stripeRequest(`setup_intents/${encodeURIComponent(setupIntentId)}`, env, null, "GET");
}

export async function chargeStripeGuarantee(entry, amountEuros, env) {
  if (!entry.stripeCustomerId || !entry.stripePaymentMethodId) {
    throw new Error("Aucune carte de garantie enregistrée pour cette réservation.");
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

  const intent = await stripeRequest("payment_intents", env, params);

  return intent;
}

export async function sendGuaranteeEmail(entry, env) {
  if (!entry.email) return {sent: false, reason: "no_email"};
  if (!env.RESEND_API_KEY) return {sent: false, reason: "resend_not_configured"};

  let html = buildEmailHtml(entry);

  html = html.replace(
    /Pour finaliser, merci de valider votre caution ci-dessous\.[\s\S]*?absence non annoncée\.<\/p>/,
    `Pour finaliser, merci d’enregistrer votre carte de garantie ci-dessous. ` +
    `Aucun montant n’est débité aujourd’hui. En cas de non-présentation selon les conditions de réservation, ` +
    `Yonko Bar pourra débiter jusqu’à <b>${entry.depositAmount || ""}€</b>.</p>`
  );

  html = html.replace(
    /Valider ma caution(?: — [^<]+)?/,
    `Enregistrer ma carte de garantie${entry.depositAmount ? " — " + entry.depositAmount + "€" : ""}`
  );

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "Yonko Bar <reservations@yonkobar.com>",
      to: [entry.email],
      subject: "Votre réservation au Yonko Bar — garantie",
      html,
    }),
  });

  if (!res.ok) return {sent: false, reason: await res.text()};
  return {sent: true};
}
