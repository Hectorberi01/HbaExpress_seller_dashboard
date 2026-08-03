# Seller_MP_Next — console vendeur

Console web de gestion de boutique pour HBA Express. Remplace `Seller_MP_Dashboard`
(Blazor .NET 9), qui reste en place tant que cette version ne couvre pas son périmètre.

Même socle technique et même style que `Admin_MP_Next` : Next.js 14 (App Router), React
Query, Tailwind, thème neumorphique partagé. Les composants `src/components/ui/*` sont
identiques aux deux consoles — une correction faite ici doit être reportée là-bas, et
réciproquement.

## Démarrer

```bash
cp .env.local.example .env.local   # puis renseigner SESSION_SECRET
npm install
npm run dev                        # http://localhost:3001
```

`npm run typecheck` lance `tsc --noEmit`.

Le port 3001 évite la collision avec la console admin, qui occupe le 3000.

## Modèle d'authentification

**Aucun jeton n'atteint le navigateur.** Le serveur Next se connecte au BFF, range
l'`accessToken` et le `refreshToken` dans un cookie `httpOnly` chiffré en AES-256-GCM,
puis relaie chaque appel via `/api/bff/…` en y attachant le Bearer.

C'est le point le plus important de cette réécriture. Le tableau de bord Blazor stockait
les deux jetons dans `localStorage`, accessibles à n'importe quel script de la page, et
ne révoquait rien à la déconnexion.

Deux détails à connaître avant de toucher à `src/lib/bff.ts` :

- Le BFF Vendeur renvoie son refresh token **dans le corps JSON**, là où le BFF Admin
  utilise un cookie `__Secure-`. `bff.ts` n'est donc pas recopiable d'une console à
  l'autre.
- Le login emballe les jetons dans `{ mfaRequired, tokens }` ; le refresh les renvoie
  **à plat**. Les deux formes sont traitées explicitement.

## Périmètre actuel

Le BFF Vendeur expose 112 routes sur 18 domaines. Cette console les couvre **tous les quatorze** exposés au vendeur :

| Écran | Route | Endpoints |
| --- | --- | --- |
| Tableau de bord | `/dashboard` | `GET /seller/dashboard` |
| Commandes | `/orders` | `GET /seller/orders`, `GET /seller/orders/{id}` |
| Produits & offres | `/products` | `GET /seller/products`, `/seller/offers`, `/seller/categories`, `/seller/brands` |
| Portefeuille | `/wallet` | `GET /seller/wallet`, `/transactions`, `/withdrawals` · `POST /withdraw` |
| Retours | `/returns` | `GET /seller/returns` · `POST …/{id}/{approve,reject,tracking,received,refund}` |
| Litiges | `/disputes` | `GET /seller/disputes` · `POST /seller/disputes/{id}/messages` |
| Expéditions | `/shipments` | `GET /seller/shipments`, `…/{id}`, `/seller/carriers` · `POST …/{id}/{prepare,ship,deliver,cancel}` |
| Stock | `/inventory` | `GET /seller/inventory`, `/seller/locations` · `POST` lieu, article, réception, ajustement · `PUT` seuil · `DELETE` lieu |
| Finances | `/finance` | `GET /seller/finance/statement?from=&to=`, `/seller/finance/payouts` |
| Avis | `/reviews` | `GET /seller/reviews` · `POST …/{id}/reply`, `…/{id}/flag` |
| Notifications | `/notifications` | `GET /seller/notifications`, `/unread-count`, `/preferences` · `POST …/{id}/read`, `/read-all` · `PUT /preferences` |
| Ma boutique + KYB | `/shop` | `GET /seller/shop` · `PUT /profile`, `/metadata`, `/payout-account` · `POST /logo`, `/kyb-documents/upload` · `GET …/{id}/download` · `DELETE …/{id}` |
| Mon compte | `/account` | `GET/PUT /seller/account/me` · `POST /change-password`, `/mfa/{setup,confirm,disable}`, `/close`, `/request-reactivation` · `DELETE /me` |
| Messagerie | `/messages` | `GET /seller/conversations`, `…/{id}/messages` · `POST` message, pièce jointe, réaction · `DELETE` message (pour tous / pour soi) |

**Le périmètre du tableau de bord Blazor est donc dépassé.** Il omettait Retours et
Litiges sans le dire, et un vendeur pouvait chercher longtemps un remboursement qui
n'existait nulle part — c'est le blocage métier identifié par l'audit, désormais levé.

Seuls Tableau de bord, Commandes et Produits restent en lecture. Tout le reste écrit :
retrait, cycle de retour, réponse à un litige, expédition, stock et entrepôts, réponse à
un avis, préférences push, profil de boutique, pièces KYB, compte, 2FA et messagerie.

### Messagerie : pas de temps réel, et c'est délibéré

Le BFF expose un hub SignalR, authentifié par `?access_token=` en query. S'y abonner
depuis le navigateur imposerait de lui livrer un jeton — c'est-à-dire de défaire la seule
propriété qui distingue cette console du Blazor qu'elle remplace. L'écran interroge donc
périodiquement à travers le proxy (30 s pour la liste, 8 s pour le fil ouvert).

Deux voies permettraient le temps réel sans jeton côté navigateur — le transport
long-polling de SignalR, proxifiable en HTTP ordinaire, ou un flux `text/event-stream`
alimenté par une connexion tenue par le serveur Next. Elles sont écartées faute de
justification, pas par ignorance. Seule la montée en WebSocket est réellement impossible
depuis un route handler de l'App Router.

⚠️ Avant d'accélérer ces intervalles : `GET .../messages` déclenche un
`MarkConversationReadCommand` qui recharge l'agrégat et fait un `SaveChanges` à chaque
appel, et `GET /seller/conversations` ramène tout l'historique de chaque fil puis résout
un nom par conversation (N+1 vers Identity). Ces deux routes sont à alléger d'abord.

## Règles tenues dans tout le code

Elles viennent de `AUDIT_2026-08_Interfaces.md`. Les enfreindre « pour aller vite »
recrée exactement les défauts que cette réécriture corrige.

1. **Jamais de zéro à la place d'une donnée manquante.** Une requête en échec affiche un
   avertissement, pas `0 F CFA`. Le tableau de bord lit `unavailable` renvoyé par le BFF
   et masque les indicateurs concernés ; le portefeuille refuse d'afficher un solde
   qu'il n'a pas pu charger.
2. **Jamais de liste vide silencieuse.** « Aucun mouvement » et « les mouvements n'ont
   pas pu être chargés » sont deux phrases différentes, et la seconde propose de
   réessayer.
3. **Montants en entiers.** Le franc CFA n'a pas de centimes : les champs filtrent à la
   saisie, de sorte que le montant confirmé à l'écran soit exactement celui envoyé.
4. **Confirmation avant tout geste qui touche à l'argent**, avec le montant formaté dans
   le dialogue.
5. **Aucun calcul financier côté client.** Commission, frais et net vendeur viennent de
   l'API. L'application mobile les recalcule avec des taux codés en dur et ment dès que
   le barème change ; on ne reproduit pas cela.
6. **Statuts traduits** via `src/lib/status-labels.ts`, avec accord en genre par domaine.
   Une valeur inconnue reste visible plutôt que masquée.
7. **Un seul émetteur de notifications** : le `MutationCache` de `providers.tsx`. Les
   pages déclarent leur texte dans `meta`, elles n'appellent pas `toastSuccess`.
   `meta.silent` coupe succès **et** erreurs — pour taire seulement le succès, utiliser
   `successMessage: ""`.
8. **Le 401 ramène à la connexion** en conservant la page d'origine (`src/lib/api.ts`).

## Ajouté au backend pour cette console

**`POST /seller/auth/forgot-password` et `/reset-password`** — ils manquaient à la
surface vendeur alors qu'ils existaient déjà côté admin et acheteur (constat §3 de
l'audit backend). Aucun code de domaine nouveau : les commandes
`RequestPasswordResetCommand` et `ResetPasswordCommand` sont partagées. La réponse est
volontairement aveugle (204 que le compte existe ou non) pour ne pas transformer la
route en annuaire des boutiques.

**`GET /seller/disputes`** — un vendeur n'avait aucun moyen de découvrir qu'un litige le
concernait : le module Litiges ne connaît que la commande, et les seules routes
existantes exigeaient de savoir laquelle chercher. La route résout les commandes du
vendeur depuis ses expéditions, puis demande les litiges de ces commandes.

Deux précautions à conserver si cette route évolue :

- **Même critère d'implication que le contrôle d'accès du détail**
  (`SellerBff.IsInvolvedInOrderAsync` : « le vendeur a une expédition sur cette
  commande »). Lister plus largement afficherait des litiges dont le détail répond 403.
- **Le filtrage se fait en base**, via `ListDisputesByOrdersQuery` — ajouté au module
  Litiges pour l'occasion. La première version passait par `ListAllDisputesQuery` puis
  filtrait en mémoire : le plafond de 500 s'appliquait alors aux litiges de toute la
  plateforme, et un litige ouvert pouvait sortir de la fenêtre sans laisser de trace.

**`GET /seller/inventory`** — même situation : on ne pouvait consulter du stock qu'en
partant d'un SKU précis, donc un écran Stock aurait appelé l'API une fois par référence
du catalogue. `ListInventoryByLocationsQuery` (module Inventory) filtre en base sur les
lieux du vendeur — le même chaînage article → localisation → `OwnerId` que les gardes
d'écriture existantes.

**Garde sur la suppression d'un lieu d'expédition.** `DeleteFulfillmentLocationCommand`
ne vérifiait que le propriétaire, et aucune clé étrangère ne rattrapait le reste : les
articles survivaient au lieu, rattachés à un identifiant mort. Comme toute lecture de
stock passe par les lieux du vendeur, ils disparaissaient des écrans **sans
avertissement**, pendant que les offres pointant ce lieu restaient actives. Le domaine
refuse désormais tant qu'une référence y est suivie.

## Pièges rencontrés, à ne pas réintroduire

- **`GET /seller/orders/{id}` renvoie `productName`, pas `name`.** Plusieurs handlers du
  BFF projettent un objet anonyme dont les champs ne suivent pas le record de contrat.
  Écrire le type d'après le `record` C# compile parfaitement et affiche le SKU à la place
  du nom, avec la bonne image juste à côté. Lire le **handler**, pas seulement le contrat.
- **Le statut de paiement des commandes n'est pas `PaymentStatus`.**
  `ToPaymentStatus` réduit tout à `Paid` / `Pending` / `Refunded` / `Failed`. Calquer la
  table de traduction sur l'énumération du module laissait « Paid » en anglais sur la
  majorité des lignes.
- **Le rafraîchissement de session doit être partagé** (`src/lib/bff.ts`). Le BFF révoque
  l'ancien jeton avant d'en émettre un nouveau : quatre requêtes parallèles qui
  rafraîchissent en même temps déconnectent le vendeur. Un `Map` au niveau du module
  sérialise les appels concurrents dans le processus.
- **Le statut d'expédition a deux orthographes.** La file (`GET /seller/shipments`)
  renomme « Preparing » en « Prepared » ; le détail (`GET /seller/shipments/{id}`) ne le
  renomme pas. Filtres, tons de badge et conditions d'affichage doivent traiter les deux
  — n'en retenir qu'une fait disparaître des expéditions d'un onglet.
- **`GET /seller/shipments` renvoie `createdAt`, pas `createdAtUtc`**, contrairement à
  tout le reste de l'API : c'est encore un objet anonyme projeté par le handler.
- **La borne d'un ajustement de stock est le RÉSERVÉ, pas zéro.** `AdjustOnHand` refuse
  dès que `onHand + delta` passe sous les quantités déjà promises à des commandes.
- **Annuler une expédition ne fait que changer son statut.** `Shipment.Cancel()` n'émet
  aucun événement de domaine : ni libération du stock réservé, ni notification à
  l'acheteur. L'écran le dit explicitement plutôt que de laisser croire le contraire.
- **Deux énumérations s'appellent `PayoutStatus`.** Celle de `Payments/IPayoutGateway.cs`
  (Pending, Started, Processing, Sent, Failed, Unknown) et celle de
  `Settlement/SettlementBatch.cs` (Scheduled, Paid, Failed). `GET /seller/finance/payouts`
  sérialise la SECONDE. Se tromper laissait « Scheduled » en anglais sur le statut le
  plus courant.
- **`GET /seller/notifications` est plafonné à 50.** Le compteur de non-lues doit venir
  de `/unread-count`, sinon il est sous-évalué et « Tout marquer comme lu » se désactive
  alors qu'il reste des non-lues plus anciennes.
- **Les préférences de notification sont inversées entre lecture et écriture.** GET
  renvoie `categories: [{key, enabled}]`, PUT attend `mutedCategories`. Envoyer les
  catégories activées couperait exactement celles qu'on vient de demander à recevoir.
- **Le relevé financier n'a pas de champ « net ».** Il se calcule
  `gross − commission − providerFee − refunds`, sur des entiers fournis par le serveur.
  Jamais de `?? 0` sur ces champs : un zéro silencieux ferait apparaître un net égal au
  brut. Attention aussi à `-undefined`, qui vaut `NaN` et passe les gardes naïfs.
- **Les bornes de période doivent être envoyées en UTC explicite.** Le serveur fait
  `SpecifyKind(..., Utc)` sur ce qu'il reçoit : une heure murale sans fuseau est prise
  pour de l'UTC, ce qui décale la fenêtre d'une heure au Bénin (UTC+1).
- **Les erreurs du BFF arrivent en `application/problem+json`.** Cette chaîne ne contient
  PAS « application/json » : tester la seconde faisait lire tous les corps d'erreur comme
  du texte, et chaque message métier soigné côté serveur devenait « Erreur 409 » à
  l'écran. `readBody` teste donc « json » tout court.
- **Tous les 401 ne sont pas des sessions expirées.** Le BFF répond 401 sur un mot de
  passe faux ou un code 2FA invalide. Seul notre proxy pose `sessionExpired: true` ;
  c'est ce marqueur qui déclenche la redirection, sinon une faute de frappe dans un champ
  de confirmation éjectait le vendeur de la console.
- **`SellerAccountMe.Status` est un `UserStatus`, pas un `SellerStatus`.** « Closed »
  n'existe que côté boutique, et fermer une boutique ne touche pas au compte. L'état de
  fermeture se lit sur `GET /seller/shop`.
- **`PayoutProvider` est une énumération fermée** (`MtnMomo`, `MoovMoney`, `Wave`,
  `BankAccount`, `Celtis`), parsée par `Enum.TryParse`. « MTN MoMo » avec une espace est
  rejeté : l'écran propose une liste, jamais un champ libre.
- **Changer son mot de passe révoque toutes les sessions** (`RevokeAllRefreshTokens`), et
  supprimer son compte laisse le jeton d'accès valide ~15 min. Dans les deux cas, appeler
  `apiLogout()` avant de rediriger — sinon la console reste utilisable sur un compte qui
  n'existe plus.

## Reste à faire

- Les quatorze domaines encore grisés dans le menu.
- L'écriture sur le catalogue (création et modification de produits, prix, remises).
- Déploiement : `Dockerfile`, service `docker-compose`, routeur Traefik, workflow CI.
- Suppression de `Seller_MP_Dashboard`, **une fois la parité atteinte** — pas avant.
