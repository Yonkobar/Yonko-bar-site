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
