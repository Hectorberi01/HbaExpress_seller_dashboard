"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { formatDateTime, formatXof, shortId } from "@/lib/utils";
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

      <PageNote>
        Cycle d&apos;un retour : <strong>approuver</strong> ou refuser, puis marquer{" "}
        <strong>reçu</strong> à réception du colis, et enfin valider le{" "}
        <strong>montant du remboursement</strong>. Valider un remboursement ne déclenche
        aucun versement : il part dans la file d&apos;un administrateur, qui l&apos;exécute
        depuis le tableau de bord du prestataire de paiement.
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
                      <span className="font-medium">{formatXof(r.refundAmount)}</span>
                    ) : r.refundableAmount > 0 ? (
                      <span className="text-muted-foreground">jusqu&apos;à {formatXof(r.refundableAmount)}</span>
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
  const [pane, setPane] = useState<"none" | "reject" | "tracking" | "refund">("none");

  const status = item?.status?.toLowerCase() ?? "";
  const id = item?.id;

  function reset() {
    setPane("none");
    setRejectReason("");
    setCarrier("");
    setTracking("");
    setRefund("");
  }

  const post = (path: string, body?: unknown) =>
    bff(`/seller/returns/${id}/${path}`, {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const approve = useMutation({
    mutationFn: () => post("approve"),
    onSuccess: async () => { await onDone(); reset(); },
    meta: { successMessage: "Retour approuvé. L'acheteur peut renvoyer l'article." },
  });

  const reject = useMutation({
    mutationFn: () => post("reject", { reason: rejectReason.trim() }),
    onSuccess: async () => { await onDone(); reset(); onClose(); },
    meta: { successMessage: "Retour refusé. Le motif est transmis à l'acheteur." },
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

  const approveRefund = useMutation({
    mutationFn: () => post("refund", { amount: refundValue }),
    onSuccess: async () => { await onDone(); reset(); },
    meta: {
      successMessage: "Remboursement validé. Il part dans la file de versement d'un administrateur.",
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
                {hasCap ? formatXof(cap) : <span className="text-muted-foreground">non renseigné</span>}
              </dd>
            </div>
            {item.refundAmount != null && (
              <div className="flex justify-between font-medium">
                <dt>Remboursement validé</dt>
                <dd className="tabular-nums">{formatXof(item.refundAmount)}</dd>
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

          {status === "refundpending" && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Le montant est validé mais <strong>l&apos;argent n&apos;est pas encore parti</strong>.
              Un administrateur doit exécuter le versement chez le prestataire de paiement.
            </p>
          )}

          {/* ─── Actions, selon l'étape du cycle ───────────────────────────────── */}
          {pane === "none" && (
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              {status === "requested" && (
                <>
                  <Button size="sm" onClick={() => approve.mutate()} disabled={busy}>
                    {approve.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    Approuver
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPane("reject")} disabled={busy}>
                    <XCircle className="size-4" /> Refuser
                  </Button>
                </>
              )}

              {status === "approved" && (
                <>
                  <Button size="sm" onClick={() => received.mutate()} disabled={busy}>
                    {received.isPending ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />}
                    Marquer le colis reçu
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
              {status === "refundpending" && (
                <p className="text-sm text-muted-foreground">
                  Rien à faire de votre part : le versement revient à un administrateur.
                </p>
              )}

              {!["requested", "approved", "received", "refundpending"].includes(status) && (
                <p className="text-sm text-muted-foreground">
                  Ce retour est clôturé : aucune action n&apos;est possible.
                </p>
              )}
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
                  placeholder="Expliquez pourquoi ce retour est refusé. L'acheteur lira ce message."
                  autoFocus
                />
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
                    ? `Montant entier, au plus ${formatXof(cap)} — le total de la ligne de commande.`
                    : "Montant entier. Le plafond n'est pas renseigné sur ce retour : vérifiez la commande."}
                </p>
                {hasCap && refundValue > cap && (
                  <p className="text-xs text-destructive">
                    Ce montant dépasse le total de la ligne de {formatXof(refundValue - cap)}. Le serveur
                    le refusera.
                  </p>
                )}
              </div>
              <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                Cette validation n&apos;envoie pas d&apos;argent. Le retour passe en{" "}
                « remboursement en attente de versement » et rejoint la file d&apos;un
                administrateur.
              </p>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>
                  Annuler
                </Button>
                <Button size="sm" onClick={() => approveRefund.mutate()} disabled={busy || !refundValid}>
                  {approveRefund.isPending && <Loader2 className="size-4 animate-spin" />}
                  Valider {formatXof(refundValue)}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
