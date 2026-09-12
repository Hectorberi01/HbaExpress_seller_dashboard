"use client";

import { useQuery } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import type {
  InventoryItem,
  SellerConversation,
  SellerDashboard,
  SellerReview,
} from "@/types/seller";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * LES QUATRE COMPTEURS DU MENU.
 *
 * AUCUNE CLÉ DE CACHE NOUVELLE — MAIS BIEN DES REQUÊTES NOUVELLES, ET IL FAUT LE DIRE.
 * Les quatre compteurs réutilisent EXACTEMENT les clés et les URL des quatre écrans
 * concernés : `seller-dashboard`, `seller-reviews`, `seller-conversations`,
 * `seller-inventory`. Sur l'écran correspondant, React Query sert donc une seule
 * requête pour l'écran et pour la pastille — et, c'est l'intérêt principal,
 * l'invalidation que fait l'écran après une action rafraîchit la pastille dans la
 * foulée : répondre à un avis fait descendre le compteur « Avis » sans que rien ici ne
 * soit au courant de la réponse. Une clé recopiée de travers romprait ce lien EN
 * SILENCE : la pastille afficherait un chiffre d'hier, et rien ne signalerait d'erreur.
 *
 * Sur TOUS LES AUTRES écrans vendeur, en revanche, ces quatre appels n'existaient pas
 * et partent désormais : le menu vit dans le layout, il est monté partout. C'est le
 * coût réel de la fonction. Il est payé une fois par session — le menu n'est pas
 * remonté d'une navigation à l'autre — et non à chaque changement d'écran.
 *
 * `null` N'EST PAS ZÉRO, ET LE MENU N'AFFICHE RIEN DANS LES DEUX CAS. Ce n'est pas une
 * contradiction : une pastille absente n'AFFIRME rien, là où un « 0 » affirmerait que
 * le vendeur est à jour. Tant qu'aucune réponse n'est arrivée, ou quand le serveur
 * signale lui-même la section indisponible (`unavailable`), on se tait plutôt que de
 * poser un chiffre. Le menu n'est PAS l'endroit où l'on annonce une panne : le tableau
 * de bord porte déjà un bandeau nommant les sections indisponibles, et c'est là que le
 * vendeur doit l'apprendre.
 *
 * UN ÉCHEC APRÈS UN PREMIER SUCCÈS LAISSE LE DERNIER CHIFFRE CONNU. React Query
 * conserve `data` quand un rechargement échoue ; les tests ci-dessous portent sur la
 * présence de `data`, donc la pastille garde sa valeur au lieu de disparaître à la
 * moindre coupure réseau. C'est volontaire : une pastille qui clignote hors du menu à
 * chaque micro-coupure serait plus trompeuse qu'un compte d'il y a deux minutes.
 *
 * CHAQUE COMPTEUR REPREND LE CALCUL DE SON ÉCRAN, À L'IDENTIQUE — SAUF « COMMANDES »,
 * ET C'EST LA SEULE EXCEPTION. Avis, Messagerie et Stock rejouent mot pour mot le
 * filtre de l'écran visé, et le vendeur retrouve donc le même nombre en arrivant.
 * « Commandes » vient de `/seller/dashboard` : c'est le chiffre de la vignette
 * « À traiter », pas un calcul de l'écran Commandes — qui n'a AUCUN filtre de statut et
 * ne peut donc pas isoler ces commandes-là. Le vendeur clique sur « Commandes 3 » et
 * tombe sur une liste paginée tous statuts confondus. Un filtre de statut sur cet écran
 * fermerait l'écart ; tant qu'il n'existe pas, l'écart est ici, écrit, plutôt que
 * découvert au clic.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */

/** `null` = inconnu : rien n'est encore arrivé, ou le serveur signale la section en panne. */
export type CompteursNav = {
  /** Commandes payées ou confirmées — le « À traiter » du tableau de bord. */
  commandes: number | null;
  /** Avis sans réponse du vendeur — l'onglet « À traiter » de l'écran Avis. */
  avis: number | null;
  /** Messages non lus, toutes conversations confondues. */
  messages: number | null;
  /** Lignes de stock sous leur seuil d'alerte — le bouton « Stock bas » de l'écran Stock. */
  stock: number | null;
};

// ─────────────────────────────────────────────────────────────────────────────────
// DEUX MINUTES DE FRAÎCHEUR, ET UN RECHARGEMENT AU RETOUR SUR L'ONGLET.
//
// Le menu n'est monté qu'une fois : sans rappel, un vendeur qui revient à sa console
// après deux heures lirait le compte de son arrivée. `refetchOnWindowFocus` est donc
// réactivé ici — le réglage global le coupe (`Providers`), ce qui convient à un écran
// qu'on regarde, pas à un menu qu'on ne remonte jamais.
//
// C'EST `staleTime` QUI EN BORNE LE COÛT, et c'est pour cela qu'il est plus long que
// les 30 s du réglage global. Un rechargement au focus n'a lieu que si la donnée est
// périmée : deux minutes suffisent à ce qu'un aller-retour vers la messagerie ne
// relance pas les quatre appels, `/seller/dashboard` compris — celui-ci charge toutes
// les commandes du vendeur avec leurs lignes, et c'est le plus cher des quatre.
//
// AUCUN SONDAGE PÉRIODIQUE, pour la même raison : interroger ce dashboard en boucle
// coûterait bien plus que le service rendu.
// ─────────────────────────────────────────────────────────────────────────────────
const OPTIONS = { staleTime: 120_000, refetchOnWindowFocus: true } as const;

/**
 * Le menu vit dans le layout : une exception levée ICI vide l'écran entier, sur TOUTES
 * les routes vendeur, et pas seulement la pastille concernée. D'où ce garde-fou sur
 * des données qui viennent du réseau : un corps inattendu (serveur plus ancien, erreur
 * sérialisée en objet) coûte une pastille manquante, jamais une console blanche.
 *
 * Le test porte sur `Array.isArray` et non sur `?? []` : c'est un TABLEAU qu'on attend,
 * et `?? []` ne rattrape que `null` et `undefined` — un objet ou un nombre passerait au
 * travers, jusqu'au `.filter` ou au `.includes` qui lève.
 */
function liste<T>(data: unknown): T[] | null {
  return Array.isArray(data) ? (data as T[]) : null;
}

export function useCompteursNav(): CompteursNav {
  // Même clé et même URL que `dashboard/page.tsx`.
  const tableauDeBord = useQuery({
    queryKey: ["seller-dashboard"],
    queryFn: () => bff<SellerDashboard>("/seller/dashboard"),
    ...OPTIONS,
  });

  // Même clé et même URL que `reviews/page.tsx`.
  const avis = useQuery({
    queryKey: ["seller-reviews"],
    queryFn: () => bff<SellerReview[]>("/seller/reviews"),
    ...OPTIONS,
  });

  // Même clé et même URL que `messages/page.tsx`.
  const conversations = useQuery({
    queryKey: ["seller-conversations"],
    queryFn: () => bff<SellerConversation[]>("/seller/conversations"),
    ...OPTIONS,
  });

  // Même clé et même URL que `inventory/page.tsx`.
  const stock = useQuery({
    queryKey: ["seller-inventory"],
    queryFn: () => bff<InventoryItem[]>("/seller/inventory"),
    ...OPTIONS,
  });

  const d = tableauDeBord.data;
  // `unavailable` est déclaré non optionnel, mais il vient du réseau, et le layout ne
  // survit pas à une exception : même garde-fou que pour les trois listes.
  const commandesIndisponibles = (liste<string>(d?.unavailable) ?? []).includes("orders");

  const lesAvis = liste<SellerReview>(avis.data);
  const lesConversations = liste<SellerConversation>(conversations.data);
  const leStock = liste<InventoryItem>(stock.data);

  return {
    // Section signalée en panne : `ordersToProcess` vaut alors zéro par défaut, ce qui
    // ne veut rien dire. On rend « inconnu ».
    commandes: d && !commandesIndisponibles ? d.ordersToProcess : null,

    // Le filtre de l'onglet « À traiter » de l'écran Avis, mot pour mot. Il porte sur
    // TOUS les avis reçus, y compris ceux que la modération a rejetés — c'est ce que
    // l'écran montre, et une pastille qui compterait autrement le contredirait.
    avis: lesAvis ? lesAvis.filter((r) => !r.sellerReply).length : null,

    // Somme des non-lus, et non nombre de fils : c'est l'addition exacte des pastilles
    // que le vendeur trouvera dans la liste des conversations.
    messages: lesConversations
      ? lesConversations.reduce((total, c) => total + Math.max(0, c.unread ?? 0), 0)
      : null,

    // `isLowStock` est calculé par le domaine, jamais recalculé ici — l'écran Stock
    // s'appuie sur le même booléen pour son bouton « Stock bas ». On compte des LIGNES
    // de stock : une même référence basse dans deux entrepôts compte deux fois, comme
    // sur l'écran Stock.
    stock: leStock ? leStock.filter((i) => i.isLowStock).length : null,
  };
}
