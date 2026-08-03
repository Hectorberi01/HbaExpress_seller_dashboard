"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { shipmentTone, statusLabel } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import type { Carrier, ShipmentDetail, ShipmentQueueRow } from "@/types/seller";
import { CheckCircle2, ExternalLink, Loader2, PackageCheck, Truck, XCircle } from "lucide-react";

const TABS = [
  { key: "todo", label: "À préparer" },
  { key: "transit", label: "En transit" },
  { key: "done", label: "Terminées" },
  { key: "all", label: "Toutes" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/**
 * ⚠️ « prepared » ET « preparing » : la file d'exécution renomme le statut du domaine
 * avant de l'envoyer, le détail ne le renomme pas. Les deux orthographes désignent le
 * même état et doivent être traitées ensemble — n'en retenir qu'une ferait disparaître
 * des expéditions d'un onglet.
 */
function inTab(status: string, tab: TabKey): boolean {
  const s = status?.toLowerCase() ?? "";
  if (tab === "all") return true;
  if (tab === "todo") return s === "pending" || s === "preparing" || s === "prepared";
  if (tab === "transit") return s === "shipped";
  return s === "delivered" || s === "cancelled";
}

export default function ShipmentsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("todo");
  const [detailId, setDetailId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["seller-shipments"],
    queryFn: () => bff<ShipmentQueueRow[]>("/seller/shipments"),
  });

  const row = useMemo(
    () => (q.data ?? []).find((s) => s.id === detailId) ?? null,
    [q.data, detailId],
  );

  const rows = useMemo(
    () =>
      (q.data ?? [])
        .filter((s) => inTab(s.status, tab))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [q.data, tab],
  );

  const counts = useMemo(() => {
    const all = q.data ?? [];
    return {
      todo: all.filter((s) => inTab(s.status, "todo")).length,
      transit: all.filter((s) => inTab(s.status, "transit")).length,
      done: all.filter((s) => inTab(s.status, "done")).length,
      all: all.length,
    } as Record<TabKey, number>;
  }, [q.data]);

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Expéditions</h1>
        <p className="text-sm text-muted-foreground">
          {q.isLoading ? "Chargement…" : `${rows.length} expédition(s) dans cette vue`}
        </p>
      </header>

      <PageNote>
        Votre file d&apos;exécution. Une expédition est créée automatiquement à la commande :
        vous la <strong>préparez</strong>, puis vous l&apos;<strong>expédiez</strong> en saisissant
        le transporteur et le numéro de suivi — c&apos;est ce numéro que l&apos;acheteur voit dans
        son application.
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
              <TableHead>Commande</TableHead>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">Articles</TableHead>
              <TableHead>Créée le</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Suivi</TableHead>
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
                  File non chargée — voir le message ci-dessus.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  {tab === "todo" ? "Rien à préparer." : "Aucune expédition dans cette vue."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  role="button"
                  tabIndex={0}
                  aria-label={`Ouvrir l'expédition de la commande ${s.orderReference}`}
                  onClick={() => setDetailId(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDetailId(s.id);
                    }
                  }}
                >
                  {/* `orderReference` est déjà formatée par le serveur : on l'affiche telle
                      quelle plutôt que de reformater l'identifiant et risquer un écart. */}
                  <TableCell className="font-mono text-xs">{s.orderReference}</TableCell>
                  <TableCell className="font-medium">{s.customer}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.itemCount}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(s.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={shipmentTone(s.status)}>
                      {statusLabel(s.status, "shipmentStatus")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.trackingNumber ? (
                      <span className="font-mono">{s.trackingNumber}</span>
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

      <ShipmentDialog
        row={row}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        onChanged={() => qc.invalidateQueries({ queryKey: ["seller-shipments"] })}
      />
    </div>
  );
}

function ShipmentDialog({
  row,
  open,
  onClose,
  onChanged,
}: {
  row: ShipmentQueueRow | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const [pane, setPane] = useState<"none" | "ship" | "cancel">("none");
  const [carrierId, setCarrierId] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [tracking, setTracking] = useState("");

  // Le détail porte les LIGNES de l'expédition, absentes de la file. Chargé à
  // l'ouverture seulement — pas une requête par ligne du tableau.
  const detail = useQuery({
    queryKey: ["seller-shipment", row?.id],
    queryFn: () => bff<ShipmentDetail>(`/seller/shipments/${row?.id}`),
    enabled: open && row !== null,
  });

  // Référentiel plateforme : choisir un transporteur du catalogue produit un lien de
  // suivi cliquable pour l'acheteur, un nom libre non.
  const carriers = useQuery({
    queryKey: ["seller-carriers"],
    queryFn: () => bff<Carrier[]>("/seller/carriers"),
    enabled: open,
  });

  function reset() {
    setPane("none");
    setCarrierId("");
    setCarrierName("");
    setTracking("");
  }

  const post = (path: string, body?: unknown) =>
    bff(`/seller/shipments/${row?.id}/${path}`, {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const prepare = useMutation({
    mutationFn: () => post("prepare"),
    onSuccess: async () => { await onChanged(); reset(); },
    meta: { successMessage: "Expédition marquée en préparation." },
  });

  const chosen = (carriers.data ?? []).find((c) => c.id === carrierId);
  const ship = useMutation({
    mutationFn: () =>
      post("ship", {
        // Le serveur accepte les deux : un identifiant du catalogue (recommandé) ou un
        // nom libre. On envoie le nom du transporteur choisi pour que l'affichage reste
        // lisible même si le référentiel change ensuite.
        carrier: chosen?.name ?? carrierName.trim(),
        trackingNumber: tracking.trim(),
        carrierId: carrierId || null,
      }),
    onSuccess: async () => { await onChanged(); reset(); },
    meta: {
      successMessage: "Expédition confirmée. Le client voit le suivi dans son application.",
      errorMessage: "L'expédition n'a pas pu être confirmée.",
    },
  });

  const deliver = useMutation({
    mutationFn: () => post("deliver"),
    onSuccess: async () => { await onChanged(); reset(); },
    meta: { successMessage: "Livraison confirmée." },
  });

  const cancel = useMutation({
    mutationFn: () => post("cancel"),
    onSuccess: async () => { await onChanged(); reset(); onClose(); },
    meta: { successMessage: "Expédition annulée.", errorMessage: "L'annulation a échoué." },
  });

  const busy = prepare.isPending || ship.isPending || deliver.isPending || cancel.isPending;
  const status = row?.status?.toLowerCase() ?? "";

  // ───────────────────────────────────────────────────────────────────────────────
  // SAISIE LIBRE DÈS QUE LE CATALOGUE NE PROPOSE RIEN — pas seulement s'il échoue.
  //
  // Le repli ne couvrait que `isError`. Un catalogue qui répond correctement une liste
  // vide (ou dont tous les transporteurs sont inactifs) laissait donc un sélecteur sans
  // option : « Confirmer l'expédition » ne s'activait JAMAIS, et rien ne disait
  // pourquoi. Le serveur, lui, accepte un simple nom (`ShipRequest.Carrier`).
  // ───────────────────────────────────────────────────────────────────────────────
  const activeCarriers = (carriers.data ?? []).filter((c) => c.isActive);
  const freeText = carriers.isError || (!carriers.isLoading && activeCarriers.length === 0);
  const canShip = (chosen !== undefined || carrierName.trim().length > 0) && tracking.trim().length > 0;

  return (
    <Dialog
      open={open && row !== null}
      onClose={() => { if (!busy) { reset(); onClose(); } }}
      title={row ? `Expédition · ${row.orderReference}` : ""}
    >
      {row && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={shipmentTone(row.status)}>{statusLabel(row.status, "shipmentStatus")}</Badge>
            <span className="text-sm text-muted-foreground">{row.customer}</span>
            <span className="text-sm text-muted-foreground">· {formatDateTime(row.createdAt)}</span>
          </div>

          <div>
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Articles à expédier ({row.itemCount})
            </div>
            {detail.isLoading ? (
              <p className="text-sm text-muted-foreground">Chargement du détail…</p>
            ) : detail.isError ? (
              // Le nombre d'articles vient de la file, le DÉTAIL des lignes du serveur :
              // on ne prétend pas connaître le contenu qu'on n'a pas pu charger.
              <p className="text-sm text-muted-foreground">
                Le détail des lignes n&apos;a pas pu être chargé. Vérifiez le contenu du colis sur
                la commande avant d&apos;expédier.
              </p>
            ) : (
              <div className="space-y-1.5">
                {(detail.data?.items ?? []).map((it, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                    <span className="font-mono text-xs">{it.sku}</span>
                    <span className="text-sm tabular-nums">× {it.quantity}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {row.trackingNumber && (
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Transporteur</dt>
                <dd>{row.carrier ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Numéro de suivi</dt>
                <dd className="font-mono text-xs">{row.trackingNumber}</dd>
              </div>
              {row.trackingUrl && (
                <div className="flex justify-end">
                  <a
                    href={row.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Suivre le colis <ExternalLink className="size-3" />
                  </a>
                </div>
              )}
            </dl>
          )}

          {pane === "none" && (
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              {status === "pending" && (
                <Button size="sm" onClick={() => prepare.mutate()} disabled={busy}>
                  {prepare.isPending ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />}
                  Marquer en préparation
                </Button>
              )}

              {/* `MarkShipped` accepte Pending OU Preparing : on propose donc l'expédition
                  dès l'état initial, sans imposer un passage par « en préparation ». */}
              {(status === "pending" || status === "preparing" || status === "prepared") && (
                <Button size="sm" onClick={() => setPane("ship")} disabled={busy}>
                  <Truck className="size-4" /> Expédier
                </Button>
              )}

              {status === "shipped" && (
                <Button size="sm" onClick={() => deliver.mutate()} disabled={busy}>
                  {deliver.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  Confirmer la livraison
                </Button>
              )}

              {/* `Shipment.Cancel()` refuse UNIQUEMENT « livrée » et « annulée » : un colis
                  perdu ou refusé en transit doit donc rester annulable. Restreindre ce
                  bouton aux états antérieurs à l'expédition privait la console d'une
                  transition que le serveur accepte, sans rien y gagner. */}
              {status !== "delivered" && status !== "cancelled" && (
                <Button size="sm" variant="outline" onClick={() => setPane("cancel")} disabled={busy}>
                  <XCircle className="size-4" /> Annuler
                </Button>
              )}

              {(status === "delivered" || status === "cancelled") && (
                <p className="text-sm text-muted-foreground">
                  Cette expédition est terminée : aucune action n&apos;est possible.
                </p>
              )}
            </div>
          )}

          {pane === "ship" && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="carrier">Transporteur</Label>
                {freeText ? (
                  <>
                    <Input
                      id="carrier"
                      value={carrierName}
                      onChange={(e) => setCarrierName(e.target.value)}
                      placeholder="Nom du transporteur"
                      autoFocus
                    />
                    <p className="text-xs text-muted-foreground">
                      {carriers.isError
                        ? "La liste des transporteurs n'a pas pu être chargée : saisissez le nom."
                        : "Aucun transporteur au catalogue : saisissez le nom."}{" "}
                      Le lien de suivi cliquable ne sera pas généré.
                    </p>
                  </>
                ) : (
                  <>
                    <select
                      id="carrier"
                      value={carrierId}
                      onChange={(e) => setCarrierId(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">— Choisir —</option>
                      {activeCarriers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Choisir un transporteur du catalogue génère un lien de suivi cliquable pour
                      l&apos;acheteur.
                    </p>
                  </>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tn">Numéro de suivi</Label>
                <Input id="tn" value={tracking} onChange={(e) => setTracking(e.target.value)} />
              </div>

              <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                Ce numéro est immédiatement visible par l&apos;acheteur. Vérifiez-le avant de
                confirmer : le corriger ensuite demande de repasser par le support.
              </p>

              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>
                  Annuler
                </Button>
                <Button size="sm" onClick={() => ship.mutate()} disabled={busy || !canShip}>
                  {ship.isPending && <Loader2 className="size-4 animate-spin" />}
                  Confirmer l&apos;expédition
                </Button>
              </div>
            </div>
          )}

          {pane === "cancel" && (
            <div className="space-y-3 border-t border-border pt-4">
              {/* Ce que fait RÉELLEMENT `Shipment.Cancel()` : poser le statut. Aucun
                  événement de domaine n'est émis — contrairement à MarkShipped et
                  MarkDelivered. Le stock n'est donc PAS libéré et l'acheteur n'est PAS
                  prévenu automatiquement. Promettre ces deux effets aurait conduit un
                  vendeur à ne rien faire d'autre, en croyant la suite prise en charge. */}
              <p className="text-sm">
                Annuler l&apos;expédition de <strong>{row.orderReference}</strong> ?
              </p>
              <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                L&apos;expédition passe en « annulée », et rien d&apos;autre : le stock réservé
                n&apos;est pas libéré automatiquement et l&apos;acheteur n&apos;est pas prévenu.
                Pensez à ajuster votre stock et à écrire au client.
              </p>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>
                  Revenir
                </Button>
                <Button size="sm" variant="destructive" onClick={() => cancel.mutate()} disabled={busy}>
                  {cancel.isPending && <Loader2 className="size-4 animate-spin" />}
                  Annuler l&apos;expédition
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
