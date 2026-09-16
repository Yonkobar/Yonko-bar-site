// PATCH /api/reservations/:id  -> mettre à jour le statut ou le lien de caution (protégé)

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-dashboard-key",
  };
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

function computeDepositAmount(entry) {
  const type = (entry.type || "").toLowerCase();
  const guests = parseInt(entry.guests, 10) || 0;
  if (type.includes("privatisation")) return 250;
  if (type.includes("taverne") && guests > 6) return guests * 3;
  return null; // "Bar entier" sur devis, ou petite table : pas de règle automatique
}

async function createStripeLink(entry, amountEuros, origin, env) {
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "eur");
  params.set("line_items[0][price_data][unit_amount]", String(Math.round(amountEuros * 100)));
  params.set(
    "line_items[0][price_data][product_data][name]",
    `Caution réservation Yonko Bar — ${entry.name}`
  );
  params.set("success_url", `${origin}/?caution=ok`);
  params.set("cancel_url", `${origin}/?caution=annule`);
  params.set("payment_intent_data[capture_method]", "manual");

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.url;
}

export async function onRequestPatch({ request, env, params }) {
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

  const wasAccepted = entry.status === "accepted";
  if (body.status && ["pending", "accepted", "declined"].includes(body.status)) {
    entry.status = body.status;
  }
  if (typeof body.depositLink === "string") {
    entry.depositLink = body.depositLink.slice(0, 500);
  }

  let stripeError = null;
  if (entry.status === "accepted" && !wasAccepted && !entry.depositLink) {
    const amount = computeDepositAmount(entry);
    if (amount) {
      try {
        const origin = new URL(request.url).origin;
        entry.depositLink = await createStripeLink(entry, amount, origin, env);
        entry.depositAmount = amount;
      } catch (e) {
        stripeError = e.message;
      }
    }
  }

  await env.RESERVATIONS.put(`res:${id}`, JSON.stringify(entry));

  return new Response(JSON.stringify({ ok: true, entry, stripeError }), {
    headers: { "Content-Type": "application/json", ...cors() },
  });
}
