/**
 * Traduction des valeurs d'énumération du serveur.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * Le BFF renvoie ses statuts tels qu'ils sont écrits en C# : « AwaitingPayment »,
 * « OutOfStock », « Refurbished ». Une console entièrement en français ne les affiche
 * pas bruts — c'est le défaut qu'a longtemps porté la console admin, où le filtre
 * proposait « Capturé » pendant que la ligne d'à côté affichait « Captured ».
 *
 * Par DOMAINE, parce que le français accorde : « Active » se dit « Actif » pour un
 * produit et « Active » pour une offre. Une table unique imposerait une faute d'accord
 * sur la moitié des écrans, ou des « Payé(e) » qui trahissent la traduction mécanique.
 *
 * Valeur inconnue ⇒ on renvoie la valeur brute, simplement découpée aux majuscules.
 * Elle reste ainsi LISIBLE et surtout VISIBLE : un statut ajouté côté serveur se
 * remarque, au lieu de disparaître derrière un tiret.
 * ─────────────────────────────────────────────────────────────────────────────────
 */

export type StatusDomain =
  | "order"
  | "payment"
  | "product"
  | "offer"
  | "offerCondition"
  | "fulfillmentType"
  | "withdrawal"
  | "walletAccount"
  | "walletDirection"
  | "returnStatus"
  | "returnReason"
  | "disputeStatus"
  | "disputeType"
  | "disputeResolution"
  | "shipmentStatus"
  | "reviewStatus"
  | "statementLine"
  | "payoutStatus"
  | "notificationCategory"
  | "sellerStatus"
  | "kybStatus"
  | "kybDocumentType"
  | "accountStatus"
  | "payoutProvider";

type Table = Record<string, string>;

/** Clés en minuscules : la casse d'un champ qui transite par JSON ou une URL n'est jamais garantie. */
const TABLES: Record<StatusDomain, Table> = {
  // OrderStatus — « commande », féminin.
  order: {
    pending: "En attente",
    awaitingpayment: "En attente de paiement",
    paid: "Payée",
    confirmed: "Confirmée",
    cancelled: "Annulée",
    failed: "Échouée",
    delivered: "Livrée",
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Statut de paiement d'une commande — « paiement », masculin.
  //
  // ⚠️ CE QUE LE BFF ENVOIE, PAS L'ÉNUMÉRATION DU MODULE.
  //
  // `SellerOrderEndpoints.ToPaymentStatus` réduit le statut de commande à QUATRE
  // valeurs : « Paid », « Pending », « Refunded », « Failed ». Ce ne sont pas celles de
  // `PaymentStatus` côté module (Authorized, Captured…), qui ne traversent jamais cette
  // route.
  //
  // Calquer la table sur l'énumération plutôt que sur le handler avait deux effets, et
  // le premier était visible partout : « paid » manquait, donc toute commande payée,
  // confirmée ou livrée — la majorité de la liste — affichait « Paid » en anglais. Les
  // deux clés inutiles, elles, ne coûtaient rien mais entretenaient l'illusion que la
  // table était complète.
  //
  // `authorized` et `captured` sont conservés en dernier recours : si un jour cette
  // route relaie le statut de paiement brut, le libellé sera juste au lieu d'être
  // anglais. Ils sont marqués comme tels pour qu'on sache qu'ils ne sont pas atteints.
  // ─────────────────────────────────────────────────────────────────────────────
  payment: {
    paid: "Payé",
    pending: "En attente",
    refunded: "Remboursé",
    failed: "Échoué",
    // Non produits par ToPaymentStatus — filet de sécurité.
    authorized: "Autorisé",
    captured: "Encaissé",
  },

  // ProductStatus — « produit », masculin.
  product: {
    draft: "Brouillon",
    active: "Actif",
    archived: "Archivé",
  },

  // OfferStatus — « offre », féminin.
  offer: {
    active: "Active",
    paused: "En pause",
    outofstock: "En rupture",
  },

  // OfferCondition — état de l'article, masculin.
  offerCondition: {
    new: "Neuf",
    used: "Occasion",
    refurbished: "Reconditionné",
  },

  // Mode d'expédition.
  //
  // ⚠️ Le serveur envoie « Fbs » / « Fbp » (`FulfillmentType` dans
  // Modules/Offers/.../Enums.cs), pas « seller » / « platform ». Cette table ne
  // contenait que la seconde paire : le badge retombait sur `humanize()` et affichait
  // « Fbs » — un sigle de logistique anglo-saxonne, sur un écran destiné à un vendeur
  // de Cotonou. Les deux orthographes sont conservées : l'ancienne pourrait provenir
  // d'une autre surface, et une clé de trop ne coûte rien.
  fulfillmentType: {
    fbs: "Vous expédiez",
    fbp: "Expédié par HBA Express",
    seller: "Vous expédiez",
    platform: "Expédié par HBA Express",
  },

  // WithdrawalStatus — « retrait », masculin.
  withdrawal: {
    requested: "Demandé",
    pending: "En attente",
    processing: "En cours de versement",
    completed: "Versé",
    failed: "Échoué",
    rejected: "Refusé",
  },

  // WalletAccount — le compte concerné par un mouvement.
  walletAccount: {
    pending: "Gains à venir",
    available: "Solde principal",
    commission: "Commission",
    shipping: "Livraison",
    provider: "Frais prestataire",
    refunds: "Remboursements",
  },

  // Sens d'un mouvement de grand livre.
  walletDirection: {
    credit: "Crédit",
    debit: "Débit",
  },

  // ReturnStatus — « retour », masculin.
  //
  // « RefundPending » ne veut PAS dire « remboursé » : le vendeur a validé un montant,
  // l'argent n'est pas parti. FedaPay n'expose aucune API de remboursement, un
  // administrateur exécute chaque versement à la main. Le libellé dit donc où en est
  // réellement l'argent — c'est l'ancien écran qui affirmait « remboursé » sans qu'un
  // franc ait bougé.
  returnStatus: {
    requested: "Demandé",
    approved: "Approuvé",
    rejected: "Refusé",
    received: "Reçu",
    refundpending: "Remboursement en attente de versement",
    refunded: "Remboursé",
  },

  // ReturnReason — motif invoqué par l'acheteur.
  returnReason: {
    defective: "Défectueux",
    notasdescribed: "Non conforme à la description",
    changedmind: "Changement d'avis",
    wrongitem: "Article erroné",
    other: "Autre",
  },

  // DisputeStatus — « litige », masculin.
  disputeStatus: {
    open: "Ouvert",
    underreview: "En cours d'examen",
    resolved: "Résolu",
    escalated: "Escaladé",
  },

  // DisputeType — motif invoqué par l'acheteur.
  disputeType: {
    notreceived: "Non reçu",
    notconforming: "Non conforme",
    damageditem: "Article endommagé",
    other: "Autre",
  },

  // DisputeResolution — issue tranchée par la modération, formulée comme un constat.
  disputeResolution: {
    refundbuyer: "Remboursement intégral de l'acheteur",
    releasetoseller: "En faveur du vendeur",
    partialrefund: "Remboursement partiel",
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // ShipmentStatus — « expédition », féminin.
  //
  // ⚠️ DEUX VOCABULAIRES POUR LA MÊME CHOSE, ET LES DEUX SONT ICI.
  //
  // Le domaine dit « Preparing » ; la file d'exécution (`GET /seller/shipments`) le
  // renomme « Prepared » avant de l'envoyer, alors que le détail
  // (`GET /seller/shipments/{id}`) renvoie la valeur brute. Le même colis change donc
  // de mot selon l'écran d'où on le regarde.
  //
  // On traduit les deux vers le MÊME libellé français : c'est le seul moyen que la
  // liste et le détail racontent la même histoire. Corriger l'écart côté serveur
  // casserait le tableau de bord MAUI qui consomme déjà « Prepared ».
  // ─────────────────────────────────────────────────────────────────────────────
  shipmentStatus: {
    pending: "À préparer",
    preparing: "En préparation",
    prepared: "En préparation",
    shipped: "Expédiée",
    delivered: "Livrée",
    cancelled: "Annulée",
  },

  // ReviewStatus — « avis », masculin.
  reviewStatus: {
    published: "Publié",
    flagged: "Signalé",
    rejected: "Rejeté",
  },

  // Type d'écriture du relevé financier (champ `type` de StatementLine).
  statementLine: {
    sale: "Vente",
    commission: "Commission plateforme",
    provider: "Frais du prestataire de paiement",
    refund: "Remboursement",
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Statut d'un reversement (`PayoutSummary.Status`) — « versement », masculin.
  //
  // ⚠️ DEUX ÉNUMÉRATIONS PORTENT LE NOM `PayoutStatus` DANS CE DÉPÔT :
  //   • Payments/…/IPayoutGateway.cs  → Pending, Started, Processing, Sent, Failed, Unknown
  //     (états d'un versement chez le PRESTATAIRE)
  //   • Settlement/…/SettlementBatch.cs → Scheduled, Paid, Failed
  //     (états d'un reversement dans un LOT de règlement) ← c'est celle-ci
  //
  // `ListSellerPayoutsQuery` sérialise `p.Status.ToString()` depuis la seconde. La
  // première version de cette table reprenait la PREMIÈRE : « Scheduled » n'y figurait
  // pas et s'affichait donc en anglais — sur le statut le plus courant, celui de tout
  // versement pas encore exécuté.
  // ─────────────────────────────────────────────────────────────────────────────
  payoutStatus: {
    scheduled: "Programmé",
    paid: "Versé",
    failed: "Échoué",
  },

  // Catégories de notification (`NotificationCategories.All` côté serveur).
  // Les clés sont fixées par le serveur ; ces libellés reprennent les commentaires
  // du fichier C#, pour que le vendeur coupe bien ce qu'il croit couper.
  notificationCategory: {
    orders: "Commandes et expéditions",
    returns: "Retours et litiges",
    reviews: "Avis clients",
    messages: "Messagerie",
    account: "Compte et paiements",
  },

  // SellerStatus — « boutique », féminin.
  sellerStatus: {
    pending: "En attente de validation",
    active: "Active",
    suspended: "Suspendue",
    closed: "Fermée",
    pendingreactivation: "Réactivation demandée",
  },

  // KybStatus — « dossier », masculin.
  kybStatus: {
    notstarted: "Non commencé",
    inreview: "En cours d'examen",
    verified: "Vérifié",
    rejected: "Rejeté",
  },

  // KybDocumentType — nature de la pièce fournie.
  kybDocumentType: {
    idcard: "Pièce d'identité",
    businessregistry: "Registre du commerce (RCCM)",
    taxid: "Identifiant fiscal (IFU)",
    proofofaddress: "Justificatif de domicile",
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // PayoutProvider — canal de reversement.
  //
  // ⚠️ Les CLÉS sont les valeurs exactes de l'énumération C# : le serveur fait
  // `Enum.TryParse<PayoutProvider>` et refuse tout le reste. « MTN MoMo » avec une
  // espace échoue ; « MtnMomo » passe. C'est pourquoi l'écran propose une liste
  // fermée plutôt qu'un champ libre — un placeholder « MTN MoMo, Moov Money… »
  // dictait littéralement des valeurs rejetées par le serveur.
  // ─────────────────────────────────────────────────────────────────────────────
  payoutProvider: {
    mtnmomo: "MTN MoMo",
    moovmoney: "Moov Money",
    wave: "Wave",
    bankaccount: "Compte bancaire",
    celtis: "Celtiis Cash",
  },

  // UserStatus — « compte », masculin.
  accountStatus: {
    pendingverification: "En attente de vérification",
    active: "Actif",
    suspended: "Suspendu",
    deleted: "Supprimé",
  },
};

/** Repli lisible : sépare les mots collés plutôt que d'afficher « OutOfStock » d'un bloc. */
function humanize(raw: string): string {
  return raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
}

/**
 * Libellé français d'une valeur de statut.
 *
 * @param value  valeur brute renvoyée par l'API (`null`/vide ⇒ tiret cadratin)
 * @param domain énumération d'origine, pour l'accord en genre
 */
export function statusLabel(value: string | null | undefined, domain: StatusDomain): string {
  const raw = (value ?? "").trim();
  if (!raw) return "—";
  return TABLES[domain][raw.toLowerCase()] ?? humanize(raw);
}

/** Ton du badge pour un statut de commande. */
export function orderTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const s = status?.toLowerCase() ?? "";
  if (s === "delivered" || s === "confirmed") return "success";
  if (s === "cancelled" || s === "failed") return "danger";
  if (s === "pending" || s === "awaitingpayment" || s === "paid") return "warning";
  return "neutral";
}

/** Ton du badge pour un statut de retrait. */
export function withdrawalTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const s = status?.toLowerCase() ?? "";
  if (s === "completed") return "success";
  if (s === "failed" || s === "rejected") return "danger";
  if (s === "requested" || s === "pending" || s === "processing") return "warning";
  return "neutral";
}

/**
 * Ton du badge pour un statut de retour.
 *
 * « Remboursement en attente » est en AMBRE, pas en vert : tant que l'administrateur
 * n'a pas exécuté le versement, l'acheteur n'a rien reçu. Le vert est réservé à
 * « Remboursé », c'est-à-dire à l'argent effectivement parti.
 */
export function returnTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const s = status?.toLowerCase() ?? "";
  if (s === "refunded") return "success";
  if (s === "rejected") return "danger";
  if (s === "requested" || s === "approved" || s === "received" || s === "refundpending") return "warning";
  return "neutral";
}

/** Ton du badge pour un statut de litige. */
export function disputeTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const s = status?.toLowerCase() ?? "";
  if (s === "resolved") return "success";
  if (s === "escalated") return "danger";
  if (s === "open" || s === "underreview") return "warning";
  return "neutral";
}

/**
 * Ton du badge pour un statut d'expédition.
 *
 * Accepte les deux orthographes du serveur (« Preparing » et « Prepared »), pour la
 * raison expliquée sur la table `shipmentStatus`.
 */
export function shipmentTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const s = status?.toLowerCase() ?? "";
  if (s === "delivered") return "success";
  if (s === "cancelled") return "danger";
  if (s === "pending" || s === "preparing" || s === "prepared" || s === "shipped") return "warning";
  return "neutral";
}

/** Ton du badge pour un statut d'offre ou de produit. */
/**
 * Ton du badge pour un statut de REVERSEMENT (lot de règlement).
 *
 * Distinct de `withdrawalTone`, qui parle d'un autre vocabulaire : lui appliquer ces
 * statuts rendait « Paid » et « Scheduled » également gris, si bien qu'un versement
 * réellement encaissé ne se distinguait pas d'un versement seulement programmé.
 */
export function payoutTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const s = status?.toLowerCase() ?? "";
  if (s === "paid") return "success";
  if (s === "failed") return "danger";
  if (s === "scheduled") return "warning";
  return "neutral";
}

/** Ton du badge pour un statut de vérification KYB. */
export function kybTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const s = status?.toLowerCase() ?? "";
  if (s === "verified") return "success";
  if (s === "rejected") return "danger";
  if (s === "inreview") return "warning";
  return "neutral";
}

/** Ton du badge pour un statut de boutique ou de compte. */
export function accountTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const s = status?.toLowerCase() ?? "";
  if (s === "active") return "success";
  if (s === "suspended" || s === "closed" || s === "deleted") return "danger";
  if (s === "pending" || s === "pendingreactivation" || s === "pendingverification") return "warning";
  return "neutral";
}

/** Ton du badge pour un statut d'offre ou de produit. */
export function catalogTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const s = status?.toLowerCase() ?? "";
  if (s === "active") return "success";
  if (s === "archived" || s === "outofstock") return "danger";
  if (s === "draft" || s === "paused") return "warning";
  return "neutral";
}
