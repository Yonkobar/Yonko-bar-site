// GET /api/google-rating -> renvoie {rating, count}, mis en cache 24h dans KV pour limiter les appels payants

export async function onRequestGet({ env }) {
  const cacheKey = "google_rating_cache";
  let stale = null;
  try {
    const cached = await env.RESERVATIONS.get(cacheKey);
    if (cached) {
      const data = JSON.parse(cached);
      if (Date.now() - data.fetchedAt < 24 * 60 * 60 * 1000) {
        return jsonResponse(data);
      }
      if (data && data.rating && data.count) stale = data; // ancienne valeur gardée en secours
    }
  } catch (e) {
    // pas de cache, on continue
  }

  if (!env.GOOGLE_PLACES_API_KEY || !env.GOOGLE_PLACE_ID) {
    return jsonResponse(stale ? { ...stale, stale: true } : { rating: null, count: null, error: "not_configured" });
  }

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${env.GOOGLE_PLACE_ID}?fields=rating,userRatingCount`,
      { headers: { "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY } }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));

    const result = {
      rating: data.rating || null,
      count: data.userRatingCount || null,
      fetchedAt: Date.now(),
    };
    if (!result.rating || !result.count) throw new Error("empty_rating");
    await env.RESERVATIONS.put(cacheKey, JSON.stringify(result));
    return jsonResponse(result);
  } catch (e) {
    if (stale) return jsonResponse({ ...stale, stale: true });
    return jsonResponse({ rating: null, count: null, error: String(e.message || e).slice(0, 200) });
  }
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
