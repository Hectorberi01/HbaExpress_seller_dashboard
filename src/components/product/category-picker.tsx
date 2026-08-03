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
export function CategoryPicker({
  categories,
  value,
  onChange,
  loading,
}: {
  categories: SellerCategory[];
  value: string;
  onChange: (id: string) => void;
  loading?: boolean;
}) {
  const [query, setQuery] = useState("");

  const options = useMemo(() => sortedByReadablePath(categories), [categories]);
  const selected = options.find((o) => o.category.id === value);

  const matches = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return options.slice(0, 60);
    const words = needle.split(/\s+/).filter(Boolean);
    return options
      .filter((o) => {
        const haystack = normalize(o.label);
        return words.every((w) => haystack.includes(w));
      })
      .slice(0, 60);
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

      {!loading && !query && options.length > matches.length && (
        <p className="text-xs text-muted-foreground">
          {options.length} catégories au total — affinez la recherche pour trouver la vôtre.
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
