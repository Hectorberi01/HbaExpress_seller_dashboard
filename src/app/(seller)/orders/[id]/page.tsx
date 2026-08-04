"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { mapUrl } from "@/components/location-field";
import { bff } from "@/lib/api";
import { formatDateTime, formatXof, shortId } from "@/lib/utils";
import { orderTone, shipmentTone, statusLabel } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryError } from "@/components/query-error";
import { ImageViewer } from "@/components/image-viewer";
import type { SellerOrderDetail, ShipmentQueueRow } from "@/types/seller";
import {
  ArrowLeft,
  ExternalLink,
  ImageOff,
  MapPin,
  Package,
  Phone,
  Truck,
  User,
} from "lucide-react";

/**
 * Détail d'une commande — page à part entière, plus un dialogue.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE PAGE
 *
 * Le dialogue précédent tenait dans `max-w-md` : adresse de livraison, coordonnées du
 * client, articles et suivi d'expédition s'y empilaient sur une colonne de 28 rem.
 * C'est l'écran qu'un vendeur ouvre pour préparer un colis — donc celui qu'il veut
 * imprimer, garder ouvert dans un onglet, ou envoyer par lien à quelqu'un de son
 * équipe. Un dialogue ne sait faire aucune des trois.
 *
 * CE QUI EST AFFICHÉ, ET CE QUI NE L'EST PAS
 *
 * Le BFF ne renvoie QUE les lignes de ce vendeur (`ScopeToSeller`), et recalcule
 * `subtotal` / `grandTotal` dessus. Sur une commande partagée, ce n'est donc pas ce
 * que l'acheteur a payé — la page le dit explicitement plutôt que d'afficher un
 * « Total » ambigu.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [viewerAt, setViewerAt] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ["seller-order", id],
    queryFn: () => bff<SellerOrderDetail>(`/seller/orders/${id}`),
    enabled: id.length > 0,
  });

  // Expéditions de CETTE commande, filtrées côté BFF sur la boutique du jeton.
  // C'est la partie « informations de livraison » qui bouge : statut, transporteur,
  // numéro de suivi. L'adresse, elle, est figée dans la commande.
  const shipments = useQuery({
    queryKey: ["seller-shipments-by-order", id],
    queryFn: () => bff<ShipmentQueueRow[]>(`/seller/shipments/by-order/${id}`),
    enabled: id.length > 0,
  });

  const order = q.data;

  // Galerie : uniquement les lignes QUI ONT une image (sinon les flèches de la
  // visionneuse sauteraient des positions vides), et DÉDOUBLONNÉE — deux déclinaisons
  // du même produit partagent la même photo principale, et la visionneuse afficherait
  // deux fois la même image en faisant croire à deux articles différents.
  const gallery = useMemo(
    () =>
      Array.from(
        new Set(
          (order?.lines ?? []).map((l) => l.imageUrl).filter((u): u is string => Boolean(u)),
        ),
      ),
    [order?.lines],
  );

  const reference = id ? `CMD-${shortId(id).toUpperCase()}` : "";

  if (q.isLoading) {
    return (
      <div className="p-6 lg:p-8">
        <BackLink />
        <p className="text-sm text-muted-foreground">Chargement de la commande…</p>
      </div>
    );
  }

  if (q.isError || !order) {
    return (
      <div className="p-6 lg:p-8">
        <BackLink />
        <QueryError of={q} />
        <p className="text-sm text-muted-foreground">
          Cette commande est introuvable, ou ne comporte aucune ligne vous concernant.
        </p>
      </div>
    );
  }

  const address = order.shippingAddress;
  const hasAddress =
    address != null &&
    [address.recipient, address.landmark, address.communeName, address.phone].some(
      (v) => v != null && v.trim().length > 0,
    );

  return (
    <div className="p-6 lg:p-8">
      <BackLink />

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{reference}</h1>
          <p className="text-sm text-muted-foreground">
            Passée le {formatDateTime(order.createdAtUtc)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={orderTone(order.status)}>{statusLabel(order.status, "order")}</Badge>
          <Badge variant="neutral">{statusLabel(order.paymentStatus, "payment")}</Badge>
        </div>
      </header>

      <QueryError of={shipments} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ───────────── Colonne principale : les articles ───────────── */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="size-4" /> Vos articles ({order.lines.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {order.lines.map((l, i) => {
                // Index DANS LA GALERIE, pas dans les lignes : une ligne sans image
                // décale tout le reste si l'on prend l'index de boucle.
                const galleryIndex = l.imageUrl ? gallery.indexOf(l.imageUrl) : -1;

                return (
                  <div
                    key={`${l.productId}-${i}`}
                    className="flex items-center gap-3 rounded-xl bg-muted/40 p-3"
                  >
                    {l.imageUrl ? (
                      <button
                        type="button"
                        onClick={() => setViewerAt(galleryIndex < 0 ? 0 : galleryIndex)}
                        aria-label={`Agrandir la photo de ${l.productName ?? l.sku}`}
                        className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={l.imageUrl}
                          alt=""
                          className="size-14 rounded-lg object-cover transition-opacity hover:opacity-80"
                        />
                      </button>
                    ) : (
                      <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <ImageOff className="size-4" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{l.productName ?? l.sku}</div>
                      <div className="font-mono text-xs text-muted-foreground">{l.sku}</div>
                      <Link
                        href={`/products/${l.productId}`}
                        className="text-xs text-primary hover:underline"
                      >
                        Voir la fiche produit
                      </Link>
                    </div>

                    <div className="shrink-0 text-right text-sm">
                      <div className="tabular-nums text-muted-foreground">
                        {l.quantity} × {formatXof(l.finalUnitPrice)}
                      </div>
                      <div className="font-medium tabular-nums">{formatXof(l.lineTotal)}</div>
                    </div>
                  </div>
                );
              })}

              <dl className="space-y-1 border-t border-border pt-3 text-sm">
                {/* Les remises sont DÉJÀ retranchées des lignes : on les montre comme
                    repères, sans les re-soustraire du total — ce serait compter deux fois. */}
                {order.totalSellerDiscount != null && order.totalSellerDiscount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <dt>Dont remise que vous avez financée</dt>
                    <dd className="tabular-nums">{formatXof(order.totalSellerDiscount)}</dd>
                  </div>
                )}
                {order.totalPlatformDiscount != null && order.totalPlatformDiscount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <dt>Dont remise financée par la plateforme</dt>
                    <dd className="tabular-nums">{formatXof(order.totalPlatformDiscount)}</dd>
                  </div>
                )}
                <div className="flex justify-between pt-1 text-base font-semibold">
                  <dt>Total de vos lignes</dt>
                  <dd className="tabular-nums text-primary">{formatXof(order.grandTotal)}</dd>
                </div>
              </dl>

              <p className="text-xs text-muted-foreground">
                Ce total ne couvre que <strong>vos</strong> lignes. Si d&apos;autres vendeurs
                figurent sur cette commande, l&apos;acheteur a payé davantage.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ───────────── Colonne latérale : client, livraison, expéditions ───────────── */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="size-4" /> Client
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0 text-sm">
              <div className="font-medium">{order.customer}</div>
              {address?.phone ? (
                <a
                  href={`tel:${address.phone.replace(/\s/g, "")}`}
                  className="flex items-center gap-1.5 text-primary hover:underline"
                >
                  <Phone className="size-3.5" /> {address.phone}
                </a>
              ) : (
                <p className="text-muted-foreground">Aucun téléphone communiqué.</p>
              )}
              {/* Pas d'e-mail ici : le BFF ne le renvoie pas, et l'échange passe par la
                  messagerie — qui garde une trace en cas de litige. */}
              <Link href="/messages" className="inline-block text-xs text-primary hover:underline">
                Écrire au client (messagerie)
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="size-4" /> Adresse de livraison
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm">
              {!hasAddress ? (
                <p className="text-muted-foreground">
                  Aucune adresse enregistrée sur cette commande.
                </p>
              ) : (
                <address className="not-italic leading-relaxed">
                  {address?.recipient && <div className="font-medium">{address.recipient}</div>}

                  {/* LE REPÈRE EN PREMIER, en évidence. C'est l'information que le
                      coursier utilise réellement — au Bénin, la rue est souvent
                      inexistante et la commune, il la connaît déjà. */}
                  {address?.landmark && <div className="font-medium">{address.landmark}</div>}

                  {address?.quartier && <div>{address.quartier}</div>}
                  {address?.line1 && <div>{address.line1}</div>}
                  <div className="text-muted-foreground">{address?.communeName || "—"}</div>

                  {/* ─────────────────────────────────────────────────────────
                      LE POINT, POUR LE COURSIER.

                      Le livreur n'a pas de compte sur la plateforme. Ce lien est
                      ce que le vendeur lui transmet — par message, ou en le lui
                      montrant à la remise du colis.

                      Absent quand l'acheteur n'a pas partagé sa position : le
                      point de repère, affiché en gras au-dessus, reste la
                      référence.
                     ───────────────────────────────────────────────────────── */}
                  {address?.latitude != null && address?.longitude != null && (
                    <a
                      href={mapUrl({ latitude: address.latitude, longitude: address.longitude })}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-sm text-foreground underline-offset-4 hover:underline"
                    >
                      <MapPin className="size-4" /> Ouvrir dans une carte
                    </a>
                  )}
                  {address?.label && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Libellé : {address.label}
                    </div>
                  )}
                </address>
              )}

              {/* Frais de port : montant de la COMMANDE ENTIÈRE, hors de votre total. */}
              {order.shippingFee != null && order.shippingFee > 0 && (
                <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                  Frais de livraison payés par le client :{" "}
                  <span className="tabular-nums">{formatXof(order.shippingFee)}</span> — pour la
                  commande entière, et non compris dans votre total.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="size-4" /> Expéditions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0 text-sm">
              {shipments.isLoading ? (
                <p className="text-muted-foreground">Chargement…</p>
              ) : shipments.isError ? (
                // On ne dit pas « aucune expédition » quand la requête a échoué : le
                // vendeur en créerait une seconde en doublon.
                <p className="text-muted-foreground">Suivi indisponible pour l&apos;instant.</p>
              ) : (shipments.data ?? []).length === 0 ? (
                <p className="text-muted-foreground">
                  Aucune expédition pour vos lignes. Elle est créée automatiquement une fois la
                  commande payée.
                </p>
              ) : (
                (shipments.data ?? []).map((s) => (
                  <div key={s.id} className="rounded-xl bg-muted/40 p-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <Badge variant={shipmentTone(s.status)}>
                        {statusLabel(s.status, "shipmentStatus")}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{s.itemCount} article(s)</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.carrier ? s.carrier : "Transporteur non renseigné"}
                    </div>
                    {s.trackingNumber && (
                      <div className="font-mono text-xs">{s.trackingNumber}</div>
                    )}
                    {s.trackingUrl && (
                      <a
                        href={s.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Suivre le colis <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                ))
              )}

              <Link href="/shipments">
                <Button variant="outline" size="sm" className="w-full">
                  Préparer et expédier
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      {viewerAt !== null && gallery.length > 0 && (
        <ImageViewer images={gallery} startIndex={viewerAt} onClose={() => setViewerAt(null)} />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/orders"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> Toutes les commandes
    </Link>
  );
}
