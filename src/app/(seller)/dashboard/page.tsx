"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { formatMoney } from "@/lib/utils";
import { statusLabel } from "@/lib/status-labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartFrame } from "@/components/charts/chart-frame";
import { BarresCategories, SerieTemporelle } from "@/components/charts/charts";
import {
  borneLocale,
  decalageMinutesVersEst,
  formatJourCourt,
  formatJourLong,
  jourLocal,
} from "@/lib/series";
import { QueryError } from "@/components/query-error";
import type { SellerDashboard, SellerOrderSeries } from "@/types/seller";
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // `q.isError` SEUL EFFAÇAIT DES CHIFFRES QU'ON AVAIT ENCORE EN MAIN.
  //
  // React Query CONSERVE `data` quand un rechargement échoue : après une coupure
  // réseau de quelques secondes, `q.isError` passe à vrai alors que la réponse
  // précédente est toujours là. Tester la seule erreur faisait donc disparaître les
  // trois vignettes et la répartition par statut — affichées une seconde plus tôt —
  // au profit d'un écran vide.
  //
  // On ne masque que lorsqu'on n'a RIEN à montrer. Dans l'autre cas, `QueryError`
  // au-dessus dit déjà que la dernière tentative a échoué : le vendeur lit des
  // chiffres d'il y a une minute, et il sait qu'ils datent.
  // ═══════════════════════════════════════════════════════════════════════════════
  const masque = q.isError && !d;

  // ═══════════════════════════════════════════════════════════════════════════════
  // DES BARRES, PLUS UN ANNEAU — ET LA RAISON EST MESURÉE, PAS ESTHÉTIQUE.
  //
  // L'anneau colorait chaque statut avec la palette `CHART_COLORS`, dont deux verts
  // voisins (« #22c55e » et « #84cc16 ») se séparent de 5,5 en vision protanope et
  // de 8,0 en VISION NORMALE — là où le plancher de lisibilité est 15. Autrement dit :
  // même avec une vue parfaite, « Payée » et « Confirmée » se confondaient sur le
  // graphe, et seule l'infobulle les distinguait.
  //
  // Une barre horizontale par statut règle les deux problèmes d'un coup : une seule
  // couleur suffit (la longueur porte la grandeur), les libellés sont écrits en toutes
  // lettres à gauche, et comparer deux longueurs alignées est plus juste que comparer
  // deux angles.
  //
  // TRIÉ DÉCROISSANT : l'ordre de `ordersByStatus` vient d'un `GroupBy` serveur, donc
  // de l'ordre d'apparition des commandes. Un classement instable d'un chargement à
  // l'autre fait bouger les barres sous les yeux du vendeur.
  // ═══════════════════════════════════════════════════════════════════════════════
  const statusSplit = useMemo(
    () =>
      Object.entries(d?.ordersByStatus ?? {})
        .map(([key, value]) => ({ key, label: statusLabel(key, "order"), value }))
        .sort((a, b) => b.value - a.value),
    [d],
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // TRENTE JOURS FIXES, SANS SÉLECTEUR DE PÉRIODE SUR CET ÉCRAN.
  //
  // Les deux vignettes d'argent sont bornées côté serveur à `now.AddDays(-30)`
  // (« À traiter », lui, n'est borné par rien) : un sélecteur qui changerait la courbe
  // sans changer ces vignettes mettrait deux périodes différentes sur le même écran,
  // sans que rien ne le dise. Le choix de période vit sur « Finances », où il cadre
  // tout l'écran, et sur « Commandes », où il ne cadre QUE la courbe — cet écran-là le
  // dit d'ailleurs lui-même, sous sa rangée de période. Une promesse de cadrage global
  // n'est donc vraie que pour Finances, et on ne l'étend pas aux deux.
  // ═══════════════════════════════════════════════════════════════════════════════
  const du = jourLocal(29);
  const au = jourLocal(0);
  const serie = useQuery({
    queryKey: ["seller-orders-series", du, au],
    queryFn: () =>
      bff<SellerOrderSeries>(
        `/seller/orders/series?from=${encodeURIComponent(borneLocale(du, false))}` +
          `&to=${encodeURIComponent(borneLocale(au, true))}` +
          `&offsetMinutes=${decalageMinutesVersEst()}`,
      ),
    staleTime: 5 * 60 * 1000,
  });

  const points = serie.data?.points ?? [];

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tableau de bord</h1>
        <p className="text-sm text-muted-foreground">
          {/* « sur les 30 derniers jours » coiffait TOUT, alors que deux chiffres
              seulement sont bornés. `ListOrdersBySellerQuery` n'a aucune borne de
              date : « À traiter », les avis, et la vignette « Commandes (total) » qui
              existait alors, sont cumulés depuis l'ouverture de la boutique. Un vendeur qui lit « 412 commandes »
              sous un titre annonçant un mois se croit quatre fois plus gros qu'il
              n'est. La fenêtre est désormais dite sur les seuls indicateurs qui la
              respectent — leurs étiquettes portent déjà « (30 j) ». */}
          {q.isLoading ? "Chargement…" : "Activité de votre boutique."}
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

      {/* ═══════════════════════════════════════════════════════════════════════
          « COMMANDES (TOTAL) » ÉTAIT LA SOMME D'UN GRAPHIQUE DU MÊME ÉCRAN.
          Côté serveur, `ordersTotal` et `ordersByStatus` sortent de la MÊME liste :
          l'un est `orders.Count`, l'autre son `GroupBy`. Les barres « Commandes par
          statut », plus bas sur cet écran, donnent donc le total ET sa répartition.
          La vignette faisait recompter pour rien.
          « À traiter » reste : c'est une somme de deux tranches (payées +
          confirmées), que ces barres ne présentent pas comme un seul nombre — et
          c'est la file de travail, celle qu'on vient chercher en premier.
          ═══════════════════════════════════════════════════════════════════════ */}
      {masque ? null : (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Metric
            label="À traiter"
            value={String(d?.ordersToProcess ?? 0)}
            /* « Commandes en attente d'expédition » était faux des deux côtés : une
               commande payée n'a pas encore d'expédition (elles naissent à la
               confirmation), et une commande confirmée dont ce vendeur a tout expédié
               y figure encore tant que l'autre vendeur n'a pas livré sa part. Le
               décompte du travail réellement restant est l'onglet « À préparer » des
               expéditions, et c'est là qu'on renvoie. */
            hint="Commandes payées ou confirmées · voir Expéditions pour les colis"
            icon={Package}
            loading={q.isLoading}
            unavailable={down.has("orders")}
          />
          <Metric
            label="Ventes brutes (30 j)"
            value={formatMoney(d?.grossSales30d ?? 0, d?.currency)}
            icon={Wallet}
            loading={q.isLoading}
            unavailable={down.has("statement")}
          />
          {/* « NET À PERCEVOIR » N'ÉTAIT PAS PERCEVABLE, ET LE MOT COMPTAIT.
              `GetSellerStatementAsync` somme TOUS les gains de la fenêtre, sans
              filtre de statut — or seuls les gains `Released` sont payables, c'est
              ce que retient le lot de reversement. Les gains `Accrued` sont encore
              en séquestre, sur des commandes non livrées. Un vendeur qui lisait « à
              percevoir » y voyait son retrait possible, puis trouvait un solde plus
              faible sur « Mon portefeuille », sans explication.
              Le chiffre est juste ; c'est son nom qui promettait autre chose. Le
              montant réellement retirable est le solde du portefeuille, et c'est là
              qu'on renvoie. */}
          <Metric
            label="Net de la période (30 j)"
            value={formatMoney(d?.netPayout30d ?? 0, d?.currency)}
            hint="Après commission et frais — pas le solde retirable"
            icon={Wallet}
            loading={q.isLoading}
            unavailable={down.has("statement")}
          />
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════
          LA COURBE EST SOUS LES VIGNETTES, MAIS HORS DE LEUR TEST D'ERREUR.

          D'où la garde `masque` COUPÉE EN DEUX de part et d'autre de ce bloc, au lieu
          d'un seul qui envelopperait tout l'écran. Ce n'est pas une maladresse de mise
          en page : `/seller/orders/series` est un appel DISTINCT de
          `/seller/dashboard`, qui peut parfaitement avoir abouti pendant que l'autre
          échouait. Une garde unique effaçait alors une donnée qu'on avait en main, et
          l'écran devenait vide sans raison visible.

          REPLIER CE BLOC DANS LA GARDE VOISINE EST DONC UNE RÉGRESSION, quand bien même
          le JSX y gagnerait en concision. La courbe porte sa propre erreur, dans son
          `ChartFrame`.
          ═══════════════════════════════════════════════════════════════════════════ */}
      <div className="mb-6">
        <ChartFrame
          titre="Évolution des commandes"
          description="Sur les 30 derniers jours, annulations comprises."
          chargement={serie.isLoading}
          erreur={serie.isError ? (serie.error as Error).message : null}
          rafraichit={serie.isFetching && !serie.isLoading}
          colonnes={["Jour", "Commandes", "dont annulées"]}
          lignes={points.map((p) => [formatJourLong(p.date), p.orders, p.cancelled])}
          note={
            <>
              Cette courbe compte des COMMANDES, pas de l&apos;argent : la somme des commandes
              passées n&apos;est pas un chiffre d&apos;affaires, elle ignore annulations,
              remboursements, commission et frais. L&apos;évolution des montants se lit dans{" "}
              <Link href="/finance" className="underline underline-offset-4">
                Finances
              </Link>
              . Les trente jours comptés ici sont des jours de CALENDRIER, à votre heure ;
              les vignettes « Ventes brutes » et « Net de la période » couvrent, elles, les
              trente dernières vingt-quatre heures. (« À traiter » n&apos;est borné par aucune
              période : il compte depuis l&apos;ouverture de la boutique.)
            </>
          }
        >
          <SerieTemporelle
            donnees={points}
            cleX="date"
            series={[
              { cle: "orders", libelle: "Commandes" },
              { cle: "cancelled", libelle: "dont annulées" },
            ]}
            formatX={formatJourCourt}
            formatValeur={(v) => String(v)}
          />
        </ChartFrame>
      </div>

      {masque ? null : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ChartFrame
              titre="Commandes par statut"
              /* PAS « 30 derniers jours » : `ListOrdersBySellerQuery` n'a aucune
                 borne de date, cette répartition porte sur TOUTE l'histoire de la
                 boutique. La courbe ci-dessus, elle, est bornée — les deux ne se
                 totalisent donc pas, et il faut le dire plutôt que de laisser le
                 vendeur le découvrir en additionnant. */
              description="Depuis l'ouverture de votre boutique, toutes périodes confondues."
              chargement={q.isLoading}
              erreur={
                down.has("orders")
                  ? "Le service des commandes n'a pas répondu."
                  : null
              }
              colonnes={["Statut", "Commandes"]}
              lignes={statusSplit.map((p) => [p.label, p.value])}
              /* Hauteur FIXE. La calculer sur `statusSplit.length` faisait passer la
                 carte de 160 à 278 px au retour de la requête — la page sautait sous
                 les yeux du vendeur. Sept statuts est le maximum possible
                 (`OrderStatus`), on dimensionne pour sept une fois pour toutes. */
              hauteur={296}
              note={
                <Link href="/orders" className="inline-flex items-center gap-1 underline underline-offset-4">
                  Voir les commandes <ArrowRight className="size-3.5" />
                </Link>
              }
            >
              {statusSplit.length === 0 ? (
                // « Aucune commande » n'est affirmé qu'une fois la réponse reçue ET
                // la section déclarée disponible. Autrement, c'est une supposition.
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Aucune commande pour l&apos;instant.
                </div>
              ) : (
                <BarresCategories
                  donnees={statusSplit}
                  cleCategorie="label"
                  cleValeur="value"
                  libelleValeur="Commandes"
                  formatValeur={(v) => String(v)}
                />
              )}
            </ChartFrame>
          </div>

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
                    {/* Le nombre compte TOUS les avis reçus, la note ne moyenne que
                        les avis VISIBLES par les acheteurs — le serveur exclut
                        désormais les avis rejetés, comme la note publique. Les deux
                        chiffres ne portent donc pas sur le même ensemble, et c'est
                        voulu : le vendeur a bien reçu les avis retirés, l'écran Avis
                        les lui montre, mais ils ne pèsent pas sur sa note. */}
                    <div className="text-xs text-muted-foreground">
                      {d?.reviewsCount} avis reçu{(d?.reviewsCount ?? 0) > 1 ? "s" : ""} —
                      note calculée sur les avis publiés
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
