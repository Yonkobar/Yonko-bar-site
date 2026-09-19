// POST /api/reservations/:id/send-quote  { pdfBase64, total, lines }  -> envoie le devis par email (protégé)

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

  if (!entry.email) {
    return new Response(JSON.stringify({ error: "Ce client n'a pas d'email enregistré." }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  if (!body.pdfBase64 || !Array.isArray(body.lines) || body.lines.length === 0) {
    return new Response(JSON.stringify({ error: "missing quote data" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  if (!env.RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "Resend n'est pas configuré (RESEND_API_KEY manquante)." }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  const rows = body.lines
    .map((l) => `<tr><td style="padding:4px 0">${l.qty} × ${l.name}</td><td style="padding:4px 0;text-align:right">${(l.qty * l.price).toFixed(2)} €</td></tr>`)
    .join("");

  const html = `
    <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#ff6e00">Devis — Yonko Bar</h2>
      <p>Bonjour ${entry.name || ""},</p>
      <p>Voici le devis pour votre réservation du ${entry.date}${entry.time ? " à " + entry.time : ""}. Le détail est aussi disponible en pièce jointe (PDF).</p>
      <table role="presentation" width="100%" style="border-top:1px solid #e6e1d8;border-bottom:1px solid #e6e1d8;padding:8px 0;margin:16px 0">${rows}</table>
      <p style="font-weight:700;font-size:15px">Total : ${Number(body.total).toFixed(2)} €</p>
      <p>N'hésitez pas à nous contacter pour toute question.</p>
      <p>À bientôt,<br>L'équipe du Yonko Bar</p>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "Yonko Bar <reservations@yonkobar.com>",
      to: [entry.email],
      subject: `Votre devis Yonko Bar — ${entry.name}`,
      html,
      attachments: [{ filename: `devis-${entry.name}.pdf`, content: body.pdfBase64 }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return new Response(JSON.stringify({ error: "email_failed", detail }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", ...cors() },
  });
}
