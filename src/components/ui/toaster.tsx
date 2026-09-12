"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { dialoguesOuverts, subscribeDialogues } from "@/components/ui/dialog";
import { subscribeToasts, dismissToast, type ToastItem } from "@/lib/toast";

const ICON = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
} as const;

/** Instantané du rendu serveur : hors navigateur, aucun dialogue n'est monté. */
const SANS_DIALOGUE = () => 0;

const ACCENT = {
  success: "text-emerald-600",
  error: "text-destructive",
  info: "text-primary",
} as const;

/**
 * ═════════════════════════════════════════════════════════════════════════════════
 * PILE DE TOASTS, EN BAS DE L'ÉCRAN ET CENTRÉE. Montée une fois, sous les Providers.
 *
 * LE CENTRAGE SE FAIT PAR `left-1/2` + `-translate-x-1/2`, et il est centré SUR LA
 * FENÊTRE, pas sur la zone de contenu. Sur desktop, la barre latérale occupe 256 px à
 * gauche : le centre du contenu est donc à 128 px à droite du toast. C'est assumé — la
 * pile est en position fixe, elle ignore la mise en page, et la recaler sur le contenu
 * la ferait sauter à chaque réduction du menu.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * UN DIALOGUE OUVERT : LA PILE MONTE EN HAUT, ET CESSE D'ÊTRE CLIQUABLE.
 *
 * Un dialogue est centré verticalement et n'a aucune hauteur maximale : dès qu'il
 * porte quelques champs, son pied — « Annuler », « Enregistrer » — descend au bas de
 * la fenêtre. Un toast posé là n'y masquerait pas seulement les boutons, il
 * INTERCEPTERAIT LE CLIC (`pointer-events-auto`, z-100 contre z-50). Le cas n'a rien
 * de théorique : `Providers` notifie l'échec de TOUTE mutation, et un dialogue reste
 * ouvert quand son enregistrement échoue — le vendeur lit l'erreur, réessaie, et son
 * clic part dans le toast. Le défaut existait déjà en coin bas-droit sur mobile, où le
 * dialogue occupe toute la largeur ; le centrage l'aurait étendu au desktop.
 *
 * MONTER EN HAUT NE SUFFIT PAS, et il faut le dire : par symétrie du centrage, un
 * dialogue dont le pied touche le bas a son en-tête — donc sa croix de fermeture —
 * contre le haut. On DÉSACTIVE donc aussi les événements de pointeur sur les cartes
 * tant qu'un dialogue est ouvert : la pile redevient purement informative, aucun clic
 * ne peut plus lui être volé, où qu'elle se trouve. Le bouton « Fermer » disparaît
 * avec, puisqu'il ne servirait plus à rien ; le toast s'efface seul au bout de 4,5 s.
 * ─────────────────────────────────────────────────────────────────────────────────
 *
 * `bottom` PREND LE MAXIMUM ENTRE 1 REM ET L'ENCOCHE BASSE. Ce second terme vaut
 * ZÉRO AUJOURD'HUI : `env(safe-area-inset-*)` ne renvoie une valeur qu'avec
 * `viewport-fit=cover`, que la mise en page racine ne déclare pas. Le `max()` est donc
 * sans effet pour l'instant — il est écrit ainsi pour que la pile se décale d'elle-même
 * hors de la barre d'accueil iOS le jour où cette option sera posée, pas parce qu'elle
 * le fait déjà.
 * ═════════════════════════════════════════════════════════════════════════════════
 */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);

  // Le rendu serveur ne connaît aucun dialogue ouvert : la pile part en bas, et se
  // déplace à l'hydratation si un dialogue l'était déjà (impossible en pratique, un
  // dialogue naissant d'un clic).
  const dialogue = useSyncExternalStore(subscribeDialogues, dialoguesOuverts, SANS_DIALOGUE) > 0;

  return (
    <div
      className={cn(
        "pointer-events-none fixed left-1/2 z-[100] flex w-[min(92vw,360px)] -translate-x-1/2 flex-col gap-2",
        dialogue ? "top-4" : "bottom-[max(1rem,env(safe-area-inset-bottom))]",
      )}
    >
      {items.map((t) => {
        const Icon = ICON[t.type];
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              "nm-elevated flex items-start gap-3 rounded-xl bg-card px-4 py-3 text-sm text-card-foreground",
              dialogue ? "pointer-events-none" : "pointer-events-auto",
            )}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", ACCENT[t.type])} />
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            {!dialogue && (
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Fermer"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
