"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * LE CADRE COMMUN À TOUS LES GRAPHES DE LA CONSOLE.
 *
 * Il n'est pas là pour uniformiser l'apparence — il est là pour rendre trois erreurs
 * IMPOSSIBLES À COMMETTRE, parce qu'un graphe faux est pire qu'une absence de graphe :
 * on le croit.
 *
 * 1. LE TABLEAU JUMEAU EST OBLIGATOIRE. `colonnes` et `lignes` ne sont pas
 *    facultatifs. Une infobulle ne doit JAMAIS être le seul moyen de lire une valeur :
 *    elle n'existe ni au clavier sur certains écrans, ni à l'impression, ni pour un
 *    lecteur d'écran. Trois des couleurs de série passent sous 3:1 de contraste sur
 *    la surface claire — la règle de secours impose alors des valeurs lisibles en
 *    toutes lettres. Ce tableau est cette valeur de secours.
 *
 * 2. UNE PANNE NE DEVIENT PAS UNE COURBE À ZÉRO. `erreur` a sa propre branche.
 *    Une ligne plate se lit « vous n'avez rien vendu », jamais « la donnée manque » ;
 *    c'est la confusion la plus coûteuse d'un tableau de bord vendeur.
 *
 * 3. UN RAFRAÎCHISSEMENT NE VIDE PAS L'ÉCRAN. `rafraichit` baisse l'opacité du rendu
 *    précédent au lieu de le remplacer par un squelette : pas de saut de mise en page,
 *    pas de clignotement à chaque changement de période.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
export function ChartFrame({
  titre,
  description,
  chargement,
  erreur = null,
  rafraichit = false,
  note,
  colonnes,
  lignes,
  hauteur = 260,
  children,
}: {
  titre: string;
  description?: string;
  chargement: boolean;
  /** Message d'erreur du serveur, ou `null`. Branche séparée : jamais une courbe à zéro. */
  erreur?: string | null;
  /** Vrai pendant un refetch alors qu'une donnée est déjà affichée. */
  rafraichit?: boolean;
  /** Précision affichée sous le graphe — périmètre, limite de lecture. */
  note?: React.ReactNode;
  /** En-têtes du tableau jumeau. Obligatoire. */
  colonnes: string[];
  /** Lignes du tableau jumeau, déjà formatées pour l'affichage. Obligatoire. */
  lignes: (string | number)[][];
  /**
   * Hauteur TOTALE de la zone de graphe, axe et légende COMPRIS — pas celle du seul
   * tracé. Recharts se loge dans cette hauteur en y soustrayant sa légende (28 px) et
   * sa bande d'axe (~30 px) : à 260, le tracé utile fait donc environ 200 px.
   *
   * La formulation compte, parce que le tableau de bord dimensionne ses barres à
   * partir de cette valeur : la lire comme « hauteur du tracé » conduit à sous-évaluer
   * la place nécessaire d'une soixantaine de pixels.
   */
  hauteur?: number;
  children: React.ReactNode;
}) {
  const [tableauOuvert, setTableauOuvert] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{titre}</CardTitle>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardHeader>

      <CardContent className="p-5 pt-0">
        {erreur ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0">
              Ces chiffres n&apos;ont pas pu être chargés, et aucune courbe n&apos;est tracée :
              une ligne à zéro se lirait comme une absence de ventes. {erreur}
            </p>
          </div>
        ) : chargement ? (
          <div
            className="flex items-center justify-center text-sm text-muted-foreground"
            style={{ height: hauteur }}
          >
            Chargement…
          </div>
        ) : (
          <>
            <div
              // Pas de squelette au rafraîchissement : on garde le rendu précédent,
              // atténué. `aria-busy` le dit à l'assistance vocale.
              className={rafraichit ? "opacity-60 transition-opacity" : "transition-opacity"}
              aria-busy={rafraichit}
              style={{ height: hauteur }}
            >
              {children}
            </div>

            {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}

            <button
              type="button"
              onClick={() => setTableauOuvert((v) => !v)}
              aria-expanded={tableauOuvert}
              className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {tableauOuvert ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              {tableauOuvert ? "Masquer les données" : "Voir les données"}
            </button>

            {tableauOuvert && (
              <div className="mt-2 max-h-72 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {colonnes.map((c, i) => (
                        <TableHead key={c} className={i === 0 ? undefined : "text-right"}>
                          {c}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lignes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={colonnes.length} className="text-sm text-muted-foreground">
                          Aucune donnée sur cette période.
                        </TableCell>
                      </TableRow>
                    ) : (
                      lignes.map((ligne, i) => (
                        <TableRow key={i}>
                          {ligne.map((v, j) => (
                            <TableCell
                              key={j}
                              className={j === 0 ? "whitespace-nowrap" : "text-right tabular-nums"}
                            >
                              {v}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
