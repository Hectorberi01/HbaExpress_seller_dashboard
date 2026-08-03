"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [onlyUnread, setOnlyUnread] = useState(false);

  const q = useQuery({
    queryKey: ["seller-notifications"],
    queryFn: () => bff<SellerNotification[]>("/seller/notifications"),
  });

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
    const all = (q.data ?? []).slice().sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
    return onlyUnread ? all.filter((n) => !n.readAtUtc) : all;
  }, [q.data, onlyUnread]);

  const unreadTotal = unreadQ.data?.unread;

  /** La liste est-elle tronquée ? 50 = plafond de `ListMyNotificationsQuery`. */
  const truncated = (q.data?.length ?? 0) >= 50;

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
              : truncated
                ? `${rows.length} notification(s) affichée(s) — seules les 50 plus récentes sont chargées`
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
                  {(q.data ?? []).length}
                </span>
              )}
            </Button>
            <Button size="sm" variant={onlyUnread ? "default" : "outline"} onClick={() => setOnlyUnread(true)}>
              Non lues
              {/* Total renvoyé par l'API : il englobe les non-lues au-delà des 50
                  dernières, que la liste ci-dessous n'affiche pas. */}
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
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatDateTime(n.createdAtUtc)}
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
