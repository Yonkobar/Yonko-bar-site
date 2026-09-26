# Application Yonko Bar — version 2026.09.26.2

Cette version reprend la production GitHub `main` au commit
`103f6b52d8441ee5612e8b2e5ee478ae7761db26` (vérifié le 26 septembre 2026)
et conserve le service push déjà présent dans `test-pwa`.

## Nouveautés

- Installation Android, aide intégrée et version visible.
- Réglages « Outils → Application & notifications » : activation, test et désactivation par téléphone.
- Mises à jour signalées sans effacer une saisie en cours.
- Actualisation des réservations à l’ouverture et chaque minute, suspendue pendant une saisie.
- Indication de perte de connexion, écran hors connexion sans données clients en cache.
- Synchronisation Privateaser : réparation de l’index de production conservée, liste actualisée aussi après modification d’une réservation.
- Devis, cautions, planning, statistiques et connexion conservés.

Le service existant conserve les réessais d’envoi et le récap de 14 h (Paris).
Privateaser est signalé après import ; les demandes absentes du flux iCal ne peuvent pas être récupérées par cette source.
Le numéro public et WhatsApp restent identiques à la production. La refonte du site public reste en attente.

## Test réel avant production

Adresse stable : https://test-pwa.yonko-bar-site.pages.dev/dashboard

1. Se connecter avec la clé de test dans Chrome Android.
2. Installer depuis le menu de Chrome ou le bouton proposé.
3. Ouvrir Outils → Application & notifications, activer, puis envoyer un test.
4. Fermer l’application et créer une réservation fictive dans la preview depuis un autre appareil. Vérifier la notification et son ouverture.
5. Désactiver les notifications et vérifier leur arrêt.

Les tests automatisés utilisent des réservations fictives : navigation responsive,
connexion, création, statuts, devis PDF réel (envoi simulé), cautions simulées,
statistiques, protection des API, chiffrement Web Push, réessais, récap et réglages mobiles.
Ils ne prouvent pas la réception sur un téléphone réel.

## Publication ultérieure

Ne pas fusionner aveuglément l’ancienne branche test : elle diverge de main.
Comparer avec la production au moment de publier et appliquer les fichiers nécessaires.
Le Worker de preview est lié exclusivement au stockage YONKO_PREVIEW_RESERVATIONS.
La production aura besoin d’un Worker distinct, de sa propre configuration et du binding
PUSH_SERVICE côté Pages production ; ne pas réutiliser le Worker de preview.
Ne publier aucun fichier de clés VAPID ni secret de dashboard dans GitHub.
Les instructions historiques INSTALLATION-PWA.md décrivent le service existant ; leur
état de déploiement daté du 23 septembre n’est plus un état courant.
