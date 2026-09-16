# Mise en place — 15 minutes

## 1. Créer le namespace KV (le "tiroir" où sont stockées les réservations)
Dans le Dashboard Cloudflare → **Workers & Pages** → **KV** → **Create a namespace**.
Nomme-le `RESERVATIONS`.

## 2. Lier ce namespace à ton projet Pages
Dans ton projet Pages → **Settings** → **Functions** → **KV namespace bindings** → **Add binding**.
- Variable name : `RESERVATIONS`
- Namespace : celui créé à l'étape 1

## 3. Ajouter les variables secrètes
Toujours dans **Settings** → **Environment variables** → **Add variable** (coche "Encrypt" pour les deux) :
- `DASHBOARD_KEY` : invente un mot de passe long, ex. `yonko-2026-xk4mZ` (c'est la clé que toi et tes employés collerez dans le dashboard)
- `STRIPE_SECRET_KEY` : ta clé secrète Stripe (Dashboard Stripe → Developers → API keys → "Secret key", commence par `sk_live_...`)

## 4. Uploader les fichiers
Uploade ce dossier **entier** (en gardant la structure, notamment le dossier `functions/`) aux côtés de ton `index.html` existant, exactement comme tu fais d'habitude. Le dossier `functions/` est ce qui active l'API automatiquement — pas besoin de configuration en plus.

Après l'upload : `dashboard.html` devient accessible à `https://ton-site.com/dashboard.html` — ouvre-le, colle ta `DASHBOARD_KEY`, et c'est parti.

## 5. Brancher le formulaire de ton site
Dans ton `index.html`, remplace (ou complète) l'action actuelle du formulaire par cet appel, avec les bons noms de champs selon ton formulaire actuel :

```js
async function envoyerReservation(data) {
  const res = await fetch("/api/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: data.nom,
      contact: data.telephoneOuEmail,
      date: data.date,       // format AAAA-MM-JJ
      time: data.heure,      // format HH:MM
      guests: data.personnes,
      notes: data.notes,
    }),
  });
  return res.ok;
}
```

Appelle cette fonction au moment où le formulaire est soumis, à la place (ou en plus) de l'envoi WhatsApp actuel.

## Ce que ça donne
- Le client remplit le formulaire → la demande apparaît automatiquement dans le dashboard, en "En attente"
- Tu acceptes → tu cliques "Générer le lien Stripe", tu tapes le montant → le lien est créé et enregistré automatiquement (plus besoin de passer par le Dashboard Stripe à la main)
- Tu cliques "Copier le message" → tu colles dans un email ou WhatsApp au client

## Limite à connaître
La protection par `DASHBOARD_KEY` est simple (un mot de passe partagé), pas un vrai système de comptes. Suffisant pour ton usage interne, mais ne partage cette clé qu'avec ton équipe.

## Optionnel — suivi automatique du paiement de la caution
Un fichier `functions/api/stripe-webhook.js` est inclus : il permet au dashboard de savoir automatiquement quand un client a validé sa caution (affichage "Caution validée" sur la carte). Pour l'activer :
1. Dans Stripe → Developers → Webhooks → **Add endpoint**
2. URL : `https://tonsite.com/api/stripe-webhook`
3. Événement à écouter : `checkout.session.completed`
4. Copie le "Signing secret" (commence par `whsec_...`)
5. Dans Cloudflare → Variables and Secrets → Add → type Secret → nom `STRIPE_WEBHOOK_SECRET`, colle la valeur

Sans cette étape, tout le reste fonctionne normalement — c'est juste l'indicateur "Caution validée" qui restera sur "En attente du client".
