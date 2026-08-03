"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { formatDateTime, formatXof, shortId } from "@/lib/utils";
import { disputeTone, statusLabel } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import type { SellerDispute } from "@/types/seller";
import { Loader2, MessageSquare, Send } from "lucide-react";

/** Litiges encore ouverts : ceux qui appellent une réponse. */
const OPEN = new Set(["open", "underreview", "escalated"]);

export default function DisputesPage() {
  const qc = useQueryClient();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);

  const q = useQuery({
    queryKey: ["seller-disputes"],
    queryFn: () => bff<SellerDispute[]>("/seller/disputes"),
  });

  /**
   * Le litige affiché est redérivé de la liste, jamais copié dans le state : après
   * l'envoi d'un message, le fil doit se compléter sans qu'on rouvre le dialogue.
   */
  const detail = useMemo(
    () => (q.data ?? []).find((d) => d.id === detailId) ?? null,
    [q.data, detailId],
  );

  const rows = useMemo(() => {
    const all = q.data ?? [];
    return onlyOpen ? all.filter((d) => OPEN.has(d.status?.toLowerCase() ?? "")) : all;
  }, [q.data, onlyOpen]);

  const openCount = useMemo(
    () => (q.data ?? []).filter((d) => OPEN.has(d.status?.toLowerCase() ?? "")).length,
    [q.data],
  );

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Litiges</h1>
        <p className="text-sm text-muted-foreground">
          {q.isLoading ? "Chargement…" : `${rows.length} litige(s) affiché(s)`}
        </p>
      </header>

      <PageNote>
        Litiges ouverts par des acheteurs sur vos commandes. <strong>Votre réponse est
        lue par le client</strong> dans son application. La décision finale — remboursement
        ou non — revient à la modération de la plateforme, pas à vous : ce que vous écrivez
        ici est ce sur quoi elle s&apos;appuiera.
      </PageNote>

      <QueryError of={q} />

      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" variant={onlyOpen ? "default" : "outline"} onClick={() => setOnlyOpen(true)}>
          À traiter
          {!q.isLoading && !q.isError && (
            <span className={onlyOpen ? "opacity-80" : "text-muted-foreground"}>{openCount}</span>
          )}
        </Button>
        <Button size="sm" variant={onlyOpen ? "outline" : "default"} onClick={() => setOnlyOpen(false)}>
          Tous
          {!q.isLoading && !q.isError && (
            <span className={onlyOpen ? "text-muted-foreground" : "opacity-80"}>
              {(q.data ?? []).length}
            </span>
          )}
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Litige</TableHead>
              <TableHead>Commande</TableHead>
              <TableHead>Motif</TableHead>
              <TableHead>Ouvert le</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Échanges</TableHead>
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
                  {onlyOpen ? "Aucun litige en attente de réponse." : "Aucun litige sur vos commandes."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((d) => (
                <TableRow
                  key={d.id}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  role="button"
                  tabIndex={0}
                  aria-label={`Ouvrir le litige LIT-${shortId(d.id).toUpperCase()}`}
                  onClick={() => setDetailId(d.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDetailId(d.id);
                    }
                  }}
                >
                  <TableCell className="font-mono text-xs">LIT-{shortId(d.id).toUpperCase()}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    CMD-{shortId(d.orderId).toUpperCase()}
                  </TableCell>
                  <TableCell className="text-sm">{statusLabel(d.type, "disputeType")}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(d.createdAtUtc)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={disputeTone(d.status)}>{statusLabel(d.status, "disputeStatus")}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                    {d.messages?.length ?? 0}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <DisputeDialog
        item={detail}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        onSent={() => qc.invalidateQueries({ queryKey: ["seller-disputes"] })}
      />
    </div>
  );
}

function DisputeDialog({
  item,
  open,
  onClose,
  onSent,
}: {
  item: SellerDispute | null;
  open: boolean;
  onClose: () => void;
  onSent: () => Promise<unknown>;
}) {
  const [body, setBody] = useState("");

  const send = useMutation({
    mutationFn: () =>
      bff(`/seller/disputes/${item?.id}/messages`, {
        method: "POST",
        // `photoUrl` est accepté par le BFF ; le téléversement d'image n'existe pas
        // encore dans cette console, on envoie donc explicitement `null` plutôt que
        // d'omettre le champ.
        body: JSON.stringify({ body: body.trim(), photoUrl: null }),
      }),
    onSuccess: async () => {
      setBody("");
      // Attendu : le fil doit contenir le nouveau message avant que le bouton
      // redevienne cliquable, sinon un double envoi paraît possible.
      await onSent();
    },
    meta: {
      successMessage: "Message envoyé. Le client le voit dans son application.",
      errorMessage: "Le message n'a pas pu être envoyé.",
    },
  });

  const isOpen = OPEN.has(item?.status?.toLowerCase() ?? "");

  return (
    <Dialog
      open={open && item !== null}
      onClose={() => { if (!send.isPending) { setBody(""); onClose(); } }}
      title={item ? `Litige LIT-${shortId(item.id).toUpperCase()}` : ""}
    >
      {item && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={disputeTone(item.status)}>{statusLabel(item.status, "disputeStatus")}</Badge>
            <span className="text-sm text-muted-foreground">{statusLabel(item.type, "disputeType")}</span>
            <span className="text-sm text-muted-foreground">
              · commande CMD-{shortId(item.orderId).toUpperCase()}
            </span>
          </div>

          {item.resolution && (
            <p className="rounded-lg bg-muted/50 p-3 text-sm">
              <strong>Décision de la modération :</strong>{" "}
              {statusLabel(item.resolution, "disputeResolution")}
              {item.refundAmount != null && ` — ${formatXof(item.refundAmount)}`}
              {item.resolvedAtUtc && (
                <span className="block text-xs text-muted-foreground">
                  {formatDateTime(item.resolvedAtUtc)}
                </span>
              )}
            </p>
          )}

          <div>
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Échanges ({item.messages?.length ?? 0})
            </div>
            {(item.messages?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun message pour l&apos;instant.</p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {item.messages.map((m, i) => {
                  // ─────────────────────────────────────────────────────────────
                  // QUI PARLE ? ON NE LE SAIT QU'À MOITIÉ, ET ON L'ÉCRIT AINSI.
                  //
                  // Les messages ne portent pas de rôle, seulement un `authorId`. Le
                  // seul repère certain est `raisedBy` : l'acheteur qui a ouvert le
                  // litige. Tout autre auteur peut être ce vendeur, la MODÉRATION
                  // (AdminModerationEndpoints poste dans le même fil, avec
                  // l'identifiant de l'administrateur) ou un AUTRE vendeur de la même
                  // commande — le contrôle d'accès porte sur l'implication dans la
                  // commande, pas sur la propriété du litige.
                  //
                  // Écrire « Votre boutique » sur ces messages était donc faux dès
                  // qu'un modérateur intervenait : le vendeur lisait sa propre
                  // signature au-dessus d'un texte qu'il n'avait pas écrit, dans le
                  // fil même qui sert de pièce à l'arbitrage.
                  // ─────────────────────────────────────────────────────────────
                  const fromBuyer = m.authorId === item.raisedBy;
                  return (
                    <div
                      key={i}
                      className={`rounded-xl p-3 text-sm ${
                        fromBuyer ? "bg-muted/60" : "bg-primary/10 ml-6"
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="font-medium">
                          {fromBuyer ? "Client" : "Vendeur ou plateforme"}
                        </span>
                        <span>{formatDateTime(m.createdAtUtc)}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      {m.photoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.photoUrl}
                          alt="Pièce jointe"
                          className="mt-2 max-h-40 rounded-lg object-contain"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {isOpen ? (
            <div className="space-y-2 border-t border-border pt-4">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Votre réponse au client…"
                rows={3}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Visible par le client, et par la modération.
                </p>
                <Button
                  size="sm"
                  onClick={() => send.mutate()}
                  disabled={send.isPending || body.trim().length === 0}
                >
                  {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Envoyer
                </Button>
              </div>
            </div>
          ) : (
            <p className="flex items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
              <MessageSquare className="size-4 shrink-0" />
              Ce litige est clos : il n&apos;accepte plus de message.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
