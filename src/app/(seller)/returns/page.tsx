"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { formatDateTime, formatMoney, shortId } from "@/lib/utils";
import { returnTone, statusLabel } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import type { SellerReturn } from "@/types/seller";
import { AlertTriangle, CheckCircle2, Loader2, PackageCheck, Truck, Undo2, XCircle } from "lucide-react";

/** Filtres de la barre d'onglets : regroupent le cycle en étapes lisibles. */
const TABS = [
  { key: "todo", label: "À traiter" },
  { key: "progress", label: "En cours" },
  { key: "done", label: "Clôturés" },
  { key: "all", label: "Tous" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function inTab(status: string, tab: TabKey): boolean {
  const s = status?.toLowerCase() ?? "";
  if (tab === "all") return true;
  // « À traiter » = ce qui attend une décision ou un geste du vendeur.
  if (tab === "todo") return s === "requested" || s === "received";
  if (tab === "progress") return s === "approved" || s === "refundpending";
  return s === "refunded" || s === "rejected";
}

export default function ReturnsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("todo");
  const [detailId, setDetailId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["seller-returns"],
    queryFn: () => bff<SellerReturn[]>("/seller/returns"),
  });

  /**
   * Le retour affiché est TOUJOURS redérivé de la liste fraîche, jamais copié dans le
   * state. Après « Marquer reçu », le dialogue doit proposer le remboursement sans
   * qu'on le rouvre : une copie figée continuerait d'afficher l'étape précédente, et
   * l'opérateur rejouerait la même action.
   */
  const detail = useMemo(
    () => (q.data ?? []).find((r) => r.id === detailId) ?? null,
    [q.data, detailId],
  );

  const rows = useMemo(
    () =>
      (q.data ?? [])
        .filter((r) => inTab(r.status, tab))
        .sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc)),
    [q.data, tab],
  );

  const counts = useMemo(() => {
    const all = q.data ?? [];
    return {
      todo: all.filter((r) => inTab(r.status, "todo")).length,
      progress: all.filter((r) => inTab(r.status, "progress")).length,
      done: all.filter((r) => inTab(r.status, "done")).length,
      all: all.length,
    } as Record<TabKey, number>;
  }, [q.data]);

  // On RENVOIE la promesse : `onSuccess` l'attend, donc `isPending` ne retombe
  // qu'une fois les données fraîches arrivées. Sans cela, le dialogue reproposait
  // pendant un instant l'action qu'on venait d'exécuter — le serveur la refuse en 409,
  // mais l'opérateur voyait un toast de succès suivi d'un toast d'erreur.
  const invalidate = () => qc.invalidateQueries({ queryKey: ["seller-returns"] });

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Retours</h1>
        <p className="text-sm text-muted-foreground">
          {q.isLoading ? "Chargement…" : `${rows.length} retour(s) dans cette vue`}
        </p>
      </header>

      {/* ═══════════════════════════════════════════════════════════════════════════
          CE BANDEAU AFFIRMAIT LE CONTRAIRE DE CE QUE FAIT LE SERVEUR.

          Il disait : « Valider un remboursement ne déclenche aucun versement : il part
          dans la file d'un administrateur. » Aucun administrateur n'intervient, et
          l'argent bouge dans la seconde. Chaîne vérifiée maillon par maillon :

            ReturnRequest.ApproveRefund
              → ReturnRefundApprovedDomainEvent
              → CreditCustomerWalletOnReturnRefundApprovedHandler   crédite l'acheteur
              → ConfirmRefundOnCustomerWalletCreditedHandler        statut « Refunded »
              → ReverseEarningsOnReturnRefundedHandler:123          DÉBITE LE VENDEUR

          Le back-office le dit déjà noir sur blanc (ReturnsEndpoints.cs:25-31) :
          « Settlement transforme [cet événement] en CRÉDIT RÉEL de la cagnotte client ».

          C'est la pire forme d'erreur d'interface : le vendeur décide sur la phrase,
          et la phrase lui promettait qu'il n'engageait rien.
          ═══════════════════════════════════════════════════════════════════════════ */}
      <PageNote>
        Cycle d&apos;un retour : <strong>approuver</strong> ou refuser, puis marquer{" "}
        <strong>reçu</strong> à réception du colis, et enfin valider le{" "}
        <strong>montant du remboursement</strong>. Cette dernière étape est{" "}
        <strong>immédiate et sans retour</strong> : l&apos;acheteur est crédité sur sa
        cagnotte, et votre part nette de la vente vous est reprise. Aucune validation
        d&apos;administrateur ne s&apos;intercale.
      </PageNote>

      <QueryError of={q} />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button
            key={t.key}
            size="sm"
            variant={tab === t.key ? "default" : "outline"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {!q.isLoading && !q.isError && (
              <span className={tab === t.key ? "opacity-80" : "text-muted-foreground"}>
                {counts[t.key]}
              </span>
            )}
          </Button>
        ))}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Retour</TableHead>
              <TableHead>Commande</TableHead>
              <TableHead>Motif</TableHead>
              <TableHead>Demandé le</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Montant</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  Chargement…
                </TableCell>
              </TableRow>
            ) : q.isError ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  Liste non chargée — voir le message ci-dessus.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  {tab === "todo"
                    ? "Aucun retour n'attend d'action de votre part."
                    : "Aucun retour dans cette vue."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={r.id}
                  // Une ligne cliquable doit l'être aussi au clavier : sans `tabIndex`
                  // ni gestionnaire de touche, l'écran est inutilisable sans souris.
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  role="button"
                  tabIndex={0}
                  aria-label={`Ouvrir le retour RET-${shortId(r.id).toUpperCase()}`}
                  onClick={() => setDetailId(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDetailId(r.id);
                    }
                  }}
                >
                  <TableCell className="font-mono text-xs">RET-{shortId(r.id).toUpperCase()}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    CMD-{shortId(r.orderId).toUpperCase()}
                  </TableCell>
                  <TableCell className="text-sm">{statusLabel(r.reason, "returnReason")}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(r.createdAtUtc)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={returnTone(r.status)}>{statusLabel(r.status, "returnStatus")}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.refundAmount != null ? (
                      <span className="font-medium">{formatMoney(r.refundAmount, r.currency)}</span>
                    ) : r.refundableAmount > 0 ? (
                      <span className="text-muted-foreground">jusqu&apos;à {formatMoney(r.refundableAmount, r.currency)}</span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <ReturnDetailDialog
        item={detail}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        onDone={invalidate}
      />
    </div>
  );
}

/** Dialogue de détail : porte les cinq transitions du cycle. */
function ReturnDetailDialog({
  item,
  open,
  onClose,
  onDone,
}: {
  item: SellerReturn | null;
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const [rejectReason, setRejectReason] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [refund, setRefund] = useState("");
  const [pane, setPane] = useState<"none" | "approve" | "received" | "reject" | "tracking" | "refund">("none");

  const status = item?.status?.toLowerCase() ?? "";
  const id = item?.id;

  function reset() {
    setPane("none");
    setRejectReason("");
    setCarrier("");
    setTracking("");
    setRefund("");
    // Le volet se referme : la prochaine ouverture repropose le plafond, puisque la
    // saisie précédente a été effacée avec lui.
    refundPrerempli.current = null;
  }

  const post = (path: string, body?: unknown) =>
    bff(`/seller/returns/${id}/${path}`, {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const approve = useMutation({
    mutationFn: () => post("approve"),
    onSuccess: async () => { await onDone(); reset(); },
    // « L'acheteur peut renvoyer l'article » décrit un DROIT, pas un envoi : rien ne
    // le prévient (Approve ne lève aucun événement). On le dit maintenant à la place
    // du vendeur, sinon la phrase se lit comme un accusé d'expédition.
    meta: { successMessage: "Retour approuvé. Indiquez à l'acheteur où renvoyer l'article." },
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // LE MOTIF DU REFUS N'EST TRANSMIS À PERSONNE, ET LE MESSAGE PROMETTAIT L'INVERSE.
  //
  // `ReturnRequest.RejectionReason` est bien écrit en base et borné à 500 caractères
  // (ReturnRequestConfiguration.cs:37), mais il ne figure dans AUCUN contrat :
  // `ReturnRequestSummary` ne le porte pas, aucun mappeur ne le projette, et `Reject`
  // ne lève aucun événement. Ni l'acheteur, ni le vendeur lui-même ne le reliront.
  //
  // On ne promet donc plus une transmission qui n'existe pas. Le champ garde sa valeur
  // — c'est la trace du dossier, celle que le support retrouvera — mais le vendeur qui
  // veut que son client comprenne doit encore le lui écrire.
  // ───────────────────────────────────────────────────────────────────────────────
  const reject = useMutation({
    mutationFn: () => post("reject", { reason: rejectReason.trim() }),
    onSuccess: async () => { await onDone(); reset(); onClose(); },
    meta: { successMessage: "Retour refusé. Le motif est enregistré au dossier." },
  });

  const addTracking = useMutation({
    mutationFn: () => post("tracking", { carrier: carrier.trim(), trackingNumber: tracking.trim() }),
    onSuccess: async () => { await onDone(); reset(); },
    meta: { successMessage: "Suivi enregistré." },
  });

  const received = useMutation({
    mutationFn: () => post("received"),
    onSuccess: async () => { await onDone(); reset(); },
    meta: { successMessage: "Colis marqué comme reçu. Vous pouvez valider le remboursement." },
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // MONTANT DU REMBOURSEMENT : ENTIER, ET BORNÉ PAR LE SERVEUR.
  //
  // `refundableAmount` est le total de la ligne de commande, figé à la création du
  // retour. Le domaine refuse tout montant supérieur — la borne est ici pour l'ANNONCER
  // avant l'envoi, pas pour la remplacer.
  //
  // `refundableAmount === 0` signifie « inconnu » (retours antérieurs à ce champ) : le
  // domaine n'applique alors aucune borne, et l'interface ne doit pas en inventer une,
  // au risque de bloquer un remboursement légitime.
  // ───────────────────────────────────────────────────────────────────────────────
  const cap = item?.refundableAmount ?? 0;
  const hasCap = cap > 0;
  const parsed = Number.parseInt(refund.replace(/\D/g, ""), 10);
  const refundValue = Number.isNaN(parsed) ? 0 : parsed;
  const refundValid = refundValue > 0 && (!hasCap || refundValue <= cap);

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * LE MONTANT DU CAS NOMINAL EST DÉJÀ À L'ÉCRAN. ON LE RECOPIAIT À LA MAIN.
   *
   * Le champ démarrait vide alors que le plafond est affiché trois lignes plus haut
   * dans le même dialogue, rappelé sous le champ, et déjà présent dans la colonne
   * « Montant » de la liste. Or ce plafond EST la valeur attendue dans le cas de loin
   * le plus courant : `ReturnRequest.ApproveRefund` borne le montant à
   * `RefundableAmount`, le total figé de la ligne de commande — c'est-à-dire le
   * remboursement intégral.
   *
   * ON PRÉREMPLIT, ON NE VERROUILLE PAS. Le remboursement partiel reste une décision
   * du vendeur : le champ se modifie, et la borne haute continue de le protéger.
   *
   * PAS DE PRÉREMPLISSAGE SANS PLAFOND CONNU (`refundableAmount` absent sur les
   * retours antérieurs à ce champ) : proposer « 0 » serait un montant, et un montant
   * faux.
   *
   * NI SUR UN PLAFOND NON ENTIER. Le champ est relu en `parseInt` après avoir retiré
   * tout ce qui n'est pas un chiffre : un plafond à 12,45 deviendrait « 1245 », cent
   * fois trop grand — et « 12,40 » donnerait « 124 », dix fois trop, puisque
   * `String(12.4)` ne garde pas le zéro final. Dans les deux cas le montant est
   * rejeté par la borne haute — et le vendeur lirait
   * « ce montant dépasse le total de la ligne » sur un champ que la console vient de
   * remplir toute seule. En franc CFA, qui n'a pas de subdivision, le cas ne se
   * présente pas ; sur une autre devise, mieux vaut ne rien proposer que proposer
   * faux. La vraie correction est de rendre cet écran conscient des décimales, ce
   * qu'il n'est pas encore.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const refundPrerempli = useRef<string | null>(null);

  useEffect(() => {
    if (pane !== "refund" || !hasCap || !id) return;
    if (!Number.isInteger(cap)) return;
    // Une fois par ouverture du volet sur CE retour : rouvrir après avoir effacé le
    // champ ne doit pas remettre le plafond sous les doigts du vendeur.
    if (refundPrerempli.current === id) return;
    refundPrerempli.current = id;
    if (refund.trim().length === 0) setRefund(String(cap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane, hasCap, id, cap]);

  const approveRefund = useMutation({
    mutationFn: () => post("refund", { amount: refundValue }),
    onSuccess: async () => { await onDone(); reset(); },
    meta: {
      successMessage: "Remboursement exécuté : l'acheteur est crédité, votre part nette vous est reprise.",
      errorMessage: "Le remboursement n'a pas pu être validé.",
    },
  });

  const busy =
    approve.isPending || reject.isPending || addTracking.isPending ||
    received.isPending || approveRefund.isPending;

  return (
    <Dialog
      open={open && item !== null}
      onClose={() => { if (!busy) { reset(); onClose(); } }}
      title={item ? `Retour RET-${shortId(item.id).toUpperCase()}` : ""}
    >
      {item && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={returnTone(item.status)}>{statusLabel(item.status, "returnStatus")}</Badge>
            <span className="text-sm text-muted-foreground">
              {statusLabel(item.reason, "returnReason")}
            </span>
            <span className="text-sm text-muted-foreground">
              · {formatDateTime(item.createdAtUtc)}
            </span>
          </div>

          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Commande</dt>
              <dd className="font-mono text-xs">CMD-{shortId(item.orderId).toUpperCase()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Plafond remboursable</dt>
              <dd className="tabular-nums">
                {hasCap ? formatMoney(cap, item.currency) : <span className="text-muted-foreground">non renseigné</span>}
              </dd>
            </div>
            {item.refundAmount != null && (
              <div className="flex justify-between font-medium">
                <dt>Remboursement validé</dt>
                <dd className="tabular-nums">{formatMoney(item.refundAmount, item.currency)}</dd>
              </div>
            )}
            {item.carrier && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Transporteur</dt>
                <dd>
                  {item.carrier}
                  {item.trackingNumber && <span className="ml-1 font-mono text-xs">{item.trackingNumber}</span>}
                </dd>
              </div>
            )}
          </dl>

          {/* ─────────────────────────────────────────────────────────────────────
              « EN ATTENTE DE VERSEMENT » DÉCRIVAIT UNE FILE D'ADMINISTRATEURS QUI
              N'EXISTE PAS. MAIS « AUCUNE INTERVENTION » ÉTAIT FAUX AUSSI.

              Cet état est le temps que l'événement traverse l'outbox : trois sauts à
              cinq secondes de cadence (`OutboxProcessor:74`), donc une quinzaine de
              secondes en marche normale.

              En cas d'échec répété, en revanche, `OutboxRetryPolicy` réessaie dix fois
              avec un délai croissant puis MET EN LETTRE MORTE (`:26, 72-74`). L'état
              devient alors définitif, et seule une reprise administrateur le débloque
              (`/admin/outbox/dead-letters/…/replay`). Écrire « n'attend aucune
              intervention » aurait été remplacer un mensonge par un autre — plus rare,
              mais exactement au moment où le vendeur a besoin de savoir quoi faire.
              ───────────────────────────────────────────────────────────────────── */}
          {status === "refundpending" && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Le remboursement est <strong>engagé</strong> et s&apos;exécute en quelques secondes.
              Rien à faire de votre côté. S&apos;il reste dans cet état au-delà de quelques
              minutes, le traitement a échoué : signalez-le à l&apos;assistance, c&apos;est une
              reprise technique et non une validation en attente.
            </p>
          )}

          {/* ─── Actions, selon l'étape du cycle ───────────────────────────────── */}
          {pane === "none" && (
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              {/* ═══════════════════════════════════════════════════════════════════
                  « APPROUVER » ET « MARQUER LE COLIS REÇU » PARTAIENT AU PREMIER CLIC.

                  « Refuser » avait un volet, ces deux-là non — alors que les trois sont
                  également définitifs, et que l'asymétrie faisait exactement croire
                  l'inverse : un geste qu'on peut faire sans confirmer se lit comme un
                  geste qu'on peut défaire.

                  Vérifié dans ReturnRequest.cs : `Reject` exige `Requested` (:118-122),
                  donc approuver ferme le refus pour de bon ; il n'existe aucune
                  transition qui ramène de `Approved` à `Requested`, ni de `Received` à
                  `Approved`. La machine à états ne va que dans un sens.
                  ═══════════════════════════════════════════════════════════════════ */}
              {status === "requested" && (
                <>
                  <Button size="sm" onClick={() => setPane("approve")} disabled={busy}>
                    <CheckCircle2 className="size-4" /> Approuver
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPane("reject")} disabled={busy}>
                    <XCircle className="size-4" /> Refuser
                  </Button>
                </>
              )}

              {status === "approved" && (
                <>
                  <Button size="sm" onClick={() => setPane("received")} disabled={busy}>
                    <PackageCheck className="size-4" /> Marquer le colis reçu
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPane("tracking")} disabled={busy}>
                    <Truck className="size-4" /> {item.trackingNumber ? "Modifier le suivi" : "Ajouter un suivi"}
                  </Button>
                </>
              )}

              {status === "received" && (
                <>
                  <Button size="sm" onClick={() => setPane("refund")} disabled={busy}>
                    <Undo2 className="size-4" /> Valider le remboursement
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPane("tracking")} disabled={busy}>
                    <Truck className="size-4" /> Modifier le suivi
                  </Button>
                </>
              )}

              {/* ─────────────────────────────────────────────────────────────────
                  AUCUN BOUTON PAR DÉFAUT.

                  L'application mobile retombait INCONDITIONNELLEMENT sur « Valider le
                  remboursement » après deux tests de statut : un statut inattendu
                  proposait donc au vendeur un bouton qui débite son solde. Ici, tout
                  statut hors du cycle d'action n'affiche rien — et le dit.
                  ───────────────────────────────────────────────────────────────── */}
              {/* « Remboursement en attente » n'est PAS un état clôturé : la décision
                  est prise, le versement ne l'est pas. Le dire « clôturé » contredisait
                  le bandeau ambre affiché juste au-dessus, et l'onglet « En cours » où
                  ce retour est rangé. Ces trois endroits doivent raconter la même
                  histoire, sans quoi le vendeur ne sait plus lequel croire. */}
              {/* Cette phrase disait « le versement revient à un administrateur ». Elle
                  décrivait le circuit d'avant l'abonnement de Settlement à
                  `ReturnRefundApprovedDomainEvent`, et elle contredisait mot pour mot le
                  bandeau ambre affiché quarante lignes plus haut sur le MÊME retour.
                  Corriger un endroit et pas l'autre laisse le vendeur arbitrer entre deux
                  versions — ce qui est pire que l'erreur seule. */}
              {status === "refundpending" && (
                <p className="text-sm text-muted-foreground">
                  Le versement est déjà engagé : voir le bandeau ci-dessus.
                </p>
              )}

              {!["requested", "approved", "received", "refundpending"].includes(status) && (
                <p className="text-sm text-muted-foreground">
                  Ce retour est clôturé : aucune action n&apos;est possible.
                </p>
              )}
            </div>
          )}

          {pane === "approve" && (
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-sm">
                Approuver le retour <strong>RET-{shortId(item.id).toUpperCase()}</strong> ?
              </p>
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-medium">SANS RETOUR. Un retour approuvé ne peut plus être refusé.</p>
                <p>
                  Le refus n&apos;est possible que sur une demande <strong>en attente</strong> ; une
                  fois approuvée, le bouton « Refuser » disparaît et rien ne le fait revenir. Si le
                  motif du client vous paraît discutable, c&apos;est maintenant qu&apos;il faut le dire.
                </p>
                <p>
                  Approuver n&apos;engage pas encore votre argent : vous restez libre du montant, et
                  c&apos;est le geste suivant — « Valider le remboursement », après réception du colis
                  — qui débite votre part.
                </p>
                <p>
                  Aucun message n&apos;est envoyé automatiquement à l&apos;acheteur : prévenez-le de
                  l&apos;adresse où renvoyer l&apos;article.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                {/* Ce volet n'a aucun champ : sans `autoFocus`, le bouton qui avait le
                    focus est démonté et le focus retombe sur le document. L'utilisateur
                    au clavier devait retabuler depuis le début de la page, et le lecteur
                    d'écran n'annonçait rien — sur l'écran même où l'on veut qu'il LISE.
                    Le focus va au retrait, jamais à la confirmation : « Entrée » doit
                    annuler, pas valider. */}
                <Button size="sm" variant="ghost" onClick={reset} disabled={busy} autoFocus>
                  Revenir
                </Button>
                <Button size="sm" onClick={() => approve.mutate()} disabled={busy}>
                  {approve.isPending && <Loader2 className="size-4 animate-spin" />}
                  Approuver ce retour
                </Button>
              </div>
            </div>
          )}

          {pane === "received" && (
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-sm">
                Confirmer la réception du colis de <strong>RET-{shortId(item.id).toUpperCase()}</strong> ?
              </p>
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-medium">SANS RETOUR. Aucune transition ne ramène un retour reçu à « approuvé ».</p>
                <p>
                  C&apos;est la déclaration que l&apos;article est <strong>physiquement revenu chez
                  vous</strong>, et la seule étape qui ouvre « Valider le remboursement ». Le
                  marquer reçu avant d&apos;avoir ouvert le colis, c&apos;est renoncer à contester
                  l&apos;état de ce qu&apos;on vous renvoie.
                </p>
                <p>
                  Rien n&apos;est débité à cette étape, et aucun message n&apos;est envoyé. Le
                  remboursement reste un geste distinct, dont vous fixez le montant.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                {/* Ce volet n'a aucun champ : sans `autoFocus`, le bouton qui avait le
                    focus est démonté et le focus retombe sur le document. L'utilisateur
                    au clavier devait retabuler depuis le début de la page, et le lecteur
                    d'écran n'annonçait rien — sur l'écran même où l'on veut qu'il LISE.
                    Le focus va au retrait, jamais à la confirmation : « Entrée » doit
                    annuler, pas valider. */}
                <Button size="sm" variant="ghost" onClick={reset} disabled={busy} autoFocus>
                  Revenir
                </Button>
                <Button size="sm" onClick={() => received.mutate()} disabled={busy}>
                  {received.isPending && <Loader2 className="size-4 animate-spin" />}
                  Confirmer la réception
                </Button>
              </div>
            </div>
          )}

          {pane === "reject" && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="reason">Motif du refus</Label>
                <Textarea
                  id="reason"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Expliquez pourquoi ce retour est refusé."
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Ce motif est enregistré au dossier du retour, où le support pourra le lire.
                  Il n&apos;est PAS envoyé à l&apos;acheteur : s&apos;il doit comprendre votre
                  décision, écrivez-lui.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>
                  Annuler
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => reject.mutate()}
                  disabled={busy || rejectReason.trim().length === 0}
                >
                  {reject.isPending && <Loader2 className="size-4 animate-spin" />}
                  Refuser ce retour
                </Button>
              </div>
            </div>
          )}

          {pane === "tracking" && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="carrier">Transporteur</Label>
                  <Input
                    id="carrier"
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value)}
                    placeholder="DHL, La Poste…"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tracking">Numéro de suivi</Label>
                  <Input id="tracking" value={tracking} onChange={(e) => setTracking(e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>
                  Annuler
                </Button>
                <Button
                  size="sm"
                  onClick={() => addTracking.mutate()}
                  disabled={busy || !carrier.trim() || !tracking.trim()}
                >
                  {addTracking.isPending && <Loader2 className="size-4 animate-spin" />}
                  Enregistrer
                </Button>
              </div>
            </div>
          )}

          {pane === "refund" && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="refund">Montant à rembourser (F CFA)</Label>
                <Input
                  id="refund"
                  inputMode="numeric"
                  value={refund}
                  // Filtrage à la saisie : le champ ne peut pas contenir autre chose que
                  // ce qui sera envoyé. Aucun écart possible entre les deux.
                  onChange={(e) => setRefund(e.target.value.replace(/\D/g, ""))}
                  placeholder="0"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  {hasCap
                    ? `Montant entier, au plus ${formatMoney(cap, item.currency)} — le total de la ligne de commande.`
                    : "Montant entier. Le plafond n'est pas renseigné sur ce retour : vérifiez la commande."}
                </p>
                {hasCap && refundValue > cap && (
                  <p className="text-xs text-destructive">
                    Ce montant dépasse le total de la ligne de {formatMoney(refundValue - cap, item.currency)}. Le serveur
                    le refusera.
                  </p>
                )}
              </div>
              {/* ─────────────────────────────────────────────────────────────────
                  C'EST ICI QUE LE VENDEUR ENGAGE SON ARGENT. LE TEXTE LE DIT MAINTENANT.

                  Il annonçait l'inverse — « cette validation n'envoie pas d'argent » —
                  juste au-dessus du bouton qui l'envoie. Sur ce qu'il perd exactement :
                  `ReverseEarningsOnReturnRefundedHandler:110-123` débite le vendeur de
                  `sellerNet`, la part NETTE proratisée, pendant que la plateforme se
                  reprend sa commission et les frais du prestataire sur ses propres
                  comptes. Dire « votre solde baisse du montant remboursé » serait donc
                  faux dans l'autre sens, et surestimerait la perte.
                  ───────────────────────────────────────────────────────────────── */}
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-medium">
                  IMMÉDIAT ET SANS RETOUR. Il n&apos;y a pas d&apos;étape après celle-ci.
                </p>
                <p>
                  L&apos;acheteur est crédité de {formatMoney(refundValue, item.currency)} sur sa cagnotte, et
                  votre solde baisse de <strong>votre part nette</strong> sur ce montant — la
                  commission et les frais du prestataire sont repris à la plateforme, pas à
                  vous. Le débit est autorisé à passer sous zéro.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>
                  Annuler
                </Button>
                <Button size="sm" onClick={() => approveRefund.mutate()} disabled={busy || !refundValid}>
                  {approveRefund.isPending && <Loader2 className="size-4 animate-spin" />}
                  Valider {formatMoney(refundValue, item.currency)}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
