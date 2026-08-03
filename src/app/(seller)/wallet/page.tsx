"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { formatDateTime, formatXof, shortId } from "@/lib/utils";
import { statusLabel, withdrawalTone } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import type { SellerWallet, WalletTransaction, Withdrawal } from "@/types/seller";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Banknote, Clock, Loader2, Wallet } from "lucide-react";

/** Statuts pour lesquels les fonds sont retenus mais pas encore versés. */
const IN_FLIGHT = new Set(["requested", "pending", "processing"]);

export default function WalletPage() {
  const qc = useQueryClient();
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [amount, setAmount] = useState("");

  const wallet = useQuery({ queryKey: ["seller-wallet"], queryFn: () => bff<SellerWallet>("/seller/wallet") });
  const txs = useQuery({
    queryKey: ["seller-wallet-tx"],
    queryFn: () => bff<WalletTransaction[]>("/seller/wallet/transactions?take=50"),
  });
  const withdrawals = useQuery({
    queryKey: ["seller-withdrawals"],
    queryFn: () => bff<Withdrawal[]>("/seller/wallet/withdrawals"),
  });

  const w = wallet.data;
  const available = w?.availableBalance ?? 0;

  const pendingWithdrawal = useMemo(
    () => (withdrawals.data ?? []).find((x) => IN_FLIGHT.has(x.status?.toLowerCase() ?? "")),
    [withdrawals.data],
  );

  // ───────────────────────────────────────────────────────────────────────────────
  // MONTANT EN ENTIERS, PLAFONNÉ AU SOLDE DISPONIBLE.
  //
  // Le XOF n'a pas de subdivision : accepter « 1500,75 » n'a aucun sens et créait,
  // sur l'app mobile, un écart entre le montant confirmé à l'écran (arrondi) et celui
  // réellement envoyé au serveur — constat §3.2 de l'audit. On n'accepte donc que des
  // chiffres, et on refuse au-delà du solde plutôt que de laisser le serveur trancher
  // après coup.
  // ───────────────────────────────────────────────────────────────────────────────
  const parsed = Number.parseInt(amount.replace(/\D/g, ""), 10);
  const value = Number.isNaN(parsed) ? 0 : parsed;
  const amountValid = value > 0 && value <= available;

  const withdraw = useMutation({
    mutationFn: () => bff("/seller/wallet/withdraw", { method: "POST", body: JSON.stringify({ amount: value }) }),
    onSuccess: () => {
      setWithdrawOpen(false);
      setAmount("");
      qc.invalidateQueries({ queryKey: ["seller-wallet"] });
      qc.invalidateQueries({ queryKey: ["seller-withdrawals"] });
      qc.invalidateQueries({ queryKey: ["seller-wallet-tx"] });
    },
    meta: {
      successMessage: "Demande de retrait enregistrée. Elle part en validation.",
      errorMessage: "La demande de retrait n'a pas pu être enregistrée.",
    },
  });

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Portefeuille</h1>
          <p className="text-sm text-muted-foreground">Soldes, retraits et mouvements de votre boutique.</p>
        </div>
        <Button onClick={() => setWithdrawOpen(true)} disabled={wallet.isLoading || wallet.isError}>
          <Banknote className="size-4" /> Demander un retrait
        </Button>
      </header>

      <PageNote>
        Un retrait <strong>retient immédiatement les fonds</strong> : ils quittent votre solde
        principal dès la demande, avant même la validation. Une seule demande peut être en cours à
        la fois.
      </PageNote>

      <QueryError of={[wallet, txs, withdrawals]} />

      {/* Soldes. En cas d'erreur on n'affiche AUCUN chiffre : un « 0 F CFA » issu d'une
          panne réseau est indiscernable d'un compte vide, et c'est sur cette lecture
          qu'un vendeur décide de relancer ses ventes ou d'appeler le support. */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {wallet.isError ? (
          <Card className="sm:col-span-3">
            <CardContent className="flex items-start gap-2.5 p-5 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium">Soldes indisponibles.</p>
                <p className="text-muted-foreground">
                  Vos soldes n&apos;ont pas pu être chargés — ils ne sont pas à zéro, ils sont
                  inconnus. Réessayez avant toute demande de retrait.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => qc.invalidateQueries({ queryKey: ["seller-wallet"] })}
                >
                  Réessayer
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <BalanceCard
              label="Solde principal"
              value={wallet.isLoading ? null : available}
              hint="Retirable"
              icon={Wallet}
              accent
            />
            <BalanceCard
              label="Gains à venir"
              value={wallet.isLoading ? null : (w?.pendingBalance ?? 0)}
              hint="Commandes non encore réglées"
              icon={Clock}
            />
            <BalanceCard
              label="Retraits en cours"
              value={wallet.isLoading ? null : (w?.pendingWithdrawal ?? 0)}
              hint="Fonds déjà retenus"
              icon={ArrowUpRight}
            />
          </>
        )}
      </div>

      {pendingWithdrawal && (
        <Card className="mb-6 p-4 text-sm">
          <div className="flex items-start gap-2.5">
            <Clock className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <p>
              Une demande de <strong>{formatXof(pendingWithdrawal.amount)}</strong> est en cours
              ({statusLabel(pendingWithdrawal.status, "withdrawal").toLowerCase()}). Vous pourrez en
              créer une nouvelle une fois celle-ci traitée.
            </p>
          </div>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Demandes de retrait</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {withdrawals.isLoading ? (
              <p className="p-5 text-sm text-muted-foreground">Chargement…</p>
            ) : withdrawals.isError ? (
              <div className="p-5 text-sm">
                <p className="text-muted-foreground">
                  Les demandes de retrait n&apos;ont pas pu être chargées. Cette liste est
                  incomplète, pas vide.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => qc.invalidateQueries({ queryKey: ["seller-withdrawals"] })}
                >
                  Réessayer
                </Button>
              </div>
            ) : (withdrawals.data ?? []).length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">Aucune demande de retrait.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Référence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(withdrawals.data ?? []).map((x) => (
                    <TableRow key={x.id}>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(x.createdAtUtc)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatXof(x.amount)}</TableCell>
                      <TableCell>
                        <Badge variant={withdrawalTone(x.status)}>{statusLabel(x.status, "withdrawal")}</Badge>
                        {x.failureReason && (
                          <div className="mt-0.5 text-xs text-destructive">{x.failureReason}</div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {x.providerRef ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Mouvements récents</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {txs.isLoading ? (
              <p className="p-5 text-sm text-muted-foreground">Chargement…</p>
            ) : txs.isError ? (
              // ───────────────────────────────────────────────────────────────────
              // ON NE FAIT PAS DISPARAÎTRE LA SECTION.
              //
              // L'app mobile vendeur rendait `SizedBox.shrink()` en cas d'erreur ici :
              // le grand livre s'évaporait, et le vendeur en concluait qu'il n'avait
              // aucun mouvement. Une erreur se dit ; elle ne se masque pas.
              // ───────────────────────────────────────────────────────────────────
              <div className="p-5 text-sm">
                <p className="text-muted-foreground">
                  Les mouvements n&apos;ont pas pu être chargés. Cette liste est incomplète, pas vide.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => qc.invalidateQueries({ queryKey: ["seller-wallet-tx"] })}
                >
                  Réessayer
                </Button>
              </div>
            ) : (txs.data ?? []).length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">Aucun mouvement enregistré.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Motif</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(txs.data ?? []).map((t) => {
                    const credit = (t.direction ?? "").toLowerCase() === "credit";
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(t.createdAtUtc)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {/* `reason` est du texte libre côté serveur, pas une énumération :
                              on l'affiche tel quel plutôt que de tenter une traduction
                              qui échouerait sur la moitié des valeurs. */}
                          {t.reason || "—"}
                          <div className="text-xs text-muted-foreground">
                            {statusLabel(t.account, "walletAccount")}
                            {t.referenceId ? ` · ${shortId(t.referenceId)}` : ""}
                          </div>
                        </TableCell>
                        <TableCell
                          className={`text-right font-medium tabular-nums ${credit ? "text-emerald-600" : "text-destructive"}`}
                        >
                          <span className="inline-flex items-center gap-1">
                            {credit ? (
                              <ArrowDownLeft className="size-3.5" />
                            ) : (
                              <ArrowUpRight className="size-3.5" />
                            )}
                            {credit ? "+" : "−"}
                            {formatXof(Math.abs(t.amount))}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Retrait : saisie et récapitulatif dans le MÊME dialogue — le montant à
          confirmer est écrit sur le bouton, et la phrase du bas dit ce qui se passe à
          la validation. Le tableau de bord Blazor, lui, engageait la totalité du solde
          en deux clics, sans validation de montant ni confirmation. */}
      <Dialog
        open={withdrawOpen}
        onClose={() => !withdraw.isPending && setWithdrawOpen(false)}
        title="Demander un retrait"
        description={`Solde disponible : ${formatXof(available)}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdrawOpen(false)} disabled={withdraw.isPending}>
              Annuler
            </Button>
            <Button onClick={() => withdraw.mutate()} disabled={!amountValid || withdraw.isPending || !!pendingWithdrawal}>
              {withdraw.isPending && <Loader2 className="size-4 animate-spin" />}
              Confirmer le retrait de {formatXof(value)}
            </Button>
          </>
        }
      >
        {pendingWithdrawal ? (
          <p className="text-sm text-muted-foreground">
            Une demande de {formatXof(pendingWithdrawal.amount)} est déjà en cours de traitement.
            Attendez son issue avant d&apos;en créer une nouvelle.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="amount">Montant (F CFA)</Label>
              <Input
                id="amount"
                inputMode="numeric"
                value={amount}
                // Le filtrage a lieu à la saisie : le champ ne peut pas contenir autre
                // chose que ce qui sera envoyé. Pas d'écart possible entre les deux.
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                autoFocus
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">
                Montant entier, au plus {formatXof(available)}. Le franc CFA n&apos;a pas de centimes.
              </p>
              {value > available && (
                <p className="text-xs text-destructive">
                  Ce montant dépasse votre solde disponible de {formatXof(value - available)}.
                </p>
              )}
            </div>
            <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              À la confirmation, {formatXof(value)} quittent immédiatement votre solde principal et
              sont retenus jusqu&apos;au versement.
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function BalanceCard({
  label,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  label: string;
  /** `null` = en cours de chargement : on n'affiche pas de zéro provisoire. */
  value: number | null;
  hint: string;
  icon: typeof Wallet;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
            <div
              className={`mt-1 truncate text-2xl font-semibold tabular-nums ${accent ? "text-primary" : ""}`}
            >
              {value === null ? "…" : formatXof(value)}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
          </div>
          <div className="nm-raised-sm flex size-10 shrink-0 items-center justify-center rounded-xl bg-card text-primary">
            <Icon className="size-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
