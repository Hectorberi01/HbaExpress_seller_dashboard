"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { subscribeToasts, dismissToast, type ToastItem } from "@/lib/toast";

const ICON = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
} as const;

const ACCENT = {
  success: "text-emerald-600",
  error: "text-destructive",
  info: "text-primary",
} as const;

/** Pile de toasts, coin bas-droit. Monté une fois, sous les Providers. */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,360px)] flex-col gap-2">
      {items.map((t) => {
        const Icon = ICON[t.type];
        return (
          <div
            key={t.id}
            role="status"
            className="nm-elevated pointer-events-auto flex items-start gap-3 rounded-xl bg-card px-4 py-3 text-sm text-card-foreground"
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", ACCENT[t.type])} />
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Fermer"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
