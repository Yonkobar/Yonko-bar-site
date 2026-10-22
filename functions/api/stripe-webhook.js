// POST /api/stripe-webhook
// Gère notamment la validation d'une carte de garantie via Checkout mode=setup.

const TOLERANCE_SECONDS = 300; // Stripe recommande 5 min : bloque le rejeu d'anciens événements.

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyStripeSignature(payload, sigHeader, secret, now = Date.now()) {
  if (!sigHeader || !secret) return false;

  const fields = { v1: [] };
  for (const part of sigHeader.split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "v1") fields.v1.push(v);
    else fields[k] = v;
  }
  if (!fields.t || !fields.v1.length) return false;
  const ts = Number(fields.t);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_SECONDS) return false;

  const signedPayload = `${fields.t}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload)
  );

  const expected = [...new Uint8Array(sigBuf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Stripe peut envoyer plusieurs signatures v1 (rotation du secret).
  return fields.v1.some((sig) => safeEqual(sig, expected));
}

async function stripeGet(path, env) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || JSON.stringify(data));
  return data;
}

export async function onRequestPost({ request, env }) {
  const payload = await request.text();
  const sig = request.headers.get("stripe-signature");

  // Signature obligatoire : sans elle, n'importe qui pourrait marquer une caution comme validée.
  if (!env.STRIPE_WEBHOOK_SECRET) {
    // 500 -> Stripe réessaie pendant 3 jours : aucun événement perdu le temps de configurer le secret.
    console.error("STRIPE_WEBHOOK_SECRET manquant : webhook refusé.");
    return new Response("Webhook not configured", { status: 500 });
  }
  const valid = await verifyStripeSignature(payload, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return new Response("Invalid signature", { status: 400 });

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const reservationId =
      session.metadata?.reservation_id ||
      session.client_reference_id;

    if (reservationId) {
      const raw = await env.RESERVATIONS.get(`res:${reservationId}`);

      if (raw) {
        const entry = JSON.parse(raw);

        if (session.mode === "setup" && session.setup_intent) {
          try {
            const setupIntent = await stripeGet(
              `setup_intents/${encodeURIComponent(session.setup_intent)}`,
              env
            );

            if (setupIntent.status === "succeeded" && setupIntent.payment_method) {
              entry.stripeCustomerId = session.customer || entry.stripeCustomerId || "";
              entry.stripeSetupIntentId = setupIntent.id;
              entry.stripePaymentMethodId = setupIntent.payment_method;

              // Nouveau statut explicite + compatibilité avec le dashboard actuel.
              entry.depositGuaranteeStatus = "enregistree";
              entry.depositStatus = "autorisee";
              entry.depositGuaranteedAt = Date.now();
            } else {
              entry.depositGuaranteeStatus = setupIntent.status || "a_verifier";
            }
          } catch (e) {
            entry.depositGuaranteeStatus = "erreur_webhook";
            entry.depositGuaranteeError = String(e.message || e).slice(0, 300);
          }
        } else if (session.mode === "payment") {
          // Compatibilité avec les anciennes cautions créées avant la migration.
          entry.depositStatus = "autorisee";
          entry.depositGuaranteeStatus ||= "ancienne_autorisation";
        }

        await env.RESERVATIONS.put(`res:${reservationId}`, JSON.stringify(entry));
      }
    }
  }

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object;
    const reservationId = intent.metadata?.reservation_id;

    if (reservationId && intent.metadata?.type === "reservation_guarantee") {
      const raw = await env.RESERVATIONS.get(`res:${reservationId}`);
      if (raw) {
        const entry = JSON.parse(raw);
        entry.depositGuaranteeStatus = "debitee";
        entry.depositStatus = "debitee";
        entry.depositChargedAt = Date.now();
        entry.depositChargePaymentIntentId = intent.id;
        await env.RESERVATIONS.put(`res:${reservationId}`, JSON.stringify(entry));
      }
    }
  }

  return Response.json({ received: true });
}
