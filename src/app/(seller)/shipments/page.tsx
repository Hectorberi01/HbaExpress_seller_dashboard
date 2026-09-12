"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { enPreparation, shipmentTone, statusLabel } from "@/lib/status-labels";
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
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, PackageCheck, Truck, XCircle } from "lucide-react";

const TABS = [
  { key: "todo", label: "À préparer" },
  { key: "transit", label: "En transit" },
  { key: "done", label: "Terminées" },
  { key: "all", label: "Toutes" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * UN SEUL ÉTAT DU DOMAINE, TROIS ORTHOGRAPHES SUR LE FIL — ET IL FAUT LES TROIS.
 *
 * Le domaine dit « Preparing ». La file (`GET /seller/shipments`) le renomme avant de
 * l'envoyer : « ReadyForPickup » aujourd'hui, « Prepared » sur un serveur antérieur au
 * renommage. Le détail (`GET /seller/shipments/{id}`), lui, renvoie la valeur brute.
 *
 * « readyforpickup » manquait, et le défaut ne faisait aucun bruit : ces expéditions
 * tombaient hors de « À préparer » ET hors de « En transit », donc hors des deux seuls
 * onglets qu'un vendeur regarde. Elles ne restaient visibles que dans « Toutes », noyées
 * par ordre de date parmi les livrées et les annulées, avec un statut affiché en
 * anglais. Rien ne disparaissait au sens strict — c'est précisément ce qui rendait le
 * trou invisible.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
function inTab(status: string, tab: TabKey): boolean {
  const s = status?.toLowerCase() ?? "";
  if (tab === "all") return true;
  if (tab === "todo") return s === "pending" || enPreparation(s);
  if (tab === "transit") return s === "shipped";
  return s === "delivered" || s === "cancelled";
}

export default function ShipmentsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("todo");

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * L'EXPÉDITION DEMANDÉE PAR L'URL (`/shipments?id=…`).
   *
   * La fiche commande proposait « Préparer et expédier » vers cette page, sans rien
   * pour désigner l'expédition : le vendeur arrivait sur la file entière, triée par
   * date, et devait y retrouver sa commande à l'œil.
   *
   * On ouvre donc directement le volet de l'expédition visée — et on le fait par
   * `window.location.search` plutôt que `useSearchParams()`, qui forcerait le rendu
   * dynamique et une frontière `Suspense` pour une lecture unique au montage.
   *
   * L'ONGLET N'A PAS À CORRESPONDRE : `row` se cherche dans la liste COMPLÈTE, pas
   * dans `rows` filtré. Une expédition déjà livrée s'ouvre donc bien depuis un lien,
   * même si l'onglet « À traiter » ne la montre pas.
   *
   * LA LECTURE A LIEU DANS UN EFFET, PAS DANS L'INITIALISEUR D'ÉTAT. Ce composant est
   * rendu sur le serveur avant d'être hydraté : un initialiseur qui lit `window`
   * rendrait le volet fermé côté serveur et ouvert côté client, c'est-à-dire une
   * divergence d'hydratation sur le premier rendu.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    const demande = new URLSearchParams(window.location.search).get("id");
    if (demande) setDetailId(demande);
    // Au montage uniquement : rouvrir le volet à chaque rendu empêcherait de le fermer.
  }, []);


  const q = useQuery({
    queryKey: ["seller-shipments"],
    queryFn: () => bff<ShipmentQueueRow[]>("/seller/shipments"),
  });

  const row = useMemo(
    () => (q.data ?? []).find((s) => s.id === detailId) ?? null,
    [q.data, detailId],
  );

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * UN LIEN PÉRIMÉ NE DOIT PAS ÊTRE UN NÉANT SILENCIEUX.
   *
   * `row` se cherche dans la liste chargée, et le volet ne s'ouvre que s'il est
   * trouvé. Si l'identifiant ne correspond à rien — lien ancien, signet, expédition
   * retirée — le vendeur clique, arrive sur la file entière, et ABSOLUMENT RIEN ne se
   * passe : rien ne distingue « elle n'existe plus » de « le lien est cassé » ni de
   * « le clic n'a pas pris ».
   *
   * On attend que la liste soit chargée pour trancher : tant que la requête tourne,
   * une expédition parfaitement valide est « introuvable » elle aussi.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const expeditionIntrouvable =
    detailId !== null && !q.isLoading && !q.isError && row === null;

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
          {/* AUCUN COMPTE ICI. Les pastilles des onglets les donnent tous — y compris
              le total, sur l'onglet « Toutes ». L'en-tête affichait d'abord le compte
              de la vue, doublon de la pastille active ; puis le total, doublon de la
              pastille « Toutes ». Il dit maintenant ce qu'aucune pastille ne dit. */}
          Vos colis à préparer, en transit, livrés ou annulés.
        </p>
      </header>

      {/* La note décrivait un parcours à une seule voie — préparer, puis saisir un
          transporteur — alors que l'expédition par transporteur est le REPLI. Marquer en
          préparation est ce qui propose la course à nos coursiers ; un vendeur qui lisait
          « puis vous l'expédiez » attendait une étape à faire là où, le plus souvent, il
          n'y a qu'un enlèvement à attendre. */}
      <PageNote>
        Votre file d&apos;exécution. Une expédition est créée automatiquement à la commande.
        La marquer <strong>en préparation</strong> propose la course à nos coursiers ; le
        colis attend alors d&apos;être enlevé. Si aucun coursier ne passe le prendre, vous le
        confiez à un <strong>transporteur</strong> en saisissant le nom et le numéro de
        suivi — c&apos;est ce numéro que l&apos;acheteur voit dans son application.
      </PageNote>

      <QueryError of={q} />

      {expeditionIntrouvable && (
        <Card className="mb-4 p-4 text-sm">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">Expédition introuvable</p>
              <p className="text-muted-foreground">
                Le lien que vous avez suivi ne correspond à aucune expédition de votre boutique.
                Elle a pu être retirée, ou le lien est ancien. Votre file complète est
                ci-dessous.
              </p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setDetailId(null)}>
                Fermer cet avertissement
              </Button>
            </div>
          </div>
        </Card>
      )}

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
                    {/* Sans ce repère, l'échec ne se voit qu'en ouvrant l'expédition une
                        par une — c'est-à-dire jamais, puisque rien n'indique laquelle
                        ouvrir. Le motif complet reste dans le détail. */}
                    {s.courierFailureReason && enPreparation(s.status) && (
                      <span className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="size-3 shrink-0" />
                        Coursier en échec
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {/* Un colis porté par un coursier de la plateforme n'a pas de
                        numéro de suivi, et un tiret se lit « personne ne l'a pris ».
                        Le serveur envoie `deliveryMode` pour cette raison exacte. */}
                    {s.trackingNumber ? (
                      <span className="font-mono">{s.trackingNumber}</span>
                    ) : (s.deliveryMode ?? "").toLowerCase() === "courier" ? (
                      "Coursier de la plateforme"
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
        onChanged={async () => {
          // ═══════════════════════════════════════════════════════════════════════
          // LE GESTE SE FAIT ICI, MAIS IL SE LIT AILLEURS.
          //
          // Cette invalidation ne rafraîchissait que la file d'expéditions. Or la
          // carte « Expéditions » de la fiche commande lit une AUTRE clé,
          // `["seller-shipments-by-order", id]`, que rien n'invalidait nulle part dans
          // toute la console — et que `staleTime: 30_000` fige. Les deux routes
          // servent pourtant la MÊME projection côté serveur.
          //
          // Le vendeur partait de la commande, marquait le colis en préparation,
          // revenait sur la commande — et y relisait l'ancien statut avec
          // « Transporteur non renseigné ». Son geste paraissait sans effet à
          // l'endroit précis d'où il l'avait lancé.
          //
          // On invalide par PRÉFIXE, sans l'identifiant : une expédition peut porter
          // des lignes de plusieurs commandes, et on ne sait pas ici lesquelles.
          // ═══════════════════════════════════════════════════════════════════════
          await Promise.all([
            qc.invalidateQueries({ queryKey: ["seller-shipments"] }),
            qc.invalidateQueries({ queryKey: ["seller-shipments-by-order"] }),
          ]);
        }}
        onDelivered={async () => {
          // ═══════════════════════════════════════════════════════════════════════
          // CONFIRMER UNE LIVRAISON DÉBORDE LARGEMENT LA FILE D'EXPÉDITIONS.
          //
          // Deux effets en chaîne côté serveur, tous deux invisibles ici :
          //   • `ReleaseSellerEarningsOnShipmentDeliveredHandler` sort de séquestre
          //     TOUS les gains de ce vendeur sur TOUTE LA COMMANDE — il lit
          //     `ListByOrderAsync(OrderId).Where(SellerId == …)`, pas les lignes de
          //     l'expédition. Il tourne à CHAQUE expédition livrée, mais ne libère
          //     qu'une fois : il ne bascule que les gains encore `Accrued`, donc la
          //     première expédition livrée vide la séquestre de ce vendeur et les
          //     suivantes ne déplacent plus rien. C'est ce que le panneau de
          //     confirmation dit déjà au vendeur, et ce commentaire disait le contraire ;
          //   • quand TOUTES les expéditions d'une commande sont livrées,
          //     `MarkOrderDeliveredOnAllShipmentsDeliveredHandler` fait passer la
          //     commande en « Livrée », ce dont dérivent le total, le « à traiter » et
          //     le donut du tableau de bord.
          //
          // Aucune de ces clés n'était invalidée : le vendeur confirmait sa dernière
          // livraison, passait au tableau de bord, et « À traiter » n'avait pas bougé.
          //
          // LA LIBÉRATION DES GAINS EST ASYNCHRONE (événement d'intégration) : ce
          // rafraîchissement peut arriver avant elle. Il ne garantit donc pas un
          // chiffre à jour à la seconde — il garantit qu'on ne sert plus un chiffre
          // périmé pendant trente secondes sans jamais le redemander.
          // ═══════════════════════════════════════════════════════════════════════
          await Promise.all([
            qc.invalidateQueries({ queryKey: ["seller-dashboard"] }),
            qc.invalidateQueries({ queryKey: ["seller-orders"] }),
            qc.invalidateQueries({ queryKey: ["seller-order"] }),
            qc.invalidateQueries({ queryKey: ["seller-wallet"] }),
            qc.invalidateQueries({ queryKey: ["seller-wallet-tx"] }),
          ]);
        }}
      />
    </div>
  );
}

function ShipmentDialog({
  row,
  open,
  onClose,
  onChanged,
  onDelivered,
}: {
  row: ShipmentQueueRow | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
  /** Appelé EN PLUS de `onChanged` après une livraison confirmée. */
  onDelivered: () => Promise<unknown>;
}) {
  const [pane, setPane] = useState<"none" | "prepare" | "ship" | "cancel" | "deliver">("none");
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
    onSuccess: async () => {
      await Promise.all([onChanged(), onDelivered()]);
      reset();
    },
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

          {/* ═══════════════════════════════════════════════════════════════════════
              LE COURSIER A RENONCÉ, ET L'ÉCRAN N'EN DISAIT RIEN.

              `MarkCourierDeliveryFailed` (Shipment.cs:312-355) ANNOTE l'expédition sans
              l'avancer : elle reste « en préparation », et c'est voulu — c'est l'état
              d'où le repli transporteur est possible. Conséquence : dans la file, un
              colis abandonné par un coursier était rigoureusement identique à un colis
              tout juste préparé. Même statut, même couleur, aucune trace.

              Pendant ce temps le vendeur recevait un push ET un e-mail lui disant
              d'agir (ShipmentNotificationHandlers.cs:134-144). Il ouvrait sa console et
              n'y trouvait rien à quoi rattacher le message. Une alerte qui ne se vérifie
              nulle part finit par être prise pour une erreur du système — et la
              commande, déjà payée, restait immobile.

              CE QUI N'EST PAS PROMIS ICI : aucune nouvelle course n'est reproposée. Le
              seul abonné à `CourierDeliveryFailedIntegrationEvent` est le handler de
              notification ; rien, côté marketplace, ne relance le dispatch. Le repli est
              un geste du vendeur, pas un automatisme.

              LE BANDEAU EST BORNÉ AUX ÉTATS DE PRÉPARATION. `CourierFailureReason`
              n'est jamais effacé : sur un colis reparti depuis par transporteur, il
              deviendrait une demande d'action sur un dossier clos. Au-delà, on garde la
              trace — utile au support — sans la présenter comme une consigne.
              ═══════════════════════════════════════════════════════════════════════ */}
          {row.courierFailureReason && enPreparation(row.status) && (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="flex items-start gap-2 font-medium">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Aucun coursier n&apos;a pu enlever ce colis.
              </p>
              <p>
                Motif indiqué : <span className="italic">{row.courierFailureReason}</span>
              </p>
              <p>
                La commande reste payée et le colis est toujours chez vous. Aucune nouvelle
                course ne sera proposée automatiquement : confiez-le à un transporteur avec
                « Expédier », ou écrivez à l&apos;assistance si ce n&apos;est pas possible.
              </p>
            </div>
          )}

          {/* Le badge dit « En préparation », par cohérence avec le bouton qui y mène.
              Ce qu'il ne peut pas dire tient en deux lignes, et c'est ici qu'il y a la
              place : à cette étape le vendeur n'a plus rien à faire, il ATTEND. Sans
              cette phrase, « en préparation » se lit comme une tâche en cours de son
              côté, et il rappelle le support pour demander ce qu'on attend de lui.
              Masquée dès qu'un coursier a renoncé : le bandeau ci-dessus dit alors le
              contraire, et c'est lui qui a raison. */}
          {enPreparation(row.status) && !row.courierFailureReason && (
            <p className="text-xs text-muted-foreground">
              La course est proposée à nos coursiers : le colis attend d&apos;être enlevé, vous
              n&apos;avez rien à faire. Si personne ne passe le prendre, confiez-le à un
              transporteur avec « Expédier ».
            </p>
          )}

          {row.courierFailureReason && !enPreparation(row.status) && (
            <p className="text-xs text-muted-foreground">
              Une course de coursier a échoué sur ce colis — motif indiqué :{" "}
              <span className="italic">{row.courierFailureReason}</span>
            </p>
          )}

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
              {/* ═══════════════════════════════════════════════════════════════════
                  CE GESTE DISPATCHE UNE COURSE, ET IL N'A PAS D'INVERSE.

                  L'écran le présentait comme une simple écriture d'état, au premier
                  clic. Vérifié côté domaine : `MarkPreparing` lève
                  `ShipmentPreparingDomainEvent`, qui publie `OrderReadyForDelivery`
                  vers le service de dispatch — le seul déclencheur de la livraison — et
                  aucune méthode de `Shipment` ne ramène à `Pending`. Un clic de travers
                  propose donc à des coursiers un colis qui n'est pas prêt, sans retour
                  possible.
                  ═══════════════════════════════════════════════════════════════════ */}
              {status === "pending" && (
                <Button size="sm" onClick={() => setPane("prepare")} disabled={busy}>
                  <PackageCheck className="size-4" /> Marquer en préparation
                </Button>
              )}

              {/* ═══════════════════════════════════════════════════════════════════
                  « EXPÉDIER » NE S'AFFICHE PLUS DEPUIS « À PRÉPARER », ET C'EST LE
                  CODE SERVEUR QUI A CHANGÉ — PAS UN DURCISSEMENT D'INTERFACE.

                  Le commentaire qui vivait ici affirmait que `MarkShipped` acceptait
                  Pending OU Preparing. Ce n'est plus vrai : `Shipment.cs:159-162`
                  refuse tout état autre que Preparing, et la garde porte la raison —
                  c'est `MarkPreparing` qui lève `ShipmentPreparingDomainEvent`, donc
                  qui publie `OrderReadyForDelivery`, donc qui CRÉE la course chez le
                  service de dispatch.

                  Le bouton ne se contentait donc pas d'être en avance sur le serveur :
                  il offrait le raccourci que la garde a été écrite pour fermer. Le
                  vendeur qui le prenait passait de « à préparer » à « expédiée » sans
                  qu'aucune course n'existe jamais. Depuis la garde, ce même clic ne
                  produit plus qu'un 409 que rien n'explique à l'écran.

                  Un bouton qu'on retire vaut mieux qu'un bouton qui échoue : l'ordre
                  des deux gestes est maintenant lisible dans l'interface elle-même.
                  ═══════════════════════════════════════════════════════════════════ */}
              {enPreparation(status) && (
                <Button size="sm" onClick={() => setPane("ship")} disabled={busy}>
                  <Truck className="size-4" /> Expédier
                </Button>
              )}

              {status === "pending" && (
                <p className="w-full text-xs text-muted-foreground">
                  Marquez d&apos;abord l&apos;expédition en préparation : c&apos;est ce geste qui
                  propose la course à nos coursiers. Le transporteur tiers ne vient qu&apos;ensuite,
                  si aucun coursier ne passe prendre le colis.
                </p>
              )}

              {status === "shipped" && (
                <Button size="sm" onClick={() => setPane("deliver")} disabled={busy}>
                  <CheckCircle2 className="size-4" /> Confirmer la livraison
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

          {pane === "prepare" && (
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-sm">
                Marquer <strong>{row.orderReference}</strong> en préparation ?
              </p>
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-medium">SANS RETOUR. Rien ne permet de revenir à « À préparer ».</p>
                <p>
                  Ce n&apos;est pas qu&apos;un changement d&apos;état : c&apos;est ce geste qui
                  propose la course à nos coursiers. L&apos;un d&apos;eux peut passer prendre le
                  colis dans la foulée.
                </p>
                <p>Ne le faites qu&apos;une fois le colis réellement emballé et prêt à partir.</p>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={reset} disabled={busy} autoFocus>
                  Revenir
                </Button>
                <Button size="sm" onClick={() => prepare.mutate()} disabled={busy}>
                  {prepare.isPending && <Loader2 className="size-4 animate-spin" />}
                  Marquer en préparation
                </Button>
              </div>
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

          {/* ═══════════════════════════════════════════════════════════════════════
              CE BOUTON LIBÈRE L'ARGENT. IL PARTAIT AU PREMIER CLIC.

              `deliver.mutate()` était appelé directement depuis la liste « En transit »,
              sans panneau — alors que « Expédier » et « Annuler », deux gestes moins
              lourds, en ont un chacun.

              Ce que `MarkDelivered` déclenche, vérifié côté serveur — et les deux
              portées sont plus larges qu'on ne le croirait :

                • `ReleaseSellerEarningsOnShipmentDeliveredHandler:36-37` libère la
                  séquestre sur `ListByOrderAsync(OrderId).Where(SellerId == …)` : ce
                  sont TOUS les gains de ce vendeur sur TOUTE LA COMMANDE, pas ceux de
                  l'expédition confirmée. Un vendeur qui expédie depuis deux lieux
                  libère donc aussi la part encore en entrepôt.

                • `MarkOrderDeliveredOnAllShipmentsDeliveredHandler:37-41` ne marque la
                  commande livrée que si `shipments.All(… Delivered)`. Or les
                  expéditions sont créées par (vendeur, lieu d'expédition)
                  (`CreateShipmentsOnOrderConfirmedHandler:43`) : sur une commande
                  multi-vendeurs, confirmer SA part ne fait rien passer du tout, et la
                  fenêtre de retour ne démarre pas. Une première version de ce panneau
                  l'annonçait comme certain — c'était remplacer un silence par une
                  affirmation fausse.

              Et il n'y a pas de retour : `Shipment.Cancel()` refuse un état `Delivered`.
              Un clic de travers déclare livré un colis encore en route, et rien ne
              permet de revenir dessus.
              ═══════════════════════════════════════════════════════════════════════ */}
          {pane === "deliver" && (
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-sm">
                Confirmer la livraison de <strong>{row.orderReference}</strong> ?
              </p>
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-medium">SANS RETOUR. Une expédition livrée ne s&apos;annule plus.</p>
                <p>
                  Vos gains sur <strong>toute cette commande</strong> sortent de la séquestre et
                  deviennent retirables — y compris ceux d&apos;une autre expédition de la même
                  commande qui serait encore chez vous.
                </p>
                <p>
                  Quand toutes les expéditions de la commande sont livrées, la commande passe en
                  « livrée » et le délai de retour de l&apos;acheteur démarre. Sur une commande
                  partagée avec un autre vendeur, cela n&apos;arrive qu&apos;une fois sa part livrée
                  aussi.
                </p>
                <p>Ne confirmez qu&apos;une fois le colis réellement remis.</p>
              </div>
              <div className="flex justify-end gap-2">
                {/* Volet sans champ : sans `autoFocus`, le focus retombe sur le document
                    quand le bouton d'origine est démonté. Il va au retrait, jamais à la
                    confirmation — « Entrée » ne doit pas libérer l'argent. */}
                <Button size="sm" variant="ghost" onClick={reset} disabled={busy} autoFocus>
                  Revenir
                </Button>
                <Button size="sm" onClick={() => deliver.mutate()} disabled={busy}>
                  {deliver.isPending && <Loader2 className="size-4 animate-spin" />}
                  Confirmer la livraison
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
