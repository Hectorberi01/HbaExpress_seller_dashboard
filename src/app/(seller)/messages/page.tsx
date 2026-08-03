"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import { ImageViewer } from "@/components/image-viewer";
import { MESSAGE_REACTIONS, type SellerConversation, type SellerMessage } from "@/types/seller";
import { Check, CheckCheck, EyeOff, ImagePlus, Loader2, MessagesSquare, Send, Trash2, X } from "lucide-react";

/**
 * ─────────────────────────────────────────────────────────────────────────────────
 * POURQUOI CET ÉCRAN INTERROGE AU LIEU D'ÉCOUTER
 *
 * Le BFF expose un hub SignalR (`/seller/hubs/chat`) et pousse « message » / « inbox »
 * à chaque envoi. On ne s'y connecte PAS, et ce n'est pas un oubli.
 *
 * SignalR authentifie son handshake WebSocket avec `?access_token=` dans l'URL. Or
 * cette console repose entièrement sur le fait qu'AUCUN jeton n'atteint le navigateur :
 * c'est le serveur Next qui les détient et relaie les appels. S'abonner au hub depuis
 * le navigateur imposerait de lui livrer un jeton — donc de défaire la seule propriété
 * qui distingue vraiment cette console du tableau de bord Blazor qu'elle remplace.
 *
 * Deux voies existent pourtant pour garder le temps réel SANS jeton côté navigateur,
 * et elles sont écartées sciemment, pas par ignorance :
 *   — le transport LONG-POLLING de SignalR est du HTTP ordinaire, donc proxifiable par
 *     `/api/bff/[...path]` ; reste à vérifier qu'une réponse tenue survit au
 *     `res.arrayBuffer()` du proxy, qui attend le corps complet ;
 *   — un route handler Next renvoyant un `text/event-stream`, alimenté par une
 *     connexion SignalR tenue par le SERVEUR Next.
 * Les deux demandent une infrastructure que cet écran ne justifie pas encore. Seule la
 * montée en WebSocket est réellement impossible : les route handlers de l'App Router
 * ne la gèrent pas.
 *
 * On interroge donc périodiquement, à travers le même proxy que le reste. React Query
 * suspend ces rappels quand l'onglet est CACHÉ (elle écoute `visibilitychange`, pas le
 * focus : une fenêtre visible sur un second écran continue de sonder — c'est d'ailleurs
 * souhaitable pour une console laissée ouverte). Un délai de quelques secondes sur une
 * messagerie de support est acceptable ; livrer un jeton au navigateur ne l'est pas.
 *
 * ⚠️ CE SONDAGE N'EST PAS GRATUIT CÔTÉ SERVEUR. `GET .../messages` déclenche
 * `MarkConversationReadCommand`, qui recharge l'agrégat et fait un `SaveChanges` — même
 * quand il n'y a rien à marquer. Et `GET /seller/conversations` ramène TOUT l'historique
 * de chaque fil puis résout un nom par conversation (N+1 vers Identity). Avant
 * d'accélérer ces intervalles, il faut d'abord alléger ces deux routes.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
const LIST_REFRESH_MS = 30_000;
const THREAD_REFRESH_MS = 8_000;

export default function MessagesPage() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const conversations = useQuery({
    queryKey: ["seller-conversations"],
    queryFn: () => bff<SellerConversation[]>("/seller/conversations"),
    refetchInterval: LIST_REFRESH_MS,
  });

  const rows = useMemo(
    () =>
      (conversations.data ?? [])
        .slice()
        .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? "")),
    [conversations.data],
  );

  // Sélection automatique du premier fil sur grand écran : un panneau vide à droite
  // n'apprend rien. On ne le fait qu'une fois, pour ne pas ramener l'utilisateur au
  // premier fil à chaque rafraîchissement de la liste.
  const autoSelected = useRef(false);
  const current = rows.find((c) => c.id === openId) ?? null;

  useEffect(() => {
    if (rows.length === 0) return;
    // On sélectionne au premier remplissage — et de nouveau si le fil ouvert a disparu
    // de la liste, faute de quoi le panneau droit restait vide pour de bon.
    if (openId === null && !autoSelected.current) {
      autoSelected.current = true;
      setOpenId(rows[0].id);
      return;
    }
    if (openId !== null && current === null) setOpenId(rows[0].id);
  }, [rows, openId, current]);

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Messagerie</h1>
        <p className="text-sm text-muted-foreground">
          {conversations.isLoading ? "Chargement…" : `${rows.length} conversation(s)`}
        </p>
      </header>

      <PageNote>
        Échanges directs avec vos acheteurs. Les messages se rafraîchissent{" "}
        <strong>toutes les quelques secondes</strong>, pas instantanément : cette console ne
        maintient pas de connexion permanente, pour ne jamais exposer vos jetons au navigateur.
      </PageNote>

      <QueryError of={conversations} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="p-0">
            {conversations.isLoading ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Chargement…</p>
            ) : conversations.isError ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Conversations non chargées — voir le message ci-dessus.
              </p>
            ) : rows.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Aucune conversation. Vos acheteurs peuvent vous écrire depuis une commande ou une
                fiche produit.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setOpenId(c.id)}
                      className={`flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-accent ${
                        c.id === openId ? "bg-accent" : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`truncate text-sm ${c.unread > 0 ? "font-semibold" : "font-medium"}`}>
                            {c.customer}
                          </span>
                          {c.unread > 0 && <Badge variant="default">{c.unread}</Badge>}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.lastMessage || "Aucun message"}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {formatDateTime(c.lastAt)}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          {current ? (
            <Thread
              // `key` : remonter le composant à chaque fil annule les mutations en vol.
              // Sans elle, un téléversement lancé dans le fil A et abouti après un
              // changement attachait son image au brouillon de B.
              key={current.id}
              conversation={current}
              onChanged={() => qc.invalidateQueries({ queryKey: ["seller-conversations"] })}
            />
          ) : (
            <CardContent className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <MessagesSquare className="size-8 opacity-40" />
              Choisissez une conversation.
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}

function Thread({
  conversation,
  onChanged,
}: {
  conversation: SellerConversation;
  onChanged: () => Promise<unknown> | unknown;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  /**
   * Confirmation des deux gestes IRRÉVERSIBLES du fil.
   *
   * Le domaine n'a aucune marche arrière : `Message.HideFor` n'a pas de symétrique
   * (aucun « démasquer » dans le module), et la projection écarte purement et simplement
   * les messages masqués. Un clic de travers efface donc DÉFINITIVEMENT de la vue du
   * vendeur l'adresse de livraison ou l'engagement écrit que son client vient d'envoyer.
   *
   * « Masquer » était le plus dangereux des deux : proposé sur les messages REÇUS, en
   * tout petit, juste à côté de « Supprimer ».
   */
  const [confirming, setConfirming] = useState<
    { message: SellerMessage; kind: "everyone" | "me" } | null
  >(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = useQuery({
    queryKey: ["seller-messages", conversation.id],
    queryFn: () => bff<SellerMessage[]>(`/seller/conversations/${conversation.id}/messages`),
    refetchInterval: THREAD_REFRESH_MS,
  });

  const list = messages.data ?? [];

  /**
   * Toutes les pièces jointes du fil, dans l'ordre d'affichage.
   *
   * C'est cette liste que parcourt la visionneuse : cliquer une photo ouvre la série
   * entière, ce qui permet de comparer trois clichés d'un article abîmé sans fermer et
   * rouvrir à chaque fois. Les messages supprimés en sont exclus — leurs pièces jointes
   * ne sont plus affichées dans le fil, elles n'ont pas à l'être ici.
   */
  const { galleryImages, offsetOf } = useMemo(() => {
    const images: string[] = [];
    const offsets = new Map<string, number>();
    for (const m of list) {
      if (m.isDeleted) continue;
      const atts = m.attachments ?? [];
      if (atts.length === 0) continue;
      offsets.set(m.id, images.length);
      images.push(...atts);
    }
    return { galleryImages: images, offsetOf: offsets };
  }, [list]);
  const [viewerAt, setViewerAt] = useState<number | null>(null);

  // Le fil est chronologique : on suit le bas à chaque nouveau message, comme dans
  // n'importe quelle messagerie. `list.length` seul suffit — inutile de réagir aux
  // rafraîchissements qui ne changent rien.
  useEffect(() => {
    // `scrollTop` sur le conteneur, PAS `scrollIntoView` : ce dernier remonte tous les
    // ancêtres défilables et faisait sauter la fenêtre entière à l'ouverture d'un fil.
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [list.length, conversation.id]);

  // Ouvrir un autre fil ne doit pas y déverser le brouillon du précédent.
  useEffect(() => {
    setBody("");
    setAttachments([]);
  }, [conversation.id]);

  /**
   * `GET .../messages` marque le fil comme LU côté serveur. Le compteur de non-lus de
   * la liste devient donc faux dès l'ouverture : on la réinvalide une fois le fil
   * chargé, sans quoi la pastille resterait jusqu'au prochain cycle de 30 secondes.
   */
  useEffect(() => {
    if (messages.isSuccess) onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.isSuccess, conversation.id]);

  const refreshThread = () =>
    qc.invalidateQueries({ queryKey: ["seller-messages", conversation.id] });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return bff<{ url: string }>("/seller/conversations/attachments", { method: "POST", body: form });
    },
    onSuccess: (data) => {
      const url = (data as { url?: string })?.url;
      if (url) setAttachments((a) => [...a, url]);
    },
    meta: { successMessage: "", errorMessage: "L'image n'a pas pu être envoyée." },
  });

  const send = useMutation({
    mutationFn: () =>
      bff(`/seller/conversations/${conversation.id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          body: body.trim(),
          // `null` plutôt qu'un tableau vide : le contrat déclare `Attachments` nullable.
          attachments: attachments.length > 0 ? attachments : null,
        }),
      }),
    onSuccess: async () => {
      setBody("");
      setAttachments([]);
      await refreshThread();
      await onChanged();
    },
    meta: { successMessage: "", errorMessage: "Le message n'a pas pu être envoyé." },
  });

  const react = useMutation({
    mutationFn: (v: { messageId: string; emoji: string }) =>
      bff(`/seller/conversations/${conversation.id}/messages/${v.messageId}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji: v.emoji }),
      }),
    onSuccess: () => refreshThread(),
    meta: { successMessage: "", errorMessage: "La réaction n'a pas pu être enregistrée." },
  });

  const deleteForEveryone = useMutation({
    mutationFn: (messageId: string) =>
      bff(`/seller/conversations/${conversation.id}/messages/${messageId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirming(null);
      await refreshThread();
      await onChanged();
    },
    meta: {
      successMessage: "Message supprimé pour tout le monde.",
      errorMessage: "Le message n'a pas pu être supprimé.",
    },
  });

  const hideForMe = useMutation({
    mutationFn: (messageId: string) =>
      bff(`/seller/conversations/${conversation.id}/messages/${messageId}/for-me`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirming(null);
      await refreshThread();
    },
    meta: { successMessage: "Message masqué de votre vue.", errorMessage: "Le masquage a échoué." },
  });

  // `upload.isPending` compte : sans lui, envoyer avant la fin du téléversement partait
  // SANS la pièce jointe, puis `upload.onSuccess` recollait l'image dans un brouillon
  // désormais vide — une vignette orpheline pour un message déjà parti.
  const canSend = (body.trim().length > 0 || attachments.length > 0) && !upload.isPending;

  return (
    <CardContent className="flex h-[70vh] flex-col p-0">
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{conversation.customer}</div>
          {conversation.subject && (
            <div className="text-xs text-muted-foreground">À propos de : {conversation.subject}</div>
          )}
        </div>
        {/* Seulement au PREMIER chargement : un spinner qui clignote toutes les huit
            secondes n'indique plus rien, il use. */}
        {messages.isLoading && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-5">
        {messages.isLoading ? (
          <p className="text-center text-sm text-muted-foreground">Chargement…</p>
        ) : messages.isError ? (
          <div className="text-center text-sm">
            <p className="text-muted-foreground">
              Ce fil n&apos;a pas pu être chargé. Il n&apos;est pas vide, il est inconnu.
            </p>
            <Button size="sm" variant="outline" className="mt-3" onClick={refreshThread}>
              Réessayer
            </Button>
          </div>
        ) : list.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            Aucun message. Écrivez le premier.
          </p>
        ) : (
          list.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              // Ciblé sur CE message : `react.isPending` seul figeait les boutons de
              // toutes les bulles du fil pendant une réaction.
              busy={
                (react.isPending && react.variables?.messageId === m.id) ||
                (deleteForEveryone.isPending && deleteForEveryone.variables === m.id) ||
                (hideForMe.isPending && hideForMe.variables === m.id)
              }
              onReact={(emoji) => react.mutate({ messageId: m.id, emoji })}
              onDeleteForEveryone={() => setConfirming({ message: m, kind: "everyone" })}
              onHideForMe={() => setConfirming({ message: m, kind: "me" })}
              // On passe le RANG de la vignette dans son message, pas l'URL : un
              // `indexOf` sur la galerie renverrait la première occurrence, donc la
              // mauvaise image dès qu'un client renvoie deux fois le même cliché.
              onOpenImage={(localIndex) => {
                const base = offsetOf.get(m.id);
                if (base !== undefined) setViewerAt(base + localIndex);
              }}
            />
          ))
        )}
      </div>

      <div className="space-y-2 border-t border-border p-4">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((url) => (
              <div key={url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="size-16 rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={() => setAttachments((a) => a.filter((u) => u !== url))}
                  aria-label="Retirer cette image"
                  className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) upload.mutate(f);
            }}
          />
          <Button
            size="icon"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={upload.isPending}
            aria-label="Joindre une image"
          >
            {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          </Button>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Votre message…"
            rows={2}
            className="flex-1"
            onKeyDown={(e) => {
              // Entrée envoie, Maj+Entrée passe à la ligne — la convention de toutes les
              // messageries. Sans cela, on cherche le bouton à chaque message.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend && !send.isPending) send.mutate();
              }
            }}
          />
          <Button onClick={() => send.mutate()} disabled={!canSend || send.isPending} aria-label="Envoyer">
            {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Entrée pour envoyer, Maj + Entrée pour aller à la ligne.</p>
      </div>

      <Dialog
        open={confirming !== null}
        onClose={() => {
          if (deleteForEveryone.isPending || hideForMe.isPending) return;
          setConfirming(null);
        }}
        title={confirming?.kind === "everyone" ? "Supprimer ce message ?" : "Masquer ce message ?"}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setConfirming(null)}
              disabled={deleteForEveryone.isPending || hideForMe.isPending}
            >
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!confirming) return;
                if (confirming.kind === "everyone") deleteForEveryone.mutate(confirming.message.id);
                else hideForMe.mutate(confirming.message.id);
              }}
              disabled={deleteForEveryone.isPending || hideForMe.isPending}
            >
              {(deleteForEveryone.isPending || hideForMe.isPending) && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {confirming?.kind === "everyone" ? "Supprimer pour tous" : "Masquer"}
            </Button>
          </>
        }
      >
        {confirming && (
          <div className="space-y-3">
            <p className="rounded-lg bg-muted/50 p-3 text-sm">
              {confirming.message.body || "(pièce jointe)"}
            </p>
            <p className="text-sm">
              {confirming.kind === "everyone" ? (
                <>
                  Le message sera remplacé par « Message supprimé » <strong>pour vous et pour
                  votre client</strong>. Le texte réel reste conservé côté plateforme en cas de
                  litige.
                </>
              ) : (
                <>
                  Le message disparaîtra <strong>de votre vue uniquement</strong> — votre client
                  continuera de le voir. <strong>C&apos;est définitif</strong> : rien ne permet
                  de le réafficher ensuite.
                </>
              )}
            </p>
          </div>
        )}
      </Dialog>

      {viewerAt !== null && (
        <ImageViewer images={galleryImages} startIndex={viewerAt} onClose={() => setViewerAt(null)} />
      )}
    </CardContent>
  );
}

function MessageBubble({
  message: m,
  busy,
  onReact,
  onDeleteForEveryone,
  onHideForMe,
  onOpenImage,
}: {
  message: SellerMessage;
  busy: boolean;
  onReact: (emoji: string) => void;
  onDeleteForEveryone: () => void;
  onHideForMe: () => void;
  onOpenImage: (localIndex: number) => void;
}) {
  const [showPalette, setShowPalette] = useState(false);
  const mine = m.fromSeller;

  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${
          mine ? "bg-primary/10" : "bg-muted/60"
        } ${m.isDeleted ? "italic text-muted-foreground" : ""}`}
      >
        {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}

        {!m.isDeleted && (m.attachments ?? []).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {(m.attachments ?? []).map((url, i) => (
              // Un BOUTON, pas une image cliquable : on gagne le focus clavier, la touche
              // Entrée et un libellé pour les lecteurs d'écran, sans rien coder de plus.
              <button
                key={`${url}#${i}`}
                type="button"
                onClick={() => onOpenImage(i)}
                aria-label="Agrandir la pièce jointe"
                className="group relative overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt="Pièce jointe"
                  // Vignette de taille FIXE : les pièces jointes arrivent dans des formats
                  // quelconques, et un `max-h` seul laissait des colonnes d'images étroites
                  // séparées par de grands vides. `cursor-zoom-in` annonce que ça s'ouvre.
                  className="size-32 cursor-zoom-in object-cover transition-transform duration-200 group-hover:scale-105"
                />
              </button>
            ))}
          </div>
        )}

        <div className="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
          <span>{formatDateTime(m.sentAt)}</span>
          {/* Accusé de lecture, sur MES messages seulement : `readAt` est la date à
              laquelle l'autre participant a ouvert le fil. Un double signe sur un
              message reçu n'aurait aucun sens. */}
          {mine &&
            !m.isDeleted &&
            (m.readAt ? (
              <CheckCheck className="size-3.5 text-primary" aria-label="Lu" />
            ) : (
              <Check className="size-3.5" aria-label="Envoyé" />
            ))}
        </div>
      </div>

      {(m.reactions ?? []).length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {(m.reactions ?? []).map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => onReact(r.emoji)}
              disabled={busy}
              // Renvoyer le même emoji le RETIRE (une seule réaction par personne) :
              // le bouton est donc une bascule, et l'état « mine » doit se voir.
              title={r.mine ? "Retirer ma réaction" : "Réagir"}
              className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                r.mine ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {r.emoji} {r.count}
            </button>
          ))}
        </div>
      )}

      <div className="mt-1 flex items-center gap-1">
        {/* Réactions et suppression n'ont pas de sens sur un message supprimé — le
            domaine les refuse. Le MASQUAGE, lui, reste utile : sans quoi le vendeur
            garde des ardoises « Message supprimé » qu'il ne peut pas retirer. */}
        {!m.isDeleted && (
          showPalette ? (
            <div className="flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-1">
              {MESSAGE_REACTIONS.map((e) => {
                // Renvoyer l'emoji déjà posé le RETIRE : on le signale, sinon le geste
                // paraît sans effet — la palette annonçait « Réagir » dans les deux cas.
                const chosen = (m.reactions ?? []).some((r) => r.emoji === e && r.mine);
                return (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      onReact(e);
                      setShowPalette(false);
                    }}
                    disabled={busy}
                    title={chosen ? "Retirer ma réaction" : "Réagir"}
                    className={`rounded-full px-1 text-base transition-transform hover:scale-125 ${
                      chosen ? "bg-primary/20" : ""
                    }`}
                  >
                    {e}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setShowPalette(false)}
                aria-label="Fermer"
                className="ml-0.5 text-muted-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowPalette(true)}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Réagir
            </button>
          )
        )}

        {/* « Supprimer pour tous » n'est proposé que sur MES messages : le domaine
            n'autorise que l'auteur, et l'offrir ailleurs mènerait droit à un refus. */}
        {mine && !m.isDeleted && (
          <button
            type="button"
            onClick={onDeleteForEveryone}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3" /> Supprimer
          </button>
        )}
        <button
          type="button"
          onClick={onHideForMe}
          disabled={busy}
          title="Le message reste visible pour votre client"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <EyeOff className="size-3" /> Masquer
        </button>
      </div>
    </div>
  );
}
