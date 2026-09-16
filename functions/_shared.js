export function computeDepositAmount(entry) {
  const type = (entry.type || "").toLowerCase();
  const guests = parseInt(entry.guests, 10) || 0;
  if (type.includes("privatisation")) return 250;
  if (type.includes("taverne") && guests > 6) return guests * 3;
  return null; // "Bar entier" sur devis, ou petite table : pas de règle automatique
}

export async function createStripeLink(entry, amountEuros, origin, env) {
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

function formatDateFr(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

export function buildEmailHtml(entry) {
  const datePart = formatDateFr(entry.date);
  return `
    <div style="font-family:sans-serif;color:#1a1a1a;max-width:480px;margin:0 auto">
      <h2 style="color:#ff6e00">Réservation confirmée — Yonko Bar</h2>
      <p>Bonjour ${entry.name || ""},</p>
      <p>Votre réservation au Yonko Bar est confirmée pour <b>${datePart}</b> à <b>${entry.time || "l'heure demandée"}</b>, pour <b>${entry.guests || "?"} personne(s)</b>.</p>
      ${entry.depositLink ? `
        <p>Pour finaliser votre réservation, merci de valider votre caution en cliquant sur le lien ci-dessous. Le montant est simplement <b>autorisé</b> sur votre carte, il ne sera prélevé qu'en cas d'absence non annoncée.</p>
        <p><a href="${entry.depositLink}" style="background:#ff6e00;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Valider ma caution (${entry.depositAmount ? entry.depositAmount + "€" : ""})</a></p>
      ` : ""}
      <p>À bientôt,<br>L'équipe du Yonko Bar</p>
    </div>
  `;
}

export async function sendDepositEmail(entry, env) {
  if (!entry.email) return { sent: false, reason: "no_email" };
  if (!env.RESEND_API_KEY) return { sent: false, reason: "resend_not_configured" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "Yonko Bar <reservations@yonkobar.com>",
      to: [entry.email],
      subject: "Votre réservation au Yonko Bar",
      html: buildEmailHtml(entry),
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return { sent: false, reason: detail };
  }
  return { sent: true };
}
