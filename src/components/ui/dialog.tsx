"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

// Compteur partagé : permet d'empiler des dialogues (ex. une confirmation de
// suppression au-dessus d'un dialogue de gestion) sans que la fermeture de
// l'un ne réactive prématurément le scroll de la page.
let openDialogCount = 0;
function lockScroll() {
  openDialogCount += 1;
  document.body.style.overflow = "hidden";
}
function unlockScroll() {
  openDialogCount = Math.max(0, openDialogCount - 1);
  if (openDialogCount === 0) document.body.style.overflow = "";
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    lockScroll();
    return () => {
      document.removeEventListener("keydown", onKey);
      unlockScroll();
    };
  }, [open, onClose]);

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
