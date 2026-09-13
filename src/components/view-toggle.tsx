"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";

export type VueListe = "tableau" | "catalogue";

/**
 * ═════════════════════════════════════════════════════════════════════════════════
 * LE CHOIX DE VUE SE MÉMORISE, ET IL SE LIT APRÈS L'HYDRATATION.
 *
 * `localStorage` n'existe pas au rendu serveur. Lire la préférence dans l'état
 * initial produirait deux rendus différents — « tableau » côté serveur, « catalogue »
 * côté client — et React remplacerait le HTML en signalant une erreur d'hydratation.
 * On part donc toujours de la valeur par défaut, et on applique la préférence dans un
 * effet : au pire, le vendeur voit le tableau une fraction de seconde.
 *
 * LA VALEUR PAR DÉFAUT EST LE TABLEAU. Non parce qu'il porterait plus d'information —
 * le catalogue montre les mêmes champs — mais parce qu'il n'en COUPE aucun : un nom
 * long y passe à la ligne là où la carte le tronque, et il tient plus de références
 * dans une hauteur d'écran. C'est la vue qui ne cache rien à qui n'a jamais touché ce
 * réglage.
 *
 * `localStorage` PEUT LEVER, ET PAS SEULEMENT RENDRE `null`. Cookies bloqués, mode
 * privé verrouillé : c'est l'ACCÈS À LA PROPRIÉTÉ qui jette une `SecurityError`. Une
 * exception dans un effet remonte jusqu'à la frontière d'erreur, et l'application n'en
 * définit aucune : le vendeur perdrait tout son catalogue à cause d'un réglage
 * d'affichage. D'où les deux `try`.
 * ═════════════════════════════════════════════════════════════════════════════════
 */
export function useVueListe(cle: string, defaut: VueListe = "tableau") {
  const [vue, setVue] = useState<VueListe>(defaut);

  useEffect(() => {
    try {
      const memorise = window.localStorage.getItem(cle);
      // Liste blanche, pas un transtypage : une valeur corrompue retombe sur le défaut.
      if (memorise === "tableau" || memorise === "catalogue") setVue(memorise);
    } catch {
      // Stockage refusé : on garde le défaut. Rien d'autre à faire, et surtout pas
      // laisser l'exception remonter.
    }
  }, [cle]);

  function choisir(v: VueListe) {
    setVue(v);
    try {
      window.localStorage.setItem(cle, v);
    } catch {
      // La bascule fonctionne pour cette visite ; seule la mémorisation est perdue.
    }
  }

  return { vue, choisir };
}

/**
 * Bascule tableau / catalogue.
 *
 * `role="group"` et `aria-pressed` plutôt que deux boutons ordinaires : un lecteur
 * d'écran doit entendre LEQUEL des deux est actif. La couleur seule ne le dit pas.
 */
export function ViewToggle({
  vue,
  onChange,
  className,
}: {
  vue: VueListe;
  onChange: (v: VueListe) => void;
  className?: string;
}) {
  const options: { valeur: VueListe; libelle: string; Icone: typeof Rows3 }[] = [
    { valeur: "tableau", libelle: "Tableau", Icone: Rows3 },
    { valeur: "catalogue", libelle: "Catalogue", Icone: LayoutGrid },
  ];

  return (
    <div
      role="group"
      aria-label="Affichage de la liste"
      className={cn("nm-inset-sm inline-flex shrink-0 items-center gap-1 rounded-xl p-1", className)}
    >
      {options.map(({ valeur, libelle, Icone }) => {
        const actif = vue === valeur;
        return (
          <button
            key={valeur}
            type="button"
            aria-pressed={actif}
            onClick={() => onChange(valeur)}
            aria-label={`Affichage ${libelle.toLowerCase()}`}
            title={`Affichage ${libelle.toLowerCase()}`}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-[box-shadow,color] duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              actif
                ? "nm-raised-sm bg-card font-medium text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icone className="size-4 shrink-0" />
            {/* Le libellé disparaît sur les petits écrans, où la barre d'outils est
                déjà à l'étroit — il ne reste alors que l'icône. C'est `aria-label` qui
                porte le nom dans les deux cas, jamais le texte visible : en
                `display:none` il ne serait plus lu, et le bouton deviendrait muet là
                où il en a le plus besoin. Le texte visible est contenu dans ce nom,
                comme l'exige le critère « étiquette dans le nom ». */}
            <span className="hidden sm:inline">{libelle}</span>
          </button>
        );
      })}
    </div>
  );
}
