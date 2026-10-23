import { installTracking } from "./_kv.js";

// Toutes les fonctions serveur passent par ici : les écritures res:* invalident la copie de la liste.
export async function onRequest(context) {
  installTracking(context.env);
  return context.next();
}
