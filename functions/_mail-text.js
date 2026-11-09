// Aides pour les emails envoyés via Resend : version texte brut + enveloppe HTML complète.
// Sans ces deux éléments, certains clients mail affichent un message vide ou mal décodé
// (fragment HTML sans <html>/<charset>, pas d'alternative texte, logo en data: bloqué).

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

// Version texte brut d'un email HTML : liens conservés sous la forme « libellé : adresse ».
export function htmlToText(html) {
  return String(html || "")
    .replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => `${label.replace(/<[^>]+>/g, "").trim()} : ${href}`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h1|h2|tr|div|blockquote|table)>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Document HTML complet : encodage UTF-8, affichage mobile, thème clair demandé aux clients mail.
export function wrapEmail(inner) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>Yonko Bar</title></head><body style="margin:0;padding:0;background:#f4f1ec;color:#1a1a1a">${inner}</body></html>`;
}
