// PATCH /api/reservations/:id
import { computeDepositAmount, sendDepositEmail } from "../../_shared.js";
import { createStripeGuaranteeLink, sendGuaranteeEmail } from "../../_stripe-guarantee.js";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-dashboard-key",
  };
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

export async function onRequestDelete({ request, env, params }) {
  const key = request.headers.get("x-dashboard-key");
  if (!key || key !== env.DASHBOARD_KEY) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: cors() });
  }

  const id = params.id;
  await env.RESERVATIONS.delete(`res:${id}`);

  const raw = await env.RESERVATIONS.get("res:index");
  const ids = raw ? JSON.parse(raw) : [];
  await env.RESERVATIONS.put("res:index", JSON.stringify(ids.filter((x) => x !== id)));

  return Response.json({ ok: true }, { headers: cors() });
}

export async function onRequestPatch({ request, env, params }) {
  const key = request.headers.get("x-dashboard-key");
  if (!key || key !== env.DASHBOARD_KEY) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: cors() });
  }

  const id = params.id;
  const raw = await env.RESERVATIONS.get(`res:${id}`);
  if (!raw) {
    return Response.json({ error: "not found" }, { status: 404, headers: cors() });
  }

  const entry = JSON.parse(raw);

  let body = {};
  try {
    body = await request.json();
  } catch {}

  const wasAccepted = entry.status === "accepted";

  if (body.status && ["pending", "accepted", "declined"].includes(body.status)) {
    entry.status = body.status;
  }

  if (typeof body.depositLink === "string") {
    entry.depositLink = body.depositLink.slice(0, 500);
  }

  let stripeError = null;
  let emailResult = null;
  let emailError = null;

  // Les emails et Stripe ne sont déclenchés qu'au passage vers "accepted".
  if (entry.status === "accepted" && !wasAccepted) {
    const amount = computeDepositAmount(entry);

    // Caution automatique seulement si la règle métier en prévoit une,
    // si la réservation n'est pas marquée "pas de caution auto",
    // et si aucun lien n'existe déjà.
    if (amount && !entry.skipAutoDeposit && !entry.depositLink) {
      try {
        const origin = new URL(request.url).origin;
        await createStripeGuaranteeLink(entry, amount, origin, env);
      } catch (e) {
        stripeError = String(e?.message || e).slice(0, 500);
      }
    }

    // Le mail est TOUJOURS tenté, même si Stripe a échoué.
    // Si un lien Stripe existe, le mail contient la garantie.
    // Sinon, c'est une confirmation simple.
    try {
      emailResult = entry.depositLink
        ? await sendGuaranteeEmail(entry, env)
        : await sendDepositEmail(entry, env);

      entry.emailSent = !!emailResult?.sent;

      if (entry.emailSent) {
        entry.confirmationEmailSentAt = Date.now();
        delete entry.confirmationEmailError;
      } else {
        emailError = String(emailResult?.reason || "email_not_sent").slice(0, 500);
        entry.confirmationEmailError = emailError;
      }
    } catch (e) {
      emailError = String(e?.message || e).slice(0, 500);
      entry.emailSent = false;
      entry.confirmationEmailError = emailError;
      emailResult = { sent: false, reason: emailError };
    }
  }

  await env.RESERVATIONS.put(`res:${id}`, JSON.stringify(entry));

  return Response.json(
    { ok: true, entry, stripeError, emailResult, emailError },
    { headers: cors() }
  );
}
