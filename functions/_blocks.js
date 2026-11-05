// Jours bloqués (complet, privatisé, fermé), pour tout le bar ou un seul espace.
// Clé hors du préfixe « res: » : n'invalide pas la copie de la liste et n'est pas lue par le Worker de notifications.
import { SPACE_LABELS } from "./_spaces.js";

export const BLOCKS_KEY = "meta:blocked-days";
export const BLOCK_SPACES = { all: "Tout le bar", ...SPACE_LABELS };
export const BLOCK_REASONS = { complet: "Complet", privatise: "Privatisé", ferme: "Fermé" };

export async function loadBlocks(env) {
  try {
    const raw = await env.RESERVATIONS.get(BLOCKS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function parisToday(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(now));
}

// Une demande pour l'espace `space` est bloquée si tout le bar est bloqué, si son espace l'est,
// ou si c'est une privatisation du bar entier et qu'une partie du bar est déjà bloquée.
export function findBlock(blocks, date, space) {
  const day = (blocks || []).filter((b) => b.date === date);
  return day.find((b) => b.space === "all") || day.find((b) => b.space === space) || (space === "bar" ? day[0] : null) || null;
}

export function blockMessage(block) {
  if (!block) return "";
  if (block.space === "all") {
    if (block.reason === "ferme") return "Le Yonko Bar est fermé ce jour-là. Choisissez une autre date.";
    if (block.reason === "privatise") return "Le Yonko Bar est privatisé ce jour-là. Choisissez une autre date.";
    return "Le Yonko Bar est complet ce jour-là. Choisissez une autre date.";
  }
  const WORDS = {
    table: { complet: "Les tables sont complètes", privatise: "Les tables sont réservées", ferme: "Les tables sont fermées" },
    cave: { complet: "La cave est complète", privatise: "La cave est privatisée", ferme: "La cave est fermée" },
    bar: { complet: "Le bar est complet", privatise: "Le bar est privatisé", ferme: "Le bar est fermé" },
  };
  const text = (WORDS[block.space] || WORDS.bar)[block.reason] || (WORDS[block.space] || WORDS.bar).complet;
  return `${text} ce jour-là. Choisissez un autre espace ou une autre date.`;
}
