// PATCH /api/reservations/:id
import { computeDepositAmount, sendDepositEmail } from "../../_shared.js";
import { ensureAccessToken, manageUrl } from "../../_access.js";
import { createStripeGuaranteeLink, sendGuaranteeEmail, expireCheckoutSession } from "../../_stripe-guarantee.js";

const EDIT_LABELS = { date: "Date", time: "Heure", guests: "Personnes", type: "Espace", email: "Email" };
const DEPOSIT_FIELDS = [
  "depositLink", "depositAmount", "depositStatus", "depositGuaranteeStatus",
  "stripeCheckoutSessionId", "stripeSetupIntentId", "stripePaymentMethodId",
  "depositGuaranteedAt", "depositLinkCreatedAt", "depositLinkExpiresAt",
];

function editError(message, status = 400) {
  return Response.json({ error: message }, { status, headers: cors() });
}

// body.edit = { date?, time?, guests?, type?, depositAmount?, notifyClient? }
// depositAmount : nombre > 0 = caution souhaitée, 0 = aucune caution, absent = inchangé.
async function handleEdit(entry, edit, request, env) {
  const next = {};
  if ("date" in edit) {
    const v = String(edit.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return editError("Date invalide.");
    next.date = v;
  }
  if ("time" in edit) {
    const v = String(edit.time || "").trim().slice(0, 5);
    if (v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return editError("Heure invalide.");
    next.time = v;
  }
  if ("guests" in edit) {
    const v = String(edit.guests ?? "").trim();
    if (v && !/^[1-9]\d{0,3}$/.test(v)) return editError("Nombre de personnes invalide.");
    next.guests = v;
  }
  if ("type" in edit) {
    next.type = String(edit.type || "").trim().slice(0, 200);
  }
  if ("kitchenNote" in edit) {
    // Note interne (nourriture à préparer, etc.) : jamais envoyée au client.
    next.kitchenNote = String(edit.kitchenNote || "").replace(/\r\n/g, "\n").trim().slice(0, 2000);
  }
  if ("email" in edit) {
    const v = String(edit.email || "").trim().slice(0, 200);
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return editError("Email invalide.");
    next.email = v;
  }

  const changed = Object.keys(next).filter((k) => String(entry[k] ?? "") !== next[k]);
  const before = Object.fromEntries(changed.map((k) => [k, entry[k] ?? ""]));

  const hadDeposit = !!entry.depositLink;
  const currentAmount = hadDeposit ? Number(entry.depositAmount) || 0 : 0;
  let wantedAmount = currentAmount;
  if (edit.depositAmount !== undefined && edit.depositAmount !== null && edit.depositAmount !== "") {
    wantedAmount = Number(edit.depositAmount);
    if (!Number.isFinite(wantedAmount) || wantedAmount < 0) return editError("Montant de caution invalide.");
    wantedAmount = Math.round(wantedAmount * 100) / 100;
  } else if (edit.depositAmount === "") {
    wantedAmount = 0;
  }
  const depositChanged = wantedAmount !== currentAmount;

  if (depositChanged && entry.depositStatus === "debitee") {
    return editError("La caution de cette réservation a déjà été débitée : son montant ne peut plus être modifié.", 409);
  }
  if (depositChanged && entry.depositStatus === "deposee") {
    return editError("Caution déposée au bar : annulez d'abord la validation manuelle pour modifier la caution.", 409);
  }
  if (!changed.length && !depositChanged) {
    return Response.json({ ok: true, entry, changed: [], depositChanged: false }, { headers: cors() });
  }

  Object.assign(entry, next);
  if (changed.length) {
    // Empêche la synchronisation Privateaser d'écraser une modification manuelle.
    entry.lockedFields = [...new Set([...(entry.lockedFields || []), ...changed])];
    entry.modifiedAt = Date.now();
    entry.modifications = [...(entry.modifications || []).slice(-9), { at: entry.modifiedAt, before, after: Object.fromEntries(changed.map((k) => [k, next[k]])) }];
  }

  let stripeError = null;
  let newLink = false;
  let oldSessionResult = null;

  if (depositChanged) {
    // 1. Nouveau lien d'abord : si Stripe échoue, l'ancienne caution reste en place.
    let fresh = null;
    if (wantedAmount > 0) {
      try {
        fresh = { ...entry };
        for (const f of DEPOSIT_FIELDS) delete fresh[f]; // jamais l'ancienne carte sur le nouveau lien
        await createStripeGuaranteeLink(fresh, wantedAmount, new URL(request.url).origin, env);
      } catch (e) {
        stripeError = String(e?.message || e).slice(0, 500);
        fresh = null;
      }
    }

    if (wantedAmount === 0 || fresh) {
      // 2. Annule l'ancienne caution : session expirée si encore ouverte,
      //    carte précédente détachée de la réservation (plus débitable via charge-deposit).
      if (hadDeposit) {
        if (entry.depositGuaranteeStatus !== "enregistree" && entry.stripeCheckoutSessionId) {
          oldSessionResult = await expireCheckoutSession(entry.stripeCheckoutSessionId, env);
        }
        entry.previousDeposits = [...(entry.previousDeposits || []).slice(-4), {
          amount: entry.depositAmount ?? null,
          status: entry.depositGuaranteeStatus || entry.depositStatus || "",
          sessionId: entry.stripeCheckoutSessionId || "",
          paymentMethodId: entry.stripePaymentMethodId || "",
          replacedAt: Date.now(),
        }];
      }
      for (const f of DEPOSIT_FIELDS) delete entry[f];
      entry.depositLink = "";
      if (fresh) {
        for (const f of DEPOSIT_FIELDS) if (fresh[f] !== undefined) entry[f] = fresh[f];
        entry.stripeCustomerId = fresh.stripeCustomerId;
        newLink = true;
      } else {
        // Caution retirée volontairement : pas de caution automatique à l'acceptation.
        entry.skipAutoDeposit = true;
      }
    }
  }

  // Email au client : réservation acceptée, ou nouveau lien de caution à transmettre.
  let emailResult = null;
  let emailError = null;
  const notify = edit.notifyClient !== false;
  const shouldEmail = notify && entry.email && entry.status !== "declined" && (entry.status === "accepted" || newLink) && (changed.some((k) => !["email", "kitchenNote"].includes(k)) || newLink);
  if (shouldEmail) {
    await ensureAccessToken(entry, env);
    const opts = {
      manageUrl: manageUrl(entry, env, new URL(request.url).origin),
      title: "Réservation modifiée",
      intro: "Votre réservation au Yonko Bar a été modifiée. Voici le récapitulatif à jour :",
      subject: "Modification de votre réservation au Yonko Bar",
    };
    try {
      const pendingCard = entry.depositLink && !["enregistree", "deposee_manuellement"].includes(entry.depositGuaranteeStatus);
      emailResult = pendingCard
        ? await sendGuaranteeEmail(entry, env, opts)
        : await sendDepositEmail({ ...entry, depositLink: "" }, env, opts);
      if (emailResult?.sent) {
        entry.modificationEmailSentAt = Date.now();
        if (newLink) entry.emailSent = true;
      } else {
        emailError = String(emailResult?.reason || "email_not_sent").slice(0, 500);
      }
    } catch (e) {
      emailError = String(e?.message || e).slice(0, 500);
      emailResult = { sent: false, reason: emailError };
    }
  }

  await env.RESERVATIONS.put(`res:${entry.id}`, JSON.stringify(entry));

  return Response.json(
    { ok: true, entry, changed, depositChanged, newLink, stripeError, oldSessionResult, emailResult, emailError },
    { headers: cors() }
  );
}

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
  const existing = await env.RESERVATIONS.get(`res:${id}`);
  const token = existing ? JSON.parse(existing).accessToken : null;
  if (token) await env.RESERVATIONS.delete(`tok:${token}`);
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

  // Modification d'une réservation existante (dashboard / application).
  // Traitée à part : ne passe jamais par la logique d'acceptation ci-dessous.
  if (body.edit && typeof body.edit === "object") {
    return handleEdit(entry, body.edit, request, env);
  }

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
      await ensureAccessToken(entry, env);
      const mailOpts = { manageUrl: manageUrl(entry, env, new URL(request.url).origin) };
      emailResult = entry.depositLink
        ? await sendGuaranteeEmail(entry, env, mailOpts)
        : await sendDepositEmail(entry, env, mailOpts);

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
