# Audit de la console vendeur — `Seller_MP_Next`

**Méthode.** Les 16 écrans et 20 composants de la console ont été lus contre leur gestionnaire serveur, endpoint par endpoint, agrégat par agrégat. Chaque défaut classé GRAVE a ensuite été revérifié une seconde fois, directement dans le code, avant d'être écrit ici. Aucun test n'a été lancé contre un serveur en ligne ; aucun fichier n'a été modifié.

**Périmètre.** `Seller_MP_Next` dans son entier (~16 800 lignes), et en face `src/Bff/Marketplace.Bff.Seller/` plus les modules Ordering, Shipping, Delivery, Returns, Disputes, Settlement, Billing, Catalog, Offers, Inventory, Pricing, Reviews, Messaging, Identity, Sellers.

---

## Le verdict en trois lignes

L'auto-inscription vendeur **ne fonctionne pas** : la console parle encore le contrat d'avant septembre. Personne ne peut ouvrir de boutique depuis cet écran.

L'écran Retours **promet trois fois au vendeur qu'il n'engage pas d'argent**, au moment précis où il en engage.

Et une expédition marquée « en préparation » **disparaît de tous les onglets** et perd tous ses boutons : le colis payé reste en boutique.

Le reste — cloisonnement entre vendeurs, session, autorisation, préservation des données à l'édition — est sain, et c'est à souligner : les trois commandes que les tests d'architecture déclaraient « non auditées » côté vendeur le sont désormais, et elles sont correctes.

---

## FAMILLE A — L'écran dit une chose, le serveur en fait une autre

C'est la famille qui coûte le plus cher, parce que le vendeur décide sur la phrase, pas sur le code.

### A1. GRAVE — « Valider un remboursement ne déclenche aucun versement ». C'est faux, et c'est son argent.

`returns/page.tsx:93-99`, `:289`, `:344-350`, `:506-510` — quatre formulations de la même promesse : « *ne déclenche aucun versement* », « *l'argent n'est pas encore parti* », « *cette validation n'envoie pas d'argent* », « *il part dans la file d'un administrateur* ».

La chaîne réelle, vérifiée maillon par maillon :

```
ApproveRefund (ReturnRequest.cs:168)
  → ReturnRefundApprovedDomainEvent
  → ReturnRefundedDomainEventHandler.cs:15          publie l'événement d'intégration
  → CreditCustomerWalletOnReturnRefundApprovedHandler (SettlementModuleInstaller.cs:137)
                                                    CRÉDITE LA CAGNOTTE DE L'ACHETEUR
  → ConfirmRefundOnCustomerWalletCreditedHandler    le retour passe « Refunded »
  → ReverseEarningsOnReturnRefundedHandler.cs:123   DebitSellerForRefundAsync
                                                    DÉBITE LE PORTEFEUILLE DU VENDEUR
```

Le back-office le dit déjà noir sur blanc : `Marketplace.Api/Endpoints/ReturnsEndpoints.cs:25-31` — « `POST /{id}/refund` lève `ReturnRefundApprovedDomainEvent`, que Settlement transforme en **CRÉDIT RÉEL** de la cagnotte client ».

**Ce que vit le vendeur.** Il clique « Valider 12 000 F CFA » sur la foi d'un écran qui lui dit que rien n'est engagé. En quelques secondes l'acheteur est crédité, le retour saute l'état « en attente de versement » qu'on vient de lui décrire, et son solde disponible baisse — un débit qui a le droit de passer sous zéro (`WalletPolicy.cs:64`). Le bandeau ambre « l'argent n'est pas encore parti » décrit un état qui ne dure que le temps d'un aller-retour d'outbox.

### A2. GRAVE — Le « Net de la période » retire deux fois la commission sur toute vente remboursée

`finance/page.tsx:100` calcule `net = brut − commission − frais − remboursements`, affiché en gros et présenté comme « **ce qui vous revient** » (`:134-138`).

Or `ListSellerEarningsAsync` (`SettlementRepositories.cs:64-69`) ne filtre **sur aucun statut** : rembourser une vente ne retire jamais sa ligne de gain, et `ReverseEarningsOnReturnRefundedHandler` n'écrit jamais `EarningStatus.Reversed`. La vente remboursée garde donc son brut **et** sa commission entiers dans le relevé, pendant que le remboursement est soustrait à 100 %.

Mais le vendeur n'a jamais encaissé le brut : `SellerEarning.cs:52` le crédite de `brut − commission − frais`, et la reprise ne lui retire que cette même part nette.

**Vente 10 000, commission 1 000, frais 500, remboursée intégralement.** Impact réel sur son portefeuille : **zéro**. L'écran affiche `10 000 − 1 000 − 500 − 10 000 = −1 500 F CFA`. Il lit une perte de 1 500 F CFA par vente remboursée, qu'il ne pourra rapprocher d'aucun mouvement. Le serveur calcule pourtant déjà le bon net par ligne (`SettlementQueries.cs:80-83`, champ `NetAmount`) — le BFF le jette au moment de projeter.

### A3. GRAVE — Après « Marquer en préparation », l'expédition sort de tous les onglets

Le BFF renomme l'état dans la file : `SellerFulfillmentEndpoints.cs:142-145`, `"Preparing"` → `"ReadyForPickup"`. L'écran, lui, ne connaît que trois orthographes : `shipments/page.tsx:36` — `pending | preparing | prepared`.

Conséquences cumulées, toutes vérifiées :

- la ligne ne tombe dans **aucun** onglet : ni « À préparer », ni « En transit », ni « Terminées ». Seul « Toutes » l'affiche, et les compteurs des trois onglets ne totalisent plus celui de « Toutes » ;
- le bouton « Expédier » est conditionné à ces trois mêmes orthographes (`:366`), « Confirmer la livraison » à `shipped` (`:372`) : pour `readyforpickup`, **ni l'un ni l'autre**. Il ne reste que « Annuler », qui est terminal ;
- `status-labels.ts:215-222` n'a pas de clé `readyforpickup` : `humanize()` affiche **« Ready For Pickup »**, en anglais, sur une console entièrement française.

Le colis payé reste en boutique, et rien dans l'interface ne permet d'en sortir.

### A4. GRAVE — Le repli transporteur que la plateforme réclame par e-mail n'existe pas dans la console

`ShipmentNotificationHandlers.cs:136-141` envoie au vendeur, par push **et** par e-mail : « *votre part est toujours "en préparation" : expédiez-la par un transporteur depuis votre tableau de bord* ».

Or `Shipment.MarkCourierDeliveryFailed` (`Shipment.cs:312-355`) laisse délibérément le statut à `Preparing` — donc `ReadyForPickup` dans la file, donc exactement l'état de A3 où « Expédier » n'est pas offert. Et le motif de l'échec n'atteint jamais l'écran : `ShipmentSummary.CourierFailureReason` existe (`ShippingContracts.cs:39-48`, avec un commentaire disant que sans lui « la notification envoyée au vendeur n'a nulle part où atterrir ») mais `EnrichAsync` ne le projette pas et `ShipmentQueueRow` ne le déclare pas.

Le coursier renonce, le vendeur reçoit « Colis non enlevé : action requise », ouvre la console — et n'y trouve ni l'incident, ni le bouton. Commande payée, jamais livrée, séquestre jamais libérée.

### A5. GRAVE — « À traiter — Commandes en attente d'expédition » compte les commandes impayées

`dashboard/page.tsx:164-167` face à `SellerDashboardEndpoints.cs:109` :

```csharp
orders.Count(o => o.Status is not ("Delivered" or "Cancelled"))
```

`OrderStatus` vaut `Pending, AwaitingPayment, Paid, Confirmed, Cancelled, Failed, Delivered` (`OrderIds.cs:15-24`). Le compteur inclut donc `Pending`, `AwaitingPayment` et `Failed` — des commandes non encaissées, dont aucune n'a d'expédition, celles-ci n'étant créées qu'à la confirmation (`CreateShipmentsOnOrderConfirmedHandler.cs:30-55`).

Le vendeur lit « À traiter : 37 », ouvre la file et n'y trouve que 4 colis. Il conclut à une panne, ou surestime son activité et réassortit.

### A6. GRAVE — « Doit correspondre au SKU d'une variante de votre catalogue » : le serveur ne vérifie rien

`inventory/page.tsx:552-554` l'affirme au vendeur. `SellerInventoryEndpoints.cs:187-208` ne contrôle que la propriété du **lieu** ; `CreateInventoryItemCommand` ne regarde que le format du SKU et son unicité (sku, lieu). Le catalogue n'est jamais consulté.

Le vendeur tape `TSHIRT-BLU-M` au lieu de `TSHIRT-BLEU-M` : « Référence suivie. » La ligne apparaît avec 20 unités, et son offre — qui porte le vrai SKU — reste sans stock. Aucun écran ne rapproche jamais les deux listes. Le contrôle manquant est exactement celui que `CreateOfferCommandHandler.cs:129-142` applique déjà aux offres.

### A7. GRAVE — Renommer le SKU d'une déclinaison casse offre et stock, sans un mot

`product-variants-manager.tsx:234-242` rend le SKU librement modifiable, sans aucun avertissement — alors que la boîte de suppression, elle, en porte un (`:369-372`).

Côté serveur, `Product.UpdateVariant` (`Product.cs:200-232`) valide le format et l'unicité **dans le produit**, puis écrit. **Aucun événement n'est levé.** Ni `Offer.VariantSku` ni `InventoryItem.Sku` ne bougent.

Le vendeur corrige une coquille. L'offre et l'article de stock gardent l'ancien SKU. `CreateOfferDialog` calcule les SKU libres en comparant les variantes aux offres (`product-offers-manager.tsx:704-705`) : la déclinaison renommée apparaît « libre », le vendeur crée une seconde mise en vente dessus — sans aucun article de stock. Et `InventoryModuleApi.IsInStockAsync:88-91` répond « disponible » pour un SKU non suivi. **Vente à découvert**, sur une fiche qui affiche deux offres dont l'une est fantôme.

### A8. MOYEN — « Activité sur les 30 derniers jours » coiffe deux chiffres cumulés depuis toujours

`dashboard/page.tsx:111` annonce un mois ; `ListOrdersBySellerQuery` (`SellerDashboardEndpoints.cs:101`) n'a aucune borne de date. Seuls `grossSales30d` et `netPayout30d` sont réellement bornés.

### A9. MOYEN — Le dispositif « donnée indisponible » du tableau de bord est entièrement mort

Le serveur prévoit trois sections, l'écran a tout l'affichage — bandeau ambre, chip « Indisponible », et le type qualifie `unavailable` de « champ le plus important de cet objet ». Or les trois handlers ne peuvent pas échouer : `OrderQueries.cs:52-57`, `SettlementQueries.cs:64-68` et `ReviewQueries.cs:30-35` renvoient tous un `Result.Success` inconditionnel.

Une base indisponible lève une exception → 500 sur `/seller/dashboard` → l'écran passe en erreur et n'affiche plus rien. L'objectif écrit côté serveur (`:88-92` : « perdre les commandes parce que les avis sont indisponibles serait disproportionné ») n'est pas atteint.

### A10. MOYEN — « Net à percevoir (30 j) » n'est pas percevable

`SettlementRepositories.cs:47-62` somme **tous** les gains de la fenêtre, sans filtre de statut. Or seuls les gains `Released` sont payables — c'est ce que retient le lot de reversement (`:24-34`). Les gains `Accrued` sont encore en séquestre. « À percevoir » additionne de l'argent que le vendeur ne peut pas retirer.

### A11. MOYEN — « Satisfaction » ≠ note publique

`SellerDashboardEndpoints.cs:133-141` moyenne sur une liste qui **ne filtre pas la visibilité** (`ReviewRepository.cs:58-63`), alors que la note publique exclut les avis rejetés (`:43-44`). L'écran Avis avertit honnêtement (`reviews/page.tsx:111-115`) ; le tableau de bord, qu'on regarde en premier, ne le dit pas.

### A12. MOYEN — Un colis porté par un coursier de la plateforme s'affiche « Transporteur non renseigné »

Le serveur envoie `deliveryMode` et le contrat explique pourquoi (`ShippingContracts.cs:30-37` : sans lui « l'application ne pouvait pas distinguer "porté par notre coursier" de "pas encore expédié" »). `ShipmentQueueRow` ne le déclare pas ; `orders/[id]/page.tsx:343` affiche donc une livraison par coursier interne exactement comme un colis que personne n'a pris.

### A13. MOYEN — « Cette réponse est définitive : l'API ne permet pas de la modifier » — c'est faux

`reviews/page.tsx:293-296` face à `Review.cs:136-147`, documentée « remplace une réponse existante » et sans aucune garde côté route. C'est l'écran seul qui rend la réponse définitive, en retirant le bouton (voir C3).

### A14. MOYEN — Réordonner les photos réassigne la photo principale en silence

`Product.cs:359-364` — `ReorderMedia` fait `UnsetPrimary()` sur **toutes** les images puis `ordered[0].MakePrimary()`. L'écran propose pourtant deux commandes distinctes : des flèches « Déplacer avant / après » et un bouton étoile séparé (`product-media-manager.tsx:104-110`, `:205-216`). Le vendeur désigne la photo 3 comme principale, permute ensuite les photos 1 et 2 — la principale saute sur la première. Les deux commandes se contredisent.

### A15. MOYEN — Aucune offre ne passe jamais « En rupture »

`InventoryIntegrationEvents.cs:14` annonce que `StockDepletedIntegrationEvent` est « consommé par Offers pour passer l'offre OutOfStock ». **Le seul abonné est Notifications.** Aucun handler dans Offers ; `Offer.MarkOutOfStock()` n'est atteint que par un `PATCH .../status` que la console n'envoie jamais. Le statut « En rupture » de `status-labels.ts:99-103` est du code mort, et une offre reste « Active » à zéro disponible.

### A16. MOYEN — Le sélecteur de catégorie propose des catégories archivées, que le serveur refuse

`category-picker.tsx:34-47` liste tout ; `SellerCategory` (`types/seller.ts:692-696`) ne porte même pas `status`, alors que `CategorySummary` le fournit. `ProductAttributeGuard.cs:75-80` refuse une catégorie archivée en 409 — après que le vendeur a rempli quatre étapes et téléversé ses photos. Tout est à refaire.

### A17. MOYEN — L'écran affirme un envoi d'e-mail que le serveur n'a pas forcément fait

`inscription/page.tsx:321-323` : « Un code à six chiffres **vient d'être envoyé** ». Le serveur n'envoie rien dans trois cas — compte suspendu, déjà rattaché à une boutique, numéro déjà pris (`SellerRegistrationEndpoints.cs:265-295`) — et sa propre formulation est prudente : « *Si cette adresse peut ouvrir une boutique, un code…* ». L'écran la jette pour affirmer.

### A18. FAIBLE — « Votre réponse est publique » sur un avis rejeté

Le bouton « Répondre » est proposé quel que soit le statut (`reviews/page.tsx:122-126`), et un avis rejeté est exclu des lectures publiques. Le vendeur rédige une réponse que personne ne verra.

---

## FAMILLE B — Le geste ne part pas

### B1. GRAVE — L'auto-inscription est cassée en deux endroits

**Premier point.** `inscription/page.tsx:115-122` :

```ts
if (!res.ok || !data.userId) {
  setError(data.detail ?? data.error ?? data.title ?? "Inscription impossible.");
  return;
}
```

Le serveur ne renvoie **plus jamais** de `userId` : `SellerRegisterResponse(bool Registered, string Message)` (`SellerRegistrationEndpoints.cs:533-537`), et le record documente lui-même la suppression — « `IsNewAccount` a disparu avec `UserId` : c'était le même aveu sous un autre nom. »

**Second point.** Même en obtenant un `userId`, l'étape 2 échouerait : `bff.ts:263-275` et `api/auth/verify/route.ts` envoient `{userId, code, shopName}` alors que le contrat est `SellerVerifyRequest(Email, Code, ShopName, Company)` (`:497-501`). `VerifyEmailCodeCommand.cs:12-24` explique le changement : « *L'ADRESSE, ET NON L'IDENTIFIANT. C'EST CE QUI FERME L'ORACLE D'ÉNUMÉRATION.* » La route Next exige même `userId` et refuse en 400 sans lui.

**Ce que vit le commerçant.** Il remplit six champs et clique « Continuer ». Le serveur **crée réellement son compte** — le commentaire le dit, « à partir d'ici le compte existe » (`:276`) — et le code à six chiffres **part par e-mail**. La réponse est 200. L'écran lit `data.userId` → `undefined` → branche d'erreur → et comme le corps ne porte ni `detail`, ni `error`, ni `title`, il affiche **« Inscription impossible. »** Il reste à l'étape 1, avec un compte créé et un code dans sa boîte qu'aucun écran ne lui permet de saisir. S'il réessaie, la réponse uniforme lui redit la même chose.

Le dernier commit de la console date du 4 août ; celui de `SellerRegistrationEndpoints.cs` du 9 septembre. Le serveur a fermé son oracle d'énumération, la console n'a pas suivi.

### B2. GRAVE — Une catégorie à attribut obligatoire est inutilisable depuis la console

`CategorySummary` expose `AttributeSchema` et `AllowUnknownAttributes` (`CategorySummary.cs:24, 27`), avec un commentaire qui dit à quoi ça sert : dessiner le formulaire « *au lieu d'un champ « attributs » libre où chacun invente ses clés* ».

`grep -rn "attributeSchema\|allowUnknown" Seller_MP_Next/src/` → **zéro occurrence.** Vérifié.

L'assistant de création n'envoie donc **jamais** d'attributs produit (`products/nouveau/page.tsx:304-323` : le `FormData` porte `categoryId`, `name`, `description`, `brandId`, `gtin`, `ean`, `tags`, `images` — jamais `attributesJson`). Dès que l'administration pose un attribut `required` sur une catégorie, `CategoryAttributeSchema.Validate` refuse toute création — et l'échec arrive **après** le téléversement des photos. Impasse totale, sans aucun champ à l'écran pour satisfaire la règle.

### B3. MOYEN — « Expédier » depuis l'état initial est refusé en 409

`shipments/page.tsx:364-370` porte ce commentaire : « *`MarkShipped` accepte Pending OU Preparing : on propose donc l'expédition dès l'état initial.* » Le serveur dit exactement le contraire, et explique pourquoi il a changé (`Shipment.cs:137-162`) : « *Cette garde acceptait aussi `Pending`* [...] *un vendeur qui appelait `/ship` sans passer par `/prepare` allait de « en attente » à « expédiée » sans qu'AUCUNE COURSE NE SOIT JAMAIS CRÉÉE.* »

Le vendeur choisit son transporteur, saisit son numéro de suivi, clique — et reçoit un 409. Le seul chemin restant le mène droit dans A3.

### B4. MOYEN — « Renvoyer le code » ne fait littéralement rien

`inscription/page.tsx:169-189` lit un `userId` que le serveur ne renvoie pas, et n'a aucune autre branche : pas de toast, pas de texte, pas d'état modifié. Le vendeur clique, le spinner passe, l'écran est identique. Le serveur fournit pourtant `retryAfterSeconds` constant précisément pour que le client désactive son bouton une minute — « *ce qui supprime le geste dans le vide au lieu de l'expliquer* » (`:138-141`). La console ne le lit pas.

### B5. FAIBLE — Une réponse d'avis de plus de 2 000 caractères casse en 500

`reviews/page.tsx:286-292` : `Textarea` sans `maxLength`. `Review.Reply()` ne borne pas ; `ReviewConfiguration.cs:34` fixe `HasMaxLength(2000)`. L'échec remonte en exception EF, pas en message métier : le vendeur perd sa rédaction sans savoir pourquoi.

### B6. FAIBLE — « Signaler » sur un avis rejeté est proposé et toujours refusé

`reviews/page.tsx:208-213` ne masque le bouton que si le statut est `flagged` ; `Review.Flag()` refuse en 409 sur `Rejected`.

---

## FAMILLE C — État sans issue

### C1. GRAVE — `ReadyForPickup`

Voir A3 et A4. Le domaine n'offre aucun retour : `MarkPreparing` n'a pas d'inverse. La seule sortie offerte par l'écran est « Annuler », qui est terminale et que l'écran décrit lui-même comme ne libérant ni le stock ni l'acheteur.

### C2. GRAVE — Le vendeur non vérifié est enfermé dehors

`LoginCommandHandler.cs:174-181` répond : « *Votre adresse e-mail n'est pas encore confirmée. **Saisissez le code reçu par e-mail, ou demandez-en un nouveau.*** »

Il n'existe **aucun écran de saisie de ce code qui soit atteignable**. Vérifié : `/inscription` le rejette (B1), `/mot-de-passe-oublie` traite un autre code, `/account` traite le MFA. Le seul écran qui saurait le recevoir est l'étape 2 de l'inscription, joignable uniquement par un `setStep("verify")` que rien ne déclenche plus. Le message donne une instruction que l'application ne permet pas d'exécuter.

### C3. GRAVE — « Approuver » et « Marquer reçu » sont des culs-de-sac à sens unique

`ReturnRequest.cs` : `Reject` exige `Requested` (`:118-122`) — **une fois approuvé, un retour ne peut plus jamais être refusé**. Depuis `Approved`, la seule sortie est `MarkReceived` ; depuis `Received`, la seule sortie est `ApproveRefund`.

L'écran reflète fidèlement l'impasse — aucun bouton « Refuser » à ces étapes — mais laisse y **entrer** en un clic sans rien en dire (voir F1). Si le colis n'arrive jamais, le retour est bloqué en « Approuvé » indéfiniment. Et un clic de trop sur « Marquer le colis reçu » contraint à rembourser : c'est la seule transition que le domaine laisse.

### C4. MOYEN — Une réponse d'avis n'est plus jamais modifiable, du fait de l'écran seul

`reviews/page.tsx:187-201` : dès que `sellerReply` existe, la réponse passe en lecture seule et le bouton disparaît. Le serveur, lui, accepte le remplacement. Une faute de frappe dans une réponse publique est définitive.

### C5. MOYEN — Une conversation archivée reste un fil avec zone de saisie

`ConversationSummary` porte le statut, `SellerMessagingEndpoints.ListAsync:68-76` ne le projette pas, `SellerConversation` ne le déclare pas. L'écran affiche donc toujours la zone de saisie ; `Conversation.SendMessage` refuse en 409 si le statut n'est pas `Open`. L'archivage est accessible à **n'importe quel participant**, donc à l'acheteur — et `Conversation` n'expose **aucune** méthode de réouverture.

### C6. MOYEN — Une adresse d'entrepôt ne peut pas être corrigée

`SellerInventoryEndpoints.cs:45-48` ne mappe que `GET`, `POST` et `DELETE` sur `/seller/locations`. Il faut supprimer et recréer — ce que le serveur refuse tant qu'une référence y est suivie (`LocationCommands.cs:180-187`).

---

## FAMILLE D — Champ libre contre ensemble fermé

### D1. GRAVE — La fiche produit édite les attributs en clé/valeur libres

Même cause que B2. `product-identity-form.tsx:238-281` : deux `<Input>` texte par ligne, placeholders « Nom » / « Valeur ». Le serveur, lui, contrôle le type (`decimal.TryParse`, `bool.TryParse`, appartenance à `Values`), les bornes `Min`/`Max`, et refuse toute clé inconnue quand `allowUnknown` est faux (`CategoryAttributeSchema.cs:338-457`).

Catégorie avec `couleur` en `enum ["rouge","bleu","noir"]`. Le vendeur tape « Bleu marine » → refus. L'écran ne lui a jamais montré la liste, **alors que le serveur la lui envoie à chaque chargement de page**. Sur une catégorie fermée, une seule ligne surnuméraire fait échouer l'enregistrement entier de la fiche.

### D2. MOYEN — Le « sujet » d'une conversation est une chaîne libre de l'acheteur, affichée comme un libellé de la plateforme

`messages/page.tsx:342-344` rend `À propos de : {subject}` tel quel. `subject` vaut `c.ContextType`, qui vient directement du corps de requête du client qui ouvre le fil (`MessagingEndpoints.cs:37, 107`), n'est validé nulle part, et n'est borné que par la colonne (50 caractères).

### D3. FAIBLE — SKU en texte libre hors de l'assistant

L'assistant valide le format côté client, avec un commentaire qui explique pourquoi (`products/nouveau/page.tsx:66, 241-242`). Les deux autres surfaces ne le font pas : `product-variants-manager.tsx:159` et `inventory/page.tsx:508`. `Sku.Create` impose `^[A-Z0-9_-]+$`, 64 caractères. « REF 001 » passe ici et échoue là-bas.

### D4. FAIBLE — Transporteur de retour en champ libre

`returns/page.tsx:450-457` est un `<Input>` alors que l'écran Expéditions choisit dans le référentiel plateforme. Le serveur accepte, mais le `trackingUrlTemplate` du référentiel ne pourra jamais être appliqué à un suivi de retour.

---

## FAMILLE E — Perte de donnée silencieuse à l'édition

**Famille vide, et c'est la bonne nouvelle de cet audit.**

`tests/Architecture.Tests/PreservationDesMisesAJourTests.cs` déclarait trois commandes « NonAudite » précisément parce que l'espace vendeur n'avait jamais été relu. Elles l'ont été, champ par champ :

| Commande | Champs annulables | Verdict |
|---|---|---|
| `UpdateProductCommand` | `BrandId`, `Gtin`, `Ean`, `ProductGroupId`, `Attributes`, `Tags` | les six sont rechargés et renvoyés (`product-identity-form.tsx:54-59, 80-84, 97-104`) |
| `UpdateProductVariantCommand` | `Attributes`, `Barcode` | rechargés et renvoyés (`product-variants-manager.tsx:80-88, 100-103`) |
| `UpdateLocationAddressCommand` | 6 champs dont les coordonnées | aucune route vendeur ne l'appelle (voir C6) |
| `UpdateSellerProfileCommand` | `LogoUrl`, `Description` | renvoyés explicitement, avec le commentaire qui dit pourquoi (`shop/page.tsx:200-206`) |
| `UpdateSellerMetadataCommand` | `Metadata` entier | les huit champs sérialisés (`shop/page.tsx:248-289`) |

Les entrées du registre peuvent passer de `NonAudite` à `Remplace` pour ce qui concerne la console vendeur.

Restent trois pertes de **brouillon**, toutes FAIBLE : `shipments/page.tsx:294` et `reviews/page.tsx:256-260` (Échap vide la saisie sans avertir), `messages/page.tsx:248-251` (changer de conversation efface le brouillon et les pièces jointes déjà téléversées). Et une ergonomie à corriger : le volet « Modifier le suivi » d'un retour se rouvre vide (`returns/page.tsx:230-236`) — sans danger pour la donnée, les deux champs étant exigés ensemble.

---

## FAMILLE F — Geste irréversible sans confirmation

### F1. GRAVE — « Approuver » et « Marquer le colis reçu » : un clic, définitif, aucun filet

`returns/page.tsx:357-360` et `:369-372` appellent `mutate()` directement. Ce sont précisément les deux gestes que le domaine rend irréversibles (C3) — et l'écran sait faire des dialogues, il en a un pour le remboursement et un pour le retrait.

### F2. GRAVE — « Confirmer la livraison » libère l'argent en un clic

`shipments/page.tsx:372-377` — `deliver.mutate()` directement, sans panneau, contrairement à « Expédier » et « Annuler » qui en ont un. Côté serveur, `MarkDelivered` lève `ShipmentDeliveredDomainEvent`, consommé par `ReleaseSellerEarningsOnShipmentDeliveredHandler` (libération de la séquestre) **et** par le passage de la commande en « livrée », qui ouvre la fenêtre de retour de l'acheteur. Aucun retour arrière : `Cancel()` refuse un état `Delivered`.

Un clic de travers dans la liste « En transit » déclare livré un colis encore en route.

### F3. MOYEN — « Marquer en préparation » est sans retour et dispatche une course, sans le dire

`MarkPreparing` n'a pas d'inverse et lève l'événement qui publie `OrderReadyForDelivery` vers le service coursier — le seul déclencheur de la livraison. L'écran présente cela comme une simple écriture d'état. Avec A3, le geste est en pratique définitif.

### F4. MOYEN — « Archiver » part au premier clic, alors que « Retirer de la vente » demande confirmation

`products/[id]/page.tsx:178-187`. Les deux boutons sont côte à côte. Celui qui a la conséquence la plus lourde — l'archivage impose le détour par la modération pour revenir, exactement l'argument invoqué pour confirmer l'autre — est le seul sans filet.

### F5. FAIBLE — Le logo de boutique se remplace sans confirmation ni retour

`shop/page.tsx:126-132` : choisir un fichier déclenche l'envoi immédiat, et l'ancienne URL n'est conservée nulle part. Tous les autres gestes irréversibles de cet écran sont correctement gardés — c'est le seul qui ne l'est pas.

### F6. FAIBLE — « Revenir à la photo d'origine » perd le détourage définitivement

`product-images-field.tsx:335-341` : le bouton de réessai n'apparaît que si une erreur est renseignée, ce que cette action ne fait pas. Le texte d'aide annonce un rétablissement réversible.

---

## FAMILLE G — Liste tronquée en silence

Les listes principales sont saines : commandes, expéditions, avis, conversations, produits, offres et stock ne portent aucun plafond serveur. Trois exceptions :

### G1. MOYEN — Les notifications sont tronquées à 50, sans aucune suite

`SellerNotificationEndpoints.cs:77` n'accepte **ni `page` ni `take`** ; `ListMyNotificationsQuery` laisse `Take` à 50. Il n'existe aucun moyen d'atteindre la 51ᵉ notification.

Un vendeur revient après deux semaines avec 130 non lues. Le badge affiche 130 — il vient de `/unread-count`, correctement — et la liste en montre au plus 50. Le filtre « Non lues » travaille sur le lot déjà coupé : s'il n'y a que 12 non lues parmi les 50 dernières, l'écran montre 12 lignes sous un badge qui annonce 130. Le seul recours est « Tout marquer comme lu », qui les efface sans les avoir montrées.

### G2. FAIBLE — Le sélecteur de catégorie coupe à 60 dès qu'on tape

`category-picker.tsx:39, 46` — `.slice(0, 60)` dans les deux branches, mais le message « affinez la recherche » est conditionné à l'absence de recherche (`:105`). Dès qu'on saisit, la troncature devient muette.

### G3. FAIBLE — Litiges plafonnés à 500, mouvements de portefeuille à 50

`DisputeRepository.cs:32-33` applique `take = 500` par défaut ; `wallet/page.tsx:31` demande `?take=50` sans pagination. Le titre « Mouvements **récents** » atténue le second.

---

## FAMILLE H — Devise figée

`formatXof` (`lib/utils.ts:10-16`) code `currency: "XOF"` en dur, et s'applique à des montants dont le contrat porte pourtant un champ `currency` renseigné par le serveur : tableau de bord, détail de commande, versements, soldes, retraits, mouvements, retours, offres.

**MOYEN**, avec une conséquence plus dure que l'étiquette sur un point :

`product-offers-manager.tsx:354` — `priceValid = isWholeNumber(price) && toNumber(price) > 0`. Une offre en EUR à 12,40 préremplit « 12.4 », la validation échoue, et l'écran affiche « Un montant entier strictement positif est attendu » — alors que `Offer.ChangePrice` accepte les décimales pour une devise qui en a, et que `Money` en accepte 24. **Une offre non-XOF est intarifiable depuis la console**, et son prix s'affiche en « F CFA » — pendant que l'étiquette du champ, elle, lit déjà `({offer.currency})`.

---

## Sécurité et cloisonnement

### Ce qui est sain — n'y passez pas de temps

**L'autorisation est correctement posée.** `Program.cs:132-134` installe une `FallbackPolicy` `RequireAuthenticatedUser()` : un `RequireAuthorization` oublié échoue **fermé**. Les 21 groupes vendeur passent par `MapSellerGroup`, qui exige authentification **et** rôle `Seller`. Les quatre `AllowAnonymous` sont légitimes : auth, référentiel des communes, version de l'app, sondes.

**Le cloisonnement tient.** Le `SellerId` n'est **jamais** lu du corps ni de la query : il est résolu du jeton (`SellerBff.cs:89-98`). Les routes adressées par identifiant vérifient la propriété avant d'agir — `OwnsProductAsync`, `OwnsOfferAsync`, `OwnsShipmentAsync`, `OwnsReturnAsync`, `OwnsReviewAsync`, `OwnsLocationAsync` (ce dernier échoue fermé si la liste est indisponible). Les refus sont des 404 normalisés, indistinguables d'un identifiant inexistant : pas d'énumération.

**Les commandes multi-vendeurs sont correctement découpées.** `ScopeToSeller` (`SellerOrderEndpoints.cs:235-248`) ne retient que les lignes du vendeur et **recalcule** sous-total, remises et total dessus. Le vendeur A ne reçoit aucune ligne, aucun SKU, aucun montant du vendeur B.

**La session est solide.** AES-256-GCM, `httpOnly`, `secure` hors dev, `sameSite: lax`, refus de démarrer en production sur le secret d'exemple. Aucun jeton n'atteint le JavaScript client. Le proxy `/api/bff/*` exige une session et contrôle l'`Origin` sur toute requête mutante, en comparant `x-forwarded-host`.

**L'énumération de comptes est fermée**, y compris au chronomètre : `LoginCommandHandler.cs:104-110` paie le coût BCrypt même sur une adresse inconnue.

### S1. GRAVE — Le limiteur de débit de la console se contourne avec un en-tête

`lib/rate-limit.ts:57-64` prend la **première** entrée de `x-forwarded-for`, avec ce commentaire : « *derrière Traefik, la première entrée est fiable* ».

Le backend documente exactement l'inverse à propos du **même** proxy — `ForwardedHeadersSetup.cs:42-48` : « *Traefik AJOUTE la véritable IP **à la fin** de la chaîne. ASP.NET, avec `ForwardLimit = 1`, ne lit que la **DERNIÈRE** entrée.* » Et : « *l'attaquant n'aurait plus qu'à changer d'IP déclarée à chaque requête pour contourner toute limite.* »

Les deux moitiés de la plateforme lisent la même chaîne par des bouts opposés. C'est le backend qui a raison : un proxy inverse **ajoute** l'adresse de son pair en fin de chaîne, donc la première entrée est celle que le client a écrite lui-même.

Conséquence : `X-Forwarded-For: 10.0.0.<n>` avec un `n` différent à chaque requête donne un seau neuf à chaque fois. La force brute sur `/login`, `/register`, `/reset-password` et `/verify` est **intégralement libre** côté console. Symétriquement, déclarer l'IP d'un vendeur ciblé épuise son quota et le verrouille.

*Correctif : lire la dernière entrée, comme ASP.NET, ou `x-real-ip` seul si Traefik le pose.*

### S2. GRAVE — Un SKU de concurrent peut être injecté dans le stock

Seule route d'écriture du périmètre qui agit sur une donnée client sans en vérifier l'appartenance : `POST /seller/inventory/items`. `SellerInventoryEndpoints.cs:187-208` contrôle la propriété du `LocationId` mais accepte `request.Sku` tel quel ; ni le validateur ni le handler ne consultent le catalogue.

Or les SKU sont publics côté acheteur — le fichier le dit lui-même (`:29-30`). Un vendeur ouvre « Suivre une référence », saisit le SKU d'un concurrent et son **propre** entrepôt, avec `onHand = 999`. La ligne est créée, parfaitement dans son périmètre d'écriture. Mais `IsInStockAsync` (`InventoryModuleApi.cs:79-83`) agrège **toutes les localisations, tous vendeurs confondus** pour un SKU donné : l'article du concurrent, réellement en rupture, continue de passer le contrôle de mise au panier. La commande échoue plus tard, à la réservation, qui est bien scopée (sku, lieu).

Le concurrent voit ses paniers échouer au paiement **sans jamais pouvoir observer la ligne fantôme** : elle est dans un entrepôt qui ne lui appartient pas, donc invisible de son écran Stock.

### S3. MOYEN — Le contrôle d'accès aux litiges est par commande, pas par vendeur

`SellerBff.cs:232-236` : « impliqué » signifie « le vendeur a une expédition sur cette commande ». Sur une commande multi-vendeurs, le vendeur A passe donc le contrôle pour un litige portant sur la ligne du vendeur B — il en lit tout le fil et peut y **écrire**.

Ce n'est pas un oubli : le module Litiges ne connaît pas la notion de vendeur (`Dispute.cs:30-33` — un litige porte `OrderId` et `RaisedBy`, rien d'autre), et l'écran assume la conséquence en refusant d'écrire « Votre boutique » sur un message. Reste qu'un vendeur tiers peut déposer une pièce dans le dossier d'arbitrage d'un concurrent. Fermer ce trou suppose de rattacher le litige à une ligne de commande — un chantier de module, pas un correctif d'écran.

### S4. MOYEN — Le proxy `/api/bff/*` ne borne pas le chemin

`api/bff/[...path]/route.ts:79` — `encodeURIComponent("..")` vaut `".."`, le point n'étant pas réservé. Rien ne vérifie que le chemin commence par `/seller/`.

Portée réelle mesurée : l'hôte du BFF Vendeur ne monte que `/seller/*` plus les sondes anonymes. **Il n'y a rien à atteindre aujourd'hui.** Ce qui est signalé est la garde absente, pas une fuite constatée : le jour où une route est montée à la racine de cet hôte, elle devient joignable par tout vendeur authentifié sans que personne ait touché au proxy.

### S5. MOYEN — Les seuils anti-force-brute punissent les vendeurs légitimes

10/min/IP sur la connexion, **3**/min/IP sur « mot de passe oublié ». `AuthRateLimiter.cs:22-37` explique pourquoi le backend est passé de 10 à 30 : « *Au Bénin, les opérateurs mobiles partagent une même adresse IP publique entre des milliers d'abonnés. Une limite « par IP » n'est donc PAS une limite par personne : c'est une limite par **QUARTIER**.* » La console réintroduit 10, et descend à 3.

Quatre vendeurs d'un même opérateur demandent un code dans la même minute ; le quatrième est refusé sans avoir rien fait. **À corriger en même temps que S1** : tant que l'en-tête est falsifiable, le seuil ne mord que les honnêtes ; le corriger seul rendrait celui-ci brutal.

### S6. FAIBLE — Pas d'en-tête HSTS déclaré

`next.config.mjs:51-57` pose cinq en-têtes, sans `Strict-Transport-Security`. Il est peut-être posé par Traefik, mais aucune configuration Traefik n'existe dans ce dépôt pour l'attester. Le cookie porte `secure`, ce qui limite la portée.

### S7. FAIBLE — Sinks `href` : vérifiés, aucun n'est alimenté par autrui

La CSP porte `'unsafe-inline'` dans `script-src`, qui autorise les URL `javascript:`. Les treize `href={…}` dynamiques ont été inventoriés : `otpAuthUri` et l'URL présignée R2 viennent de notre serveur, `trackingUrl` est **construit côté serveur** depuis un gabarit administrateur avec le numéro échappé. Aucun `dangerouslySetInnerHTML` dans tout `src/` — vérifié.

*Point d'hygiène hors périmètre : aucun contrôle de schéma n'existe sur `Carrier.TrackingUrlTemplate`. Un gabarit valant `javascript:…` produirait un lien exécutable. Cela demande un compte administrateur.*

---

## Les écrans exemplaires

Il serait malhonnête de ne lister que les défauts.

- **Commandes** (`orders/page.tsx`) — pagination honnête, déduction de la page suivante justifiée en commentaire, mentions de partage exactes sur les commandes multi-vendeurs.
- **Tableau de bord** — refuse d'afficher un zéro quand la source est muette, et distingue le chargement de l'absence. C'est exactement ce que la console admin avait raté. Le dispositif n'est malheureusement jamais déclenché (A9), mais l'intention et le code sont justes.
- **Boutique** (`shop/page.tsx`) — renvoie explicitement `logoUrl` pour ne pas l'effacer, avec le commentaire qui explique pourquoi ; `PAYOUT_PROVIDERS` et `KYB_TYPES` sont des listes fermées alignées sur les énumérations serveur.
- **Prix** — `lib/pricing.ts:79-92` reproduit `Offer.ComputeBreakdown` en arithmétique entière avec arrondi au pair, taux venant du serveur. Aucun taux codé en dur.
- **Annuler une expédition** — le panneau décrit exactement ce que le domaine fait *et ne fait pas*.

---

## Tableau de synthèse

Légende : **G** grave · **M** moyen · **F** faible

| Écran | A dit≠fait | B ne part pas | C sans issue | D champ libre | E perte | F sans confirm. | G tronqué | H devise | Sécurité |
|---|---|---|---|---|---|---|---|---|---|
| inscription | M | **G** | — | — | — | — | — | — | **G** |
| login | — | — | **G** | — | — | — | — | — | **G** |
| dashboard | **G** M M M | — | — | — | — | — | — | M | — |
| retours | **G** M | — | **G** | F | F | **G** | — | M | — |
| finance | **G** | — | — | — | — | — | — | M | — |
| portefeuille | M | — | — | — | — | — | F | M | — |
| expéditions | **G** **G** M | M | **G** | — | F | **G** M | — | — | — |
| commandes | M | — | — | — | — | — | — | M | — |
| stock | **G** | — | M | F | — | — | — | — | **G** |
| produits · création | M | **G** | — | **G** | — | M | F | — | — |
| produits · fiche | M M | — | — | **G** | — | M F | — | M | — |
| avis | M F | F F | M | — | F | — | — | — | — |
| messages | — | — | M | M | F | — | — | — | M |
| litiges | — | — | — | — | — | F | F | — | M |
| boutique | — | — | — | — | — | F | — | — | — |
| notifications | — | — | — | — | — | — | M | — | — |

---

## Ordre de réparation

**Aujourd'hui — ce qui est cassé ou ce qui ment sur l'argent**

1. **Rebrancher l'auto-inscription** sur le contrat serveur de septembre (B1) : ne plus attendre `userId`, envoyer `email` à `/verify`. Personne ne peut ouvrir de boutique aujourd'hui.
2. **Rendre le code de vérification saisissable** (C2) : un écran atteignable depuis le message de connexion. Même chantier que le point 1.
3. **Dire la vérité sur le remboursement d'un retour** (A1) : réécrire les quatre textes, et ajouter une confirmation à la hauteur d'un débit immédiat.
4. **Corriger le « Net de la période »** (A2) : projeter le `NetAmount` que le serveur calcule déjà, au lieu de recomposer la soustraction côté écran.
5. **Confirmer « Confirmer la livraison »** (F2) : un clic libère la séquestre et ouvre la fenêtre de retour, sans retour arrière.

**Cette semaine — ce qui bloque l'exploitation**

6. **Reconnaître `ReadyForPickup`** (A3, C1) : l'ajouter à `inTab`, à la table de libellés, et aux conditions des boutons. Un mot dans trois fichiers.
7. **Ouvrir le repli transporteur** (A4) : offrir « Expédier » depuis cet état, et projeter `courierFailureReason` pour que le motif d'échec atteigne l'écran.
8. **Corriger le compteur « À traiter »** (A5) : ne compter que les commandes confirmées ou payées.
9. **Aligner le commentaire et le code sur `MarkShipped`** (B3) : ne plus proposer « Expédier » depuis `Pending`.
10. **Confirmer « Approuver » et « Marquer reçu »** (F1, C3), en disant que les deux sont sans retour.

**Ensuite — le fond**

11. **Lire le schéma d'attributs de catégorie** (B2, D1) : dessiner le formulaire depuis `AttributeSchema`, dans l'assistant comme dans la fiche. Le serveur envoie déjà tout ce qu'il faut.
12. **Vérifier le SKU à l'ouverture d'une référence en stock** (A6, S2) : même contrôle que `CreateOfferCommandHandler`. Corrige aussi l'injection inter-vendeurs.
13. **Lever un événement au renommage d'un SKU de variante** (A7), ou interdire le renommage. En l'état, c'est une vente à découvert.
14. **Lire la dernière entrée de `x-forwarded-for`** (S1), et relever les seuils dans le même geste (S5).
15. **Paginer les notifications** (G1) — aujourd'hui la 51ᵉ est inatteignable.
16. `formatMoney` partout où le contrat porte une devise (H), et débloquer la saisie d'un prix non-XOF.
17. Les points moyens restants : A8 à A16, C4 à C6, D2, F3 à F4, S3, S4.

---

*Audit réalisé le 11 septembre 2026. Les défauts classés GRAVE ont tous été revérifiés dans le code une seconde fois avant rédaction.*
