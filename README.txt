YONKO BAR — Correctif Stripe carte de garantie

Fichiers à ajouter/remplacer sur la branche MAIN :

1) AJOUTER
functions/_stripe-guarantee.js

2) REMPLACER
functions/api/reservations/[id].js

3) REMPLACER
functions/api/reservations/[id]/deposit-link.js

4) REMPLACER
functions/api/stripe-webhook.js

5) AJOUTER
functions/api/reservations/[id]/charge-deposit.js

Ce correctif :
- remplace l'empreinte bancaire temporaire par Checkout mode=setup ;
- enregistre une carte pour usage futur off_session ;
- conserve le montant maximum de caution dans la réservation ;
- enregistre stripeCustomerId / stripePaymentMethodId après validation ;
- garde depositStatus="autorisee" pour compatibilité avec le dashboard actuel ;
- ajoute depositGuaranteeStatus="enregistree" comme nouveau statut réel ;
- ajoute une API protégée permettant de débiter la caution manuellement plus tard ;
- conserve la compatibilité avec les anciennes Checkout Sessions mode=payment.

IMPORTANT :
- ne modifiez pas STRIPE_SECRET_KEY ni STRIPE_WEBHOOK_SECRET ;
- le webhook existant doit continuer à pointer vers /api/stripe-webhook ;
- ne testez pas un débit réel sans réservation de test contrôlée.
