# Audit — actions inutiles de la console vendeur (web)

Périmètre : les dix-huit écrans de `Seller_MP_Next`, du tableau de bord aux réglages
de compte. Date : 12 septembre 2026.

## Ce qu'on a cherché

Une **action inutile** est un geste que la console demande au vendeur et qui ne lui
rapporte rien. Quatre familles, retenues comme grille de lecture :

1. **Ce qui ne mène à rien** — un contrôle sans destination, ou dont le serveur
   refuse le résultat à tous les coups dans l'état où il est proposé.
2. **Les étapes superflues** — une confirmation pour un geste anodin, une re-saisie
   d'une donnée déjà à l'écran, un clic qui n'ajoute aucune information.
3. **Les redondances** — deux chemins pour le même geste, la même donnée affichée
   deux fois, un rafraîchissement manuel à côté d'un rafraîchissement automatique.
4. **Ce qui n'a pas d'effet observable** — une mutation qui réussit sans que rien ne
   change à l'écran, faute d'invalidation de cache ou d'affichage du résultat.

## Méthode, et ce qu'elle ne couvre pas

Chaque constat est appuyé sur le code : une référence côté console, et une référence
côté serveur dès que l'affirmation porte sur ce que le backend fait réellement. Les
routes ont été recoupées une à une entre les appels `bff()` de la console et les
routes montées par `Marketplace.Bff.Seller` ; les invalidations de cache ont été
comparées à l'inventaire complet des `queryKey` de la console, y compris celles des
autres écrans qui affichent la même donnée.

RIEN N'A ÉTÉ EXÉCUTÉ. Ni la console ni le backend n'ont été lancés : il n'y a pas de
SDK .NET disponible, et les constats de comportement sont déduits de la lecture du
code, non d'une observation. Les douze constats classés GRAVE ont été relus
personnellement dans le code, un par un, avant d'être écrits ici.

Les remarques d'esthétique, de nommage et d'accessibilité sont hors sujet et ont été
écartées.

---

# GRAVE — douze constats

Sont classés GRAVE les gestes où le vendeur perd du temps à coup sûr, ou — pire —
croit avoir agi sans avoir agi.

## G1. Le compte de versement Wave ou bancaire rend tout retrait impossible, pour toujours

*Famille 1 — écran « Ma boutique »*

La liste des opérateurs de versement propose cinq entrées
(`src/app/(seller)/shop/page.tsx:33` : `MtnMomo`, `MoovMoney`, `Wave`, `BankAccount`,
`Celtis`). L'enregistrement les accepte toutes. Le retrait, lui, n'en accepte que
trois : `WalletPayout.IsMobileMoney` vaut vrai pour `mtnmomo`, `moovmoney` et
`celtis` uniquement (`WalletCommands.cs:301-302`), et
`RequestWithdrawalCommandHandler` refuse la demande avant toute écriture dès que le
compte n'est pas de ce type (`WalletCommands.cs:57-63`).

Le vendeur qui choisit Wave ou son compte bancaire voit une carte de versement
valide, numéro masqué à l'appui (`shop/page.tsx:418-434`), et chacune de ses
demandes de retrait échoue ensuite — définitivement, sans que rien ne relie l'échec
au choix qu'il a fait des semaines plus tôt.

**À faire :** ne proposer que les trois opérateurs réellement reversables. Si Wave et
le virement bancaire doivent rester visibles pour une raison commerciale, les marquer
« versement indisponible » au moment du choix, pas au moment du refus.

## G2. « Demander un retrait » est proposé sans compte de versement

*Famille 1 — écran « Portefeuille »*

Le bouton n'est désactivé que pendant le chargement du solde
(`src/app/(seller)/wallet/page.tsx:81`), et la page n'interroge jamais
`["seller-shop"]` (`:28-36`) — elle ignore donc si un compte de versement existe.
Le serveur, lui, refuse immédiatement (`WalletCommands.cs:57-63`).

Le vendeur ouvre le dialogue, saisit un montant, confirme, et lit « La demande de
retrait n'a pas pu être enregistrée » sans apprendre que la cause est un compte
manquant — information que l'écran « Ma boutique » possède et affiche.

**À faire :** lire `["seller-shop"]`, déjà en cache puisque le bandeau KYB le charge
(`kyb-banner.tsx:44-48`), désactiver le bouton et renvoyer vers Ma boutique ›
Compte de versement.

## G3. « Fermer » est proposé dans deux états où le serveur refuse

*Famille 1 — écran « Mon compte », zone sensible*

L'écran ne connaît que deux cas : fermée, ou pas (`account/page.tsx:534` :
`closed = shopStatus === "closed"`). Le bouton « Fermer » est donc rendu dans tous
les autres statuts, y compris `PendingReactivation` et `Suspended`, que
`Seller.RequestClosure` refuse l'un et l'autre en 409
(`Seller.cs:407-411` et `:427-432`).

Le moment est prévisible : juste après avoir cliqué « Demander la réactivation »
(`account/page.tsx:560`), qui invalide `["seller-shop"]` et fait basculer le bouton
sur « Fermer ». Rien ne dit au vendeur que sa demande est en cours d'examen, et la
seule action qu'on lui propose est celle que le serveur refuse.

**À faire :** trois états au lieu de deux — fermée → « Demander la réactivation » ;
réactivation demandée → une phrase, aucun bouton ; suspendue → renvoi au support, en
reprenant le message que le domaine écrit déjà (`SellerRights.cs:78-84`).

## G4. La corbeille est proposée sur une pièce KYB déjà vérifiée

*Famille 1 — écran « Ma boutique », documents KYB*

Le bouton Supprimer est rendu pour chaque pièce sans regarder `status` ni
`verifiedAtUtc` (`shop/page.tsx:621-629`), deux champs pourtant reçus
(`src/types/seller.ts:595-597`). `Seller.RemoveKybDocument` refuse en 409 toute pièce
portant `VerifiedAtUtc` (`Seller.cs:232-238`).

Sur une boutique vérifiée, TOUTES les pièces sont dans ce cas. Le vendeur clique la
corbeille, lit un avertissement alarmant, confirme, et récolte un refus.

**À faire :** masquer la corbeille quand `verifiedAtUtc` est renseigné, et afficher
l'issue que le domaine nomme déjà — téléverser une pièce à jour.

## G5. Une catégorie archivée gèle la fiche produit, y compris pour en corriger le nom

*Famille 1 — écran « Produit »*

`UpdateProductCommandHandler` passe par `ProductAttributeGuard.ResolveAsync`
(`UpdateProductCommandHandler.cs:55`), et le contrôle d'archivage y est
inconditionnel — seul le contrôle de feuille est réservé à la création
(`ProductAttributeGuard.cs:106-111` contre `:127`). Toute modification d'un produit
rangé dans une catégorie archivée depuis est donc refusée.

Le formulaire, lui, ne lit jamais le `status` de la catégorie
(`product-identity-form.tsx:92-95`) et affiche deux lignes plus haut que la catégorie
« ne se change pas depuis ici » (`:282-291`). Le message d'erreur du serveur dit
« choisissez-en une autre » — une sortie qui n'existe sur aucune surface vendeur,
`UpdateProductRequest` ne portant aucun `categoryId`
(`SellerCatalogEndpoints.cs:591-593`).

Le vendeur corrige une faute dans sa description, enregistre, et découvre que sa
fiche est définitivement gelée.

**À faire :** lire `category.status` à l'ouverture de la fiche, annoncer le blocage
avant la saisie, et nommer le seul recours réel.

## G6. L'étoile « photo principale » et les flèches se défont l'une l'autre

*Familles 3 et 4 — écran « Produit », photos*

Deux gestes coexistent : l'étoile (`POST .../media/{id}/primary`,
`product-media-manager.tsx:74-79`) et les flèches de réordonnancement
(`PUT .../media/order`, `:81-92`). Côté domaine, `SetPrimaryMedia` change la
principale sans toucher aux positions (`Product.cs:316-330`), tandis que
`ReorderMedia` désigne d'office la première comme principale — il appelle
`UnsetPrimary()` sur toutes puis `ordered[0].MakePrimary()` (`Product.cs:359-364`).

Le vendeur désigne la photo 3 comme principale, permute ensuite les photos 1 et 2
sans toucher à la 3, et l'étoile a sauté sur la première. Son geste précédent est
annulé en silence.

**À faire :** n'exposer qu'un seul geste. Le plus simple : l'étoile déplace la photo
en tête, en un seul appel `order` — et l'écran dit que la première photo est la
principale.

## G7. « La plateforme expédie » ne change strictement rien

*Famille 4 — écran « Produit », mise en vente*

Le vendeur choisit entre « Vous expédiez » et « La plateforme expédie »
(`product-offers-manager.tsx:851-861`), la valeur part au serveur (`:742-756`), et le
badge la lui confirme ensuite sur la fiche (`:398`).

`FulfillmentType` est stocké puis recopié, et lu par personne : hors du module Offers,
ses seules occurrences dans tout `src/` sont des passe-plats
(`SellerOfferEndpoints.cs:154, 210, 299, 312` et `OfferEndpoints.cs:39, 89`). Le
module Shipping crée les expéditions par `(SellerId, ShipFromLocationId)` sans jamais
consulter ce champ (`CreateShipmentsOnOrderConfirmedHandler.cs:47`). La même boîte
continue d'ailleurs d'exiger l'entrepôt du vendeur et son délai de préparation
même en « La plateforme expédie » (`:864-897`).

Le vendeur croit déléguer sa logistique et continue de recevoir toutes les
expéditions à préparer. L'assistant de création, lui, a déjà tranché : il code
`Fbs` en dur (`products/nouveau/page.tsx:419`).

**À faire :** retirer l'option tant que le FBP n'existe pas, comme l'assistant l'a
fait, ou la laisser en la marquant explicitement indisponible.

## G8. Les gestes d'expédition ne rafraîchissent pas la commande d'où ils partent

*Famille 4 — écrans « Expéditions » et « Commande »*

Les quatre mutations du dialogue d'expédition — préparer, expédier, livrer, annuler —
appellent toutes le même `onChanged`, qui n'invalide que `["seller-shipments"]`
(`shipments/page.tsx:219`). La carte « Expéditions » de la commande lit, elle,
`["seller-shipments-by-order", id]` (`orders/[id]/page.tsx:64`) — clé que rien
n'invalide nulle part dans la console, et que `staleTime: 30_000`
(`providers.tsx:68`) fige pendant trente secondes.

Les deux routes servent pourtant la même projection côté serveur
(`SellerFulfillmentEndpoints.cs:82-131`).

Le vendeur part de la commande, marque le colis en préparation, revient sur la
commande — et y lit toujours l'ancien statut et « Transporteur non renseigné ».

**À faire :** invalider aussi `["seller-shipments-by-order"]` (préfixe, sans l'id).

## G9. « Préparer et expédier » est proposé même quand il n'y a rien à préparer

*Familles 1 et 2 — écran « Commande »*

Le bouton est rendu HORS de toute condition (`orders/[id]/page.tsx:395-399`) : à
l'identique quand la carte vient d'écrire « Aucune expédition pour vos lignes »
(`:329-333`), quand le chargement a échoué (`:325-328`), et quand toutes les
expéditions sont livrées ou annulées — cas où l'écran d'arrivée répond « Cette
expédition est terminée : aucune action n'est possible » (`shipments/page.tsx:518`).

Le lien est aveugle : `<Link href="/shipments">`, sans identifiant. L'écran
Expéditions ne lit aucun paramètre d'URL et trie par date décroissante
(`shipments/page.tsx:67-73`). Le vendeur doit y retrouver sa commande à l'œil.

**À faire :** masquer le bouton quand la liste est vide ou entièrement terminée, et
faire pointer le lien sur l'expédition précise — `/shipments?id=…`, lu au montage
pour ouvrir directement le dialogue.

## G10. « Écrire au client » mène à un écran où l'on ne peut pas écrire à ce client

*Famille 1 — écran « Commande »*

Le lien pointe sur `/messages` sans identifiant (`orders/[id]/page.tsx:246-248`).
L'écran Messagerie ne lit ni `useSearchParams` ni `useParams` : il ouvre le fil le
plus récent (`messages/page.tsx:71-92`).

Surtout, le BFF vendeur ne monte AUCUNE route de création de conversation — seulement
la liste, l'envoi dans un fil existant, les pièces jointes, les réactions et les
suppressions (`SellerMessagingEndpoints.cs:20-30`). L'écran le dit lui-même :
« attendez que le client ouvre un nouveau fil depuis son application » (`:464-465`).

Sur une commande dont l'acheteur n'a jamais écrit, ce bouton ne peut rien produire.

**À faire :** n'afficher le lien que si un fil existe avec cet acheteur, et le pointer
sur ce fil. Sinon, ne rien proposer.

## G11. « Signaler » est proposé sur un avis rejeté, que le serveur refuse toujours

*Famille 1 — écran « Avis »*

Le bouton s'affiche dès que le statut n'est pas `flagged` (`reviews/page.tsx:228`),
donc aussi sur `rejected`. `Review.Flag()` refuse en 409 tout avis rejeté
(`Review.cs:95-104`), et la liste vendeur renvoie bien les avis rejetés — son dépôt
ne filtre pas sur le statut, contrairement à la lecture publique
(`ReviewRepository.cs:58-63` contre `:43-44`).

Sur un avis déjà retiré par la modération, le vendeur clique, lit un dialogue,
confirme, et reçoit une erreur. À chaque tentative.

**À faire :** masquer « Signaler » sur `rejected` comme c'est déjà fait pour
`flagged`, et afficher la même phrase d'état.

## G12. Le motif de refus d'un retour est obligatoire et personne ne le relira jamais

*Famille 1 — écran « Retours »*

Le champ est exigé : le bouton « Refuser ce retour » reste inerte tant que le texte
est vide (`returns/page.tsx:562-593`). Le texte est bien transporté et écrit en base
(`SellerReturnEndpoints.cs:57-58`, `ReturnRequest.cs:118-129`).

Il s'arrête là. `RejectionReason` n'apparaît, dans tout le backend, que dans
l'agrégat et sa configuration EF (`ReturnRequestConfiguration.cs:37`) : aucun contrat,
aucun mappeur, aucune requête, aucun endpoint. `ReturnRequestSummary` ne le porte pas,
`Reject` ne lève aucun événement, et le type console ne le déclare pas
(`src/types/seller.ts:259-289`).

Le vendeur rédige une justification à chaque refus. Ni l'acheteur, ni la modération,
ni lui-même dans sa propre console ne la reverront — seule une lecture directe en base
la retrouve.

**À faire :** trancher dans un sens ou dans l'autre. Soit projeter `RejectionReason`
dans `ReturnRequestSummary`, l'afficher sur le retour refusé et le pousser à
l'acheteur ; soit rendre le champ facultatif et cesser de le présenter comme une pièce
du dossier. Le laisser obligatoire et invisible est le seul choix à exclure.

---

# MINEUR — vingt-trois constats

Sont classés MINEUR les gestes qui coûtent un clic, une relecture ou une seconde
d'hésitation, sans faire perdre de travail.

## Ce qui ne mène à rien

**M1. « Mettre en vente » ouvre une boîte vide sur le produit qu'on vient de créer.**
Le bouton n'est désactivé que pendant le chargement des offres
(`product-offers-manager.tsx:181-205`) ; la boîte affiche alors « Toutes les
déclinaisons de ce produit sont déjà en vente » (`:790-798`). Or l'assistant crée
exactement une déclinaison ET une offre dessus (`products/nouveau/page.tsx:389-424`) :
c'est le cas le plus courant. → Désactiver le bouton, l'information est déjà dans le
composant.

**M2. « Supprimer » le produit, et une règle annoncée plus étroite que la vraie.**
Le dialogue dit « si le produit est **encore en vente** » (`products/[id]/page.tsx:318-339`),
alors que le refus 409 compte TOUTES les offres, suspendues comprises
(`SellerCatalogEndpoints.cs:532-544`). Le vendeur qui a suspendu sa vente conclut que
ce n'est pas son cas, clique deux fois, et se prend un refus. → Désactiver tant que
`productOffers.length > 0`, et compter les offres dans le message.

**M3. Tous les boutons d'écriture sont offerts à une boutique suspendue.**
Ni `products/[id]` ni `inventory` n'interrogent `["seller-shop"]`, et le bandeau
global ne regarde que le KYB (`kyb-banner.tsx:44-53`), pas le statut. L'assistant,
lui, fait déjà le contrôle (`products/nouveau/page.tsx:296-301`). → Reprendre ce
contrôle et neutraliser les écritures avec un bandeau unique.

> **CORRECTION DE CET AUDIT (relecture du lot 6).** Cette entrée affirmait que
> « toutes leurs mutations passent par `ResolveSellingSellerAsync` ». C'était faux, et
> `/shop` manquait à la liste des écrans concernés. Cinq routes d'écriture du BFF
> catalogue utilisaient encore `ResolveSellerAsync`, qui rend la boutique quel que soit
> son statut : `CreateWithImagesAsync` (`:157`), `AddMediaAsync` (`:291`),
> `UploadMediaAsync` (`:312`), `AddVariantAsync` (`:353`), `DeleteAsync` (`:499`). Une
> boutique **suspendue ou fermée** pouvait donc créer des produits, y attacher photos
> et déclinaisons, et supprimer des fiches — alors que `SellerRights.CanSell` couvre
> explicitement « produits, variantes, médias ». Pour « Closed », cela **annulait la
> sanction** : la fermeture dépublie le catalogue, il suffisait de le recréer.
> Les quatre premières ont été fermées côté serveur dans le lot 6. La cinquième — la
> suppression — reste ouverte **volontairement**, décision documentée en tête de
> `DeleteAsync` et à trancher (voir « Restant à décider » en fin de document).

**M4. « Répondre » à un avis, même verrou.** Seule écriture de la zone
retours/litiges/avis/messagerie à passer par `ResolveSellingSellerAsync`
(`SellerReviewEndpoints.cs:110-116`) — les autres s'en dispensent délibérément. Le
vendeur suspendu rédige une réponse publique entière avant de l'apprendre. → Lire
`["seller-shop"].status` et désactiver avant la rédaction.

**M5. « Appliquer » sur une période inversée efface le relevé.** Le bouton n'est
jamais désactivé (`finance/page.tsx:153`), la requête est coupée
(`:83`) et le corps rend `null` (`:172`) : les cinq tuiles, le net et le tableau
disparaissent. → Désactiver « Appliquer » tant que `toInput < fromInput`.

**M6. « Demander un retrait » à solde nul, ou avec une demande déjà en cours.**
Le bouton reste actif (`wallet/page.tsx:81`) ; le dialogue ne fait que répéter ce que
la page affiche déjà en clair (`:144-155`), avec un bouton de confirmation inerte.
→ Désactiver en donnant la raison, comme le fait déjà l'export de Finance
(`finance/page.tsx:159`).

## Les étapes superflues

**M7. L'étape 2 de l'assistant ne demande rien.** Le SKU est pré-rempli
(`products/nouveau/page.tsx:210-216`), c'est le seul champ visible (`:716-737`), le
bloc optionnel démarre replié (`:156`) et le poids vaut déjà `"0"` (`:154`). Une étape
entière traversée d'un clic, sur chaque produit. → Replier le SKU dans une autre
étape, et ne remonter une étape dédiée que si le vendeur choisit de personnaliser sa
déclinaison.

**M8. Trois sélecteurs obligent à choisir là où un seul choix existe.** Entrepôt de
l'assistant (`products/nouveau/page.tsx:893-907`), entrepôt de « Suivre une référence »
(`inventory/page.tsx:800-812`), déclinaison et entrepôt de la mise en vente
(`product-offers-manager.tsx:802-882`). Pour le vendeur mono-entrepôt — le cas
majoritaire — c'est trois listes ouvertes pour y désigner l'unique entrée. L'assistant
applique pourtant déjà le bon réflexe pour le lieu qu'il vient de créer (`:1086-1093`).
→ Présélectionner quand la liste ne compte qu'une entrée.

**M9. La note « archivé » envoie repasser en brouillon pour rien.** L'écran dit
« Repassez-le en brouillon pour le rééditer » (`products/[id]/page.tsx:217-222`) alors
que la fiche, les photos, les déclinaisons et les offres restent pleinement actives
juste en dessous — et que ni `GuardAsync` (`SellerCatalogEndpoints.cs:574-589`) ni
`Product.Update` (`Product.cs:449`) ne regardent le statut du produit. Le vendeur fait
un aller-retour de statut inutile et perd l'archivage qu'il avait choisi. → Dire ce
qui est réellement bloqué : la remise en vitrine, pas l'édition.

**M10. Le montant du remboursement doit être retapé.** Le champ démarre vide
(`returns/page.tsx:244`, `:630-655`) alors que le plafond est affiché deux lignes plus
haut dans le même dialogue (`:357-360`), rappelé sous le champ (`:646`) et déjà présent
dans la colonne « Montant » de la liste. Côté domaine, ce plafond EST la valeur du cas
nominal (`ReturnRequest.cs:202-207`). → Préremplir avec `refundableAmount`, en laissant
modifiable pour les remboursements partiels.

**M11. Le dialogue de suppression KYB annonce une conséquence qui n'arrive pas.**
« qui repassera en vérification. Si votre boutique était vérifiée, elle ne le sera
plus » (`shop/page.tsx:691-698`) — le domaine dit l'inverse en toutes lettres : « Le
retrait ne change pas le statut KYB de la boutique » (`Seller.cs:220-222`), et
n'écrit nulle part `KybStatus`. Le vendeur renonce à retirer un justificatif déposé
par erreur. → Aligner le texte sur le domaine.

**M12. Re-saisie du numéro de versement pour ne changer que le titulaire.** Les trois
champs sont exigés (`shop/page.tsx:376`, `:406`) alors que l'écran détient le numéro
et l'affiche masqué (`:428`). La re-saisie se justifie quand l'opérateur ou le numéro
changent ; pas pour corriger une faute dans un nom. → Lever l'exigence dans ce seul
cas.

**M13. Télécharger une pièce KYB demande deux clics et une fenêtre.** Le premier clic
demande l'URL présignée (`shop/page.tsx:573-581`), un dialogue s'ouvre, et il faut y
cliquer « Ouvrir le document » (`:701-731`). → Demander l'URL au survol ou au focus et
rendre un vrai lien : le contournement des bloqueurs de fenêtres est conservé sans
l'étape intermédiaire.

## Les redondances

**M14. La colonne « Paiement » ne dit rien que « Statut » ne dise déjà.** Côté BFF,
`paymentStatus = ToPaymentStatus(o.Status)` (`SellerOrderEndpoints.cs:92`, `:185`), et
cette fonction est une pure traduction du statut de commande — aucune donnée de
paiement n'est lue (`:222-232`). Deux badges côte à côte sur 25 lignes
(`orders/page.tsx:171-176`), et « Annulée / Échoué » fait soupçonner un problème de
paiement là où il n'y en a pas. → Supprimer la colonne tant que le BFF ne relaie pas
un statut de paiement réellement distinct.

**M15. Le même compteur écrit deux fois.** Sur Expéditions, l'en-tête affiche
`rows.length` et l'onglet actif la même valeur, à deux centimètres
(`shipments/page.tsx:90` et `:118-122`). Sur Commandes, le numéro de page figure en
haut et en bas (`orders/page.tsx:64` et `:188`). → N'en garder qu'une occurrence.

**M16. Le tableau de bord redit en vignettes ce que son donut montre.**
« Commandes (total) » et « À traiter » (`dashboard/page.tsx:156-176`) se lisent tous
deux sur le graphique juste en dessous (`:228-232`) — côté serveur, les trois sortent
de la même liste (`SellerDashboardEndpoints.cs:160`, `:193`, `:197-199`). → Garder les
vignettes pour ce que le donut ne montre pas.

**M17. Deux entrées de menu vers la même page.** « Ma boutique » → `/shop` et
« Documents KYB » → `/shop#kyb` (`sidebar.tsx:83` et `:85`). L'ancre `id="kyb"` n'est
rendue qu'une fois la requête aboutie (`shop/page.tsx:585`, `:71-85`) : à l'arrivée
depuis un autre écran elle n'existe pas encore, et la page s'ouvre en haut — le
résultat exact de la première entrée. → Une seule entrée, ou un défilement déclenché
après chargement.

**M18. L'écran Notifications redit les files des autres écrans, sans y mener.** Les
cinq catégories recouvrent exactement cinq écrans
(`NotificationCategories.cs:10-16`), où le compte est déjà affiché
(`returns/page.tsx:68-76`, `reviews/page.tsx:78-85`, `disputes/page.tsx:46-49`,
`messages/page.tsx:138-141`). Et la ligne ne mène nulle part : elle porte pourtant
`relatedEntityType` et `relatedEntityId` (`NotificationsContracts.cs:10-11`), que le
rendu ignore (`notifications/page.tsx:222-259`, aucun lien dans le fichier). → Rendre
chaque ligne cliquable vers son écran, et marquer lu à l'ouverture plutôt que par un
bouton dédié.

**M19. « Réessayer » à côté d'un fil qui se recharge seul.** Le fil a un
`refetchInterval` de 8 s (`messages/page.tsx:207-211`, `:56`), et le bouton ne fait
qu'invalider cette même requête (`:378-386`). → Annoncer la reprise automatique, ou
réserver le bouton aux requêtes sans intervalle — celui des préférences de
notification, lui, est légitime (`notifications/page.tsx:310-317`).

## Ce qui n'a pas d'effet observable

**M20. « Confirmer la livraison » ne rafraîchit ni le tableau de bord, ni les
commandes, ni le portefeuille.** La mutation n'invalide que `["seller-shipments"]`
(`shipments/page.tsx:294-298`, `:219`). Or la livraison de la dernière expédition fait
passer la commande en `Delivered`
(`MarkOrderDeliveredOnAllShipmentsDeliveredHandler.cs:37-43`), ce dont dérivent
`ordersTotal`, `ordersToProcess` et le donut (`SellerDashboardEndpoints.cs:160`,
`:193`, `:197-199`) — et le panneau promet explicitement que « vos gains deviennent
retirables » (`shipments/page.tsx:653-657`). Aucune des clés
`["seller-dashboard"]`, `["seller-orders"]`, `["seller-wallet"]` n'est invalidée.
→ Les invalider dans `onSuccess`.

**M21. « Masquer » un message ne met pas à jour la colonne de gauche.**
`hideForMe.onSuccess` n'appelle que `refreshThread()` (`messages/page.tsx:322-330`),
là où la suppression pour tous appelle en plus `onChanged()` (`:308-320`). Le résumé
de conversation est pourtant construit APRÈS filtrage des messages masqués
(`ConversationQueries.cs:31-50`) : l'aperçu continue d'afficher le message masqué
jusqu'au cycle suivant de 30 s. → Appeler `onChanged()` comme le fait la suppression.

**M22. Le nom enregistré dans « Mon compte » ne change pas dans la barre latérale.**
La mutation n'invalide que `["seller-account"]` (`account/page.tsx:28`, `:77-89`),
alors que le nom affiché en permanence vient du cookie de session
(`layout.tsx:6` → `app-shell.tsx:26` → `sidebar.tsx:249-250`), reconduit
délibérément au rafraîchissement de jeton (`src/lib/bff.ts:157-159`) pour un cookie de
30 jours (`src/lib/session.ts:145`). Le vendeur corrige son nom, le toast confirme, et
la barre latérale garde l'ancien jusqu'à la reconnexion. → `router.refresh()` après
succès, et re-dériver `name`/`email` du nouveau jeton.

**M23. Le bandeau KYB envoie déposer des pièces pour débloquer un versement que le KYB
ne bloque pas.** Le bandeau affirme « La vérification conditionne le versement de vos
gains » (`kyb-banner.tsx:116-118`). `SellerRights.CanWithdraw` vaut pourtant
`Active | Pending | Closed | PendingReactivation` — le KYB n'y figure pas
(`SellerRights.cs:69-70`) — et `RequestWithdrawalCommandHandler` ne lit jamais
`KybStatus` (`WalletCommands.cs:47-63`). Le KYB conditionne l'ACTIVATION de la
boutique (`Seller.cs:311-314`), pas le retrait. Le vendeur dont le retrait est refusé
part scanner et téléverser des pièces, attend la revue, et rien ne se débloque : le
vrai obstacle est le compte de versement Mobile Money (voir G1 et G2). → Nommer le
blocage réel, et réserver la phrase KYB à l'activation.

---

# Ce qui a été vérifié sans rien trouver

Ces points valaient d'être regardés, et l'absence de constat est elle-même un
résultat.

- **Un seul chemin de création de produit.** Le `POST /seller/products` n'existe qu'à
  un endroit (`products/nouveau/page.tsx:383`) ; aucune autre route de `src/app/` ne
  crée de fiche.
- **Portefeuille et Finance ne font pas doublon.** « Demandes de retrait » vient du
  vendeur et attend une validation admin (`SellerWalletEndpoints.cs:24`) ;
  « Versements reçus » vient des lots de règlement de la plateforme
  (`ListSellerPayoutsQuery.cs:20-28`). « Mouvements » est le grand livre, une écriture
  NETTE par commande (`WalletMutations.cs:218-219`) ; « Écritures de la période » est
  la décomposition brut / commission / frais (`SellerFinanceEndpoints.cs:118-135`).
  Le même événement s'y lit sous deux formes, dont aucune ne se déduit de l'autre.
- **Les boutons d'expédition correspondent exactement aux gardes du domaine.**
  `prepare` sur `pending`, `ship` sur `preparing`, `deliver` sur `shipped`, `cancel`
  hors `delivered|cancelled` — à comparer avec `Shipment.cs:118-122`, `:159-162`,
  `:186-190`, `:371-380`. Aucun décalage.
- **Toutes les confirmations restantes portent sur des gestes irréversibles.**
  Vérifié dans les machines à états : aucune méthode de `Shipment` ne ramène à
  `Pending` ; `ReturnRequest.Approve`, `MarkReceived` et `ApproveRefund` n'ont pas de
  transition inverse (`ReturnRequest.cs:107-216`) ; `Message.HideFor` n'a pas de
  symétrique.
- **Aucune route morte.** Les appels `bff()` de la console ont été recoupés un à un
  avec les routes montées par le BFF vendeur : tous existent. Aucune entrée de menu ne
  pointe vers un dossier absent de `src/app/(seller)/`. Aucun contrôle n'a de
  gestionnaire vide.
- **Les trois « Enregistrer » de Ma boutique ne sont pas un formulaire scindé à tort :**
  le serveur expose bien trois routes distinctes (`SellerShopEndpoints.cs:31, 33, 36`)
  et n'accepterait pas un seul appel.
- **Le bandeau KYB bascule bien après un dépôt de pièce :** `shop/page.tsx:52`
  rafraîchit `["seller-shop"]`, la clé que lit le bandeau (`kyb-banner.tsx:45`).

---

# Ordre de réparation

Six lots, ordonnés par ce qu'ils rendent au vendeur et non par la difficulté. Chaque
lot se tient seul et peut être livré sans attendre le suivant.

## Lot 1 — L'argent (G1, G2, M23, M6)

Le seul endroit où un malentendu coûte de l'argent plutôt que du temps. Un vendeur
peut aujourd'hui enregistrer un compte de versement qui ne sera jamais payé, et
personne ne le lui dit ; quand le retrait échoue, le bandeau l'envoie faire une
démarche KYB qui n'y changera rien.

Limiter la liste des opérateurs aux trois reversables, lire `["seller-shop"]` sur le
Portefeuille pour désactiver le retrait sans compte valide, corriger la phrase du
bandeau, et donner la raison sur le bouton désactivé.

## Lot 2 — Les impasses (G3, G4, G5, G11, M2)

Cinq gestes proposés que le serveur refuse à tous les coups. Ils ont tous la même
forme : la console ignore un champ qu'elle reçoit déjà. Le correctif est toujours de
le lire avant d'afficher le bouton.

Statut de boutique dans la zone sensible, `verifiedAtUtc` sur les pièces KYB, statut
de catégorie sur la fiche produit, statut d'avis sur « Signaler », nombre d'offres sur
« Supprimer ».

## Lot 3 — Les gestes qui s'annulent en silence (G6, G7, G8, M20, M21)

Le plus grave du lot est G6 : deux commandes qui se défont l'une l'autre sans un mot.
Vient ensuite G7, une option qui ne fait rien du tout. Le reste est du cache : trois
invalidations manquantes qui font paraître un geste sans effet.

## Lot 4 — Les chemins aveugles (G9, G10, M18)

Trois liens qui déposent le vendeur au bon écran sans lui dire où regarder — et, pour
G10, sans qu'il puisse faire ce qu'on lui a promis. Le correctif commun est de porter
l'identifiant dans l'URL et de le lire au montage.

Pour G10, la décision est en amont : soit on ouvre une route de création de
conversation côté vendeur, soit on retire le bouton. Le laisser en l'état est le seul
choix à exclure.

## Lot 5 — Les clics en trop (M7, M8, M10, M12, M13, M19, M15, M16, M17)

Rien d'urgent, mais c'est ce que le vendeur sent tous les jours. La présélection des
listes à choix unique (M8) et le préremplissage du montant de remboursement (M10) sont
les deux plus rentables — ils touchent des gestes quotidiens.

## Lot 6 — Les textes qui mentent (M9, M11, M14, M22, M3, M4, M5)

Des phrases à l'écran qui décrivent un comportement que le code n'a pas : M9 envoie
désarchiver pour rien, M11 fait craindre une perte de vérification qui n'arrive pas,
M14 présente comme un fait indépendant une valeur dérivée. On y joint les trois
derniers contrôles manquants (M3, M4, M5) et le nom de la barre latérale (M22).

## Le préalable, qui n'est pas dans les lots

**G12 n'est pas une réparation de console.** Le motif de refus d'un retour demande de
trancher une question produit : ce motif doit-il exister ? S'il doit exister, il faut
le projeter dans le contrat, l'afficher au vendeur et le pousser à l'acheteur — c'est
un chantier backend. S'il ne doit pas exister, il faut cesser de l'exiger. La console
ne peut pas décider seule.

## Restant à décider

**Suppression d'un produit par une boutique suspendue ou fermée.** Les quatre autres
écritures de catalogue qui échappaient au contrôle de statut ont été fermées (voir la
correction de M3). `DeleteAsync` reste ouverte, et la console ne prétend pas le
contraire — son bandeau dit explicitement que la suppression demeure possible. Deux
lectures s'opposent :

- **La fermer.** Une boutique **suspendue** ne devrait pas pouvoir effacer des fiches
  pendant qu'on instruit son dossier. C'est l'argument le plus fort ; il porte sur la
  suspension, pas sur la fermeture volontaire.
- **La laisser.** Un vendeur qui range son catalogue après une fermeture volontaire ne
  contourne aucune sanction — la fermeture a déjà dépublié ses produits. L'enfermer sur
  des fiches qu'il ne peut ni vendre ni retirer n'a pas de sens.

Une troisième voie existe et réconcilie les deux : refuser la suppression sur
`Suspended` seulement, ce qui demande un droit distinct dans `SellerRights` — le dépôt
en a déjà deux (`CanSell`, `CanWithdraw`) et assume que « vendre » et « être payé » ne
se retirent pas au même moment. Le geste serait le même ici.

Quel que soit le choix, il se prend en un endroit : `SellerRights`, puis le résolveur
utilisé par `DeleteAsync`. La console suivra — le bandeau énumère ce qui est figé, il
suffira d'en retirer la phrase sur la suppression.
