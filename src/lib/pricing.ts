/**
 * Décomposition du prix — reproduite À L'IDENTIQUE du domaine.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * LES TAUX VIENNENT DU SERVEUR, JAMAIS DU CODE.
 *
 * `GET /seller/pricing` renvoie le barème en vigueur. L'application mobile vendeur,
 * elle, recopie 10 % et 5 % dans `app_config.dart` : au premier changement de barème
 * elle annonce un prix faux jusqu'à sa prochaine publication sur les stores. On ne
 * reproduit pas cela ici — si les taux ne sont pas chargés, on n'affiche RIEN plutôt
 * qu'un montant inventé.
 * ─────────────────────────────────────────────────────────────────────────────────
 */

export interface PricingRates {
  /** Fraction du prix vendeur, ex. 0,10 pour 10 %. */
  platformCommissionRate: number;
  providerFeeRate: number;
}

export interface PriceBreakdown {
  sellerPrice: number;
  commission: number;
  providerFee: number;
  /** Ce que paiera l'acheteur. */
  productPrice: number;
}

/**
 * Arrondi « au pair » sur une fraction ENTIÈRE — celui de `Math.Round(decimal)` en
 * .NET (MidpointRounding.ToEven).
 *
 * Deux écarts guettent une transposition naïve, et ils se cumulent :
 *   • `Math.round` de JavaScript arrondit .5 vers le haut, .NET vers le pair ;
 *   • un taux comme 0,05 n'a pas de représentation binaire exacte, si bien que
 *     `5010 * 0.05` vaut 250,50000000000003 et non 250,5 — le point milieu, que
 *     `Math.Round` sur `decimal` traite exactement, est manqué.
 *
 * On travaille donc en entiers, sur le taux converti en fraction.
 */
function roundHalfToEvenFraction(value: number, numerator: number, denominator: number): number {
  const product = value * numerator;
  const quotient = Math.floor(product / denominator);
  const rest = product - quotient * denominator;

  if (2 * rest > denominator) return quotient + 1;
  if (2 * rest < denominator) return quotient;
  return quotient % 2 === 0 ? quotient : quotient + 1;
}

/**
 * Convertit un taux décimal en fraction exacte : 0,05 → 5/100.
 *
 * On repart de l'écriture décimale (`toString`) plutôt que du flottant : c'est la
 * valeur que le serveur a lue dans sa configuration, et la seule qui soit exacte.
 */
function asFraction(rate: number): { numerator: number; denominator: number } {
  const text = rate.toString();
  if (text.includes("e") || text.includes("E")) {
    // Notation scientifique : on ne tente pas de rattraper, on repasse en flottant.
    return { numerator: rate * 1e9, denominator: 1e9 };
  }
  const [whole, fraction = ""] = text.split(".");
  const denominator = 10 ** fraction.length;
  const numerator = Number(whole) * denominator + (fraction === "" ? 0 : Number(fraction));
  return { numerator, denominator };
}

/**
 * Décompose un prix vendeur exactement comme `Offer.ComputeBreakdown` :
 *
 *   commission  = Round(sellerPrice × tauxCommission)
 *   fraisPaiement = Round(sellerPrice × tauxPrestataire)
 *   prixAcheteur  = sellerPrice + commission + fraisPaiement
 *
 * Les deux arrondis sont INDÉPENDANTS et appliqués avant l'addition : arrondir la
 * somme donnerait un franc d'écart sur certains montants.
 */
export function computeBreakdown(sellerPrice: number, rates: PricingRates): PriceBreakdown {
  const c = asFraction(rates.platformCommissionRate);
  const p = asFraction(rates.providerFeeRate);

  const commission = roundHalfToEvenFraction(sellerPrice, c.numerator, c.denominator);
  const providerFee = roundHalfToEvenFraction(sellerPrice, p.numerator, p.denominator);

  return {
    sellerPrice,
    commission,
    providerFee,
    productPrice: sellerPrice + commission + providerFee,
  };
}

/** Taux en pourcentage lisible : 0,105 → « 10,5 % ». */
export function ratePercent(rate: number): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(rate * 100)} %`;
}
