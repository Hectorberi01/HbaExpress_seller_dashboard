"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
import type { SellerShop, SellerWallet, WalletTransaction, Withdrawal } from "@/types/seller";
import { payoutBlockReason } from "@/lib/payout";
import { ChartFrame } from "@/components/charts/chart-frame";
import { SerieTemporelle } from "@/components/charts/charts";
import { PeriodePresets } from "@/components/charts/period-presets";
import {
  agregeParJour,
  borneLocale,
  formatJourCourt,
  formatJourLong,
  jourLocal,
} from "@/lib/series";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Banknote, Clock, Loader2, Wallet } from "lucide-react";

/** Statuts pour lesquels les fonds sont retenus mais pas encore versés. */
const IN_FLIGHT = new Set(["requested", "pending", "processing"]);

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * « FONDS RETENUS » ET « NOUVELLE DEMANDE INTERDITE » NE SONT PAS LE MÊME ENSEMBLE.
 *
 * Le verrou du serveur ne connaît que deux statuts : `SellerWalletEndpoints` refuse une
 * seconde demande quand il en existe une en `Requested` ou `Pending`. `Processing` n'y
 * figure pas, et ce n'est pas un oubli : c'est l'état « versement demandé au PSP, issue
 * non confirmée », qui couvre les délais d'arbitrage manuel après un timeout — il peut
 * durer.
 *
 * CONFONDRE LES DEUX ENFERMAIT LE VENDEUR HORS DE SON ARGENT. Une demande coincée en
 * `Processing` retient ses propres fonds (le solde disponible les a déjà quittés) mais
 * n'empêche nullement d'en demander un autre sur le reste. Bloquer le bouton dans cet
 * état rendait le reste du solde inaccessible, sans recours ni explication, pendant
 * tout le temps de l'arbitrage.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
const BLOQUE_UNE_NOUVELLE_DEMANDE = new Set(["requested", "pending"]);

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

  // ═══════════════════════════════════════════════════════════════════════════════
  // LA COURBE A SA PROPRE REQUÊTE, ET SURTOUT SA PROPRE PREUVE DE COMPLÉTUDE.
  //
  // `/seller/wallet/transactions` est TRONQUÉE : le dépôt plafonne à 200 lignes
  // (`WalletRepositories.MaxPageSize`), les plus récentes d'abord. Agréger cette
  // liste par jour aurait produit une courbe qui s'arrête net au 200ᵉ mouvement, sans
  // que rien ne le dise — le vendeur aurait lu « plus rien n'est entré depuis le 12 »
  // là où la vérité est « la console n'a pas regardé plus loin ».
  //
  // Le contrôle de complétude est EXACT, pas heuristique : la liste étant triée du
  // plus récent au plus ancien, la période est entièrement couverte si et seulement
  // si le mouvement le PLUS ANCIEN reçu précède le début de la période — ou si on a
  // reçu moins de lignes que le plafond, preuve qu'il n'y en avait pas d'autres.
  //
  // Quand ce n'est pas le cas, on n'affiche PAS de courbe partielle. Un graphe faux
  // sur un écran d'argent est le pire de tous.
  // ═══════════════════════════════════════════════════════════════════════════════
  const [joursMouvements, setJoursMouvements] = useState(30);
  const duMvt = jourLocal(joursMouvements - 1);
  const auMvt = jourLocal(0);

  const PLAFOND_MOUVEMENTS = 200;
  const txsSerie = useQuery({
    // ═══════════════════════════════════════════════════════════════════════════
    // LA CLÉ EST PRÉFIXÉE PAR CELLE DU TABLEAU, ET C'EST CE QUI LA FAIT INVALIDER.
    //
    // Première rédaction : `["seller-wallet-tx-series"]`. React Query compare les
    // clés ÉLÉMENT PAR ÉLÉMENT, pas par préfixe de chaîne : « seller-wallet-tx » et
    // « seller-wallet-tx-series » sont deux chaînes différentes, donc deux entrées
    // sans aucun lien. Après un retrait, `invalidateQueries(["seller-wallet-tx"])`
    // rafraîchissait les soldes et le tableau des mouvements, et laissait la courbe
    // — posée quinze centimètres plus haut, avec `staleTime` de cinq minutes —
    // afficher un grand livre d'avant l'opération. Deux lectures contradictoires du
    // même argent sur le même écran.
    //
    // En faisant de « serie » un SEGMENT, la clé du tableau devient un préfixe réel
    // de celle-ci : toutes les invalidations existantes l'atteignent, y compris le
    // bouton « Réessayer » plus bas, sans qu'il faille penser à les mettre à jour.
    // ═══════════════════════════════════════════════════════════════════════════
    queryKey: ["seller-wallet-tx", "serie"],
    queryFn: () =>
      bff<WalletTransaction[]>(`/seller/wallet/transactions?take=${PLAFOND_MOUVEMENTS}`),
    staleTime: 5 * 60 * 1000,
  });

  const mouvements = useMemo(() => {
    const liste = txsSerie.data;
    if (!liste) return { points: [], complet: true };

    const debutPeriode = new Date(borneLocale(duMvt, false)).getTime();
    const plusAncien = liste.length === 0 ? null : liste[liste.length - 1].createdAtUtc;
    const complet =
      liste.length < PLAFOND_MOUVEMENTS ||
      (plusAncien !== null && new Date(plusAncien).getTime() <= debutPeriode);

    const dansLaPeriode = liste.filter((t) => {
      const ts = new Date(t.createdAtUtc).getTime();
      return ts >= debutPeriode && ts <= new Date(borneLocale(auMvt, true)).getTime();
    });

    const points = agregeParJour(
      dansLaPeriode,
      (t) => t.createdAtUtc,
      (t) => {
        const credit = (t.direction ?? "").toLowerCase() === "credit";
        return {
          entrees: credit ? t.amount : 0,
          sorties: credit ? 0 : t.amount,
        };
      },
      duMvt,
      auMvt,
      ["entrees", "sorties"],
    );

    return { points, complet };
  }, [txsSerie.data, duMvt, auMvt]);

  // ───────────────────────────────────────────────────────────────────────────────
  // CET ÉCRAN IGNORAIT TOUT DU COMPTE DE VERSEMENT, ET C'EST LUI QUI DEMANDE LE
  // RETRAIT.
  //
  // `RequestWithdrawalCommandHandler` refuse la demande AVANT toute écriture quand le
  // compte est absent, vide, ou d'un canal non reversable. Le bouton, lui, n'était
  // désactivé que pendant le chargement du solde : le vendeur ouvrait le dialogue,
  // saisissait un montant, confirmait, et lisait « La demande de retrait n'a pas pu
  // être enregistrée » — sans jamais apprendre que la cause était un compte manquant,
  // information que l'écran « Ma boutique » possède et affiche.
  //
  // MÊME CLÉ ET MÊME REQUÊTE QUE LE BANDEAU KYB (`["seller-shop"]`), qui est monté sur
  // toutes les pages : l'entrée de cache est partagée, pas dupliquée.
  //
  // LE `staleTime` EST RECOPIÉ DE LUI, ET CE N'EST PAS DÉCORATIF. Il se règle par
  // OBSERVATEUR, pas par clé : sans lui, ce nouvel observateur héritait du défaut
  // global de 30 s et redemandait `/seller/shop` à chaque arrivée sur le Portefeuille,
  // alors que le bandeau, lui, s'en contente pour cinq minutes. Un compte de versement
  // ne change pas trois fois par heure.
  // ───────────────────────────────────────────────────────────────────────────────
  const shop = useQuery({
    queryKey: ["seller-shop"],
    queryFn: () => bff<SellerShop>("/seller/shop"),
    staleTime: 5 * 60 * 1000,
  });

  /** `undefined` tant que la boutique charge : ni « possible », ni « impossible ». */
  const blocage = payoutBlockReason(shop.data);

  const w = wallet.data;
  const available = w?.availableBalance ?? 0;

  /** Une demande dont les fonds sont retenus — information affichée au vendeur. */
  const pendingWithdrawal = useMemo(
    () => (withdrawals.data ?? []).find((x) => IN_FLIGHT.has(x.status?.toLowerCase() ?? "")),
    [withdrawals.data],
  );

  /** Une demande qui INTERDIT la suivante. Sous-ensemble strict de la précédente. */
  const demandeBloquante = useMemo(
    () =>
      (withdrawals.data ?? []).find((x) =>
        BLOQUE_UNE_NOUVELLE_DEMANDE.has(x.status?.toLowerCase() ?? ""),
      ),
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
        {/* ═══════════════════════════════════════════════════════════════════════
            LE BOUTON PORTE MAINTENANT SA RAISON D'ÊTRE INERTE.
            Un bouton désactivé sans motif est une impasse muette : le vendeur clique,
            rien ne se passe, et il ne sait pas s'il doit attendre ou agir. `title` le
            dit au survol, la carte ci-dessous le dit en toutes lettres.
            ON N'ATTEND PAS `shop` POUR AUTORISER : tant que la boutique charge
            (`blocage === undefined`), le bouton reste actif. Le serveur reste
            l'autorité, et bloquer sur une requête lente serait le remplacer par une
            panne réseau. ═══════════════════════════════════════════════════════════ */}
        <Button
          onClick={() => setWithdrawOpen(true)}
          disabled={
            wallet.isLoading ||
            wallet.isError ||
            blocage != null ||
            available <= 0 ||
            !!demandeBloquante
          }
          title={
            blocage ??
            (available <= 0
              ? "Votre solde disponible est nul : il n'y a rien à retirer."
              : demandeBloquante
                ? "Une demande est déjà en cours. Vous pourrez en créer une nouvelle une fois celle-ci traitée."
                : undefined)
          }
        >
          <Banknote className="size-4" /> Demander un retrait
        </Button>
      </header>

      {/* « UNE SEULE DEMANDE À LA FOIS » ÉTAIT FAUX, ET LE RESTE DE CET ÉCRAN LE DIT
          MAINTENANT. Le serveur ne refuse une nouvelle demande que tant que la
          précédente est « demandée » ou « en attente » ; une fois partie chez
          l'opérateur, elle ne bloque plus rien. */}
      <PageNote>
        Un retrait <strong>retient immédiatement les fonds</strong> : ils quittent votre solde
        principal dès la demande, avant même la validation. Tant qu&apos;une demande attend son
        traitement, vous ne pouvez pas en créer une seconde — une fois partie chez
        l&apos;opérateur, le reste de votre solde redevient disponible.
      </PageNote>

      <QueryError of={[wallet, txs, withdrawals, shop]} />

      {/* LE MOTIF EN CLAIR, ET LE CHEMIN POUR LE LEVER. Le survol d'un bouton n'existe
          pas sur un téléphone, et c'est là que la moitié des vendeurs consulte leur
          portefeuille. La carte porte donc la même information, avec le lien. */}
      {blocage != null && (
        <Card className="mb-4 p-4 text-sm">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">Retrait indisponible</p>
              <p className="text-muted-foreground">{blocage}</p>
              {shop.data?.status?.toLowerCase() !== "suspended" && (
                <Link href="/shop">
                  <Button size="sm" variant="outline" className="mt-3">
                    Ouvrir Ma boutique
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </Card>
      )}

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
              ({statusLabel(pendingWithdrawal.status, "withdrawal").toLowerCase()}).{" "}
              {/* « Attendez » n'est vrai que pour une demande que le serveur compte
                  comme bloquante. Pour les autres, ces fonds-là ont déjà quitté le
                  solde disponible et rien n'empêche de demander un retrait sur le
                  reste.
                  ON NE DIT PAS « le versement est parti » : `Processing` couvre AUSSI
                  les issues indéterminées — appel au prestataire interrompu, délai
                  dépassé — où rien n'est parti et où un arbitrage humain tranchera.
                  Le serveur emploie lui-même « en cours de vérification » dans ce cas. */}
              {demandeBloquante
                ? "Vous pourrez en créer une nouvelle une fois celle-ci traitée."
                : "Elle est chez l'opérateur et ne bloque plus rien : vous pouvez demander un retrait sur le reste de votre solde disponible."}
            </p>
          </div>
        </Card>
      )}

      <PeriodePresets jours={joursMouvements} onChange={setJoursMouvements} className="mb-2" />

      <div className="mb-6">
        <ChartFrame
          titre="Entrées et sorties du portefeuille"
          description="Ce qui est entré et ce qui est sorti, jour par jour."
          chargement={txsSerie.isLoading}
          erreur={
            txsSerie.isError
              ? (txsSerie.error as Error).message
              : mouvements.complet
                ? null
                : "Votre historique dépasse ce que cette liste peut rapporter sur la période " +
                  "demandée (200 mouvements). Une courbe tracée dessus s'arrêterait net sans " +
                  "le dire. Choisissez une période plus courte."
          }
          rafraichit={txsSerie.isFetching && !txsSerie.isLoading}
          colonnes={["Jour", "Entrées", "Sorties"]}
          lignes={mouvements.points.map((p) => [
            formatJourLong(p.date),
            p.entrees === 0 ? "—" : formatXof(p.entrees),
            p.sorties === 0 ? "—" : formatXof(p.sorties),
          ])}
          note={
            <>
              Les <strong>entrées</strong> sont vos gains libérés à la livraison ; les{" "}
              <strong>sorties</strong>, vos retraits et les reprises sur remboursement. Les
              soldes affichés plus haut sont l&apos;état d&apos;aujourd&apos;hui, pas le cumul de
              cette courbe.
            </>
          }
        >
          <SerieTemporelle
            donnees={mouvements.points}
            cleX="date"
            series={[
              { cle: "entrees", libelle: "Entrées" },
              { cle: "sorties", libelle: "Sorties" },
            ]}
            formatX={formatJourCourt}
            formatValeur={formatXof}
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
            <Button onClick={() => withdraw.mutate()} disabled={!amountValid || withdraw.isPending || !!demandeBloquante}>
              {withdraw.isPending && <Loader2 className="size-4 animate-spin" />}
              Confirmer le retrait de {formatXof(value)}
            </Button>
          </>
        }
      >
        {/* PAS DU CODE MORT, MALGRÉ LES APPARENCES, et le chemin qui y mène est banal :
            le `disabled` du bouton d'en-tête teste `wallet.isLoading` mais PAS
            `withdrawals.isLoading`. Tant que la liste des retraits n'a pas répondu,
            `demandeBloquante` vaut `undefined` et le bouton reste actif — y compris
            pour un vendeur qui a bel et bien une demande en cours. Sur réseau lent, il
            ouvre donc ce dialogue, et c'est ici qu'il l'apprend. On ne bloque pas sur
            le chargement : attendre deux requêtes pour ouvrir un dialogue coûterait à
            tout le monde ce que cette branche règle pour quelques-uns. */}
        {demandeBloquante ? (
          <p className="text-sm text-muted-foreground">
            Une demande de {formatXof(demandeBloquante.amount)} est déjà en cours de traitement.
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
