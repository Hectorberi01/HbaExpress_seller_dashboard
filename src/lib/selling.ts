"use client";

import { useQuery } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import type { SellerShop } from "@/types/seller";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * LE DROIT D'ÉCRIRE DANS SON CATALOGUE, LU UNE FOIS POUR TOUTES.
 *
 * La règle vit côté serveur dans `SellerRights.CanSell` : seules `Active` et `Pending`
 * peuvent écrire. Les surfaces d'écriture la font appliquer par
 * `SellerBff.ResolveSellingSellerAsync`, qui rend un 403 motivé.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * CE MODULE A D'ABORD AFFIRMÉ QUE « TOUTES » LES ÉCRITURES PASSAIENT PAR CE VERROU.
 * C'ÉTAIT FAUX, ET C'EST LA RELECTURE QUI L'A ÉTABLI.
 *
 * Cinq routes d'écriture du BFF catalogue utilisaient encore `ResolveSellerAsync`,
 * qui rend la boutique quel que soit son statut : création de produit, ajout de
 * média, téléversement de média, ajout de déclinaison, suppression de produit. Une
 * boutique suspendue ou fermée pouvait donc faire ces cinq choses.
 *
 * Les quatre premières ont été fermées côté serveur, dans le même lot. La CINQUIÈME —
 * la suppression d'un produit — reste ouverte volontairement : c'est une décision de
 * politique produit, documentée en tête de `DeleteAsync`.
 *
 * D'où la règle de rédaction pour tout ce fichier et pour les écrans qui s'en
 * servent : on n'écrit pas « vous ne pouvez plus rien modifier ». On dit ce qui est
 * refusé, et on ne prétend pas que la suppression l'est.
 * ─────────────────────────────────────────────────────────────────────────────────
 *
 * TROIS ÉCRANS IGNORAIENT LE STATUT. La fiche produit, le stock et les réponses aux
 * avis n'interrogeaient jamais `["seller-shop"]` : chaque bouton répondait « votre
 * boutique est suspendue », un par un, après que le vendeur a rédigé, saisi,
 * téléversé. Le bandeau global ne couvre pas le cas — il ne regarde que le KYB.
 *
 * `Pending` EST ACCEPTÉ, ET CE N'EST PAS UN OUBLI : préparer son catalogue avant
 * l'ouverture est le parcours normal, et rien ne part en vitrine sans validation de
 * l'administration.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */

/** Miroir exact de `SellerRights.CanSell`. */
export function peutVendre(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "active" || s === "pending";
}

/**
 * Miroir de `SellerRights.DenialReason`, dans les mots de la console.
 *
 * On ne recopie pas le serveur à la lettre : là-bas c'est un refus opposé à une
 * action, ici une explication donnée AVANT qu'on la tente. Ce qui ne doit pas
 * diverger, c'est le fond — et le fond n'autorise à annoncer ni un recours
 * inexistant, ni une condition qu'on tait.
 *
 * `motifSuspension` vient de `SellerSummary.suspensionReason`, que `/seller/shop`
 * rapporte déjà. Sans lui, la phrase envoyait le vendeur « contacter le support pour
 * connaître le motif » d'une suspension dont la console tenait le motif en main —
 * défaut déjà corrigé une fois sur l'écran « Mon compte », et qu'il ne faut pas
 * réintroduire ici.
 */
export function raisonDeRefus(
  status: string | null | undefined,
  motifSuspension?: string | null,
): string {
  switch ((status ?? "").toLowerCase()) {
    case "suspended": {
      const motif = motifSuspension?.trim();
      return (
        (motif ? `Votre boutique est suspendue — motif : ${motif}. ` : "Votre boutique est suspendue. ") +
        "Une suspension se lève par décision de la plateforme : contactez le support pour connaître les suites."
      );
    }
    case "closed":
      // « Demandez la réactivation » sans la suite serait une porte à moitié ouverte :
      // `Seller.ApproveReactivation` exige EN PLUS un KYB vérifié, et le statut
      // intermédiaire `PendingReactivation` ne vend toujours pas.
      return (
        "Votre boutique est fermée. Vous pouvez demander sa réactivation depuis Mon compte ; " +
        "elle est accordée par la plateforme, et seulement si votre dossier de vérification est validé."
      );
    case "pendingreactivation":
      return (
        "Votre demande de réactivation est en cours d'examen. La vente et les modifications " +
        "reprendront à sa validation."
      );
    default:
      return "Votre boutique n'est pas en mesure d'effectuer cette action dans son état actuel.";
  }
}

/**
 * Le droit d'écrire, prêt à l'emploi.
 *
 * `bloque` RESTE FAUX TANT QUE LE STATUT N'EST PAS CONNU — chargement, panne, champ
 * non projeté. Le serveur reste l'autorité : traiter une requête lente comme un
 * empêchement enfermerait un vendeur parfaitement en règle, et le refus serveur, lui,
 * arrive toujours.
 *
 * Le prix de ce choix est assumé et visible : au tout premier chargement d'un écran,
 * les commandes s'affichent actives puis se grisent quand la réponse arrive. Un
 * troisième état « pas encore su » a été écrit puis RETIRÉ — aucun écran ne s'en
 * servait, et un champ que personne ne lit est une promesse de contrat, pas un
 * contrat.
 *
 * MÊME CLÉ ET MÊME `staleTime` QUE LE BANDEAU KYB, monté sur toutes les pages :
 * l'entrée de cache est partagée, cette lecture ne coûte aucune requête de plus.
 */
export interface DroitDeVendre {
  /** Le serveur refusera les écritures gardées. */
  bloque: boolean;
  /** Motif à afficher, ou `null` quand rien n'est bloqué. */
  raison: string | null;
}

export function useDroitDeVendre(): DroitDeVendre {
  const shop = useQuery({
    queryKey: ["seller-shop"],
    queryFn: () => bff<SellerShop>("/seller/shop"),
    staleTime: 5 * 60 * 1000,
  });

  const status = shop.data?.status;
  if (!status) return { bloque: false, raison: null };

  return peutVendre(status)
    ? { bloque: false, raison: null }
    : { bloque: true, raison: raisonDeRefus(status, shop.data?.suspensionReason) };
}
