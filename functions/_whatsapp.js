// Notification WhatsApp automatique pour l'équipe, envoyée par le serveur dès qu'une demande arrive du site :
// le client n'a rien d'autre à faire que « Envoyer ma demande ».
// Passe par CallMeBot (gratuit, usage personnel) : le message arrive sur le numéro qui a activé la clé.
// Variables Cloudflare Pages : CALLMEBOT_PHONE (ex. +33612345678) et CALLMEBOT_APIKEY (à chiffrer).
// Sans ces deux variables, rien n'est envoyé et la création de la réservation n'est pas affectée.

const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);

export function whatsappText(entry) {
  return [
    "Nouvelle demande - Yonko Bar",
    `Nom: ${clean(entry.name, 80)}`,
    entry.email && `Email: ${clean(entry.email, 80)}`,
    entry.contact && `Tel: ${clean(entry.contact, 40)}`,
    `Date: ${clean(entry.date, 10)}${entry.time ? " à " + clean(entry.time, 5) : ""}`,
    entry.guests && `Personnes: ${clean(entry.guests, 10)}`,
    entry.type && `Espace: ${clean(entry.type, 60)}`,
    entry.notes && `Message: ${clean(entry.notes, 300)}`,
    entry.source && `Via ${clean(entry.source, 30)}`,
  ].filter(Boolean).join("\n");
}

function normalizePhone(raw) {
  const p = String(raw || "").replace(/[^\d+]/g, "");
  return /^0\d{9}$/.test(p) ? "+33" + p.slice(1) : p; // 06… saisi sans indicatif -> +33 6…
}

export async function notifyNewReservationWhatsApp(env, entry) {
  const phone = normalizePhone(env.CALLMEBOT_PHONE);
  const apikey = String(env.CALLMEBOT_APIKEY || "").trim();
  if (!phone || !apikey) return { sent: false, reason: "not_configured" };
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(whatsappText(entry))}&apikey=${encodeURIComponent(apikey)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.warn("WhatsApp notification not delivered", { status: res.status }); // jamais l'URL : elle contient la clé
      return { sent: false, reason: "http_" + res.status };
    }
    return { sent: true };
  } catch {
    console.warn("WhatsApp notification not delivered", { reason: "network" });
    return { sent: false, reason: "network" };
  }
}
