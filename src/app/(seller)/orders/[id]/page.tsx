"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { mapUrl } from "@/components/location-field";
import { bff } from "@/lib/api";
import { formatDateTime, formatMoney, shortId } from "@/lib/utils";
import { enPreparation, orderTone, shipmentTone, statusLabel } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryError } from "@/components/query-error";
import { ImageViewer } from "@/components/image-viewer";
import type { SellerConversation, SellerOrderDetail, ShipmentQueueRow } from "@/types/seller";
import {
  AlertTriangle,
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

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * LE FIL DE CET ACHETEUR — S'IL EXISTE, ET IL N'EXISTE SOUVENT PAS.
   *
   * « Écrire au client » pointait sur `/messages` sans identifiant. L'écran de
   * messagerie, qui ne lisait aucun paramètre, ouvrait le fil le PLUS RÉCENT : le
   * vendeur atterrissait donc dans la conversation d'un autre client, sans que rien
   * ne le signale.
   *
   * ET SUR UNE COMMANDE DONT L'ACHETEUR N'A JAMAIS ÉCRIT, LE BOUTON NE POUVAIT RIEN
   * PRODUIRE : le BFF vendeur ne monte AUCUNE route de création de conversation —
   * seulement la liste, l'envoi dans un fil existant, les pièces jointes, les
   * réactions et les suppressions. Seul l'acheteur peut ouvrir un fil, depuis son
   * application. L'écran de messagerie le dit d'ailleurs lui-même.
   *
   * On rapproche donc par `counterpartId` — l'identifiant Identity de l'autre
   * participant, le même espace que `buyerId`. Pas par le nom : il se replie sur
   * « Client » quand Identity ne répond pas, et deux acheteurs peuvent être
   * homonymes.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const conversations = useQuery({
    queryKey: ["seller-conversations"],
    queryFn: () => bff<SellerConversation[]>("/seller/conversations"),
    enabled: id.length > 0,
  });

  const order = q.data;

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * CE QUI RESTE À FAIRE SUR CETTE COMMANDE, CÔTÉ EXPÉDITION.
   *
   * Le bouton « Préparer et expédier » était rendu HORS de toute condition : à
   * l'identique quand la carte venait d'écrire « Aucune expédition pour vos lignes »,
   * quand le chargement avait échoué, et quand tout était livré ou annulé — cas où
   * l'écran d'arrivée répond « Cette expédition est terminée : aucune action n'est
   * possible ».
   *
   * Les quatre gestes de l'écran Expéditions correspondent exactement aux gardes du
   * domaine : `MarkPreparing` exige `Pending`, `MarkShipped` exige `Preparing`,
   * `MarkDelivered` exige `Shipped`, et `Cancel()` refuse `Delivered` et `Cancelled`.
   * Une expédition livrée ou annulée n'accepte donc AUCUN des quatre : c'est la
   * définition de « rien à y faire ».
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const expeditionAFaire = useMemo(() => {
    const termine = (s: string) => {
      const v = (s ?? "").toLowerCase();
      return v === "delivered" || v === "cancelled" || v === "canceled";
    };
    return (shipments.data ?? []).find((s) => !termine(s.status)) ?? null;
  }, [shipments.data]);

  const filClient = useMemo(() => {
    const buyer = order?.buyerId;
    if (!buyer) return null;
    return (
      (conversations.data ?? []).find(
        (c) => (c.counterpartId ?? "").toLowerCase() === buyer.toLowerCase(),
      ) ?? null
    );
  }, [conversations.data, order?.buyerId]);

  /**
   * Le serveur projette-t-il `counterpartId` ?
   *
   * TROISIÈME CAUSE D'UN `filClient` NUL, et la plus sournoise : sur un BFF antérieur
   * à cette projection, la liste arrive complète mais sans le champ qui permet de
   * rapprocher. Tous les fils existent, aucun ne correspond, et l'écran conclurait à
   * l'absence. On distingue le cas — des conversations, mais aucune ne porte
   * l'identifiant — plutôt que d'affirmer quelque chose qu'on ne sait pas.
   */
  const projectionAbsente = useMemo(() => {
    const fils = conversations.data ?? [];
    return fils.length > 0 && fils.every((c) => c.counterpartId == null);
  }, [conversations.data]);

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
          {/* Second badge retiré, comme la colonne « Paiement » de la liste :
              `paymentStatus` est une traduction PURE de `status` côté BFF
              (`ToPaymentStatus`), aucune donnée de paiement n'est lue. Deux badges
              donnaient l'illusion de deux faits indépendants. */}
        </div>
      </header>

      <QueryError of={[shipments, conversations]} />

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
                        {l.quantity} × {formatMoney(l.finalUnitPrice, order.currency)}
                      </div>
                      <div className="font-medium tabular-nums">{formatMoney(l.lineTotal, order.currency)}</div>
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
                    <dd className="tabular-nums">{formatMoney(order.totalSellerDiscount, order.currency)}</dd>
                  </div>
                )}
                {order.totalPlatformDiscount != null && order.totalPlatformDiscount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <dt>Dont remise financée par la plateforme</dt>
                    <dd className="tabular-nums">{formatMoney(order.totalPlatformDiscount, order.currency)}</dd>
                  </div>
                )}
                <div className="flex justify-between pt-1 text-base font-semibold">
                  <dt>Total de vos lignes</dt>
                  <dd className="tabular-nums text-primary">{formatMoney(order.grandTotal, order.currency)}</dd>
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
              {conversations.isLoading ? (
                <p className="text-xs text-muted-foreground">Recherche du fil de discussion…</p>
              ) : filClient ? (
                <Link
                  href={`/messages?c=${filClient.id}`}
                  className="inline-block text-xs text-primary hover:underline"
                >
                  Ouvrir la conversation avec ce client
                  {filClient.unread > 0 && ` (${filClient.unread} non lu${filClient.unread > 1 ? "s" : ""})`}
                </Link>
              ) : projectionAbsente ? (
                <Link href="/messages" className="inline-block text-xs text-primary hover:underline">
                  Ouvrir la messagerie
                </Link>
              ) : conversations.isError ? (
                // « AUCUNE CONVERSATION » NE SE DIT PAS SUR UNE PANNE. `filClient` est
                // nul dans trois cas — aucun fil, requête échouée, serveur qui ne
                // projette pas encore `counterpartId` — et un seul les justifie. La
                // première rédaction affirmait l'absence dans les trois ; la deuxième
                // n'en couvrait que celui-ci. Le troisième est traité juste au-dessus
                // par `projectionAbsente`, qui se contente d'ouvrir la messagerie.
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Vos conversations n&apos;ont pas pu être chargées : impossible de dire si ce
                  client vous a écrit.{" "}
                  <Link href="/messages" className="text-primary hover:underline">
                    Ouvrir la messagerie
                  </Link>
                </p>
              ) : (
                // ON NE PROPOSE PLUS RIEN, ET ON DIT POURQUOI. Un lien vers la
                // messagerie n'ouvrirait pas de fil : la console n'a pas de quoi en
                // créer un — le BFF vendeur ne monte aucune route de création, et
                // l'app mobile non plus. Laisser le bouton en promettant l'inverse
                // coûtait au vendeur un aller-retour et la lecture d'un échange qui
                // n'est pas le sien.
                <p className="text-xs text-muted-foreground">
                  Aucune conversation avec ce client. C&apos;est l&apos;acheteur qui ouvre un
                  fil depuis son application ; vous pourrez alors lui répondre depuis la
                  messagerie.
                </p>
              )}
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
                  <span className="tabular-nums">{formatMoney(order.shippingFee, order.currency)}</span> — pour la
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
                    {/* Cet écran charge `/seller/shipments/by-order/{id}`, donc les mêmes
                        lignes que la file — motif d'échec compris. Ne pas le montrer ici
                        laissait subsister, sur la page où le vendeur vient chercher « où en
                        est cette commande », l'ambiguïté exacte que le champ ferme :
                        « personne ne l'a encore pris » et « un coursier a renoncé » y
                        restaient identiques. Un mot, et le détail de l'expédition porte le
                        motif complet. */}
                    {s.courierFailureReason && enPreparation(s.status) && (
                      <div className="mb-1 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                        <span>
                          Coursier en échec — à confier à un transporteur depuis les expéditions.
                        </span>
                      </div>
                    )}
                    {/* ═══════════════════════════════════════════════════════════
                        « TRANSPORTEUR NON RENSEIGNÉ » S'AFFICHAIT SUR UN COLIS PORTÉ
                        PAR UN COURSIER DE LA PLATEFORME.

                        Une livraison par coursier interne n'a NI transporteur NI numéro
                        de suivi — c'est normal, une moto n'en a pas. Le serveur envoie
                        `deliveryMode` précisément pour lever l'ambiguïté, et le contrat
                        le dit : sans lui « l'application ne pouvait pas distinguer
                        "porté par notre coursier" de "pas encore expédié" ». Ce champ
                        n'était pas déclaré côté console, donc les deux situations
                        s'affichaient à l'identique — l'une appelant une action du
                        vendeur, l'autre non.
                        ═══════════════════════════════════════════════════════════ */}
                    <div className="text-xs text-muted-foreground">
                      {(s.deliveryMode ?? "").toLowerCase() === "courier"
                        ? "Porté par un coursier de la plateforme"
                        : s.carrier
                          ? s.carrier
                          : "Transporteur non renseigné"}
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

              {/* LE LIEN PORTE L'IDENTIFIANT : l'écran Expéditions ouvre directement
                  le volet de CETTE expédition. Sans lui, le vendeur arrivait sur la
                  file entière, triée par date, et devait y retrouver sa commande à
                  l'œil. */}
              {expeditionAFaire && (
                <Link href={`/shipments?id=${expeditionAFaire.id}`}>
                  <Button variant="outline" size="sm" className="w-full">
                    Préparer et expédier
                  </Button>
                </Link>
              )}

              {/* Tout est livré ou annulé : on le dit plutôt que d'offrir un bouton
                  qui mène à un écran répondant « aucune action n'est possible ». */}
              {!shipments.isLoading &&
                !shipments.isError &&
                (shipments.data ?? []).length > 0 &&
                !expeditionAFaire && (
                  <p className="text-xs text-muted-foreground">
                    Plus rien à préparer sur cette commande.
                  </p>
                )}
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
