"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { formatXof } from "@/lib/utils";
import { statusLabel } from "@/lib/status-labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DonutChart, type ChartPoint } from "@/components/ui/charts";
import { QueryError } from "@/components/query-error";
import type { SellerDashboard } from "@/types/seller";
import { AlertTriangle, ArrowRight, Package, ShoppingBag, Star, Wallet } from "lucide-react";

/**
 * Étiquette lisible d'une section indisponible, telle que le BFF la nomme
 * (`SellerDashboardEndpoints` : « orders », « statement », « reviews »).
 */
const SECTION_LABELS: Record<string, string> = {
  orders: "commandes",
  statement: "relevé financier",
  reviews: "avis clients",
};

function Metric({
  label,
  value,
  hint,
  icon: Icon,
  unavailable,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof ShoppingBag;
  /** Vrai si la source de ce chiffre n'a pas répondu : on n'affiche alors AUCUN chiffre. */
  unavailable?: boolean;
  /**
   * Vrai tant que la requête est en vol.
   *
   * Sans cet état, `d?.grossSales30d ?? 0` affichait « 0 F CFA » pendant tout le
   * chargement : sur un réseau lent, le vendeur lisait un chiffre d'affaires nul avant
   * de voir le vrai. Un zéro provisoire est un zéro quand même — c'est le repli
   * silencieux que cet écran est censé bannir, déplacé du cas d'erreur au cas d'attente.
   */
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
            {loading ? (
              <div className="mt-1 text-2xl font-semibold text-muted-foreground">…</div>
            ) : unavailable ? (
              // ─────────────────────────────────────────────────────────────────
              // PAS DE ZÉRO QUAND LA DONNÉE MANQUE.
              //
              // Le BFF met les compteurs à zéro quand une source ne répond pas, et
              // le signale dans `unavailable`. Afficher « 0 F CFA » ici serait le
              // repli silencieux que tout l'audit dénonce : un vendeur conclurait
              // qu'il n'a rien vendu ce mois-ci.
              // ─────────────────────────────────────────────────────────────────
              <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-amber-600">
                <AlertTriangle className="size-4 shrink-0" />
                Indisponible
              </div>
            ) : (
              <div className="mt-1 truncate text-2xl font-semibold tabular-nums">{value}</div>
            )}
            {hint && !unavailable && !loading && (
              <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
            )}
          </div>
          <div className="nm-raised-sm flex size-10 shrink-0 items-center justify-center rounded-xl bg-card text-primary">
            <Icon className="size-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const q = useQuery({
    queryKey: ["seller-dashboard"],
    queryFn: () => bff<SellerDashboard>("/seller/dashboard"),
  });

  const d = q.data;
  const down = useMemo(() => new Set(d?.unavailable ?? []), [d]);

  const statusSplit = useMemo<ChartPoint[]>(
    () =>
      Object.entries(d?.ordersByStatus ?? {}).map(([key, value]) => ({
        key,
        label: statusLabel(key, "order"),
        value,
      })),
    [d],
  );

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tableau de bord</h1>
        <p className="text-sm text-muted-foreground">
          {q.isLoading ? "Chargement…" : "Activité de votre boutique sur les 30 derniers jours."}
        </p>
      </header>

      <QueryError of={q} />

      {/* ─────────────────────────────────────────────────────────────────────────
          AVERTISSEMENT EXPLICITE SUR LES DONNÉES MANQUANTES.

          `unavailable` est renseigné par le BFF quand une source interne n'a pas
          répondu. Ce bandeau est la raison d'être de ce champ : sans lui, le vendeur
          lit des chiffres partiels sans savoir qu'ils le sont, et peut décider d'un
          retrait ou d'un réassort sur cette base.
          ───────────────────────────────────────────────────────────────────────── */}
      {down.size > 0 && (
        <Card className="mb-4 border-amber-300 bg-amber-50 p-4 text-sm dark:bg-amber-950/30">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-200">
                Certaines données n&apos;ont pas pu être chargées.
              </p>
              <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                Sections concernées :{" "}
                {Array.from(down)
                  .map((s) => SECTION_LABELS[s] ?? s)
                  .join(", ")}
                . Les indicateurs correspondants sont masqués — ils ne valent pas zéro, ils sont
                inconnus. Réessayez dans quelques instants avant de prendre une décision.
              </p>
            </div>
          </div>
        </Card>
      )}

      {q.isError ? null : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Commandes (total)"
              value={String(d?.ordersTotal ?? 0)}
              icon={ShoppingBag}
              loading={q.isLoading}
              unavailable={down.has("orders")}
            />
            <Metric
              label="À traiter"
              value={String(d?.ordersToProcess ?? 0)}
              hint="Commandes en attente d'expédition"
              icon={Package}
              loading={q.isLoading}
              unavailable={down.has("orders")}
            />
            <Metric
              label="Ventes brutes (30 j)"
              value={formatXof(d?.grossSales30d ?? 0)}
              icon={Wallet}
              loading={q.isLoading}
              unavailable={down.has("statement")}
            />
            <Metric
              label="Net à percevoir (30 j)"
              value={formatXof(d?.netPayout30d ?? 0)}
              hint="Après commission et frais"
              icon={Wallet}
              loading={q.isLoading}
              unavailable={down.has("statement")}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">Commandes par statut</CardTitle>
                <Link href="/orders">
                  <Button size="sm" variant="outline">
                    Voir les commandes <ArrowRight className="size-4" />
                  </Button>
                </Link>
              </CardHeader>
              <CardContent className="p-5 pt-0">
                {q.isLoading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Chargement…</p>
                ) : down.has("orders") ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Répartition indisponible — le service des commandes n&apos;a pas répondu.
                  </p>
                ) : statusSplit.length === 0 ? (
                  // « Aucune commande » n'est affirmé qu'une fois la réponse reçue ET
                  // la section déclarée disponible. Autrement, c'est une supposition.
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Aucune commande pour l&apos;instant.
                  </p>
                ) : (
                  <DonutChart
                    data={statusSplit}
                    formatValue={(v) => `${v} commande${v > 1 ? "s" : ""}`}
                    size={180}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Satisfaction</CardTitle>
              </CardHeader>
              <CardContent className="p-5 pt-0">
                {q.isLoading ? (
                  <p className="text-sm text-muted-foreground">Chargement…</p>
                ) : down.has("reviews") ? (
                  <p className="text-sm text-muted-foreground">
                    Avis indisponibles pour le moment.
                  </p>
                ) : (d?.reviewsCount ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun avis client pour l&apos;instant.</p>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="nm-raised-sm flex size-12 items-center justify-center rounded-xl bg-card text-amber-500">
                      <Star className="size-6 fill-current" />
                    </div>
                    <div>
                      <div className="text-2xl font-semibold tabular-nums">
                        {(d?.averageRating ?? 0).toFixed(1)}
                        <span className="text-base font-normal text-muted-foreground"> / 5</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {d?.reviewsCount} avis client{(d?.reviewsCount ?? 0) > 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
