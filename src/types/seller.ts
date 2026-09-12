/**
 * Types du BFF Vendeur.
 *
 * Ils décalquent les `record` C# de `Marketplace.Bff.Seller` et des contrats de modules
 * (`OrderSummary`, `SellerWalletView`, `ProductSummary`, `OfferSummary`), sérialisés en
 * camelCase par ASP.NET.
 *
 * ⚠️ Écrits à partir des contrats RÉELS, pas devinés depuis l'ancien tableau de bord
 * Blazor. Celui-ci recopiait certains champs sous d'autres noms et calculait côté client
 * des montants que le serveur fournit déjà — c'est l'origine du constat « net vendeur
 * calculé côté client avec repli à zéro » de l'audit.
 */

// ─────────────────────────────────────────────────────────────────────────────────
// Tableau de bord
// ─────────────────────────────────────────────────────────────────────────────────

export interface SellerDashboard {
  ordersTotal: number;
  ordersToProcess: number;
  grossSales30d: number;
  netPayout30d: number;
  currency: string;
  reviewsCount: number;
  averageRating: number;
  ordersByStatus: Record<string, number>;
  /**
   * Sections dont les données n'ont PAS pu être récupérées : « orders », « statement »,
   * « reviews ». Vide en fonctionnement normal.
   *
   * C'est le champ le plus important de cet objet. Les chiffres correspondants valent
   * zéro quand la récupération échoue ; sans cette liste, un vendeur ne peut pas
   * distinguer « aucune vente ce mois-ci » de « le service de facturation est tombé ».
   * L'écran DOIT la lire — la laisser de côté reviendrait à réintroduire le repli
   * silencieux que le BFF a justement pris la peine de signaler.
   */
  unavailable: string[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// Commandes
// ─────────────────────────────────────────────────────────────────────────────────

/** Ligne de commande, déjà restreinte au vendeur par le BFF (anti-IDOR côté serveur). */
export interface SellerOrderLine {
  productId: string;
  sku: string;
  quantity: number;
  finalUnitPrice: number;
  lineTotal: number;

  /**
   * Présents uniquement sur le DÉTAIL (`GET /seller/orders/{id}`), enrichis depuis le
   * catalogue.
   *
   * ⚠️ Le champ s'appelle `productName`, PAS `name` — le handler projette un objet
   * anonyme (`SellerOrderEndpoints.ScopeToSeller` / la boucle d'enrichissement) dont les
   * noms ne suivent pas ceux du record de contrat. L'écrire `name` compilait très bien
   * et affichait le SKU à la place du nom sur toutes les lignes, l'image correcte juste
   * à côté : le genre de bug qu'on ne voit pas en relisant, seulement à l'écran.
   */
  productName?: string | null;
  imageUrl?: string | null;
  offerId?: string;
}

/**
 * Commande vue par le vendeur.
 *
 * `subtotal` et `grandTotal` sont RECALCULÉS par le BFF sur les seules lignes de ce
 * vendeur (`ScopeToSeller`) : sur une commande multi-vendeurs, ce ne sont pas les
 * totaux payés par l'acheteur, et il ne faut donc jamais y ajouter les frais de port
 * de la commande entière.
 */
export interface SellerOrder {
  id: string;
  buyerId: string;
  status: string;
  paymentStatus: string;
  createdAtUtc: string;
  subtotal: number;
  grandTotal: number;
  customer: string;
  lines: SellerOrderLine[];
}

/**
 * Un jour de la série des commandes. Décalque `SellerOrderEndpoints.SeriesAsync`.
 *
 * Les jours SANS commande sont présents, à zéro : c'est le serveur qui rend la grille
 * complète, sinon une courbe relierait le 3 au 11 par une droite et donnerait à une
 * semaine morte l'allure d'une progression.
 */
export interface OrderSeriesPoint {
  /** Jour LOCAL du vendeur, « AAAA-MM-JJ » (le décalage est envoyé dans la requête). */
  date: string;
  /** Commandes passées ce jour-là, tous statuts confondus. */
  orders: number;
  /** Parmi elles, celles annulées ou en échec. */
  cancelled: number;
}

/**
 * Série des commandes sur une période.
 *
 * AUCUN MONTANT — voir la note du handler : la somme des sous-totaux de commandes
 * n'est pas un chiffre d'affaires. Les montants se lisent dans le relevé
 * (`SellerStatement`), seule source qui déduise commission, frais et remboursements.
 */
export interface SellerOrderSeries {
  from: string;
  to: string;
  offsetMinutes: number;
  /** Total de la période — pas la somme d'une page. */
  totalOrders: number;
  points: OrderSeriesPoint[];
}

export interface OrderShippingAddress {
  label?: string | null;
  recipient?: string | null;
  /** Libellé résolu par le serveur depuis le code figé sur la commande. */
  communeName?: string | null;
  communeCode?: string | null;
  quartier?: string | null;
  /** Point de repère — vide sur les commandes antérieures à la refonte. */
  landmark?: string | null;
  line1?: string | null;
  /** Position figée par l'acheteur. `null` si elle n'a pas été partagée. */
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
}

export interface SellerOrderDetail extends SellerOrder {
  currency?: string;
  shippingAddress?: OrderShippingAddress | null;

  /**
   * Remises DÉJÀ DÉDUITES des lignes (`LineTotal = FinalUnitPrice × Quantity`, et
   * `FinalUnitPrice` est net). Elles ne se soustraient donc pas du total : ce sont des
   * repères, pas des opérations. Recalculées sur les seules lignes du vendeur.
   */
  totalSellerDiscount?: number;
  totalPlatformDiscount?: number;

  /**
   * ⚠️ FRAIS DE PORT DE LA COMMANDE ENTIÈRE — pas de votre part.
   *
   * `ScopeToSeller` recalcule `subtotal`, `grandTotal` et les remises sur vos lignes,
   * mais laisse `shippingFee` intact : c'est ce que l'acheteur a payé pour toute la
   * commande, vendeurs tiers compris. L'additionner au total du vendeur donnerait un
   * montant qu'il ne percevra jamais — d'où l'affichage à part, hors du récapitulatif.
   */
  shippingFee?: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Portefeuille
// ─────────────────────────────────────────────────────────────────────────────────

export interface SellerWallet {
  sellerId: string;
  /** Gains pas encore libérés (commandes non réglées). */
  pendingBalance: number;
  /** Solde retirable. */
  availableBalance: number;
  /**
   * Retraits DÉJÀ RETENUS : demandés (en attente de validation) et en cours de
   * versement. Ces fonds ne sont plus dans `availableBalance` — les afficher évite au
   * vendeur de croire que son argent s'est évaporé entre la validation et le versement.
   */
  pendingWithdrawal: number;
  currency: string;
}

export interface WalletTransaction {
  id: string;
  account: string;
  direction: string;
  amount: number;
  currency: string;
  /** Texte libre côté serveur (pas une énumération) : affiché tel quel. */
  reason: string;
  referenceType?: string | null;
  referenceId?: string | null;
  createdAtUtc: string;
}

export interface Withdrawal {
  id: string;
  sellerId: string;
  amount: number;
  currency: string;
  status: string;
  providerRef?: string | null;
  failureReason?: string | null;
  createdAtUtc: string;
  completedAtUtc?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Catalogue et offres
// ─────────────────────────────────────────────────────────────────────────────────

export interface ProductVariant {
  id: string;
  sku: string;
  attributes: Record<string, string>;
  barcode?: string | null;
  weightGrams: number;
}

export interface ProductMedia {
  id: string;
  url: string;
  type: string;
  isPrimary: boolean;
  position: number;
  altText: string;
}

export interface SellerProduct {
  id: string;
  sellerId: string;
  categoryId: string;
  brandId?: string | null;
  name: string;
  description: string;
  slug: string;
  status: string;
  gtin?: string | null;
  ean?: string | null;
  productGroupId?: string | null;
  attributes: Record<string, string>;
  tags: string[];
  variants: ProductVariant[];
  media: ProductMedia[];
}

/**
 * Offre : le prix et sa décomposition.
 *
 * ⚠️ `sellerPrice`, `commissionAmount`, `providerFeeAmount` et `productPrice` sont
 * calculés PAR LE SERVEUR, à partir du barème en vigueur. On les affiche tels quels.
 *
 * L'application mobile vendeur, elle, recalcule ces montants avec des taux codés en
 * dur (`app_config.dart` : 10 % et 5 %) — constat §3.2 de l'audit : tout changement de
 * barème fait mentir l'app jusqu'à sa prochaine publication sur les stores. Cette
 * console n'a pas ce défaut, et il ne faut pas l'y introduire « pour aller plus vite ».
 */
export interface SellerOffer {
  id: string;
  productId: string;
  /**
   * Nom du produit, recollé par le BFF (`SellerOfferView`) — `OfferSummary` ne porte
   * qu'un GUID. Vaut « Produit introuvable » si la fiche a été supprimée alors que
   * l'offre subsiste : c'est un signalement, pas un repli cosmétique.
   */
  productName: string;
  sellerId: string;
  sku: string;
  basePriceAmount: number;
  currency: string;
  condition: string;
  fulfillmentType: string;
  shipFromLocationId: string;
  handlingTime: number;
  status: string;
  /** Ce que le vendeur perçoit réellement. */
  sellerPrice: number;
  commissionAmount: number;
  providerFeeAmount: number;
  /** Prix payé par l'acheteur. */
  productPrice: number;
  /** Prix barré, si une remise est en cours. */
  compareAtAmount?: number | null;
  discountEndsOnUtc?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Retours (RMA)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Demande de retour. Décalque `ReturnRequestSummary`.
 *
 * Cycle : Requested → Approved → Received → RefundPending → Refunded, ou
 * Requested → Rejected.
 */
export interface SellerReturn {
  id: string;
  orderId: string;
  offerId: string;
  buyerId: string;
  sellerId: string;
  /** `ReturnReason` : Defective, NotAsDescribed, ChangedMind, WrongItem, Other. */
  reason: string;
  status: string;
  currency: string;

  /**
   * PLAFOND remboursable — total de la ligne de commande, figé à la création.
   *
   * ⚠️ À ne pas confondre avec `refundAmount`, qui est le montant DÉJÀ décidé. C'est
   * exactement la confusion qui a empêché l'application mobile de borner sa saisie :
   * elle ne disposait que du second et l'a pris pour le premier, si bien que le champ
   * acceptait n'importe quel nombre.
   *
   * Vaut 0 sur les retours antérieurs à ce champ : signifie « inconnu », pas « zéro ».
   * Le domaine n'applique alors aucune borne — l'interface ne doit pas en inventer une.
   */
  refundableAmount: number;

  /** Montant de remboursement validé. `null` tant qu'aucune décision n'a été prise. */
  refundAmount?: number | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  createdAtUtc: string;
  resolvedAtUtc?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Litiges
// ─────────────────────────────────────────────────────────────────────────────────

export interface DisputeMessage {
  authorId: string;
  body: string;
  photoUrl?: string | null;
  createdAtUtc: string;
}

/**
 * Litige. Décalque `DisputeSummary`.
 *
 * `raisedBy` est l'identifiant de l'ACHETEUR qui l'a ouvert : il sert à distinguer ses
 * messages de ceux du vendeur dans le fil, faute d'un champ « rôle » sur les messages.
 */
export interface SellerDispute {
  id: string;
  orderId: string;
  raisedBy: string;
  /** `DisputeType` : NotReceived, NotConforming, DamagedItem, Other. */
  type: string;
  status: string;
  /** `DisputeResolution`, décidée par la modération. `null` tant que le litige est ouvert. */
  resolution?: string | null;
  refundAmount?: number | null;
  createdAtUtc: string;
  resolvedAtUtc?: string | null;
  messages: DisputeMessage[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// Stock et lieux d'expédition
// ─────────────────────────────────────────────────────────────────────────────────

/** Lieu d'expédition de la boutique. Décalque `FulfillmentLocationSummary`. */
export interface FulfillmentLocation {
  id: string;
  /** Toujours « SellerAddress » pour un lieu créé par un vendeur. */
  type: string;
  ownerId?: string | null;
  communeCode: string;
  communeName: string;
  quartier?: string | null;
  landmark?: string | null;
  line?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Article de stock, pour un SKU dans une localisation. Décalque `InventoryItemSummary`.
 *
 * `available` = `onHand` − `reserved` : c'est le seul chiffre qui dit ce qu'on peut
 * encore vendre. Afficher `onHand` seul donnerait un stock apparent supérieur au réel.
 */
export interface InventoryItem {
  id: string;
  sku: string;
  locationId: string;
  onHand: number;
  reserved: number;
  available: number;
  reorderThreshold: number;
  /** Calculé par le domaine à partir de `available` et du seuil — pas recalculé ici. */
  isLowStock: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Expéditions
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Ligne de la file d'exécution — forme ENRICHIE renvoyée par `GET /seller/shipments`.
 *
 * DEUX PIÈGES, tous deux dus au fait que ce handler projette un objet anonyme
 * (`SellerFulfillmentEndpoints.EnrichAsync`) et non le record de contrat :
 *
 *   1. La date s'appelle `createdAt`, PAS `createdAtUtc` comme partout ailleurs.
 *   2. Le statut est RENOMMÉ : « Preparing » côté domaine devient « ReadyForPickup »
 *      ici (« Prepared » sur les serveurs antérieurs au renommage). Le détail
 *      (`GET /seller/shipments/{id}`), lui, renvoie le statut brut. Les trois
 *      orthographes sont traduites vers le même libellé — voir `shipmentStatus` dans
 *      status-labels.ts.
 */
export interface ShipmentQueueRow {
  id: string;
  orderId: string;
  /** Déjà formatée « CMD-XXXXXXXX » par le serveur : à afficher telle quelle. */
  orderReference: string;
  customer: string;
  status: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  /**
   * « Courier », « Carrier », ou nul tant que personne n'a emporté le colis. Le serveur
   * le projette déjà ; il n'était pas déclaré ici. Champ RÉCENT, comme le renommage de
   * statut qui l'accompagne : rien de ce qui le concerne n'a encore l'usure qui permet
   * de le supposer éprouvé.
   */
  deliveryMode?: string | null;
  /**
   * ───────────────────────────────────────────────────────────────────────────────
   * POURQUOI LE DERNIER COURSIER A RENONCÉ — NUL SI AUCUNE COURSE N'A ÉCHOUÉ.
   *
   * `Shipment.MarkCourierDeliveryFailed` ANNOTE l'état sans l'avancer : l'expédition
   * reste « en préparation ». Sans ce champ, un colis qu'un coursier a abandonné est
   * indiscernable dans la file d'un colis qu'on vient de préparer — même statut, même
   * couleur, même silence — alors que le vendeur reçoit par ailleurs un message lui
   * demandant d'agir. Un message d'alerte qui ne se vérifie nulle part finit par être
   * pris pour une erreur du système.
   *
   * Le motif est celui que porte la course, déjà normalisé et borné à 300 caractères
   * côté domaine. On l'affiche tel quel : le reformuler perdrait ce que le support
   * doit lire.
   * ───────────────────────────────────────────────────────────────────────────────
   */
  courierFailureReason?: string | null;
  itemCount: number;
  createdAt: string;
}

export interface ShipmentItem {
  sku: string;
  quantity: number;
}

/** Détail d'une expédition — forme BRUTE (`ShipmentSummary`), non enrichie. */
export interface ShipmentDetail {
  id: string;
  orderId: string;
  sellerId: string;
  buyerId: string;
  shipFromLocationId: string;
  status: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  createdAtUtc: string;
  shippedAtUtc?: string | null;
  deliveredAtUtc?: string | null;
  items: ShipmentItem[];
}

/** Transporteur du référentiel plateforme. Décalque `CarrierSummary`. */
export interface Carrier {
  id: string;
  name: string;
  code: string;
  trackingUrlTemplate?: string | null;
  logoUrl?: string | null;
  isActive: boolean;
  createdAtUtc: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Finances
// ─────────────────────────────────────────────────────────────────────────────────

/** Une écriture du relevé. Montant SIGNÉ, déjà arrondi à l'entier par le serveur. */
export interface StatementLine {
  date: string;
  label: string;
  /** « sale » | « commission » | « provider » | « refund ». */
  type: string;
  amountXof: number;
}

/**
 * Relevé d'une période. Décalque l'objet anonyme de `SellerFinanceEndpoints.StatementAsync`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════
 * `netSalesXof` EST LE SEUL NET QUI VEUILLE DIRE QUELQUE CHOSE. NE LE RECALCULEZ PAS.
 *
 * L'écran composait autrefois son propre net :
 *   `grossSalesXof − commissionXof − providerFeeXof − refundsXof`
 *
 * C'était une soustraction d'entiers tous fournis par le serveur — donc, croyait-on,
 * sans risque. Elle était pourtant fausse sur toute vente remboursée : rembourser ne
 * retire pas la ligne de gain du relevé (aucun filtre de statut côté dépôt, et la
 * contre-passation n'écrit jamais `Reversed`). La vente gardait son brut ET sa
 * commission, pendant que le remboursement était retranché à 100 % — donc commission et
 * frais déduits deux fois. Une vente de 10 000 remboursée affichait −1 500 F CFA de
 * perte pour un impact réel nul.
 *
 * `netSalesXof` est la somme des `SellerEarning.NetAmount`, c'est-à-dire ce qui a été
 * RÉELLEMENT crédité. Les trois composantes restent projetées pour expliquer la
 * décomposition, pas pour être recombinées.
 *
 * Aucun `?? 0` sur ces champs : un zéro silencieux ferait apparaître un net égal au
 * brut, en gras et en couleur. On les déclare requis et on ne les rattrape jamais.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
export interface SellerStatement {
  from: string;
  to: string;
  grossSalesXof: number;
  /** Ce qui vous a été crédité pour vos ventes de la période (brut − commission − frais). */
  netSalesXof: number;
  commissionXof: number;
  providerFeeXof: number;
  refundsXof: number;
  lines: StatementLine[];
}

/** Un reversement reçu (ou en cours). Décalque `PayoutSummary`. */
export interface SellerPayout {
  id: string;
  sellerId: string;
  grossAmount: number;
  commissionAmount: number;
  /** Fourni PAR LE SERVEUR : on ne le recalcule pas. */
  netAmount: number;
  currency: string;
  status: string;
  providerRef?: string | null;
  paidAtUtc?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Avis
// ─────────────────────────────────────────────────────────────────────────────────

/** Avis client sur un produit de la boutique. Décalque `ReviewSummary`. */
export interface SellerReview {
  id: string;
  productId: string;
  sellerId: string;
  buyerId: string;
  rating: number;
  title: string;
  body: string;
  isVerifiedPurchase: boolean;
  /** `ReviewStatus` : Published, Flagged, Rejected. */
  status: string;
  createdAtUtc: string;
  sellerReply?: string | null;
  sellerRepliedAtUtc?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────────

/** Notification reçue. Décalque `NotificationSummary`. */
export interface SellerNotification {
  id: string;
  recipientUserId: string;
  /** Canal d'émission : « push », « email »… */
  channel: string;
  subject: string;
  body: string;
  relatedEntityType: string;
  relatedEntityId?: string | null;
  status: string;
  createdAtUtc: string;
  readAtUtc?: string | null;
}

/**
 * État d'une catégorie de notification.
 *
 * ⚠️ ASYMÉTRIE LECTURE / ÉCRITURE, à ne pas manquer :
 *   — `GET /seller/notifications/preferences` renvoie `{ categories: [{ key, enabled }] }`
 *   — `PUT` attend `{ mutedCategories: [...] }`, c'est-à-dire l'INVERSE.
 *
 * Envoyer la liste des catégories activées couperait exactement celles que le vendeur
 * vient de demander à recevoir. La conversion se fait en un seul endroit, à l'envoi.
 */
export interface NotificationCategoryState {
  key: string;
  enabled: boolean;
}

export interface NotificationPreferences {
  categories: NotificationCategoryState[];
}

// ─────────────────────────────────────────────────────────────────────────────────
// Boutique et KYB
// ─────────────────────────────────────────────────────────────────────────────────

/** Compte de reversement (Mobile Money, banque…). Décalque `PayoutAccountSummary`. */
export interface PayoutAccount {
  provider: string;
  accountNumber: string;
  accountName: string;
}

/**
 * Pièce justificative KYB. Décalque `KybDocumentSummary`.
 *
 * `status` est DÉRIVÉ de la vérification de la boutique, pas propre à la pièce :
 * « Verified » si la boutique est vérifiée, « Rejected » si elle est refusée, sinon
 * « InReview ». Toutes les pièces d'une même boutique portent donc le même statut —
 * l'écran ne doit pas laisser croire qu'elles sont examinées une par une.
 */
export interface KybDocument {
  id: string;
  /** `KybDocumentType` : IdCard, BusinessRegistry, TaxId, ProofOfAddress. */
  type: string;
  fileUrl: string;
  status: string;
  uploadedAtUtc: string;
  verifiedAtUtc?: string | null;
}

/** Informations société déclarées. Tous les champs sont optionnels. */
export interface SellerCompanyInfo {
  legalName?: string | null;
  rccm?: string | null;
  ifu?: string | null;
  address?: string | null;
  /** Code d'une des 77 communes (« abomey-calavi »), pas un libellé libre. */
  commune?: string | null;
  /** Libellé accentué, résolu par le serveur — pour l'affichage en lecture seule. */
  communeName?: string | null;
  activity?: string | null;
  managerName?: string | null;
  phone?: string | null;
}

/** Ma boutique. Décalque `SellerSummary` (vue propriétaire, pas la vitrine publique). */
export interface SellerShop {
  id: string;
  userId: string;
  shopName: string;
  logoUrl?: string | null;
  description?: string | null;
  status: string;
  kybStatus: string;
  /** Taux DÉCIMAL (0,10 = 10 %), pas un pourcentage. */
  commissionRate: number;
  rating: number;
  salesCount: number;
  payout?: PayoutAccount | null;
  kybDocuments: KybDocument[];
  metadata?: SellerCompanyInfo | null;
  /**
   * Motif du dernier refus de KYB. Le vendeur voyait « Rejected » sans savoir ce qui
   * n'allait pas, et re-téléversait la pièce refusée.
   */
  kybRejectionReason?: string | null;
  /**
   * Suspension EN COURS : sa date et son motif. Null hors suspension.
   *
   * Servis par `/seller/shop` — `SellerSummary` les porte — et déclarés nulle part
   * ici : la console envoyait donc le vendeur « contacter le support pour connaître le
   * motif » d'une suspension dont elle tenait le motif en main.
   */
  suspendedOnUtc?: string | null;
  suspensionReason?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Compte
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Profil du compte. Décalque `SellerAccountMe`.
 *
 * ⚠️ Objet À PLAT : les champs de boutique (`shopName`, `logoUrl`, `kybStatus`) y sont
 * mélangés à ceux du compte, délibérément côté serveur. Ne pas s'attendre à un objet
 * `shop` imbriqué.
 */
export interface SellerAccount {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  status: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  roleIds: string[];
  shopName?: string | null;
  logoUrl?: string | null;
  kybStatus?: string | null;
  acceptedTermsVersion?: string | null;
  acceptedTermsOnUtc?: string | null;
}

/** Réponse de `POST /seller/account/me/mfa/setup`. Décalque `MfaSetupResponse`. */
export interface MfaSetup {
  secret: string;
  /** URI `otpauth://` à transformer en QR code, ou à saisir à la main. */
  otpAuthUri: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Messagerie
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Ligne de la liste des conversations — forme ENRICHIE projetée par
 * `SellerMessagingEndpoints.ListAsync`, pas le `ConversationSummary` du module.
 *
 * ⚠️ `subject` est en réalité le `ContextType` de la conversation (« order »,
 * « product »…), pas un objet de message rédigé par quelqu'un.
 */
export interface SellerConversation {
  id: string;
  /** Nom de l'autre participant, résolu via Identity. « Client » à défaut. */
  customer: string;
  /**
   * Identifiant Identity de l'autre participant — le même espace d'identifiants que
   * `SellerOrder.buyerId` (tous deux viennent du `sub` du jeton).
   *
   * C'est ce qui permet à la fiche commande de retrouver LE fil de CET acheteur.
   * Le nom ne le permet pas : il se replie sur « Client » quand Identity ne répond
   * pas, et deux acheteurs peuvent être homonymes.
   *
   * Absent = serveur antérieur à cette projection ; on ne propose alors aucun lien
   * plutôt qu'un lien au hasard.
   */
  counterpartId?: string | null;
  /**
   * CHAÎNE LIBRE DU CLIENT QUI A OUVERT LE FIL (`ContextType`), pas un libellé de la
   * plateforme : elle vient du corps de requête, n'est validée nulle part et n'est
   * bornée que par la colonne. L'écran l'affichait sous « À propos de : », au format
   * d'un libellé officiel — à présenter comme une citation, jamais comme notre texte.
   */
  subject?: string | null;
  /**
   * « Open », « Archived »… `SendMessage` refuse en 409 tout ce qui n'est pas `Open`,
   * et l'archivage est accessible à N'IMPORTE QUEL participant, donc à l'acheteur. Le
   * champ existait côté contrat ; le BFF ne le projetait pas, et l'écran laissait donc
   * une zone de saisie sur un fil qui n'accepte plus rien.
   */
  status?: string | null;
  lastMessage: string;
  lastAt: string;
  unread: number;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  /** Vrai si c'est MOI qui ai posé cette réaction. Une seule réaction par personne. */
  mine: boolean;
}

/**
 * Message d'un fil — forme ENRICHIE de `MessagesAsync`.
 *
 * ⚠️ Les noms diffèrent du contrat de module : `sentAt` (et non `createdAtUtc`),
 * `readAt` (et non `readAtUtc`), plus un booléen `fromSeller` calculé côté serveur en
 * comparant l'expéditeur au porteur du jeton. On ne devine donc pas « qui parle » à
 * partir d'un identifiant, contrairement à l'écran Litiges.
 *
 * `isDeleted` = supprimé pour tout le monde ; le corps renvoyé vaut alors
 * « Message supprimé », le vrai texte restant en base pour le support.
 */
export interface SellerMessage {
  id: string;
  fromSeller: boolean;
  body: string;
  attachments?: string[];
  sentAt: string;
  /** Date à laquelle l'AUTRE participant a lu ce message. `null` = pas encore lu. */
  readAt?: string | null;
  isDeleted?: boolean;
  reactions?: MessageReaction[];
}

/**
 * Palette de réactions autorisée.
 *
 * Recopiée de `MessageReactions.Allowed` côté domaine, où le jeu est FERMÉ et validé :
 * envoyer un autre caractère est rejeté. Proposer un sélecteur d'emoji libre produirait
 * donc des erreurs sur la moitié des clics.
 */
export const MESSAGE_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * UN ATTRIBUT ATTENDU PAR UNE CATÉGORIE. Décalque de `CategoryAttributeSummary`.
 *
 * Le serveur envoyait déjà tout cela à chaque chargement de page ; la console ne le
 * déclarait pas, donc ne le lisait pas, donc éditait les caractéristiques en clé et
 * valeur libres pendant que le serveur, lui, contrôlait le type, les bornes et
 * l'appartenance à une liste fermée.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
export interface CategoryAttribute {
  /** Clé technique : à utiliser TELLE QUELLE dans les attributs du produit. */
  key: string;
  label: string;
  /** « text », « number », « boolean » ou « enum ». */
  type: string;
  required: boolean;
  /** Valeurs admises — type « enum » uniquement ; tableau vide sinon. */
  values: string[];
  unit?: string | null;
  /** Borne inférieure pour un nombre, longueur MINIMALE pour un texte. */
  min?: number | null;
  /** Borne supérieure pour un nombre, longueur MAXIMALE pour un texte. */
  max?: number | null;
  /**
   * Nom de la catégorie PARENTE qui déclare cet attribut, quand il est hérité. Nul
   * pour un attribut propre à la catégorie choisie.
   *
   * Sert à grouper le formulaire du général au particulier — « Informatique », puis
   * « Ordinateurs », puis « Ordinateurs portables » — plutôt que d'aligner quinze
   * champs sans hiérarchie visible.
   */
  inheritedFrom?: string | null;
}

export interface SellerCategory {
  id: string;
  name: string;
  path?: string | null;
  /**
   * « Active » ou « Archived ». Le sélecteur proposait TOUT, y compris les catégories
   * archivées, que `ProductAttributeGuard` refuse en 409 — après quatre étapes
   * remplies et les photos téléversées. Le champ existait côté serveur ; il n'était
   * pas déclaré ici.
   */
  status?: string | null;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * LE SCHÉMA EFFECTIF : LA CATÉGORIE **ET TOUS SES ANCÊTRES**.
   *
   * Ce champ ne portait que les attributs de la catégorie elle-même. Un produit rangé
   * dans « Informatique › Ordinateurs › Ordinateurs portables » ne se voyait donc
   * demander que ceux de la feuille — alors que les attributs communs (marque,
   * garantie, pays de fabrication) se posent sur les étages du haut.
   *
   * Rien n'échouait : la fiche partait, simplement sans les champs généraux. La perte
   * ne se voyait qu'à la recherche à facettes, quand « filtrer par marque » ne
   * ramenait rien sur la moitié du rayon.
   *
   * Vide, ou absent, = la branche n'impose aucune caractéristique.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  attributeSchema?: CategoryAttribute[] | null;
  /**
   * Vrai si la catégorie n'a aucune sous-catégorie.
   *
   * UN PRODUIT NE SE CRÉE QUE DANS UNE FEUILLE, et le serveur le refuse désormais
   * (`catalog.product.category_not_leaf`). Ranger un ordinateur portable dans
   * « Ordinateurs » le prive des attributs de la feuille — donc des filtres par
   * lesquels l'acheteur le cherche — sans qu'aucune erreur ne le signale.
   *
   * Absent = serveur antérieur à cette règle : on traite alors comme une feuille
   * plutôt que de bloquer toutes les catégories.
   */
  isLeaf?: boolean;
  /**
   * Faux = toute clé hors schéma fait échouer l'enregistrement ENTIER de la fiche.
   * Vrai par défaut côté serveur : un schéma décrit ce qu'on attend, pas
   * nécessairement tout ce qui est permis.
   */
  allowUnknownAttributes?: boolean;
}

export interface SellerBrand {
  id: string;
  name: string;
}
