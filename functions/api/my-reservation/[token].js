// GET  /api/my-reservation/:token  -> vue client de la réservation (lien privé reçu par email)
// POST /api/my-reservation/:token  -> { action: "message", text } ou { action: "cancel" }
import { loadByToken, publicView, addMessage, cancelDeadline, mailStaff, mailClientCancelled } from "../../_access.js";
import { expireCheckoutSession, detachPaymentMethod } from "../../_stripe-guarantee.js";

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
const notFound = () => json({ error: "Réservation introuvable. Vérifiez le lien reçu par email." }, 404);

export async function onRequestGet({ env, params }) {
  const entry = await loadByToken(env, params.token);
  if (!entry) return notFound();
  return json(publicView(entry));
}

export async function onRequestPost({ request, env, params, waitUntil }) {
  const entry = await loadByToken(env, params.token);
  if (!entry) return notFound();
  if (Number(request.headers.get("Content-Length")) > 8192) return json({ error: "Message trop long." }, 413);
  let body = {};
  try { body = await request.json(); } catch {}
  const origin = new URL(request.url).origin;
  const later = (p) => (waitUntil ? waitUntil(p) : p);

  if (body.action === "message") {
    const hourAgo = Date.now() - 3600 * 1000;
    if ((entry.messages || []).filter((m) => m.from === "client" && m.at > hourAgo).length >= 15) {
      return json({ error: "Beaucoup de messages en peu de temps : patientez un peu ou appelez-nous." }, 429);
    }
    let msg;
    try { msg = addMessage(entry, "client", body.text); } catch (e) { return json({ error: e.message }, 400); }
    await env.RESERVATIONS.put(`res:${entry.id}`, JSON.stringify(entry));
    later(mailStaff(entry, env, origin, "Nouveau message d'un client", msg.text));
    return json(publicView(entry));
  }

  if (body.action === "cancel") {
    if (entry.status === "declined") return json({ error: "Cette réservation est déjà annulée." }, 409);
    const deadline = cancelDeadline(entry);
    if (deadline === null || Date.now() >= deadline) {
      return json({ error: "L'annulation en ligne n'est plus possible à moins de 48 h : écrivez-nous via la messagerie." }, 409);
    }
    entry.status = "declined";
    entry.cancelledByClient = true;
    entry.cancelledAt = Date.now();
    // Libère la caution : lien fermé, carte retirée. Une caution déposée au bar reste à rendre par l'équipe.
    if (entry.depositLink && !["deposee", "debitee"].includes(entry.depositStatus)) {
      if (entry.stripeCheckoutSessionId && entry.depositGuaranteeStatus !== "enregistree") {
        entry.depositReleaseResult = await expireCheckoutSession(entry.stripeCheckoutSessionId, env);
      }
      if (entry.stripePaymentMethodId) {
        entry.depositReleaseResult = await detachPaymentMethod(entry.stripePaymentMethodId, env);
        delete entry.stripePaymentMethodId;
      }
      entry.depositStatus = "liberee";
      entry.depositGuaranteeStatus = "liberee";
    }
    await env.RESERVATIONS.put(`res:${entry.id}`, JSON.stringify(entry));
    const note = entry.depositStatus === "deposee" ? "\n\nAttention : une caution avait été déposée au bar, à rendre au client." : "";
    later(mailStaff(entry, env, origin, "Réservation annulée par le client", "Le client a annulé sa réservation depuis sa page." + note));
    later(mailClientCancelled(entry, env, origin));
    return json(publicView(entry));
  }

  return json({ error: "Action inconnue." }, 400);
}
