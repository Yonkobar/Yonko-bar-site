// No subscription keys or customer details are sent through this event.
export async function notifyNewReservation(env, request, entry) {
  if (!env.PUSH_SERVICE || !env.DASHBOARD_KEY) return;
  try {
    const response = await env.PUSH_SERVICE.fetch('https://push.internal/event', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-dashboard-key': env.DASHBOARD_KEY, 'x-app-origin': new URL(request.url).origin},
      body: JSON.stringify({id: entry.id, createdAt: entry.createdAt}),
    });
    if (!response.ok) console.warn('Push event deferred to reconciliation', {status: response.status});
  } catch { console.warn('Push event deferred to reconciliation'); }
}
