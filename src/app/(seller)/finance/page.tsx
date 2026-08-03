"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { formatDateTime, formatXof, shortId } from "@/lib/utils";
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

/**
 * Date du jour (moins N jours) en heure LOCALE.
 *
 * `toISOString()` bascule en UTC : entre minuit et 1 h au Bénin (UTC+1), il renvoyait
 * la VEILLE de ce que le vendeur lit sur sa montre.
 */
const isoDay = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Convertit « AAAA-MM-JJ » + une heure locale en instant UTC (ISO avec « Z »).
 *
 * Sans cela on envoyait « 2026-08-03T00:00:00 » sans fuseau ; le serveur fait
 * `SpecifyKind(..., Utc)` et prenait donc l'heure murale pour de l'UTC. Au Bénin
 * (UTC+1), la fenêtre réellement interrogée était décalée d'une heure : les écritures
 * du premier jour entre 00 h et 01 h manquaient, et celles du lendemain de la fin de
 * période s'y ajoutaient — affichées, après reconversion locale, à une date HORS de
 * la période demandée.
 */
const localBound = (day: string, endOfDay: boolean): string => {
  const [y, m, d] = day.split("-").map(Number);
  return endOfDay
    ? new Date(y, m - 1, d, 23, 59, 59, 999).toISOString()
    : new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
};

export default function FinancePage() {
  // Période appliquée séparée de la saisie : on ne relance pas une requête à chaque
  // frappe dans un champ date.
  const [fromInput, setFromInput] = useState(isoDay(30));
  const [toInput, setToInput] = useState(isoDay(0));
  const [period, setPeriod] = useState({ from: isoDay(30), to: isoDay(0) });

  // Le serveur compare des INSTANTS (`from` à 00:00:00 contre `to` à 23:59:59), pas
  // des dates nues. Comparer « Du » et « Au » tels quels refusait une période d'un seul
  // jour — « le relevé d'aujourd'hui » était donc impossible à demander.
  const invalidPeriod = period.to < period.from;

  const statement = useQuery({
    queryKey: ["seller-statement", period.from, period.to],
    queryFn: () =>
      bff<SellerStatement>(
        `/seller/finance/statement?from=${encodeURIComponent(localBound(period.from, false))}` +
          `&to=${encodeURIComponent(localBound(period.to, true))}`,
      ),
    enabled: !invalidPeriod,
  });

  const payouts = useQuery({
    queryKey: ["seller-payouts"],
    queryFn: () => bff<SellerPayout[]>("/seller/finance/payouts"),
  });

  const s = statement.data;

  // ───────────────────────────────────────────────────────────────────────────────
  // LE NET N'EST PAS RENVOYÉ PAR L'API : il se calcule à partir des quatre agrégats.
  //
  // Ce sont des entiers XOF fournis par le serveur, pas une reconstitution du barème.
  // Aucun `?? 0` : si un champ manquait, un zéro silencieux ferait apparaître un net
  // ÉGAL au brut — en gras et en vert. On préfère alors ne rien afficher.
  // ───────────────────────────────────────────────────────────────────────────────
  const net = useMemo(() => {
    if (!s) return null;
    const parts = [s.grossSalesXof, s.commissionXof, s.providerFeeXof, s.refundsXof];
    if (parts.some((v) => typeof v !== "number")) return null;
    return s.grossSalesXof - s.commissionXof - s.providerFeeXof - s.refundsXof;
  }, [s]);

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
        Le <strong>net</strong> est ce qui vous revient : ventes brutes moins la commission de la
        plateforme, les frais du prestataire de paiement et les remboursements de la période. Il ne
        correspond pas forcément à ce qui a déjà été versé — voir les versements plus bas.
      </PageNote>

      <QueryError of={[statement, payouts]} />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="from">Du</Label>
            <Input id="from" type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">Au</Label>
            <Input id="to" type="date" value={toInput} onChange={(e) => setToInput(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => setPeriod({ from: fromInput, to: toInput })}>
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
          {toInput < fromInput && (
            <p className="w-full text-xs text-destructive">
              La date de fin ne peut pas précéder la date de début.
            </p>
          )}
        </CardContent>
      </Card>

      {invalidPeriod ? null : statement.isError ? (
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
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Ventes brutes" value={num(s?.grossSalesXof)} loading={statement.isLoading} />
            <Metric label="Commission plateforme" value={negate(s?.commissionXof)} loading={statement.isLoading} />
            <Metric label="Frais de paiement" value={negate(s?.providerFeeXof)} loading={statement.isLoading} />
            <Metric label="Remboursements" value={negate(s?.refundsXof)} loading={statement.isLoading} />
          </div>

          <Card className="mb-6">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Net de la période
                </div>
                <div className="mt-1 text-3xl font-semibold tabular-nums text-primary">
                  {statement.isLoading ? "…" : net === null ? "—" : formatXof(net)}
                </div>
              </div>
              {s && (
                <p className="max-w-md text-xs text-muted-foreground">
                  {formatXof(s.grossSalesXof)} − {formatXof(s.commissionXof)} −{" "}
                  {formatXof(s.providerFeeXof)} − {formatXof(s.refundsXof)}. Le détail de chaque
                  écriture est ci-dessous.
                </p>
              )}
            </CardContent>
          </Card>

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
