import type { SellerShop } from "@/types/seller";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * LA RÈGLE DU VERSEMENT, ÉCRITE UNE FOIS.
 *
 * Deux écrans en dépendent — « Ma boutique », qui enregistre le compte, et
 * « Portefeuille », qui demande le retrait — et ils en donnaient deux lectures
 * différentes. Le premier proposait cinq opérateurs, le second n'en vérifiait aucun,
 * et c'est le serveur qui tranchait, des semaines plus tard, au moment du retrait.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * LES SEULS OPÉRATEURS RÉELLEMENT REVERSABLES.
 *
 * Miroir exact de `WalletPayout.IsMobileMoney` côté serveur, qui n'accepte que
 * `mtnmomo`, `moovmoney` et `celtis`. Le domaine accepte pourtant aussi `Wave` et
 * `BankAccount` à l'ENREGISTREMENT du compte : l'écart entre les deux gestes est
 * précisément le défaut qu'on ferme ici.
 *
 * CE QUE CET ÉCART COÛTAIT. Le vendeur choisissait Wave, voyait une carte de versement
 * parfaitement valide — opérateur, numéro masqué, titulaire — et découvrait des
 * semaines plus tard que CHACUNE de ses demandes de retrait échouait. Rien, ni sur
 * l'écran du compte ni sur celui du retrait, ne reliait l'échec au choix qu'il avait
 * fait. Le message du serveur parle d'un « compte de versement Mobile Money » sans
 * nommer celui qu'il a enregistré.
 *
 * L'ORDRE EST CELUI DE LA PART DE MARCHÉ au Bénin, pas l'alphabétique : la première
 * entrée est celle que la majorité des vendeurs cherche.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
export const PAYOUT_PROVIDERS = ["MtnMomo", "MoovMoney", "Celtis"] as const;

/** Vrai si ce canal peut réellement recevoir un versement. Insensible à la casse. */
export function isPayableProvider(provider: string | null | undefined): boolean {
  const p = (provider ?? "").trim().toLowerCase();
  return p === "mtnmomo" || p === "moovmoney" || p === "celtis";
}

/**
 * Pourquoi le retrait est DURABLEMENT impossible, ou null s'il ne l'est pas.
 *
 * Deux des refus que le serveur oppose, et seulement ceux-là :
 *   • `SellerRights.CanWithdraw` — seule la SUSPENSION gèle ; une boutique fermée
 *     volontairement garde le droit d'encaisser ce qu'elle a gagné ;
 *   • `RequestWithdrawalCommandHandler` — compte absent, canal non reversable, ou
 *     numéro vide.
 *
 * LES AUTRES RESTENT CHEZ L'APPELANT, et c'est délibéré : le montant contre le solde,
 * et la demande déjà en cours, sont des conditions du MOMENT, que l'écran Portefeuille
 * connaît seul et formule dans ses propres mots. Ce qu'on décrit ici est ce qui ne se
 * lèvera pas tout seul.
 *
 * L'ORDRE DES TESTS SUIT CELUI DU SERVEUR, et il compte : un compte Wave au numéro
 * vide doit s'entendre dire que Wave n'est pas reversable, pas qu'il n'a pas de
 * compte — le second message l'enverrait refaire une saisie qui échouerait pareil.
 *
 * Rend `undefined` quand la boutique n'est pas encore chargée : on ne prétend alors
 * NI que le retrait est possible, ni qu'il ne l'est pas. Les trois états sont
 * distincts, et l'appelant doit les distinguer — afficher « compte manquant » pendant
 * un chargement serait un reproche adressé au hasard.
 */
export function payoutBlockReason(shop: SellerShop | undefined): string | null | undefined {
  if (!shop) return undefined;

  if ((shop.status ?? "").toLowerCase() === "suspended") {
    return "Votre boutique est suspendue : les retraits sont gelés le temps de l'instruction. Vos gains ne sont pas perdus, ils attendent la décision.";
  }

  const payout = shop.payout;
  if (!payout) {
    return "Aucun compte de versement renseigné. Ajoutez-en un dans Ma boutique avant de demander un retrait.";
  }

  if (!isPayableProvider(payout.provider)) {
    return "Votre compte de versement n'est pas un compte Mobile Money : seuls MTN MoMo, Moov Money et Celtiis Cash peuvent recevoir un versement aujourd'hui. Changez-le dans Ma boutique.";
  }

  if (!payout.accountNumber?.trim()) {
    return "Le numéro de votre compte de versement est vide. Renseignez-le dans Ma boutique avant de demander un retrait.";
  }

  return null;
}
