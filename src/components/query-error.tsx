"use client";

import { Card } from "@/components/ui/card";

/** Forme minimale d'une requête React Query, pour n'en dépendre qu'a minima. */
type QueryLike = { isError: boolean; error?: unknown };

/**
 * Bandeau d'erreur de chargement, à placer en tête de page.
 *
 * Pourquoi un composant plutôt qu'un `isError ?` autour du contenu : il s'insère
 * SANS restructurer le rendu existant, et couvre plusieurs requêtes d'un coup —
 * une page qui en fait cinq ne doit pas échouer en silence sur la quatrième.
 * N'affiche rien tant que tout va bien.
 */
export function QueryError({ of }: { of: QueryLike | QueryLike[] }) {
  const queries = Array.isArray(of) ? of : [of];
  const failed = queries.filter((q) => q.isError);
  if (failed.length === 0) {
    return null;
  }

  // Messages distincts uniquement : cinq requêtes qui tombent pour la même raison
  // (BFF injoignable) ne doivent pas produire cinq lignes identiques.
  const messages = Array.from(
    new Set(failed.map((q) => (q.error instanceof Error ? q.error.message : "erreur"))),
  );

  return (
    <Card className="mb-4 p-4 text-sm text-destructive">
      Impossible de charger : {messages.join(" · ")}
    </Card>
  );
}
