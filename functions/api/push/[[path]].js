// Pages service binding PUSH_SERVICE -> yonko-bar-push-preview.
export async function onRequest({request, env, params}) {
  const headers = {'Cache-Control': 'no-store', 'Content-Type': 'application/json'};
  const fail = (error, status) => new Response(JSON.stringify({error}), {status, headers});
  const key = request.headers.get('x-dashboard-key');
  if (!key || !env.DASHBOARD_KEY || key !== env.DASHBOARD_KEY) return fail('Clé du dashboard incorrecte.', 401);
  const origin = new URL(request.url).origin;
  if (request.headers.get('Origin') && request.headers.get('Origin') !== origin) return fail('Origine refusée.', 403);
  const path = Array.isArray(params.path) ? params.path.join('/') : params.path;
  const methods = {config: ['GET'], subscription: ['POST', 'DELETE'], test: ['POST']};
  if (!methods[path]?.includes(request.method)) return fail('Route introuvable.', 404);
  if (!env.PUSH_SERVICE) return fail('Les notifications doivent encore être activées sur le serveur Cloudflare.', 503);
  let body;
  if (request.method !== 'GET') {
    if (Number(request.headers.get('Content-Length')) > 8192) return fail('Requête trop volumineuse.', 413);
    body = await request.text();
    if (body.length > 8192) return fail('Requête trop volumineuse.', 413);
  }
  try {
    return await env.PUSH_SERVICE.fetch(`https://push.internal/${path}`, {
      method: request.method, headers: {'Content-Type': 'application/json', 'x-dashboard-key': key, 'x-app-origin': origin}, body,
    });
  } catch { return fail('Service de notifications indisponible. Réessayez plus tard.', 503); }
}
