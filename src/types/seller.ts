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

export interface OrderShippingAddress {
  label?: string | null;
  recipient?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  country?: string | null;
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
  line: string;
  city: string;
  country: string;
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
 * ⚠️ DEUX PIÈGES, tous deux dus au fait que ce handler projette un objet anonyme
 * (`SellerFulfillmentEndpoints.EnrichAsync`) et non le record de contrat :
 *
 *   1. La date s'appelle `createdAt`, PAS `createdAtUtc` comme partout ailleurs.
 *   2. Le statut est RENOMMÉ : « Preparing » côté domaine devient « Prepared » ici.
 *      Le détail (`GET /seller/shipments/{id}`), lui, renvoie le statut brut. Les deux
 *      vocabulaires sont donc traduits (voir `shipmentStatus` dans status-labels.ts).
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
 * ⚠️ IL N'Y A PAS DE CHAMP « NET ». Le net se calcule :
 *   `grossSalesXof − commissionXof − providerFeeXof − refundsXof`
 *
 * C'est une soustraction d'entiers tous fournis par le serveur, pas une reconstitution
 * du barème — rien à voir avec l'app mobile, qui recalcule commission et frais à partir
 * de taux codés en dur et ment dès que le barème change.
 *
 * En revanche le piège reste le même s'il n'est pas vu : appliquer `?? 0` à ces quatre
 * champs ferait, en cas de renommage côté serveur, apparaître un net ÉGAL au brut, en
 * gras et en vert. On les déclare donc requis et on ne les rattrape jamais par un zéro.
 *
 * Le serveur refuse par ailleurs de servir un relevé partiel : si les remboursements
 * sont introuvables il répond 503 plutôt qu'un net surévalué.
 */
export interface SellerStatement {
  from: string;
  to: string;
  grossSalesXof: number;
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
  city?: string | null;
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
  subject?: string | null;
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

export interface SellerCategory {
  id: string;
  name: string;
  path?: string | null;
}

export interface SellerBrand {
  id: string;
  name: string;
}
