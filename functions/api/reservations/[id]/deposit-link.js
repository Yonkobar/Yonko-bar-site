// POST /api/reservations/:id/deposit-link  { amount: 50 }  -> crée un lien de paiement Stripe (protégé)

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-dashboard-key",
  };
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

export async function onRequestPost({ request, env, params }) {
  const key = request.headers.get("x-dashboard-key");
  if (!key || key !== env.DASHBOARD_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  const id = params.id;
  const raw = await env.RESERVATIONS.get(`res:${id}`);
  if (!raw) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }
  const entry = JSON.parse(raw);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    body = {};
  }
  const amountEuros = Number(body.amount);
  if (!amountEuros || amountEuros <= 0) {
    return new Response(JSON.stringify({ error: "amount (in euros) is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  const origin = new URL(request.url).origin;
  const params2 = new URLSearchParams();
  params2.set("mode", "payment");
  params2.set("line_items[0][quantity]", "1");
  params2.set("line_items[0][price_data][currency]", "eur");
  params2.set("line_items[0][price_data][unit_amount]", String(Math.round(amountEuros * 100)));
  params2.set(
    "line_items[0][price_data][product_data][name]",
    `Caution réservation Yonko Bar — ${entry.name}`
  );
  params2.set("success_url", `${origin}/?caution=ok`);
  params2.set("cancel_url", `${origin}/?caution=annule`);
  params2.set("payment_intent_data[capture_method]", "manual");

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params2.toString(),
  });

  const stripeData = await stripeRes.json();
  if (!stripeRes.ok) {
    return new Response(JSON.stringify({ error: "stripe_error", detail: stripeData }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  entry.depositLink = stripeData.url;
  await env.RESERVATIONS.put(`res:${id}`, JSON.stringify(entry));

  return new Response(JSON.stringify({ ok: true, url: stripeData.url, entry }), {
    headers: { "Content-Type": "application/json", ...cors() },
  });
}
