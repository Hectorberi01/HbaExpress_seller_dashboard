import type { SellerCategory } from "@/types/seller";

/**
 * Chemin LISIBLE d'une catégorie : « Beauté et soins › Ongles › Accessoires de manucure ».
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE DÉTOUR
 *
 * Le serveur renvoie deux choses insuffisantes prises séparément :
 *   • `name` — « Accessoires » : lisible, mais ambigu. Plusieurs branches de l'arbre
 *     portent le même nom, et le vendeur ne sait pas laquelle il choisit.
 *   • `path` — « /beaute-et-soins/ongles/accessoires » : sans ambiguïté, mais c'est
 *     une suite de slugs d'URL, en minuscules et sans accents. Personne ne range son
 *     catalogue en lisant des fragments d'adresse.
 *
 * On reconstruit donc le chemin des NOMS en remontant les ancêtres par leur `path`.
 * Repli sur le slug quand un ancêtre manque de la liste : mieux vaut un segment
 * disgracieux qu'un trou dans le chemin.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
export function categoryReadablePath(
  category: SellerCategory,
  all: readonly SellerCategory[],
): string {
  const path = category.path;
  if (!path) return category.name;

  const byPath = new Map(all.filter((c) => c.path).map((c) => [c.path as string, c.name]));

  const names: string[] = [];
  let accumulated = "";
  const segments = path.split("/");
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    accumulated = index === 0 ? segment : `${accumulated}/${segment}`;
    // Le chemin commence par « / » : le premier segment est vide, on le saute — mais
    // on l'a bien concaténé, sans quoi tous les chemins suivants seraient décalés.
    if (segment === "") continue;
    names.push(byPath.get(accumulated) ?? segment);
  }

  return names.length === 0 ? category.name : names.join(" › ");
}

/** Catégories triées par chemin lisible — l'ordre dans lequel on les parcourt à l'œil. */
export function sortedByReadablePath(
  all: readonly SellerCategory[],
): { category: SellerCategory; label: string }[] {
  return all
    .map((category) => ({ category, label: categoryReadablePath(category, all) }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}
