"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { formatDateTime, shortId } from "@/lib/utils";
import { statusLabel } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import type { SellerProduct, SellerReview } from "@/types/seller";
import { BadgeCheck, Flag, Loader2, MessageSquareReply, Star } from "lucide-react";

const TABS = [
  { key: "todo", label: "Sans réponse" },
  { key: "answered", label: "Répondus" },
  { key: "all", label: "Tous" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} sur 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`size-3.5 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
        />
      ))}
    </span>
  );
}

function reviewTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const s = status?.toLowerCase() ?? "";
  if (s === "published") return "success";
  if (s === "rejected") return "danger";
  if (s === "flagged") return "warning";
  return "neutral";
}

export default function ReviewsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("todo");
  const [replyId, setReplyId] = useState<string | null>(null);
  const [flagId, setFlagId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["seller-reviews"],
    queryFn: () => bff<SellerReview[]>("/seller/reviews"),
  });

  // Le nom des produits vient du catalogue : un avis ne porte qu'un `productId`, et
  // « avis sur 3f2a1b8c » n'aide personne. Chargé UNE fois, pas une requête par ligne.
  const products = useQuery({
    queryKey: ["seller-products"],
    queryFn: () => bff<SellerProduct[]>("/seller/products"),
  });
  const productName = useMemo(
    () => new Map((products.data ?? []).map((p) => [p.id, p.name])),
    [products.data],
  );

  const reply = useMemo(() => (q.data ?? []).find((r) => r.id === replyId) ?? null, [q.data, replyId]);
  const flag = useMemo(() => (q.data ?? []).find((r) => r.id === flagId) ?? null, [q.data, flagId]);

  const rows = useMemo(() => {
    const all = (q.data ?? []).slice().sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
    if (tab === "todo") return all.filter((r) => !r.sellerReply);
    if (tab === "answered") return all.filter((r) => !!r.sellerReply);
    return all;
  }, [q.data, tab]);

  const counts = useMemo(() => {
    const all = q.data ?? [];
    return {
      todo: all.filter((r) => !r.sellerReply).length,
      answered: all.filter((r) => !!r.sellerReply).length,
      all: all.length,
    } as Record<TabKey, number>;
  }, [q.data]);

  /** Moyenne calculée sur les avis chargés — pas une note officielle de boutique. */
  const average = useMemo(() => {
    const all = q.data ?? [];
    if (all.length === 0) return null;
    return all.reduce((sum, r) => sum + r.rating, 0) / all.length;
  }, [q.data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["seller-reviews"] });

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Avis clients</h1>
          <p className="text-sm text-muted-foreground">
            {q.isLoading ? "Chargement…" : `${rows.length} avis affiché(s)`}
          </p>
        </div>
        {!q.isLoading && !q.isError && average !== null && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Star className="size-6 fill-amber-400 text-amber-400" />
              <div>
                <div className="text-xl font-semibold tabular-nums">{average.toFixed(1)} / 5</div>
                {/* Moyenne des avis CHARGÉS, avis rejetés compris — ce n'est pas la
                    note publique de vos produits, qui n'inclut que les avis publiés. */}
                <div className="text-xs text-muted-foreground">
                  moyenne sur {counts.all} avis reçu{counts.all > 1 ? "s" : ""}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </header>

      <PageNote>
        Votre réponse est <strong>publique</strong> : elle s&apos;affiche sous l&apos;avis, pour tous
        les acheteurs. Le signalement, lui, saisit la modération de la plateforme — à réserver aux
        avis qui enfreignent les règles, pas à ceux qui déplaisent.
      </PageNote>

      <QueryError of={[q, products]} />

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

      {q.isLoading ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">Chargement…</Card>
      ) : q.isError ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          Avis non chargés — voir le message ci-dessus.
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          {tab === "todo" ? "Tous vos avis ont une réponse." : "Aucun avis dans cette vue."}
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Stars rating={r.rating} />
                  <Badge variant={reviewTone(r.status)}>{statusLabel(r.status, "reviewStatus")}</Badge>
                  {r.isVerifiedPurchase && (
                    <Badge variant="neutral">
                      <BadgeCheck className="mr-1 size-3" /> Achat vérifié
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(r.createdAtUtc)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ·{" "}
                    {/* Nom réel si le catalogue a répondu, identifiant court sinon —
                        jamais un tiret, qui laisserait croire à un produit supprimé. */}
                    {productName.get(r.productId) ?? (
                      <span className="font-mono">{shortId(r.productId)}</span>
                    )}
                  </span>
                </div>

                {r.title && <div className="font-medium">{r.title}</div>}
                {r.body && <p className="mt-1 whitespace-pre-wrap text-sm">{r.body}</p>}

                {r.sellerReply ? (
                  <div className="mt-3 rounded-xl bg-primary/5 p-3">
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="font-medium">Votre réponse</span>
                      {r.sellerRepliedAtUtc && <span>{formatDateTime(r.sellerRepliedAtUtc)}</span>}
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{r.sellerReply}</p>
                  </div>
                ) : (
                  <div className="mt-3">
                    <Button size="sm" onClick={() => setReplyId(r.id)}>
                      <MessageSquareReply className="size-4" /> Répondre
                    </Button>
                  </div>
                )}

                {/* SIGNALEMENT : proposé indépendamment de la réponse — le vendeur peut
                    vouloir les deux — mais JAMAIS sur un avis déjà signalé. Le domaine
                    accepte un second `Flag()`, qui ne fait rien de plus et re-toaste
                    « signalé à la modération » : l'écran laisse donc croire à une
                    nouvelle action là où il n'y en a aucune. */}
                {r.status?.toLowerCase() !== "flagged" ? (
                  <div className="mt-3">
                    <Button size="sm" variant="outline" onClick={() => setFlagId(r.id)}>
                      <Flag className="size-4" /> Signaler
                    </Button>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Signalé — en attente de l&apos;examen de la modération.
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ReplyDialog item={reply} onClose={() => setReplyId(null)} onDone={invalidate} />
      <FlagDialog item={flag} onClose={() => setFlagId(null)} onDone={invalidate} />
    </div>
  );
}

function ReplyDialog({
  item,
  onClose,
  onDone,
}: {
  item: SellerReview | null;
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const [body, setBody] = useState("");

  const send = useMutation({
    mutationFn: () =>
      bff(`/seller/reviews/${item?.id}/reply`, { method: "POST", body: JSON.stringify({ body: body.trim() }) }),
    onSuccess: async () => {
      await onDone();
      setBody("");
      onClose();
    },
    meta: {
      successMessage: "Réponse publiée.",
      errorMessage: "La réponse n'a pas pu être publiée.",
    },
  });

  function close() {
    if (send.isPending) return;
    setBody("");
    onClose();
  }

  return (
    <Dialog
      open={item !== null}
      onClose={close}
      title="Répondre à cet avis"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={send.isPending}>
            Annuler
          </Button>
          <Button onClick={() => send.mutate()} disabled={send.isPending || body.trim().length === 0}>
            {send.isPending && <Loader2 className="size-4 animate-spin" />}
            Publier la réponse
          </Button>
        </>
      }
    >
      {item && (
        <div className="space-y-3">
          <div className="rounded-xl bg-muted/40 p-3">
            <Stars rating={item.rating} />
            {item.title && <div className="mt-1 text-sm font-medium">{item.title}</div>}
            {item.body && <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>}
          </div>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Votre réponse…"
            rows={4}
            autoFocus
          />
          <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            Cette réponse est <strong>publique et définitive</strong> : elle apparaîtra sous
            l&apos;avis pour tous les acheteurs, et l&apos;API ne permet pas de la modifier ensuite.
          </p>
        </div>
      )}
    </Dialog>
  );
}

function FlagDialog({
  item,
  onClose,
  onDone,
}: {
  item: SellerReview | null;
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const send = useMutation({
    mutationFn: () => bff(`/seller/reviews/${item?.id}/flag`, { method: "POST" }),
    onSuccess: async () => {
      await onDone();
      onClose();
    },
    meta: {
      successMessage: "Avis signalé à la modération.",
      errorMessage: "Le signalement n'a pas pu être enregistré.",
    },
  });

  return (
    <Dialog
      open={item !== null}
      onClose={() => !send.isPending && onClose()}
      title="Signaler cet avis ?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={send.isPending}>
            Annuler
          </Button>
          <Button onClick={() => send.mutate()} disabled={send.isPending}>
            {send.isPending && <Loader2 className="size-4 animate-spin" />}
            Signaler
          </Button>
        </>
      }
    >
      <p className="text-sm">
        La modération de la plateforme examinera cet avis. Le signalement est destiné aux contenus
        qui enfreignent les règles — propos injurieux, hors sujet, contenu commercial. Un avis
        négatif mais sincère n&apos;en relève pas : mieux vaut y répondre publiquement.
      </p>
    </Dialog>
  );
}
