# Yonko Bar — livraison PWA du 23 septembre 2026

## Ce qui est prêt et ce qui n’a pas été déployé

Le dossier contient les fichiers finaux du site et le service push séparé. GitHub a refusé la création d’un objet Git avec **403 — Resource not accessible by integration**. Aucun commit ni branche distante n’a été modifié. Aucun paramètre Cloudflare n’a été modifié.

La synchronisation des **fichiers** est réalisée localement : dernière version de `main`, dashboard V2 et filtres de date conservés, manifest et icônes de `test-pwa` conservés, service worker enrichi. Le lien vers le manifest et l’enregistrement du service worker ont été ajoutés au dashboard : ils étaient absents du fichier distant vérifié.

Cette livraison est une PWA installable depuis Chrome Android ; elle ne contient pas d’APK. Les notifications reposent sur le vrai protocole Web Push chiffré et un service Cloudflare. Leur réception sur un téléphone fermé n’a pas encore été testée en conditions réelles.

## État distant vérifié

| Élément | État |
|---|---|
| Dépôt | Yonkobar/Yonko-bar-site |
| `main` | `04d686d81438f8f090884a6a02a232ef5847a44a` |
| `test-pwa` | `2e0af35c21d2b2729cf3ade86c1bf67c4d2baa45` |
| Ancêtre commun | `de2f1a6a7d29fd755cd1fd414999a03ec5e931e8` |
| Divergence | 4 commits propres à chaque branche |
| Preview stable | https://test-pwa.yonko-bar-site.pages.dev/dashboard |
| Cloudflare Pages | `yonko-bar-site`, production automatique sur `main` |
| Preview Pages | toutes les branches hors production ; `DASHBOARD_KEY` seule ; **aucun binding** |
| Production Pages | binding `RESERVATIONS` présent ; configuration email/Stripe/Privateaser présente |

Le dashboard, le manifest et le service worker de la preview répondaient HTTP 200. Cela vérifie leur accessibilité, pas le fonctionnement de l’API de réservations : la preview n’a pas encore de stockage lié.

## 1. Uploader sur test-pwa

1. Décompresser le ZIP.
2. Ouvrir le dépôt GitHub et sélectionner **test-pwa**, pas `main`.
3. Uploader le contenu du dossier en conservant les sous-dossiers, notamment `functions`, `icons` et `push-worker`.
4. Vérifier le diff : il inclut le site actuel de `main`, le dashboard, les fichiers PWA et l’ajout du push. Il ne supprime ni les PDF ni les icônes.
5. Enregistrer le commit sur `test-pwa` et attendre la réussite du déploiement Cloudflare Pages.

Ne pas uploader un ZIP unique comme fichier du site. Le répertoire `functions` doit être présent à la racine du dépôt. Un simple glisser-déposer d’assets dans Cloudflare n’est pas un remplacement du déploiement Git avec Pages Functions.

L’upload synchronise le contenu mais ne crée pas, à lui seul, un commit de fusion à deux parents. Pour synchroniser aussi l’historique Git, utiliser un clone propre, récupérer les deux branches, lancer `git merge --no-commit --no-ff origin/main` depuis `test-pwa`, appliquer ces fichiers pour résoudre le conflit du dashboard, puis vérifier et committer la fusion. Si les références ci-dessus ont changé, comparer les nouveaux changements avant d’appliquer cette livraison. Ne pas utiliser de push forcé.

## 2. Configurer le stockage de test

Dans Cloudflare, créer un namespace KV séparé, par exemple `YONKO_PREVIEW_RESERVATIONS`. Dans **Pages → yonko-bar-site → Settings → Preview → Bindings**, lier ce namespace sous le nom `RESERVATIONS`.

Les essais utiliseront des réservations fictives. **Les réservations de production ne seront pas visibles dans ce stockage de test.** Ne pas connecter la preview à la base de production pour effectuer les essais.

Conserver une clé d’accès de test sous `DASHBOARD_KEY`. Aucun secret n’est inclus dans cette archive. Ne pas copier les clés de paiement/email de production dans la preview. L’envoi d’emails, la caution Stripe et l’import Privateaser nécessitent chacun leur configuration dédiée s’ils sont testés ; leur code existant est conservé.

## 3. Installer le service push

Le service est un Worker séparé : les Pages Functions ne disposent pas du déclencheur planifié nécessaire au récap. Il utilise un Durable Object pour les abonnements, les doublons et les envois en attente, et lit le KV de test pour les réservations et le récap.

Dans `push-worker/wrangler.jsonc`, remplacer `REPLACE_WITH_PREVIEW_KV_NAMESPACE_ID` par l’identifiant du namespace de test. Le domaine stable est déjà renseigné. Le nom prévu est `yonko-bar-push-preview`. Le Worker n’expose aucune URL publique (`workers_dev` et `preview_urls` désactivés).

Avec Node.js et l’outil officiel Wrangler, depuis le dossier décompressé :

```text
npx wrangler login
npx wrangler deploy --config push-worker/wrangler.jsonc
node push-worker/generate-vapid.mjs
```

La dernière commande crée `vapid-keys.json` **uniquement sur l’ordinateur**. Ce fichier est exclu de Git ; ne jamais l’uploader, même manuellement. Stocker ses valeurs dans les secrets du Worker puis conserver une sauvegarde sécurisée. La clé privée doit rester uniquement côté serveur.

Ajouter les secrets du Worker avec Cloudflare ou `npx wrangler secret put NOM --config push-worker/wrangler.jsonc` :

| Nom | Valeur |
|---|---|
| `VAPID_PUBLIC_KEY` | clé publique générée |
| `VAPID_PRIVATE_KEY` | clé privée générée |
| `VAPID_SUBJECT` | `mailto:` suivi d’une adresse email de contact réelle que vous gérez |
| `DASHBOARD_KEY` | même clé que le dashboard **de preview** |

`APP_ORIGIN` est déjà défini dans la configuration : `https://test-pwa.yonko-bar-site.pages.dev`.

Le fichier Wrangler crée le Durable Object et le déclencheur toutes les cinq minutes, à partir de 00, 05, 10… Le code convertit l’heure planifiée vers `Europe/Paris` et prépare une seule fois le récap du jour à partir de 14 h. La fenêtre de rattrapage se termine à 15 h. Cloudflare ou le téléphone peuvent retarder la réception : il ne s’agit pas d’une garantie à la seconde.

Dans **Pages → Settings → Preview → Bindings**, ajouter le binding de service :

- Nom : `PUSH_SERVICE`
- Service : `yonko-bar-push-preview`

Redéployer `test-pwa` après l’ajout des bindings. Ouvrir uniquement l’adresse stable ci-dessus : les URL temporaires par déploiement sont volontairement refusées par le service push, pour ne pas multiplier les installations et abonnements.

Consulter les quotas du compte avant activation permanente. Le contrôle de secours fait environ 288 parcours KV par jour (davantage si la liste est paginée), plus les lectures de nouveaux dossiers et du récap. L’envoi direct ne dépend pas de ce délai. Un compte gratuit peut imposer des limites selon le volume ; aucun forfait payant n’a été activé.

## 4. Vérifier sur Android

1. Dans Chrome Android, ouvrir l’URL stable, se connecter au dashboard puis utiliser « Installer l’application » si proposé, ou le menu Chrome d’installation.
2. Appuyer sur **Activer les notifications**, autoriser Chrome, puis **Tester**. Le test passe par le serveur et le fournisseur push ; il ne simule pas une notification locale.
3. Fermer normalement la PWA. Depuis un autre appareil, créer une demande fictive dans la **preview**. Vérifier la réception et l’ouverture du dashboard au toucher.
4. Vérifier une nouvelle création lorsque le téléphone est hors réseau, puis le reconnecter. L’acceptation par le fournisseur ne garantit pas que le téléphone a déjà affiché le message.
5. Vérifier le récap à 14 h Paris, avec des réservations fictives acceptées et en attente pour la date du jour.
6. Désactiver les notifications et vérifier l’arrêt de réception. La déconnexion retire aussi l’abonnement de cet appareil.

Un arrêt forcé de Chrome dans les réglages Android, un refus d’autorisation ou certaines restrictions de batterie peuvent empêcher la réception. Fermer la fenêtre de la PWA ne correspond pas à un arrêt forcé du navigateur.

## Comportement et limites

- **Nouvelle demande créée par l’API** : événement serveur après sauvegarde, envoi Web Push immédiat si le service est disponible. En cas d’échec, réconciliation toutes les cinq minutes, augmentée du délai de cohérence KV.
- **Réservation ajoutée par un autre chemin**, notamment un import Privateaser : détectée au contrôle périodique après son apparition dans le KV. Cette livraison ne lance pas de nouvel import Privateaser autonome ; elle conserve le déclenchement existant du dashboard.
- **Historique** : les réservations déjà présentes à la première activation servent de référence et ne provoquent pas de rafale d’alertes.
- **Récap** : réservations du jour hors refus, nombres acceptés/en attente et total des invités. Aucune coordonnée client dans le push.
- **Devis accepté** : non détectable dans l’application actuelle. L’envoi du devis ne conserve pas d’état d’acceptation et ne propose pas de signature ni de webhook d’acceptation. Une caution Stripe ou une réservation acceptée n’est pas assimilée à un devis accepté. Il faut une future source de preuve explicite pour activer cette alerte.
- **Confidentialité** : API push protégée par la clé existante ; abonnements stockés côté serveur ; clés privées jamais exposées au navigateur ; aucun cache des réservations, devis, Stripe ou du dashboard. Seuls l’écran hors connexion et les icônes sont mis en cache.
- **Fiabilité** : file persistante par appareil, réessais avec attente croissante sur erreur réseau/fournisseur, suppression des abonnements 404/410, expiration des tâches après 24 h. Les tags évitent les alertes empilées du même événement ; une interruption après envoi et avant sauvegarde peut entraîner une nouvelle livraison du même tag. Le service n’annonce pas une garantie « exactement une fois ».
- Jusqu’à 50 abonnements enregistrés, fournisseurs autorisés Google FCM, Mozilla et Apple. L’objectif validé ici reste Chrome Android.
- Cette archive ne modifie pas `main` et n’active rien en production. Une mise en production éventuelle exige d’abord le test réel ci-dessus, puis une configuration distincte pour le domaine et les données de production.

## Contrôles effectués

Onze tests automatisés passent (`node --test tests/push.test.js`) : heure de Paris hiver/été et changements d’heure, calcul du récap, validation d’abonnement et blocage des endpoints détournés, pagination KV, protection des routes, non-envoi historique et dédoublonnage, réessais et expiration, événement direct plus réconciliation, stockage de 5 000 identifiants, déchiffrement RFC8291 et vérification de signature VAPID, affichage/clic du service worker.

Rendu du dashboard vérifié sur ordinateur et à 390 × 844 avec données fictives, sans erreur JavaScript observée et sans débordement horizontal. Filtres À venir/Passées/Toutes les dates conservés. Les icônes originales et le manifest sont conservés à l’identique. La syntaxe des scripts et la concordance avec les fichiers distants ont été contrôlées.

Non exécutés : déploiement de ces nouveaux fichiers, configuration du Worker dans le compte, inscription d’un téléphone réel, notification application fermée et réception effective à 14 h. Aucun email, paiement ou réservation réelle n’a été envoyé lors de ces contrôles.

## Références

- Alias de branche Cloudflare Pages : https://developers.cloudflare.com/pages/configuration/preview-deployments/
- Déclencheurs planifiés (UTC) : https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Push API et service worker : https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- Bibliothèque de chiffrement incluse : https://github.com/block65/webcrypto-web-push
