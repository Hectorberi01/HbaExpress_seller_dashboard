"use client";

import { useQuery } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import type { SellerShop } from "@/types/seller";
import { Clock, ShieldAlert, ShieldX } from "lucide-react";

/**
 * Bandeau de vérification KYB — présent sur TOUTES les pages de la console.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * POURQUOI DANS LA COQUILLE, ET PAS SUR LE TABLEAU DE BORD
 *
 * Un vendeur n'arrive pas forcément par l'accueil : il ouvre un lien de commande, il
 * revient sur l'onglet resté ouvert sur Produits, il passe ses journées dans la
 * messagerie. Une alerte posée sur le seul tableau de bord ne serait vue que par ceux
 * qui n'en ont pas besoin. Placée dans la coquille, elle suit le vendeur partout —
 * jusqu'à ce que ses documents soient validés, et pas une page de plus.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * CE QUE LE BANDEAU NE FAIT PAS
 *
 * Il n'a pas de bouton. Ce choix est délibéré : c'est un état à connaître, pas une
 * tâche à exécuter dans l'instant. Le chemin est nommé en toutes lettres (« Ma
 * boutique › Documents KYB ») pour que l'information reste actionnable sans
 * transformer chaque écran en injonction.
 *
 * Il ne bloque rien non plus. Le serveur autorise la mise en vente à un vendeur
 * « Pending » : ajouter un blocage ici inventerait une règle métier que le back-end ne
 * connaît pas, et l'interface finirait par diverger du domaine — ce qui coûte plus
 * cher qu'un produit créé un peu tôt.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * SILENCIEUX TANT QU'ON NE SAIT PAS
 *
 * Ni pendant le chargement, ni en cas d'échec de la requête. Afficher « votre boutique
 * n'est pas vérifiée » parce qu'on n'a pas réussi à lire son statut serait une
 * accusation gratuite — et la faire clignoter à chaque navigation, une nuisance.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
export function KybBanner() {
  // Même clé que la page « Ma boutique » : aucune requête supplémentaire, le cache
  // est partagé et la validation des documents efface le bandeau sans rechargement.
  const shop = useQuery({
    queryKey: ["seller-shop"],
    queryFn: () => bff<SellerShop>("/seller/shop"),
    staleTime: 5 * 60 * 1000,
  });

  if (shop.isPending || shop.isError || !shop.data) return null;

  const notice = noticeFor(shop.data.kybStatus);
  if (!notice) return null;

  return (
    <div className={`border-b px-6 py-3 lg:px-8 ${notice.className}`} role="status">
      <div className="flex items-start gap-3">
        <notice.icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-sm leading-relaxed">
          <strong className="font-semibold">{notice.title}</strong> {notice.body}
        </p>
      </div>
    </div>
  );
}

type Notice = {
  title: string;
  body: string;
  icon: typeof ShieldAlert;
  className: string;
};

/**
 * Message correspondant au statut KYB.
 *
 * ⚠️ Les quatre valeurs viennent de `KybStatus` côté serveur : `NotStarted`,
 * `InReview`, `Verified`, `Rejected`. Comparaison en minuscules — la sérialisation
 * les envoie en PascalCase.
 *
 * Un statut INCONNU est traité comme « non vérifié » plutôt qu'ignoré : si la
 * plateforme ajoute un état un jour, mieux vaut un bandeau prudent qu'un silence qui
 * laisserait croire la boutique en règle.
 */
function noticeFor(status: string | null | undefined): Notice | null {
  switch ((status ?? "").toLowerCase()) {
    case "verified":
      return null;

    case "inreview":
      return {
        title: "Vérification en cours.",
        body:
          "Vos documents sont entre les mains de notre équipe. Vous n'avez rien à faire : " +
          "le statut se met à jour dès que l'examen est terminé.",
        icon: Clock,
        className:
          "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200",
      };

    case "rejected":
      return {
        title: "Vos documents ont été refusés.",
        body:
          "Votre boutique reste non vérifiée. Les motifs et le renvoi des pièces se trouvent " +
          "dans Ma boutique, section Documents KYB.",
        icon: ShieldX,
        className:
          "border-red-200 bg-red-50 text-red-900 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200",
      };

    default:
      return {
        title: "Votre boutique n'est pas encore vérifiée.",
        body:
          "Déposez vos pièces justificatives dans Ma boutique, section Documents KYB. " +
          "La vérification conditionne le versement de vos gains.",
        icon: ShieldAlert,
        className:
          "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200",
      };
  }
}
