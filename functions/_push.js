// No subscription keys or customer details are sent through this event.
export function notifyNewReservation(env, request, entry) {
  return sendEvent(env, request, {id: entry.id, createdAt: entry.createdAt});
}

// Nouveau message d'un client. Seuls l'identifiant de la réservation et l'heure du message sont transmis :
// le texte reste dans le tableau de bord. Un push worker plus ancien ignore cet événement sans erreur.
export function notifyNewMessage(env, request, entry, msg) {
  return sendEvent(env, request, {id: entry.id, createdAt: entry.createdAt, type: 'message', at: msg.at});
}

async function sendEvent(env, request, event) {
  if (!env.PUSH_SERVICE || !env.DASHBOARD_KEY) return;
  try {
    const response = await env.PUSH_SERVICE.fetch('https://push.internal/event', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-dashboard-key': env.DASHBOARD_KEY, 'x-app-origin': new URL(request.url).origin},
      body: JSON.stringify(event),
    });
    if (!response.ok) console.warn('Push event not delivered', {status: response.status, type: event.type || 'reservation'});
  } catch { console.warn('Push event not delivered', {type: event.type || 'reservation'}); }
}
