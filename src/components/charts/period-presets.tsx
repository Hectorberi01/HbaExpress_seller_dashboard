"use client";

import { cn } from "@/lib/utils";

/**
 * Sélecteur de période par préréglages.
 *
 * UNE SEULE RANGÉE, AU-DESSUS DE CE QU'ELLE CADRE, jamais à l'intérieur d'une carte de
 * graphe : un filtre posé dans une carte laisse croire qu'il ne concerne que celle-ci,
 * et deux graphes voisins finissent par montrer deux périodes différentes sans que
 * rien ne le dise.
 *
 * Des préréglages plutôt que deux champs date : sur cet écran, le vendeur veut « les
 * trente derniers jours », pas une fenêtre précise. L'écran « Finances » garde ses deux
 * champs, parce qu'un relevé se demande sur une période exacte.
 */
export function PeriodePresets({
  jours,
  onChange,
  className,
  options = [7, 30, 90],
}: {
  jours: number;
  onChange: (jours: number) => void;
  className?: string;
  options?: number[];
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} role="group" aria-label="Période">
      <span className="mr-1 text-xs text-muted-foreground">Période</span>
      {options.map((n) => {
        const actif = n === jours;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={actif}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs transition-colors",
              actif
                ? "nm-inset-sm bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {n} jours
          </button>
        );
      })}
    </div>
  );
}
