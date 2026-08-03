"use client";

import { useQuery } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { formatXof } from "@/lib/utils";
import { computeBreakdown, ratePercent, type PricingRates } from "@/lib/pricing";

/** Barème en vigueur, partagé par tous les écrans qui affichent un prix en cours de saisie. */
export function usePricingRates() {
  return useQuery({
    queryKey: ["seller-pricing"],
    queryFn: () => bff<PricingRates>("/seller/pricing"),
    // Un barème ne bouge pas pendant qu'on remplit un formulaire.
    staleTime: 15 * 60 * 1000,
  });
}

/**
 * Détail du prix sous le champ de saisie — même information que l'app mobile vendeur.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * CE QUI DIFFÈRE DE L'APP MOBILE, ET POURQUOI
 *
 * Le calcul est le même, les TAUX ne viennent pas du même endroit. `PricePreview`
 * (mobile) applique `AppConfig.commissionRate` et `AppConfig.providerFeeRate`, écrits
 * en dur : au premier changement de barème, l'app annonce un prix acheteur faux
 * jusqu'à sa prochaine publication sur les stores — et rien ne le signale.
 *
 * Ici les taux sont lus sur `GET /seller/pricing`, qui sert le barème réellement
 * appliqué par le domaine. Quand ils ne sont pas disponibles, on n'affiche RIEN : un
 * montant inventé dans un écran de prix est pire qu'un écran silencieux.
 *
 * L'arrondi suit celui du domaine (au pair, sur chaque ligne avant l'addition) — voir
 * `computeBreakdown`. Le prix ainsi affiché est celui qui sera enregistré, au franc près.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
export function PriceBreakdown({
  sellerPrice,
  rates,
  unavailable,
}: {
  sellerPrice: number;
  rates: PricingRates | undefined;
  /** Vrai si le barème n'a pas pu être chargé. */
  unavailable?: boolean;
}) {
  if (!Number.isFinite(sellerPrice) || sellerPrice <= 0) return null;

  if (!rates) {
    return unavailable ? (
      <p className="text-xs text-muted-foreground">
        Le détail du prix n&apos;est pas disponible pour l&apos;instant. Le montant exact
        sera calculé par la plateforme à l&apos;enregistrement.
      </p>
    ) : null;
  }

  const b = computeBreakdown(sellerPrice, rates);

  return (
    <dl className="space-y-1 rounded-xl bg-primary/5 p-3 text-sm">
      <div className="flex justify-between font-medium">
        <dt>Vous percevez</dt>
        <dd className="tabular-nums text-primary">{formatXof(b.sellerPrice)}</dd>
      </div>
      <div className="flex justify-between text-muted-foreground">
        <dt>Commission plateforme ({ratePercent(rates.platformCommissionRate)})</dt>
        <dd className="tabular-nums">+{formatXof(b.commission)}</dd>
      </div>
      <div className="flex justify-between text-muted-foreground">
        <dt>Frais de paiement ({ratePercent(rates.providerFeeRate)})</dt>
        <dd className="tabular-nums">+{formatXof(b.providerFee)}</dd>
      </div>
      <div className="flex justify-between border-t border-border pt-1 font-semibold">
        <dt>Prix affiché à l&apos;acheteur</dt>
        <dd className="tabular-nums">{formatXof(b.productPrice)}</dd>
      </div>
    </dl>
  );
}
