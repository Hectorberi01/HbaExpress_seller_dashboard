"use client";

import { useMemo, useState } from "react";
import { sortedByReadablePath } from "@/lib/categories";
import { Input } from "@/components/ui/input";
import type { SellerCategory } from "@/types/seller";
import { Search } from "lucide-react";

/**
 * Choix de la catégorie — recherche plutôt que liste déroulante.
 *
 * L'arbre des catégories d'une place de marché compte des centaines d'entrées. Un
 * `<select>` obligerait à les faire défiler toutes ; le sélecteur en cascade de l'app
 * mobile convient au doigt mais demande trois ou quatre tapes. Au clavier, taper
 * « manucure » est le geste le plus court — et le chemin complet reste affiché, pour
 * qu'on voie DANS QUELLE branche on atterrit.
 *
 * La recherche porte sur le chemin lisible entier : « beauté ongles » trouve donc la
 * bonne entrée, même si aucun de ces mots n'est dans son nom propre.
 */
/** Plafond d'affichage. La liste défile ; au-delà, elle cesse d'être lisible. */
const MAX_AFFICHES = 60;

export function CategoryPicker({
  categories,
  value,
  onChange,
  loading,
  feuillesSeulement = false,
}: {
  categories: SellerCategory[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
  /**
   * ═════════════════════════════════════════════════════════════════════════════════
   * NE PROPOSER QUE LES CATÉGORIES FINALES — celles qui n'ont pas de sous-catégorie.
   *
   * Le serveur refuse désormais la création d'un produit ailleurs
   * (`catalog.product.category_not_leaf`), et pour une raison qui ne se voyait pas :
   * ranger un ordinateur portable dans « Ordinateurs » plutôt que dans « Ordinateurs
   * portables » ne produisait aucune erreur. La fiche partait, simplement privée des
   * attributs de la feuille — donc introuvable pour l'acheteur qui filtre dessus.
   *
   * Les filtrer ICI plutôt que d'afficher un refus après quatre étapes remplies et les
   * photos téléversées : c'est la même logique que le retrait des catégories archivées.
   * ═════════════════════════════════════════════════════════════════════════════════
   */
  feuillesSeulement?: boolean;
}) {
  const [query, setQuery] = useState("");

  /**
   * ═════════════════════════════════════════════════════════════════════════════════
   * LES CATÉGORIES ARCHIVÉES NE SONT PLUS PROPOSÉES.
   *
   * Ce sélecteur listait tout. `ProductAttributeGuard` refuse une catégorie archivée
   * en 409 — mais seulement à l'ENVOI, c'est-à-dire après quatre étapes remplies et
   * les photos téléversées. Le vendeur n'avait aucun moyen de voir venir le refus, et
   * tout était à refaire.
   *
   * ON GARDE CELLE QUI EST DÉJÀ CHOISIE, même archivée. Un produit existant peut
   * pointer vers une catégorie retirée depuis : la faire disparaître de la liste ne
   * l'enlèverait pas du produit, cela rendrait seulement l'écran incapable de dire où
   * il est rangé.
   *
   * UN STATUT ABSENT VAUT ACTIF. Le champ est facultatif dans le contrat ; traiter
   * l'absence comme un archivage viderait le sélecteur entier le jour où un serveur
   * plus ancien répond.
   * ═════════════════════════════════════════════════════════════════════════════════
   */
  const proposables = useMemo(
    () =>
      categories.filter((c) => {
        // La catégorie DÉJÀ choisie reste proposable quoi qu'il arrive : la faire
        // disparaître ne l'enlèverait pas du produit, cela rendrait seulement l'écran
        // incapable de dire où il est rangé.
        if (c.id === value) return true;
        if ((c.status ?? "Active").toLowerCase() === "archived") return false;

        // `isLeaf` absent = serveur antérieur à cette règle : on propose, plutôt que
        // de vider le sélecteur entier.
        return !feuillesSeulement || (c.isLeaf ?? true);
      }),
    [categories, value, feuillesSeulement],
  );

  const options = useMemo(() => sortedByReadablePath(proposables), [proposables]);
  const selected = options.find((o) => o.category.id === value);

  const matches = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return options.slice(0, MAX_AFFICHES);
    const words = needle.split(/\s+/).filter(Boolean);
    return options
      .filter((o) => {
        const haystack = normalize(o.label);
        return words.every((w) => haystack.includes(w));
      })
      .slice(0, MAX_AFFICHES);
  }, [options, query]);

  /** Nombre de correspondances AVANT troncature — voir la note sous la liste. */
  const totalCorrespondances = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return options.length;
    const words = needle.split(/\s+/).filter(Boolean);
    return options.filter((o) => {
      const haystack = normalize(o.label);
      return words.every((w) => haystack.includes(w));
    }).length;
  }, [options, query]);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3.5 py-2.5">
        <span className="min-w-0 truncate text-sm font-medium">{selected.label}</span>
        <button
          type="button"
          onClick={() => {
            onChange("");
            setQuery("");
          }}
          className="shrink-0 text-xs text-primary hover:underline"
        >
          Changer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={loading ? "Chargement des catégories…" : "Rechercher une catégorie…"}
          className="pl-9"
          disabled={loading}
          aria-label="Rechercher une catégorie"
        />
      </div>

      <div className="max-h-56 overflow-y-auto rounded-xl border border-border">
        {loading ? (
          <p className="p-3 text-sm text-muted-foreground">Chargement…</p>
        ) : matches.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            Aucune catégorie ne correspond à « {query} ».
          </p>
        ) : (
          <ul>
            {matches.map((o) => (
              <li key={o.category.id}>
                <button
                  type="button"
                  onClick={() => onChange(o.category.id)}
                  className="block w-full truncate px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* La troncature devenait MUETTE dès qu'on tapait : la note n'était affichée
          qu'en l'absence de recherche, alors que le `.slice` s'applique dans les deux
          branches. Une recherche large montrait donc soixante lignes sur deux cents,
          sans rien dire — et « ma catégorie n'existe pas » est la conclusion naturelle.
          On compte désormais les correspondances réelles, dans les deux cas. */}
      {!loading && feuillesSeulement && (
        <p className="text-xs text-muted-foreground">
          Seules les catégories finales sont proposées : ce sont elles qui portent les
          caractéristiques attendues, et c&apos;est par elles que les acheteurs filtrent.
        </p>
      )}

      {!loading && totalCorrespondances > matches.length && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {matches.length} sur {totalCorrespondances} {query ? "correspondances" : "catégories"} —
          affinez la recherche pour voir les autres.
        </p>
      )}
    </div>
  );
}

/** Minuscules sans accents : « Beauté » et « beaute » doivent se répondre. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
