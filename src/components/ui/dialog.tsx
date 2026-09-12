"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

// Compteur partagé : permet d'empiler des dialogues (ex. une confirmation de
// suppression au-dessus d'un dialogue de gestion) sans que la fermeture de
// l'un ne réactive prématurément le scroll de la page.
let openDialogCount = 0;

// ═════════════════════════════════════════════════════════════════════════════════
// CE COMPTEUR EST PUBLIÉ, PARCE QUE LES TOASTS DOIVENT S'ÉCARTER DES DIALOGUES.
//
// Un dialogue est centré verticalement et n'a AUCUNE hauteur maximale : dès qu'il
// porte une poignée de champs, son pied — donc « Annuler » et « Enregistrer » —
// descend à quelques pixels du bas de la fenêtre. La pile de toasts y vit aussi, et
// chaque toast est `pointer-events-auto` au-dessus du dialogue (z-100 contre z-50) :
// il ne se contente donc pas de masquer les boutons, IL INTERCEPTE LE CLIC.
//
// Le cas n'est pas théorique : `Providers` notifie l'échec de TOUTE mutation, et un
// dialogue reste ouvert quand son enregistrement échoue. Le vendeur reçoit « Une
// erreur est survenue », puis son second essai ne part pas — le clic atterrit sur le
// toast. La pile se déplace donc en haut de l'écran tant qu'un dialogue est ouvert.
// ═════════════════════════════════════════════════════════════════════════════════
const dialogListeners = new Set<(ouverts: number) => void>();

function emitDialogCount() {
  dialogListeners.forEach((l) => l(openDialogCount));
}

/** Nombre de dialogues actuellement ouverts. Zéro côté serveur, où rien n'est monté. */
export function dialoguesOuverts(): number {
  return openDialogCount;
}

export function subscribeDialogues(l: (ouverts: number) => void) {
  dialogListeners.add(l);
  return () => {
    dialogListeners.delete(l);
  };
}

function lockScroll() {
  openDialogCount += 1;
  document.body.style.overflow = "hidden";
  emitDialogCount();
}
function unlockScroll() {
  openDialogCount = Math.max(0, openDialogCount - 1);
  if (openDialogCount === 0) document.body.style.overflow = "";
  emitDialogCount();
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  // ─────────────────────────────────────────────────────────────────────────────
  // `onClose` PASSE PAR UNE RÉFÉRENCE, ET CE N'EST PAS UNE MICRO-OPTIMISATION.
  //
  // Tous les appelants passent une flèche écrite en ligne (`onClose={() => …}`) :
  // son identité change à chaque rendu du parent. En dépendance d'effet, elle
  // relançait donc le nettoyage puis l'effet à CHAQUE FRAPPE dans un formulaire de
  // dialogue — soit un `unlockScroll()` suivi d'un `lockScroll()`, c'est-à-dire un
  // compteur qui retombe à zéro et un `document.body.style.overflow` rétabli, deux
  // fois par caractère saisi.
  //
  // Rien ne se voyait tant que ce compteur restait privé. Il est désormais PUBLIÉ et
  // lu par la pile de toasts : `dialoguesOuverts()` annonçait « aucun dialogue » à
  // chaque frappe, et tout futur lecteur synchrone de cette API serait tombé dedans.
  // ─────────────────────────────────────────────────────────────────────────────
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    lockScroll();
    return () => {
      document.removeEventListener("keydown", onKey);
      unlockScroll();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="nm-elevated relative z-10 w-full max-w-md rounded-2xl bg-white p-5 text-card-foreground dark:bg-card"
      >
        <div className="mb-1 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground transition-colors hover:text-foreground" aria-label="Fermer">
            <X className="size-4" />
          </button>
        </div>
        {description && <p className="mb-3 text-sm text-muted-foreground">{description}</p>}
        <div className="space-y-3 text-sm">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
