// Espaces du bar. Noms affichés dans l'appli : Table, Cave, Bar.
// Les anciens noms (Taverne, Privatisation de la Cave, Bar entier) restent reconnus :
// réservations déjà enregistrées, formulaire du site, imports Privateaser.
export const SPACE_LABELS = { table: "Table", cave: "Cave", bar: "Bar" };

export function spaceOf(type) {
  const t = String(type || "").toLowerCase();
  if (!t.trim()) return null;
  if (t.includes("cave")) return "cave";
  if (t.includes("bar entier") || /(^|[^a-zà-ÿ])bar([^a-zà-ÿ]|$)/.test(t)) return "bar";
  if (t.includes("privatisation")) return "cave"; // ancien libellé « Privatisation » = la cave
  if (t.includes("taverne") || t.includes("table")) return "table";
  return null;
}

// Privatisation de la Cave : minimum de consommation selon le jour de la soirée.
// Mardi, mercredi et jeudi 500 €, vendredi 600 €, samedi 700 €. Dimanche et lundi : sur devis.
export const CAVE_MINIMUM_BY_WEEKDAY = { 2: 500, 3: 500, 4: 500, 5: 600, 6: 700 };

export function caveMinimum(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return null;
  const weekday = new Date(date + "T12:00:00Z").getUTCDay();
  return CAVE_MINIMUM_BY_WEEKDAY[weekday] || null;
}

// Textes rédigés par le bar, repris dans l'accusé de réception de la demande ET dans l'email de confirmation.
//  - Cave du mardi au samedi : minimum du jour (caveMinimum), fermeture à 2h du jeudi au samedi.
//  - Table simple le samedi, plus de 6 personnes (comme le minimum de la page Réserver).
// Dimanche, lundi, bar entier et les autres tables : pas de texte dédié (null) -> emails standards.
// `joiner` : séparateur entre « Merci pour la demande de réservation. » et le premier paragraphe (accusé de réception).
const FOOD_RULE = "La nourriture et boissons extérieures ne sont pas admises sauf pour les gâteaux d'anniversaire. Prévoir vos assiettes et couverts ;)";

export function bookingTemplate(entry) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || ""))) return null;
  const weekday = new Date(entry.date + "T12:00:00Z").getUTCDay();
  const space = spaceOf(entry.type);
  if (space === "cave") {
    const min = caveMinimum(entry.date);
    if (min === null) return null;
    return {
      space, joiner: " ",
      paragraphs: [
        `Pour privatiser la cave nous demandons un minimum de consommation de <b>${min} euros</b>.`,
        "Vous aurez la possibilité de passer votre musique ainsi qu'un karaoké disponible sur le pc en libre service mis à disposition. Vous aurez aussi accès aux consoles de jeux et jeux de sociétés, la salle est aménageable selon votre envie (décoration possible sauf confettis, guirlandes etc...).",
        FOOD_RULE,
        ...(weekday >= 4 ? ["Nous fermons à 2h du matin."] : []),
      ],
    };
  }
  if (space === "table" && weekday === 6 && (parseInt(entry.guests, 10) || 0) > 6) {
    return {
      space, joiner: "<br>",
      paragraphs: [
        "Nous avons de la place pour votre groupe au RDC.<br>Vous aurez accès aux consoles de jeux et jeux de sociétés.",
        "Pour la réservation, nous demandons un minimum de consommation de <b>15 euros/personnes</b>.",
        FOOD_RULE,
      ],
    };
  }
  return null;
}

// Phrase envoyée au client (emails) : le montant exact du jour réservé.
export function minConsoText(entry) {
  const space = spaceOf(entry.type);
  if (space === "cave") {
    const min = caveMinimum(entry.date);
    return min ? `Minimum de consommation : ${min} € pour la soirée.` : "Minimum de consommation : sur devis pour cette date.";
  }
  if (space === "bar") return "Privatisation sur devis — nous vous recontactons pour établir les conditions.";
  if (space === "table") {
    // Uniquement le vendredi et le samedi, au-delà de 6 personnes ; sinon pas de minimum.
    const weekday = /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || "")) ? new Date(entry.date + "T12:00:00Z").getUTCDay() : null;
    const guests = parseInt(entry.guests, 10) || 0;
    if ((weekday === 5 || weekday === 6) && guests > 6) return `Minimum de consommation : 15 € par personne, soit ${guests * 15} € pour ${guests} personnes.`;
    return "";
  }
  return "";
}
