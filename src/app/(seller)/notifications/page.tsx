"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { statusLabel } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import type { NotificationPreferences, SellerNotification } from "@/types/seller";
import { Bell, BellOff, CheckCheck, Loader2 } from "lucide-react";

/** Taille d'une page. 200 est le plafond que la requête serveur accepte. */
const TAILLE_PAGE = 50;

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * OÙ MÈNE UNE NOTIFICATION — CAR ELLE NE MENAIT NULLE PART.
 *
 * Chaque notification porte `relatedEntityType` et `relatedEntityId` depuis toujours
 * (`NotificationsContracts`), et cet écran les ignorait entièrement : il affichait
 * sujet, corps, canal et date, sans un seul lien. Le vendeur lisait « avis reçu » ou
 * « retour demandé », cliquait « Marquer lu » — pur travail de ménage — puis devait
 * retrouver l'élément à la main dans l'écran correspondant.
 *
 * ON NE PORTE L'IDENTIFIANT QUE LÀ OÙ IL DÉSIGNE VRAIMENT LA CIBLE, et cela demande
 * de lire ce que les émetteurs passent RÉELLEMENT, pas ce que le nom du type suggère :
 *
 *   • « order » → `OrderId` (`SellerOrderNotificationHandler`) ;
 *   • « shipment » → `ShipmentId` (`ShipmentNotificationHandlers`) ;
 *   • « message » → `ConversationId` (`MessageNotificationHandler`) — le nom dit
 *     « message », la charge est un FIL. Première rédaction de ce mappage : j'avais
 *     suivi le nom, jeté l'identifiant et renvoyé vers `/messages` tout court, ce qui
 *     rouvrait le fil le plus récent — donc celui d'un autre client, sur la
 *     notification la plus fréquente d'un vendeur. Exactement le chemin aveugle que ce
 *     lot ferme ;
 *   • « inventory » → `InventoryItemId` : la rupture de stock. Elle était émise en
 *     « order », ce qui menait à une fiche commande introuvable — corrigé côté
 *     serveur en même temps que ceci ;
 *   • « return », « dispute » → un identifiant que la console ne sait pas ouvrir
 *     seul, faute de route de détail : on mène à la liste ;
 *   • « review » → un `ProductId`, malgré son nom. On mène à la liste des avis, qui
 *     est ce que le vendeur cherche ; `/products/{id}` afficherait la fiche sans
 *     l'avis dont on lui parle.
 *
 * « conversation » est accepté par `NotificationCategories` mais n'est émis nulle
 * part aujourd'hui. On le traite quand même — le mappage doit survivre à un émetteur
 * qui s'aligne enfin sur son propre vocabulaire.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
function lienNotification(type: string | null | undefined, entityId: string | null | undefined) {
  const t = (type ?? "").trim().toLowerCase();
  const id = (entityId ?? "").trim();

  if (t === "order") return id ? `/orders/${id}` : "/orders";
  if (t === "shipment") return id ? `/shipments?id=${id}` : "/shipments";
  // Les DEUX portent un identifiant de conversation, quoi que dise leur nom.
  if (t === "conversation" || t === "message") return id ? `/messages?c=${id}` : "/messages";
  if (t === "inventory") return "/inventory";
  if (t === "return") return "/returns";
  if (t === "dispute") return "/disputes";
  if (t === "review") return "/reviews";
  if (t === "payout" || t === "wallet" || t === "payment") return "/wallet";
  if (t === "seller") return "/shop";

  // Type inconnu — une catégorie ajoutée côté serveur après cette console. On
  // n'invente pas de destination : la ligne reste lisible, simplement sans lien.
  return null;
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [onlyUnread, setOnlyUnread] = useState(false);

  /**
   * ═════════════════════════════════════════════════════════════════════════════════
   * LA 51ᵉ NOTIFICATION ÉTAIT INATTEIGNABLE, ET RIEN NE LE DISAIT VRAIMENT.
   *
   * `GET /seller/notifications` n'acceptait aucun paramètre et la requête laissait son
   * plafond à 50. L'écran l'annonçait — « seules les 50 plus récentes sont chargées » —
   * mais ne proposait aucune suite : c'était un constat, pas une issue. Le seul bouton
   * qui agissait sur les anciennes était « Tout marquer comme lu », qui les effaçait
   * sans les avoir montrées.
   *
   * La route accepte désormais `take` et `skip`, et on empile les pages.
   *
   * CE QUE CELA NE FAIT PAS : économiser des requêtes à l'invalidation. TanStack Query
   * refetch TOUTES les pages chargées d'une requête infinie — aucun `maxPages` n'est
   * posé ici — donc « marquer comme lu » relance autant d'appels que de pages ouvertes.
   * Une première version de ce commentaire prétendait l'inverse. Le gain réel est
   * ailleurs : l'existence même d'un chemin vers les notifications anciennes.
   *
   * LA PAGINATION PAR DÉCALAGE N'EST PAS STABLE SOUS INSERTION. Une notification qui
   * arrive entre deux pages décale tout le tri : la même peut alors revenir dans deux
   * pages. On déduplique donc par identifiant avant de rendre — sans quoi React voit
   * deux fois la même clé, et le vendeur deux fois le même message.
   *
   * FIN DE LISTE = PAGE INCOMPLÈTE. Le serveur renvoie un tableau nu, sans total : une
   * page pleine peut être la dernière, auquel cas la suivante revient vide et le
   * bouton disparaît. Un aller-retour de trop, contre une réponse qui reste compatible
   * avec l'app mobile.
   * ═════════════════════════════════════════════════════════════════════════════════
   */
  const q = useInfiniteQuery({
    queryKey: ["seller-notifications"],
    queryFn: ({ pageParam }) =>
      bff<SellerNotification[]>(`/seller/notifications?take=${TAILLE_PAGE}&skip=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (derniere, toutes) =>
      derniere.length < TAILLE_PAGE ? undefined : toutes.length * TAILLE_PAGE,
  });

  /** Toutes les pages chargées, à plat et DÉDUPLIQUÉES — voir la note ci-dessus. */
  const chargees = useMemo(() => {
    const vues = new Map<string, SellerNotification>();
    for (const n of (q.data?.pages ?? []).flat()) {
      if (!vues.has(n.id)) vues.set(n.id, n);
    }
    return Array.from(vues.values());
  }, [q.data]);

  /**
   * Le compteur vient de l'API, pas d'un décompte de la liste.
   *
   * `ListMyNotificationsQuery` plafonne à 50 : au-delà, un décompte local serait
   * SOUS-ÉVALUÉ, et « Tout marquer comme lu » se désactiverait alors qu'il reste des
   * non-lues plus anciennes — que le serveur, lui, traite toutes.
   */
  const unreadQ = useQuery({
    queryKey: ["seller-unread-count"],
    queryFn: () => bff<{ unread: number }>("/seller/notifications/unread-count"),
  });

  const prefs = useQuery({
    queryKey: ["seller-notification-prefs"],
    queryFn: () => bff<NotificationPreferences>("/seller/notifications/preferences"),
  });

  const rows = useMemo(() => {
    const all = chargees.slice().sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
    return onlyUnread ? all.filter((n) => !n.readAtUtc) : all;
  }, [chargees, onlyUnread]);

  const unreadTotal = unreadQ.data?.unread;

  // Le filtre « Non lues » porte sur CE QUI EST CHARGÉ, et il faut le dire : le badge,
  // lui, vient d'un COUNT serveur. Sans cette phrase, douze lignes sous un badge à 130
  // se lisent comme une panne.
  const nonLuesAilleurs =
    onlyUnread &&
    unreadTotal !== undefined &&
    unreadTotal > chargees.filter((n) => !n.readAtUtc).length;

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["seller-notifications"] }),
      qc.invalidateQueries({ queryKey: ["seller-unread-count"] }),
    ]);

  const markRead = useMutation({
    mutationFn: (id: string) => bff(`/seller/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => invalidate(),
    // ⚠️ PAS de `meta.silent` : ce drapeau coupe AUSSI les erreurs (voir le
    // `MutationCache.onError` de providers.tsx, qui sort en premier sur `silent`).
    // Un échec silencieux laisserait la pastille en place, et le vendeur recliquerait
    // en croyant avoir manqué le bouton. On se contente donc de ne pas annoncer le
    // succès — l'écran le montre déjà — tout en gardant le message d'erreur.
    meta: { successMessage: "", errorMessage: "La notification n'a pas pu être marquée comme lue." },
  });

  const markAllRead = useMutation({
    mutationFn: () => bff("/seller/notifications/read-all", { method: "POST" }),
    onSuccess: () => invalidate(),
    meta: { successMessage: "Toutes vos notifications sont marquées comme lues." },
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // LECTURE ET ÉCRITURE SONT INVERSÉES — c'est le piège de cet écran.
  //
  // GET renvoie `categories: [{ key, enabled }]` ; PUT attend `mutedCategories`,
  // c'est-à-dire la liste des catégories COUPÉES. Envoyer les catégories activées
  // couperait exactement celles que le vendeur vient de demander à recevoir.
  //
  // La conversion se fait ici, en un seul endroit, à partir de l'état affiché.
  // ───────────────────────────────────────────────────────────────────────────────
  const togglePref = useMutation({
    mutationFn: (next: NotificationPreferences) =>
      bff("/seller/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify({
          mutedCategories: next.categories.filter((c) => !c.enabled).map((c) => c.key),
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["seller-notification-prefs"] }),
    meta: {
      successMessage: "Préférences enregistrées.",
      errorMessage: "Les préférences n'ont pas pu être enregistrées.",
    },
  });

  function toggle(key: string) {
    const current = prefs.data;
    if (!current) return;
    togglePref.mutate({
      categories: current.categories.map((c) => (c.key === key ? { ...c, enabled: !c.enabled } : c)),
    });
  }

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {q.isLoading
              ? "Chargement…"
              : q.hasNextPage
                ? `${rows.length} notification(s) affichée(s) — il y en a peut-être de plus anciennes`
                : `${rows.length} notification(s) affichée(s)`}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => markAllRead.mutate()}
          disabled={markAllRead.isPending || q.isLoading || q.isError || unreadTotal === 0}
        >
          {markAllRead.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
          Tout marquer comme lu
        </Button>
      </header>

      <PageNote>
        Ces réglages coupent les <strong>notifications push</strong> par catégorie. Les événements
        continuent d&apos;apparaître dans cette liste : couper une catégorie vous évite d&apos;être
        alerté, cela ne vous prive pas de l&apos;information.
      </PageNote>

      <QueryError of={[q, unreadQ, prefs]} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap gap-2">
            <Button size="sm" variant={onlyUnread ? "outline" : "default"} onClick={() => setOnlyUnread(false)}>
              Toutes
              {!q.isLoading && !q.isError && (
                <span className={onlyUnread ? "text-muted-foreground" : "opacity-80"}>
                  {chargees.length}
                </span>
              )}
            </Button>
            <Button size="sm" variant={onlyUnread ? "default" : "outline"} onClick={() => setOnlyUnread(true)}>
              Non lues
              {/* Total renvoyé par l'API : il englobe les non-lues plus anciennes que
                  les pages chargées. Le bouton « Afficher les plus anciennes » est ce
                  qui permet de les atteindre. */}
              {!unreadQ.isLoading && !unreadQ.isError && unreadTotal !== undefined && (
                <span className={onlyUnread ? "opacity-80" : "text-muted-foreground"}>{unreadTotal}</span>
              )}
            </Button>
          </div>

          {q.isLoading ? (
            <Card className="p-10 text-center text-sm text-muted-foreground">Chargement…</Card>
          ) : q.isError ? (
            <Card className="p-10 text-center text-sm text-muted-foreground">
              Notifications non chargées — voir le message ci-dessus.
            </Card>
          ) : rows.length === 0 ? (
            <Card className="p-10 text-center text-sm text-muted-foreground">
              {onlyUnread ? "Aucune notification non lue." : "Aucune notification."}
            </Card>
          ) : (
            <div className="space-y-2">
              {rows.map((n) => {
                const isUnread = !n.readAtUtc;
                const lien = lienNotification(n.relatedEntityType, n.relatedEntityId);
                return (
                  <Card key={n.id} className={isUnread ? "border-l-2 border-l-primary" : undefined}>
                    <CardContent className="flex items-start gap-3 p-4">
                      <div
                        className={`mt-1 size-2 shrink-0 rounded-full ${isUnread ? "bg-primary" : "bg-transparent"}`}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-sm ${isUnread ? "font-semibold" : "font-medium"}`}>
                            {n.subject}
                          </span>
                          <Badge variant="neutral">{n.channel}</Badge>
                        </div>
                        {n.body && (
                          <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{n.body}</p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatDateTime(n.createdAtUtc)}</span>
                          {/* LE LIEN MARQUE LU EN PARTANT. Le vendeur qui ouvre
                              l'élément a lu la notification — lui laisser en plus un
                              bouton « Marquer lu » à cliquer serait du ménage qu'on
                              lui fait faire pour rien. On ne le fait QUE s'il reste
                              non lue, et on ne bloque pas la navigation dessus : la
                              mutation part, le lien suit son cours. */}
                          {lien && (
                            <Link
                              href={lien}
                              onClick={() => {
                                if (isUnread) markRead.mutate(n.id);
                              }}
                              className="text-primary hover:underline"
                            >
                              Ouvrir
                            </Link>
                          )}
                        </div>
                      </div>
                      {isUnread && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => markRead.mutate(n.id)}
                          // Seule la ligne en cours est désactivée : `markRead.isPending`
                          // seul figeait le bouton de TOUTES les autres notifications.
                          disabled={markRead.isPending && markRead.variables === n.id}
                        >
                          Marquer lu
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              {/* Le filtre travaille sur les pages chargées ; le badge vient d'un COUNT
                  serveur. Quand les deux divergent, c'est qu'il reste des non-lues plus
                  anciennes — et c'est exactement le moment où il faut le dire, sans quoi
                  douze lignes sous un badge à 130 passent pour une panne. */}
              {/* `hasNextPage` se déduit d'une dernière page PLEINE : à 50, 100 ou 150
                  notifications exactement, il reste vrai alors qu'il n'y a plus rien.
                  On ne l'affirme donc pas, on l'annonce comme une possibilité — et le
                  bouton ci-dessous ramène simplement une page vide, ce qui le corrige
                  de lui-même. */}
              {nonLuesAilleurs && q.hasNextPage && (
                <p className="px-1 text-xs text-muted-foreground">
                  Le compteur de non-lues porte sur tout votre historique ; cette liste
                  s&apos;arrête aux notifications chargées.
                </p>
              )}

              {q.hasNextPage && (
                <div className="pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => q.fetchNextPage()}
                    disabled={q.isFetchingNextPage}
                  >
                    {q.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />}
                    Afficher les plus anciennes
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Alertes push</CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {prefs.isLoading ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : prefs.isError ? (
              // Ne PAS afficher d'interrupteurs par défaut : ils suggéreraient un état
              // qu'on ne connaît pas, et un clic écraserait les vrais réglages.
              <div className="text-sm">
                <p className="text-muted-foreground">
                  Vos préférences n&apos;ont pas pu être chargées. Les interrupteurs sont masqués
                  pour ne pas afficher un état qui n&apos;est peut-être pas le vôtre.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => qc.invalidateQueries({ queryKey: ["seller-notification-prefs"] })}
                >
                  Réessayer
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {(prefs.data?.categories ?? []).map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => toggle(c.key)}
                    disabled={togglePref.isPending}
                    aria-pressed={c.enabled}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    <span className="min-w-0">
                      {/* Libellé français si la clé est connue, clé brute sinon : une
                          catégorie ajoutée côté serveur reste visible et actionnable. */}
                      {statusLabel(c.key, "notificationCategory")}
                    </span>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 text-xs ${
                        c.enabled ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {c.enabled ? <Bell className="size-4" /> : <BellOff className="size-4" />}
                      {c.enabled ? "Activé" : "Coupé"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
