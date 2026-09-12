import { AlertTriangle } from "lucide-react";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * L'ENCART QUI ACCOMPAGNE UN BOUTON DÉSACTIVÉ.
 *
 * Un bouton inerte sans explication est un cul-de-sac de plus, pas un correctif. Et
 * l'explication ne peut PAS passer par `title` : `components/ui/button.tsx` pose
 * `disabled:pointer-events-none` sur toutes les variantes, donc un bouton désactivé ne
 * reçoit aucun survol — l'infobulle ne s'affiche jamais, ni à la souris ni au doigt.
 *
 * Le motif complet est donné une seule fois, en tête de page. Sur une fiche produit
 * longue, il est hors écran quand le vendeur atteint les mises en vente : chaque carte
 * porte donc ce rappel court, qui dit POURQUOI et où lire le détail.
 *
 * `role="status"` plutôt que `role="alert"` : l'encart est présent au rendu, il
 * n'interrompt pas une saisie en cours.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
export function ReadOnlyNote({ children }: { children?: React.ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0">
        {children ?? (
          <>
            Modifications indisponibles dans l&apos;état actuel de votre boutique — le motif est
            indiqué en haut de cette page.
          </>
        )}
      </p>
    </div>
  );
}
