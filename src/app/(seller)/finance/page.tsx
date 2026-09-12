"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { formatDateTime, formatXof, shortId } from "@/lib/utils";
import {
  agregeParJour,
  borneLocale,
  dateExploitable,
  formatJourCourt,
  formatJourLong,
  jourLocal,
} from "@/lib/series";
import { ChartFrame } from "@/components/charts/chart-frame";
import { SerieTemporelle } from "@/components/charts/charts";
import { payoutTone, statusLabel } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import { toCsv, downloadCsv } from "@/lib/csv-export";
import type { SellerPayout, SellerStatement } from "@/types/seller";
import { AlertTriangle, Download } from "lucide-react";

/**
 * Garde-fou de rendu : ne laisse passer qu'un nombre réel.
 *
 * `-undefined` vaut `NaN`, PAS `undefined` — et `NaN` traverse aussi bien le test
 * `value === undefined` que le `?? 0` de `formatXof`, pour finir en « NaN F CFA ».
 * Un champ renvoyé sous un autre nom par le serveur affichait donc trois tuiles
 * cassées au lieu d'être signalé.
 */
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const negate = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : -n;
};

// ═══════════════════════════════════════════════════════════════════════════════════
// `isoDay`, `localBound` ET `dateExploitable` ONT DÉMÉNAGÉ DANS `@/lib/series`.
//
// Ils vivaient ici, et le deuxième écran à interroger une période les aurait recopiés.
// Ce sont exactement les fonctions dont l'erreur ne se voit pas : un relevé décalé
// d'un jour reste un relevé plausible. Les pièges qu'elles ferment — bascule UTC de
// `toISOString`, mappage des années 0-99 sur 1900-1999 par le constructeur `Date`,
// comparaison lexicographique d'une année à cinq chiffres — sont documentés à leur
// nouvel emplacement.
// ═══════════════════════════════════════════════════════════════════════════════════

export default function FinancePage() {
  // Période appliquée séparée de la saisie : on ne relance pas une requête à chaque
  // frappe dans un champ date.
  // Initialisation PARESSEUSE : les arguments de `useState` sont évalués à chaque
  // rendu, même quand leur valeur est ignorée. `isoDay` construisait donc quatre
  // objets `Date` par rendu pour rien.
  const [fromInput, setFromInput] = useState(() => jourLocal(30));
  const [toInput, setToInput] = useState(() => jourLocal(0));
  const [period, setPeriod] = useState(() => ({ from: jourLocal(30), to: jourLocal(0) }));

  // NOTE HISTORIQUE, CONSERVÉE PARCE QU'ELLE EXPLIQUE UNE ABSENCE.
  //
  // Un `invalidPeriod = period.to < period.from` vivait ici, et coupait la requête.
  // Il est devenu inatteignable : `period` ne change plus que par « Appliquer », et ce
  // bouton est désormais bloqué tant que la saisie n'est pas exploitable. Le laisser
  // aurait signifié deux endroits pour la même règle, dont un qui ne s'exécute jamais
  // — et il rendait `null` SANS message, donc un écran vide et muet le jour où il se
  // serait réveillé.
  //
  // L'autre moitié de la note d'origine reste vraie et vaut d'être redite : le serveur
  // compare des INSTANTS (`from` à 00:00:00 contre `to` à 23:59:59), pas des dates
  // nues. Une période d'UN SEUL JOUR est donc légitime — « le relevé d'aujourd'hui »
  // doit rester demandable, et c'est pourquoi le contrôle est `<` et non `<=`.

  // ═══════════════════════════════════════════════════════════════════════════════
  // « APPLIQUER » NE DOIT PAS POUVOIR EFFACER LE RELEVÉ SANS RIEN METTRE À LA PLACE
  //
  // Deux saisies menaient à un clic sans effet lisible :
  //   - « Au » antérieur à « Du » : la requête passait à `enabled: false` et le relevé
  //     déjà affiché disparaissait, remplacé par rien du tout.
  //   - un champ date VIDÉ (l'utilisateur peut effacer un `type="date"`, qui renvoie
  //     alors une chaîne vide) : `borneLocale("")` construit une date invalide et
  //     `toISOString()` lève, ce qui se terminait en erreur de requête.
  // On bloque donc le bouton tant que la saisie n'est pas exploitable, et on dit
  // laquelle des deux choses manque.
  // ═══════════════════════════════════════════════════════════════════════════════
  const saisieIncomplete = !dateExploitable(fromInput) || !dateExploitable(toInput);
  const saisieInversee = !saisieIncomplete && toInput < fromInput;
  const saisieInapplicable = saisieIncomplete || saisieInversee;

  const statement = useQuery({
    queryKey: ["seller-statement", period.from, period.to],
    queryFn: () =>
      bff<SellerStatement>(
        `/seller/finance/statement?from=${encodeURIComponent(borneLocale(period.from, false))}` +
          `&to=${encodeURIComponent(borneLocale(period.to, true))}`,
      ),
  });

  const payouts = useQuery({
    queryKey: ["seller-payouts"],
    queryFn: () => bff<SellerPayout[]>("/seller/finance/payouts"),
  });

  const s = statement.data;

  // ═══════════════════════════════════════════════════════════════════════════════
  // LA COURBE EST CALCULÉE SUR LES LIGNES QUI ONT DÉJÀ SERVI AUX VIGNETTES.
  //
  // C'est la seule façon de garantir qu'elle raconte la même chose qu'elles. Une
  // seconde requête, ou un second calcul côté serveur, aurait fini par diverger — et
  // deux totaux contradictoires sur un même écran d'argent est le pire défaut qu'on
  // puisse livrer à un vendeur.
  //
  // CE QU'ON SOMME, ET POURQUOI C'EST EXACTEMENT `netSalesXof` :
  // le BFF émet, par gain, une écriture « sale » (+brut), une « commission »
  // (−commission) et, s'il y a lieu, une « provider » (−frais). Leur somme vaut donc
  // brut − commission − frais, c'est-à-dire `SellerEarning.NetAmount` — la définition
  // même de `netSalesXof`.
  //
  // À L'ARRONDI PRÈS, ET IL FAUT LE DIRE PLUTÔT QUE DE PROMETTRE L'ÉGALITÉ. La
  // vignette arrondit la SOMME (`Math.Round(earnings.Sum(e => e.NetAmount))`), la
  // courbe somme des montants DÉJÀ arrondis ligne à ligne. Sur une commission
  // fractionnaire, l'écart plafonne à un franc par gain. C'est assumé : refaire une
  // requête pour gagner ce franc rouvrirait la porte à une divergence bien plus
  // coûteuse, celle de deux sources différentes.
  //
  // LES REMBOURSEMENTS RESTENT UNE SÉRIE À PART, exactement comme la vignette les
  // compte à part. Le montant d'une écriture « refund » est ce qui a été rendu à
  // L'ACHETEUR, pas ce qui a été repris au vendeur : la part nette reprise est
  // calculée au prorata à la contre-passation, et ni le relevé ni cet écran ne la
  // connaissent. Les soustraire du net ici fabriquerait un troisième chiffre faux.
  // ═══════════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════════
  // PLAFOND DE JOURS, PARCE QUE LA SAISIE N'EN A AUCUN.
  //
  // « Du 01/01/2000 au 31/12/2099 » passe tous les contrôles de saisie : les deux
  // dates sont valides et dans l'ordre. `agregeParJour` construisait alors 36 525
  // points, remis tels quels à Recharts, et « Voir les données » empilait 36 525
  // lignes dans le DOM. Le relevé lui-même supporte la période — c'est sa QUOTIDIENNE
  // qui ne la supporte pas.
  //
  // Même plafond que `/seller/orders/series`, et pour la même raison : au-delà, un
  // point par jour n'est plus lisible, quand bien même le navigateur tiendrait.
  // On ne coupe RIEN d'autre : les vignettes, le net de la période et le tableau des
  // écritures continuent de porter la période entière.
  // ═══════════════════════════════════════════════════════════════════════════════
  const JOURS_MAX_COURBE = 400;
  const joursDemandes = useMemo(() => {
    const a = new Date(2000, 0, 1);
    const [ay, am, ad] = period.from.split("-").map(Number);
    a.setFullYear(ay, am - 1, ad);
    a.setHours(12, 0, 0, 0);
    const b = new Date(2000, 0, 1);
    const [by, bm, bd] = period.to.split("-").map(Number);
    b.setFullYear(by, bm - 1, bd);
    b.setHours(12, 0, 0, 0);
    return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  }, [period.from, period.to]);

  const courbeTropLongue = joursDemandes > JOURS_MAX_COURBE;

  const parJour = useMemo(
    () =>
      courbeTropLongue
        ? []
        : agregeParJour(
        s?.lines ?? [],
        (l) => l.date,
        // ═══════════════════════════════════════════════════════════════════════
        // LES REMBOURSEMENTS GARDENT LEUR SIGNE, C'EST-À-DIRE LE NÉGATIF.
        //
        // Première rédaction : `Math.abs(...)`. La courbe montait donc à +50 000 sur
        // un jour de remboursement, sur la MÊME échelle que les ventes nettes — un
        // remboursement se lisait comme une recette. Et le tableau jumeau, lui,
        // affichait −50 000 : les deux lectures du même jour se contredisaient, ce
        // que le tableau est précisément censé empêcher.
        //
        // Le serveur envoie déjà ces montants en négatif
        // (`StatementLineDto(..., "refund", -(int)Math.Round(r.RefundAmount))`), et
        // la vignette du haut les affiche en négatif. On garde ce signe partout :
        // la courbe plonge sous zéro, ce qui est exactement ce qui s'est passé.
        // ═══════════════════════════════════════════════════════════════════════
        (l) => ({
          net: l.type === "refund" ? 0 : l.amountXof,
          remboursements: l.type === "refund" ? l.amountXof : 0,
        }),
        period.from,
        period.to,
        ["net", "remboursements"],
      ),
    [s, period.from, period.to, courbeTropLongue],
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // ON NE COMPOSE PLUS DE NET. LE SERVEUR EN PROJETTE UN, ET C'EST LE BON.
  //
  // Voir l'en-tête de `SellerStatement` : la soustraction d'ici déduisait deux fois la
  // commission et les frais sur toute vente remboursée. `netSalesXof` est la somme des
  // montants réellement crédités.
  //
  // Ce qui est REPRIS sur un remboursement n'est pas le montant rendu à l'acheteur mais
  // la part nette du vendeur, calculée au prorata au moment de la contre-passation. Ni
  // le relevé ni cet écran ne la connaissent. On affiche donc les deux chiffres pour ce
  // qu'ils sont, et on renvoie au portefeuille, qui porte le débit exact — plutôt que
  // d'inventer un troisième chiffre faux pour remplacer le précédent.
  // ═══════════════════════════════════════════════════════════════════════════════
  function exportLines() {
    if (!s) return;
    downloadCsv(
      `releve_${period.from}_${period.to}.csv`,
      toCsv(
        ["Date", "Libellé", "Type", "Montant XOF"],
        s.lines.map((l) => [
          // Même format qu'à l'écran : une date ISO brute n'est pas reconnue comme
          // date par Excel FR, et l'export dirait autre chose que le tableau.
          formatDateTime(l.date),
          l.label,
          statusLabel(l.type, "statementLine"),
          String(l.amountXof),
        ]),
      ),
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Finances</h1>
        <p className="text-sm text-muted-foreground">
          Relevé de votre boutique sur une période, et historique des versements reçus.
        </p>
      </header>

      <PageNote>
        <strong>Ventes nettes</strong> : ce qui vous a été crédité sur la période, commission de la
        plateforme et frais du prestataire déjà déduits. Les <strong>remboursements</strong> sont
        indiqués à part, au montant rendu à l&apos;acheteur — ce qui vous est repris, lui, est votre
        part nette de la vente, la commission étant reprise à la plateforme. Pour votre solde réel,
        c&apos;est le <strong>portefeuille</strong> qui fait foi ; ce relevé explique la période.
      </PageNote>

      <QueryError of={[statement, payouts]} />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="from">Du</Label>
            {/* `min`/`max` guident le sélecteur ; ils ne SUFFISENT pas — une valeur hors
                bornes reste lisible dans `value`, d'où le contrôle `dateExploitable`. */}
            <Input
              id="from"
              type="date"
              min="2000-01-01"
              max="2099-12-31"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">Au</Label>
            <Input
              id="to"
              type="date"
              min="2000-01-01"
              max="2099-12-31"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setPeriod({ from: fromInput, to: toInput })}
            disabled={saisieInapplicable}
          >
            Appliquer
          </Button>
          <Button
            variant="ghost"
            onClick={exportLines}
            disabled={!s || s.lines.length === 0}
            title="Exporter les écritures de la période"
          >
            <Download className="size-4" /> Exporter en CSV
          </Button>
          {saisieInapplicable && (
            <p className="w-full text-xs text-destructive">
              {saisieIncomplete
                ? "Renseignez les deux dates — jour, mois et année sur quatre chiffres."
                : "La date de fin ne peut pas précéder la date de début."}
            </p>
          )}
        </CardContent>
      </Card>

      {statement.isError ? (
        // Le serveur REFUSE de servir un relevé partiel : si les remboursements sont
        // introuvables, il répond 503 plutôt qu'un net surévalué. On relaie ce choix
        // au lieu d'afficher les chiffres dont on dispose.
        <Card className="mb-6 p-4 text-sm">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">Relevé indisponible.</p>
              <p className="text-muted-foreground">
                {statement.error instanceof Error
                  ? statement.error.message
                  : "Le relevé n'a pas pu être calculé."}{" "}
                Aucun chiffre n&apos;est affiché : un relevé incomplet vaut moins que pas de relevé
                du tout.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="Ventes brutes" value={num(s?.grossSalesXof)} loading={statement.isLoading} />
            <Metric label="Ventes nettes" value={num(s?.netSalesXof)} loading={statement.isLoading} />
            <Metric label="Commission plateforme" value={negate(s?.commissionXof)} loading={statement.isLoading} />
            <Metric label="Frais de paiement" value={negate(s?.providerFeeXof)} loading={statement.isLoading} />
            <Metric label="Remboursements" value={negate(s?.refundsXof)} loading={statement.isLoading} />
          </div>

          <Card className="mb-6">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Ventes nettes de la période
                </div>
                <div className="mt-1 text-3xl font-semibold tabular-nums text-primary">
                  {/* « … » pendant le chargement, « — » si le champ manque. Les
                      confondre rendrait un tiret perpétuel indiscernable d'une requête
                      lente : un BFF antérieur à `netSalesXof` afficherait un spinner
                      textuel qui ne s'arrête jamais. */}
                  {statement.isLoading
                    ? "…"
                    : typeof s?.netSalesXof !== "number"
                      ? "—"
                      : formatXof(s.netSalesXof)}
                </div>
              </div>
              {s && (
                <p className="max-w-md text-xs text-muted-foreground">
                  {formatXof(s.grossSalesXof)} de ventes brutes, moins{" "}
                  {formatXof(s.commissionXof)} de commission et {formatXof(s.providerFeeXof)} de
                  frais de paiement. Les {formatXof(s.refundsXof)} de remboursements de la période
                  sont comptés à part : ce qui vous en a été repris figure sur votre portefeuille.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="mb-6">
            <ChartFrame
              titre="Ventes nettes par jour"
              description="Ce qui vous a été crédité chaque jour, commission et frais déjà déduits."
              chargement={statement.isLoading}
              erreur={
                courbeTropLongue
                  ? `La période demandée fait ${joursDemandes} jours. Au-delà de ` +
                    `${JOURS_MAX_COURBE}, un point par jour n'est plus lisible — les chiffres ` +
                    "de la période restent exacts ci-dessus et dans le tableau des écritures."
                  : null
              }
              rafraichit={statement.isFetching && !statement.isLoading}
              colonnes={["Jour", "Ventes nettes", "Remboursements"]}
              lignes={parJour.map((p) => [
                formatJourLong(p.date),
                formatXof(p.net),
                p.remboursements === 0 ? "—" : formatXof(p.remboursements),
              ])}
              note={
                <>
                  Les <strong>remboursements</strong> sont tracés au montant rendu à
                  l&apos;acheteur. Ce qui vous en est repris est votre part nette de la vente,
                  calculée au prorata — le relevé ne la connaît pas. Pour le débit exact,
                  c&apos;est le portefeuille qui fait foi.
                </>
              }
            >
              <SerieTemporelle
                donnees={parJour}
                cleX="date"
                series={[
                  { cle: "net", libelle: "Ventes nettes" },
                  { cle: "remboursements", libelle: "Remboursements (rendus à l'acheteur)" },
                ]}
                formatX={formatJourCourt}
                formatValeur={formatXof}
                /* Graduations abrégées : « 1 250 000 F CFA » huit fois sur un axe
                   vertical mange la moitié du tracé. L'infobulle et le tableau
                   donnent le montant exact. */
                formatAxeY={(v) =>
                  Math.abs(v) >= 1_000_000
                    ? `${Math.round(v / 100_000) / 10} M`
                    : Math.abs(v) >= 1_000
                      ? `${Math.round(v / 1_000)} k`
                      : String(v)
                }
              />
            </ChartFrame>
          </div>

          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Écritures de la période</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Libellé</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statement.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                        Chargement…
                      </TableCell>
                    </TableRow>
                  ) : (s?.lines.length ?? 0) === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                        Aucune écriture sur cette période.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (s?.lines ?? []).map((l, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(l.date)}
                        </TableCell>
                        <TableCell className="text-sm">{l.label}</TableCell>
                        <TableCell>
                          <Badge variant={l.amountXof < 0 ? "neutral" : "success"}>
                            {statusLabel(l.type, "statementLine")}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className={`text-right font-medium tabular-nums ${l.amountXof < 0 ? "text-destructive" : ""}`}
                        >
                          {l.amountXof < 0 ? "−" : "+"}
                          {formatXof(Math.abs(l.amountXof))}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Versements reçus</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {payouts.isLoading ? (
            <p className="p-5 text-sm text-muted-foreground">Chargement…</p>
          ) : payouts.isError ? (
            <p className="p-5 text-sm text-muted-foreground">
              L&apos;historique des versements n&apos;a pas pu être chargé. Cette liste est
              incomplète, pas vide.
            </p>
          ) : (payouts.data ?? []).length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">Aucun versement à ce jour.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead className="text-right">Brut</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Net versé</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Payé le</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(payouts.data ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">
                      {p.providerRef ?? shortId(p.id)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatXof(p.grossAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      −{formatXof(p.commissionAmount)}
                    </TableCell>
                    {/* `netAmount` vient du serveur : on l'affiche, on ne le recalcule pas. */}
                    <TableCell className="text-right font-medium tabular-nums text-primary">
                      {formatXof(p.netAmount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={payoutTone(p.status)}>
                        {statusLabel(p.status, "payoutStatus")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.paidAtUtc ? formatDateTime(p.paidAtUtc) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  loading,
}: {
  label: string;
  /** `undefined` = pas encore connu. On n'affiche jamais un zéro provisoire. */
  value: number | undefined;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div
          className={`mt-1 text-2xl font-semibold tabular-nums ${
            value !== undefined && value < 0 ? "text-destructive" : ""
          }`}
        >
          {loading || value === undefined ? "…" : formatXof(value)}
        </div>
      </CardContent>
    </Card>
  );
}
