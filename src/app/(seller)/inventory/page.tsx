"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { useDroitDeVendre } from "@/lib/selling";
import { useAutoChoisirUnique } from "@/lib/auto-choice";
import { shortId } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CommuneSelect } from "@/components/commune-select";
import { LocationField, mapUrl, type GeoPoint } from "@/components/location-field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import { ReadOnlyNote } from "@/components/read-only-note";
import type {
  FulfillmentLocation,
  InventoryItem,
  SellerOffer,
  SellerProduct,
} from "@/types/seller";
import { AlertTriangle, Loader2, MapPin, PackagePlus, Plus, Search, SlidersHorizontal } from "lucide-react";

/**
 * Libellé court d'un lieu d'expédition : commune + point de repère.
 *
 * Le repère plutôt que la rue, parce que c'est lui qui distingue deux entrepôts
 * d'une même commune — et parce que beaucoup de lieux n'ont pas de rue.
 */
function locationLabel(l: { communeName: string; landmark?: string | null; line?: string | null }): string {
  const detail = l.landmark || l.line;
  return detail ? `${l.communeName} — ${detail}` : l.communeName;
}

/**
 * ═════════════════════════════════════════════════════════════════════════════════
 * « J'AI CRÉÉ MON ENTREPÔT, ET IL N'APPARAÎT PAS DANS LE TABLEAU. »
 *
 * Il n'y apparaîtra jamais : CE TABLEAU LISTE DES RÉFÉRENCES SUIVIES, PAS DES
 * ENTREPÔTS. L'entrepôt est une colonne de ce tableau, pas une de ses lignes — il se
 * consulte par le bouton « Entrepôts ».
 *
 * Le malentendu venait entièrement d'ici. Tant qu'aucun entrepôt n'existe, la page
 * affiche une carte qui explique quoi faire ; dès le premier créé, cette carte
 * disparaît et il ne reste que « Aucune référence suivie. » — trois mots qui, juste
 * après une création réussie, se lisent comme « votre création n'a rien donné ».
 *
 * On dit donc les deux choses que le vendeur cherche à ce moment précis : que ses
 * entrepôts sont bien enregistrés, et ce qu'il reste à faire pour remplir ce tableau.
 * ═════════════════════════════════════════════════════════════════════════════════
 */
function VideSansReference({ entrepots }: { entrepots: number }) {
  if (entrepots === 0) {
    // La carte « Aucun entrepôt déclaré », au-dessus, porte déjà l'explication et le
    // bouton. La répéter ici donnerait deux appels à l'action pour un seul geste.
    return <>Aucune référence suivie.</>;
  }

  return (
    <span className="mx-auto block max-w-md space-y-1.5">
      <span className="block font-medium text-foreground">Aucune référence suivie.</span>
      <span className="block">
        {entrepots === 1 ? "Votre entrepôt est bien enregistré" : `Vos ${entrepots} entrepôts sont bien enregistrés`}
        {" — ce tableau ne les liste pas, il liste les SKU dont vous suivez le stock, un par "}
        entrepôt. Le bouton « Entrepôts » les affiche et permet de les corriger.
      </span>
      <span className="block">
        Pour remplir ce tableau, ouvrez une référence avec « Suivre une référence » : le stock se
        déclare sur une déclinaison de vos fiches produit, qu&apos;elle soit déjà mise en vente
        ou non.
      </span>
    </span>
  );
}

export default function InventoryPage() {
  const qc = useQueryClient();
  const droit = useDroitDeVendre();
  const [search, setSearch] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [pane, setPane] = useState<"none" | "location" | "item">("none");
  /** Incrémenté à chaque ouverture du dialogue « Suivre une référence » — voir sa clé. */
  const [ouvertures, setOuvertures] = useState(0);
  const [editId, setEditId] = useState<string | null>(null);

  const items = useQuery({
    queryKey: ["seller-inventory"],
    queryFn: () => bff<InventoryItem[]>("/seller/inventory"),
  });
  const locations = useQuery({
    queryKey: ["seller-locations"],
    queryFn: () => bff<FulfillmentLocation[]>("/seller/locations"),
  });

  // Nommée `locationLabels` (pluriel) : `locationLabel` est la fonction du module.
  // Réutiliser le même nom la masquait, et `locationLabel(l)` appelait alors la Map.
  const locationLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of locations.data ?? []) m.set(l.id, locationLabel(l));
    return m;
  }, [locations.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (items.data ?? [])
      .filter((i) => (onlyLow ? i.isLowStock : true))
      .filter((i) => (needle ? i.sku.toLowerCase().includes(needle) : true))
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [items.data, search, onlyLow]);

  const lowCount = useMemo(() => (items.data ?? []).filter((i) => i.isLowStock).length, [items.data]);

  /**
   * L'article géré est REDÉRIVÉ de la liste, jamais copié dans le state. Une copie
   * figée continuait d'afficher les quantités d'AVANT la réception, sous un toast de
   * succès — pendant que le tableau derrière, lui, montrait les bonnes. Deux chiffres
   * contradictoires au même instant, et aucun moyen de savoir lequel croire.
   */
  const edit = useMemo(
    () => (items.data ?? []).find((i) => i.id === editId) ?? null,
    [items.data, editId],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["seller-inventory"] });

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stock</h1>
          <p className="text-sm text-muted-foreground">
            {items.isLoading ? "Chargement…" : `${rows.length} référence(s) affichée(s)`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPane("location")}>
            <MapPin className="size-4" /> Entrepôts
          </Button>
          {/* Désactivé faute d'entrepôt, PAS faute d'avoir pu les charger : sur erreur
              on laisse le bouton actif, le dialogue expliquera.

              `title` RETIRÉ : `disabled:pointer-events-none` (components/ui/button.tsx)
              empêche tout survol sur un bouton désactivé, donc l'infobulle ne
              s'affichait jamais — ni à la souris, ni au doigt. Le motif est dans le
              bandeau juste en dessous. */}
          <Button
            onClick={() => {
              setOuvertures((n) => n + 1);
              setPane("item");
            }}
            disabled={droit.bloque || (!locations.isError && (locations.data ?? []).length === 0)}
          >
            <PackagePlus className="size-4" /> Suivre une référence
          </Button>
        </div>
      </header>

      <PageNote>
        <strong>Disponible</strong> est le seul chiffre qui compte pour vendre : c&apos;est le stock
        physique moins ce qui est déjà réservé par des commandes en cours. Une réception ajoute du
        stock ; un ajustement corrige un écart d&apos;inventaire, dans un sens ou dans l&apos;autre.
      </PageNote>

      <QueryError of={[items, locations]} />

      {/* ═══════════════════════════════════════════════════════════════════════════
          LE DROIT D'ÉCRIRE, DIT UNE FOIS EN HAUT PLUTÔT QU'À CHAQUE BOUTON.

          Les écritures de cet écran — suivi d'une référence, réception, ajustement,
          seuil, entrepôts — passent toutes par `ResolveSellingSellerAsync`
          (`SellerInventoryEndpoints` : `GuardItemAsync` pour les articles, appel
          direct pour les lieux). Sans ce bandeau, une boutique suspendue ou fermée
          découvrait le refus bouton par bouton, APRÈS avoir saisi.

          La LECTURE reste ouverte, et l'écran la garde ouverte : le tableau, la liste
          des entrepôts et la carte restent consultables.
          ═══════════════════════════════════════════════════════════════════════════ */}
      {droit.bloque && (
        <Card className="mb-4 p-4 text-sm">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <p className="font-medium">Modifications indisponibles</p>
              <p className="text-muted-foreground">{droit.raison}</p>
              <p className="text-muted-foreground">
                Vous pouvez toujours consulter vos stocks et vos entrepôts ; seules les
                écritures sont suspendues.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Un stock ne peut exister sans entrepôt : le dire plutôt que d'afficher un
          tableau vide qu'on ne saurait pas remplir. */}
      {!locations.isLoading && !locations.isError && (locations.data ?? []).length === 0 && (
        <Card className="mb-4 p-4 text-sm">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">Aucun entrepôt déclaré.</p>
              <p className="text-muted-foreground">
                Un article de stock est rattaché à un lieu d&apos;expédition. Créez-en un avant de
                suivre vos références — c&apos;est aussi ce lieu qui sert d&apos;adresse de départ à
                vos offres.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => setPane("location")}
                disabled={droit.bloque}
              >
                <Plus className="size-4" /> Créer un entrepôt
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un SKU…"
            className="pl-9"
          />
        </div>
        <Button size="sm" variant={onlyLow ? "default" : "outline"} onClick={() => setOnlyLow((v) => !v)}>
          <AlertTriangle className="size-4" /> Stock bas
          {!items.isLoading && !items.isError && (
            <span className={onlyLow ? "opacity-80" : "text-muted-foreground"}>{lowCount}</span>
          )}
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Entrepôt</TableHead>
              <TableHead className="text-right">Physique</TableHead>
              <TableHead className="text-right">Réservé</TableHead>
              <TableHead className="text-right">Disponible</TableHead>
              <TableHead className="text-right">Seuil d&apos;alerte</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Chargement…
                </TableCell>
              </TableRow>
            ) : items.isError ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Stock non chargé — voir le message ci-dessus.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  {onlyLow ? (
                    "Aucune référence sous son seuil d'alerte."
                  ) : search ? (
                    "Aucune référence ne correspond."
                  ) : (
                    <VideSansReference entrepots={(locations.data ?? []).length} />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-mono text-xs">{i.sku}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {/* La localisation peut manquer si la requête « entrepôts » a échoué :
                        on montre l'identifiant court plutôt qu'un tiret, qui laisserait
                        croire à un article orphelin. */}
                    {locationLabels.get(i.locationId) ?? (
                      <span className="font-mono text-xs">{shortId(i.locationId)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{i.onHand}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {i.reserved > 0 ? `−${i.reserved}` : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={`font-medium tabular-nums ${i.available <= 0 ? "text-destructive" : ""}`}
                    >
                      {i.available}
                    </span>
                    {i.isLowStock && (
                      <Badge variant="warning" className="ml-2">
                        bas
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {i.reorderThreshold}
                  </TableCell>
                  <TableCell className="text-right">
                    {/* Le dialogue « Gérer » ne contient QUE des écritures — réception,
                        ajustement, seuil — toutes gardées par `GuardItemAsync`. Rien à
                        y lire que la ligne du tableau ne montre déjà. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditId(i.id)}
                      disabled={droit.bloque}
                    >
                      <SlidersHorizontal className="size-4" /> Gérer
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <LocationsDialog
        open={pane === "location"}
        onClose={() => setPane("none")}
        locations={locations.data ?? []}
        loading={locations.isLoading}
        failed={locations.isError}
        lectureSeule={droit.bloque}
        onChanged={() => qc.invalidateQueries({ queryKey: ["seller-locations"] })}
      />

      {/* `key` REMONTÉE À CHAQUE OUVERTURE, comme le fait déjà le dialogue de mise en
          vente. Ce dialogue reste monté en permanence : sans clé, l'état interne du
          hook de présélection survivait à `reset()`, et la deuxième référence suivie
          d'affilée se retrouvait sans entrepôt présélectionné alors que la première
          l'avait eu. Deux comportements pour le même geste, selon qu'on l'a déjà fait
          ou non. */}
      <CreateItemDialog
        key={`item-${ouvertures}`}
        open={pane === "item"}
        onClose={() => setPane("none")}
        locations={locations.data ?? []}
        onCreated={invalidate}
      />

      <ManageItemDialog item={edit} onClose={() => setEditId(null)} onChanged={invalidate} />
    </div>
  );
}

/** Gestion des lieux d'expédition : lister, créer, supprimer. */
function LocationsDialog({
  open,
  onClose,
  locations,
  loading,
  failed,
  lectureSeule = false,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  locations: FulfillmentLocation[];
  loading: boolean;
  failed: boolean;
  /**
   * La boutique n'a plus le droit d'écrire. Créer, corriger et supprimer un lieu
   * passent par `ResolveSellingSellerAsync` ; la LISTE, elle, reste servie — ce
   * dialogue reste donc ouvrable, avec ses seules commandes neutralisées.
   */
  lectureSeule?: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const [communeCode, setCommuneCode] = useState("");
  const [quartier, setQuartier] = useState("");
  const [landmark, setLandmark] = useState("");
  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [line, setLine] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<FulfillmentLocation | null>(null);

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * UNE ADRESSE D'ENTREPÔT NE POUVAIT PAS ÊTRE CORRIGÉE DU TOUT.
   *
   * Le BFF ne montait que `GET`, `POST` et `DELETE` sur `/seller/locations`. Une faute
   * dans un quartier, un point de repère devenu faux, un déménagement : la seule
   * manœuvre était de supprimer puis recréer — ce que le serveur REFUSE tant qu'une
   * référence est suivie à cet endroit. Un vendeur avec du stock était donc enfermé
   * avec son adresse fausse, celle-là même que reçoit le coursier à chaque commande.
   *
   * La route `PUT` existe désormais (le module avait déjà la commande, sans porte).
   * Ce formulaire sert à la création ET à la correction : deux formulaires jumeaux
   * auraient divergé au premier champ ajouté.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const [enEdition, setEnEdition] = useState<FulfillmentLocation | null>(null);

  function chargerPourEdition(l: FulfillmentLocation) {
    setEnEdition(l);
    setCommuneCode(l.communeCode ?? "");
    setQuartier(l.quartier ?? "");
    setLandmark(l.landmark ?? "");
    setLine(l.line ?? "");
    setPoint(
      l.latitude != null && l.longitude != null
        ? { latitude: l.latitude, longitude: l.longitude }
        : null,
    );
  }

  function viderFormulaire() {
    setEnEdition(null);
    setCommuneCode("");
    setQuartier("");
    setLandmark("");
    setPoint(null);
    setLine("");
  }

  /** Le corps est identique pour la création et la correction. */
  function corpsAdresse() {
    return JSON.stringify({
      // Le serveur attend « commune » et accepte code ou libellé. On envoie le code.
      commune: communeCode,
      quartier: quartier.trim() || null,
      landmark: landmark.trim(),
      line: line.trim() || null,
      latitude: point?.latitude ?? null,
      longitude: point?.longitude ?? null,
    });
  }

  const update = useMutation({
    mutationFn: () =>
      bff(`/seller/locations/${enEdition?.id}`, { method: "PUT", body: corpsAdresse() }),
    onSuccess: async () => {
      viderFormulaire();
      await onChanged();
    },
    meta: {
      successMessage: "Adresse corrigée.",
      errorMessage: "L'adresse n'a pas pu être corrigée.",
    },
  });

  const create = useMutation({
    // La position part quand le vendeur en a posé une (plus de `null` en dur).
    mutationFn: () => bff("/seller/locations", { method: "POST", body: corpsAdresse() }),
    onSuccess: async () => {
      viderFormulaire();
      await onChanged();
    },
    meta: { successMessage: "Entrepôt créé.", errorMessage: "L'entrepôt n'a pas pu être créé." },
  });

  const remove = useMutation({
    mutationFn: (id: string) => bff(`/seller/locations/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirmDelete(null);
      await onChanged();
    },
    meta: {
      successMessage: "Entrepôt supprimé.",
      // Repli seulement : le serveur renvoie désormais un message précis (« ce lieu
      // porte encore N référence(s) en stock »), qui a la priorité.
      errorMessage: "Suppression impossible.",
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // DEUX DRAPEAUX, ET SURTOUT PAS UN SEUL.
  //
  // Première rédaction : `busy = lectureSeule || ...`, au motif que toutes les
  // commandes d'écriture portent déjà `busy`. C'ÉTAIT UN PIÈGE À VENDEUR : `busy`
  // garde aussi la FERMETURE du dialogue (`onClose={() => !busy && onClose()}`), et
  // `components/ui/dialog.tsx` n'a aucune autre sortie — Échap, le voile et la croix
  // passent tous par cette même prop, et `lockScroll()` bloque en plus le défilement
  // de la page derrière. En lecture seule, `busy` restait vrai en permanence : le
  // vendeur ouvrait « Entrepôts » pour CONSULTER sa liste — ce que l'écran l'invite
  // explicitement à faire — et ne pouvait plus en sortir autrement qu'en rechargeant.
  //
  // `busy` reste donc ce qu'il était : une mutation est en cours. `ecrituresBloquees`
  // dit autre chose : le droit d'écrire manque.
  // ═══════════════════════════════════════════════════════════════════════════════
  const busy = create.isPending || remove.isPending || update.isPending;
  const ecrituresBloquees = lectureSeule || busy;
  // La rue n'est PAS exigée : au Bénin, beaucoup de lieux n'en ont pas. Ce sont la
  // commune et le point de repère qui rendent l'entrepôt trouvable par un coursier.
  const canCreate = communeCode.length > 0 && landmark.trim().length > 0;

  return (
    <>
      <Dialog
        open={open}
        onClose={() => !busy && onClose()}
        title="Entrepôts"
        description="Lieux depuis lesquels vous expédiez. Chaque offre en désigne un."
      >
        <div className="space-y-4">
          {/* Le bandeau de la page est DERRIÈRE le voile de la modale : sans ce rappel,
              le vendeur voyait un formulaire d'adresse entièrement saisissable et un
              bouton grisé, sans nulle part où lire pourquoi. */}
          {lectureSeule && (
            <ReadOnlyNote>
              Votre boutique ne peut pas modifier ses entrepôts dans son état actuel. La liste
              ci-dessous reste consultable.
            </ReadOnlyNote>
          )}
          <div>
            {loading ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : failed ? (
              <p className="text-sm text-muted-foreground">
                Liste non chargée. Ne créez pas d&apos;entrepôt avant de savoir lesquels existent :
                vous risqueriez un doublon.
              </p>
            ) : locations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun entrepôt pour l&apos;instant.</p>
            ) : (
              <div className="space-y-1.5">
                {locations.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{l.landmark || l.line || l.communeName}</div>
                      <div className="text-xs text-muted-foreground">
                        {[l.quartier, l.communeName].filter(Boolean).join(", ")}
                        {/* Le lien n'apparaît que si le lieu porte un point : il sert
                            au vendeur à vérifier, et à le transmettre au coursier. */}
                        {l.latitude != null && l.longitude != null && (
                          <>
                            {" · "}
                            <a
                              href={mapUrl({ latitude: l.latitude, longitude: l.longitude })}
                              target="_blank"
                              rel="noreferrer"
                              className="underline-offset-4 hover:underline"
                            >
                              carte
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => chargerPourEdition(l)}
                        disabled={ecrituresBloquees}
                      >
                        Corriger
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => setConfirmDelete(l)}
                        disabled={ecrituresBloquees}
                      >
                        Supprimer
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            {/*
              Ordre volontaire, du plus large au plus précis — comme on explique un
              lieu à un coursier : « Cotonou, Fidjrossè, en face de la pharmacie ».
              La rue vient en dernier et reste facultative : au Bénin, beaucoup de
              lieux n'en ont pas, et l'exiger pousserait à en inventer une.
            */}
            <CommuneSelect value={communeCode} onChange={setCommuneCode} required />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="quartier">Quartier</Label>
                <Input id="quartier" value={quartier} onChange={(e) => setQuartier(e.target.value)} placeholder="Fidjrossè" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="line">Rue, carré (facultatif)</Label>
                <Input id="line" value={line} onChange={(e) => setLine(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="landmark">
                Point de repère<span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="landmark"
                value={landmark}
                onChange={(e) => setLandmark(e.target.value)}
                placeholder="En face de la pharmacie Sainte-Rita"
              />
              <p className="text-xs text-muted-foreground">
                C'est ce que lit le coursier qui vient retirer vos colis.
              </p>
            </div>
            <LocationField value={point} onChange={setPoint} />
            {enEdition && (
              <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                Vous corrigez <strong>{locationLabel(enEdition)}</strong>. Les offres et le stock
                rattachés à cet entrepôt ne bougent pas : c&apos;est la même adresse qu&apos;on
                réécrit, sous le même identifiant.
              </p>
            )}
            <div className="flex justify-end gap-2">
              {enEdition && (
                <Button size="sm" variant="ghost" onClick={viderFormulaire} disabled={busy}>
                  Annuler la correction
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => (enEdition ? update.mutate() : create.mutate())}
                disabled={ecrituresBloquees || !canCreate}
              >
                {(create.isPending || update.isPending) && <Loader2 className="size-4 animate-spin" />}
                {enEdition ? (
                  "Enregistrer la correction"
                ) : (
                  <>
                    <Plus className="size-4" /> Ajouter cet entrepôt
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </Dialog>

      {/* Suppression confirmée à part : elle peut casser des offres qui désignent ce lieu. */}
      <Dialog
        open={confirmDelete !== null}
        onClose={() => !busy && setConfirmDelete(null)}
        title="Supprimer cet entrepôt ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)} disabled={busy}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
              disabled={ecrituresBloquees}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" />}
              Supprimer
            </Button>
          </>
        }
      >
        {confirmDelete && (
          <>
            <p className="text-sm">
              <strong>
                {locationLabel(confirmDelete)}
              </strong>{" "}
              ne pourra plus servir d&apos;adresse de départ.
            </p>
            {/* Le serveur REFUSE désormais la suppression tant qu'une référence y est
                suivie : la phrase décrit une règle réelle, pas un conseil. Auparavant
                elle disait « doivent être déplacés au préalable » alors que rien ne
                l'imposait — et le stock disparaissait silencieusement des écrans. */}
            <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              La suppression sera refusée tant que des références y sont suivies. Vérifiez
              aussi les offres qui désignent ce lieu comme adresse de départ.
            </p>
          </>
        )}
      </Dialog>
    </>
  );
}

/** Déclare le suivi d'un SKU dans un entrepôt. */
function CreateItemDialog({
  open,
  onClose,
  locations,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  locations: FulfillmentLocation[];
  onCreated: () => Promise<unknown>;
}) {
  const [sku, setSku] = useState("");
  const [locationId, setLocationId] = useState("");
  const [onHand, setOnHand] = useState("0");
  const [threshold, setThreshold] = useState("5");

  // ───────────────────────────────────────────────────────────────────────────────
  // ON NE TAPE PLUS UN SKU, ON LE CHOISIT PARMI LES SIENS.
  //
  // Le champ était libre, sous une phrase qui affirmait « doit correspondre au SKU
  // d'une variante de votre catalogue » — une règle que RIEN ne faisait respecter, ni
  // ici ni côté serveur. Une lettre de travers créait une ligne de stock orpheline,
  // parfaitement crédible à l'écran, pendant que l'offre restait à zéro.
  //
  // PAS DE REPLI EN SAISIE LIBRE si les listes ne chargent pas. Un repli rouvrirait
  // précisément le champ que le serveur va refuser, et ferait passer une panne de
  // chargement pour une faute de frappe du vendeur.
  //
  // ═══════════════════════════════════════════════════════════════════════════════
  // DEUX SOURCES, PARCE QUE LE SERVEUR EN ACCEPTE DEUX.
  //
  // La version précédente ne listait que les SKU des OFFRES, sous un commentaire qui
  // affirmait que « la liste des SKU vendables est exactement GET /seller/offers ».
  // C'est faux, et la conséquence n'était pas cosmétique : `CreateItemAsync`
  // (SellerInventoryEndpoints) accepte une offre du vendeur sur ce SKU **OU** une
  // déclinaison d'un de ses propres produits — la seconde voie existant précisément
  // pour l'ordre naturel « je reçois la marchandise, ensuite je la mets en vente ».
  //
  // Un vendeur ayant des fiches mais aucune offre voyait donc une liste vide, un
  // sélecteur DÉSACTIVÉ, et un message lui ordonnant de créer d'abord une offre —
  // alors que le serveur aurait accepté sa déclinaison. La console fermait un parcours
  // que le serveur avait été écrit pour garder ouvert, et rien à l'écran ne permettait
  // de le deviner.
  //
  // Les deux mêmes clés que partout ailleurs (`["seller-offers"]`, `["seller-products"]`,
  // sur les mêmes routes) : une clé dédiée aurait fabriqué un second cache de la même
  // ressource, qu'aucune invalidation ne relie.
  // ═══════════════════════════════════════════════════════════════════════════════
  const offers = useQuery({
    queryKey: ["seller-offers"],
    queryFn: () => bff<SellerOffer[]>("/seller/offers"),
    enabled: open,
  });
  const products = useQuery({
    queryKey: ["seller-products"],
    queryFn: () => bff<SellerProduct[]>("/seller/products"),
    enabled: open,
  });

  /**
   * Les SKU que le serveur acceptera, et eux seuls.
   *
   * Les offres d'abord : un SKU déjà en vente est celui que le vendeur reconnaîtra le
   * plus vite, et `productName` y est déjà. Les déclinaisons ensuite, sans écraser une
   * entrée existante — un même SKU porté par une offre ET par sa variante ne doit
   * apparaître qu'une fois.
   *
   * La comparaison du serveur est INSENSIBLE À LA CASSE et il normalise en majuscules
   * (`SkuPattern` = ^[A-Z0-9_-]{1,64}$). On normalise donc ici aussi, sinon « tsh-01 »
   * venu d'une variante et « TSH-01 » venu d'une offre feraient deux lignes pour une
   * seule référence.
   */
  const skuChoices = useMemo(() => {
    const vus = new Map<string, { produit: string; enVente: boolean }>();

    for (const o of offers.data ?? []) {
      if (!o.sku) continue;
      const cle = o.sku.trim().toUpperCase();
      if (cle && !vus.has(cle)) vus.set(cle, { produit: o.productName, enVente: true });
    }

    for (const p of products.data ?? []) {
      for (const v of p.variants ?? []) {
        if (!v.sku) continue;
        const cle = v.sku.trim().toUpperCase();
        if (cle && !vus.has(cle)) vus.set(cle, { produit: p.name, enVente: false });
      }
    }

    return Array.from(vus.entries())
      .map(([valeur, info]) => ({ valeur, ...info }))
      .sort((a, b) => a.valeur.localeCompare(b.valeur));
  }, [offers.data, products.data]);

  /** Une seule panne suffit à rendre la liste incomplète : on ne devine pas laquelle. */
  const sourcesEnCours = offers.isLoading || products.isLoading;
  const sourcesEnEchec = offers.isError || products.isError;

  // Une seule référence suivable, ou un seul entrepôt : on les pose.
  useAutoChoisirUnique(sku, setSku, skuChoices.map((c) => c.valeur));
  useAutoChoisirUnique(locationId, setLocationId, locations.map((l) => l.id));

  const toInt = (v: string) => {
    const n = Number.parseInt(v.replace(/\D/g, ""), 10);
    return Number.isNaN(n) ? 0 : n;
  };

  const create = useMutation({
    mutationFn: () =>
      bff("/seller/inventory/items", {
        method: "POST",
        body: JSON.stringify({
          sku: sku.trim(),
          locationId,
          onHand: toInt(onHand),
          reorderThreshold: toInt(threshold),
        }),
      }),
    onSuccess: async () => {
      await onCreated();
      reset();
      onClose();
    },
    meta: {
      successMessage: "Référence suivie.",
      errorMessage: "Impossible de suivre cette référence — elle est peut-être déjà suivie ici.",
    },
  });

  const valid = sku.trim().length > 0 && locationId !== "";

  /** Vide TOUS les champs : sans cela, on rouvrait le dialogue sur la saisie abandonnée. */
  function reset() {
    setSku("");
    setLocationId("");
    setOnHand("0");
    setThreshold("5");
  }

  function close() {
    if (create.isPending) return;
    reset();
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Suivre une référence"
      description="Déclare le stock d'un SKU dans l'un de vos entrepôts."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={create.isPending}>
            Annuler
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !valid}>
            {create.isPending && <Loader2 className="size-4 animate-spin" />}
            Créer
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="sku">SKU</Label>
          <select
            id="sku"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            disabled={sourcesEnCours || sourcesEnEchec || skuChoices.length === 0}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
            // `autoFocus` est inutile ici : les requêtes sont `enabled: open`, donc le
            // champ est TOUJOURS désactivé au montage et le focus retombe sur le
            // document sans jamais revenir. On le donne quand le champ devient
            // utilisable, ce qui est le moment où il sert.
            ref={(el) => {
              if (el && !el.disabled && document.activeElement === document.body) el.focus();
            }}
          >
            <option value="">— Choisir —</option>
            {skuChoices.map((c) => (
              <option key={c.valeur} value={c.valeur}>
                {c.valeur} — {c.produit}
                {c.enVente ? "" : " (pas encore en vente)"}
              </option>
            ))}
          </select>
          {sourcesEnCours ? (
            <p className="text-xs text-muted-foreground">Chargement de vos références…</p>
          ) : sourcesEnEchec ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Vos références n&apos;ont pas pu être chargées entièrement : impossible de savoir
              lesquelles vous pouvez suivre. Réessayez dans un instant.
            </p>
          ) : skuChoices.length === 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Votre catalogue ne porte aucune référence. Le stock se déclare sur une déclinaison
              d&apos;un de vos produits : créez d&apos;abord la fiche produit.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Vos déclinaisons et vos mises en vente. Une référence pas encore en vente peut être
              reçue en stock dès maintenant — l&apos;offre viendra après. Un même SKU peut être
              suivi dans plusieurs entrepôts, une ligne par entrepôt.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loc">Entrepôt</Label>
          <select
            id="loc"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">— Choisir —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {locationLabel(l)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="onhand">Quantité physique</Label>
            <Input
              id="onhand"
              inputMode="numeric"
              value={onHand}
              onChange={(e) => setOnHand(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="thr">Seuil d&apos;alerte</Label>
            <Input
              id="thr"
              inputMode="numeric"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** Réception, ajustement et seuil d'alerte sur un article existant. */
function ManageItemDialog({
  item,
  onClose,
  onChanged,
}: {
  item: InventoryItem | null;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const [receive, setReceive] = useState("");
  const [delta, setDelta] = useState("");
  const [threshold, setThreshold] = useState("");

  function reset() {
    setReceive("");
    setDelta("");
    setThreshold("");
  }

  const post = (path: string, body: unknown, method: "POST" | "PUT" = "POST") =>
    bff(`/seller/inventory/items/${item?.id}/${path}`, { method, body: JSON.stringify(body) });

  const receiveQty = Number.parseInt(receive.replace(/\D/g, ""), 10) || 0;

  // ───────────────────────────────────────────────────────────────────────────────
  // L'AJUSTEMENT EST SIGNÉ, LA RÉCEPTION NE L'EST PAS.
  //
  // `ReceiveStockCommand` prend une quantité positive ; `AdjustStockCommand` prend un
  // DELTA, qui peut être négatif — c'est ce qui sert à corriger un écart d'inventaire.
  // Le champ accepte donc « -3 », et le signe est affiché en clair avant validation :
  // c'est la même touche qui ajoute ou retire, l'erreur de saisie doit se voir.
  // ───────────────────────────────────────────────────────────────────────────────
  const deltaClean = delta.replace(/[^\d-]/g, "").replace(/(?!^)-/g, "");
  const deltaValue = Number.parseInt(deltaClean, 10);
  const deltaValid = !Number.isNaN(deltaValue) && deltaValue !== 0;

  const thresholdValue = Number.parseInt(threshold.replace(/\D/g, ""), 10);
  const thresholdValid = !Number.isNaN(thresholdValue);

  const doReceive = useMutation({
    mutationFn: () => post("receive", { quantity: receiveQty }),
    onSuccess: async () => { await onChanged(); reset(); },
    meta: { successMessage: "Réception enregistrée.", errorMessage: "La réception a échoué." },
  });

  const doAdjust = useMutation({
    mutationFn: () => post("adjust", { delta: deltaValue }),
    onSuccess: async () => { await onChanged(); reset(); },
    meta: { successMessage: "Stock ajusté.", errorMessage: "L'ajustement a échoué." },
  });

  const doThreshold = useMutation({
    mutationFn: () => post("reorder-threshold", { threshold: thresholdValue }, "PUT"),
    onSuccess: async () => { await onChanged(); reset(); },
    meta: { successMessage: "Seuil d'alerte mis à jour.", errorMessage: "La mise à jour a échoué." },
  });

  const busy = doReceive.isPending || doAdjust.isPending || doThreshold.isPending;

  return (
    <Dialog
      open={item !== null}
      onClose={() => { if (!busy) { reset(); onClose(); } }}
      title={item ? item.sku : ""}
    >
      {item && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground">Physique</div>
                <div className="text-lg font-semibold tabular-nums">{item.onHand}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground">Réservé</div>
                <div className="text-lg font-semibold tabular-nums">{item.reserved}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground">Disponible</div>
                <div
                  className={`text-lg font-semibold tabular-nums ${item.available <= 0 ? "text-destructive" : "text-primary"}`}
                >
                  {item.available}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="rec">Réception (ajouter du stock)</Label>
              <div className="flex gap-2">
                <Input
                  id="rec"
                  inputMode="numeric"
                  value={receive}
                  onChange={(e) => setReceive(e.target.value.replace(/\D/g, ""))}
                  placeholder="0"
                />
                <Button onClick={() => doReceive.mutate()} disabled={busy || receiveQty <= 0}>
                  {doReceive.isPending && <Loader2 className="size-4 animate-spin" />}
                  Recevoir
                </Button>
              </div>
              {receiveQty > 0 && (
                <p className="text-xs text-muted-foreground">
                  Physique : {item.onHand} → <strong>{item.onHand + receiveQty}</strong>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="adj">Ajustement d&apos;inventaire (peut être négatif)</Label>
              <div className="flex gap-2">
                <Input
                  id="adj"
                  inputMode="text"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value.replace(/[^\d-]/g, "").replace(/(?!^)-/g, ""))}
                  placeholder="-3"
                />
                <Button variant="outline" onClick={() => doAdjust.mutate()} disabled={busy || !deltaValid}>
                  {doAdjust.isPending && <Loader2 className="size-4 animate-spin" />}
                  Ajuster
                </Button>
              </div>
              {deltaValid && (
                // La borne du domaine n'est PAS zéro : `AdjustOnHand` refuse dès que
                // `onHand + delta` passe sous le RÉSERVÉ — on ne peut pas descendre le
                // stock sous ce qui est déjà promis à des commandes en cours. Tester
                // « < 0 » laissait passer un ajustement que le serveur rejetait en 409,
                // après une projection rassurante.
                <p
                  className={`text-xs ${
                    item.onHand + deltaValue < item.reserved ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  Physique : {item.onHand} → <strong>{item.onHand + deltaValue}</strong>
                  {item.onHand + deltaValue < item.reserved &&
                    ` — refusé : ${item.reserved} unité(s) sont déjà réservées par des commandes.`}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="th">Seuil d&apos;alerte (actuellement {item.reorderThreshold})</Label>
              <div className="flex gap-2">
                <Input
                  id="th"
                  inputMode="numeric"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ""))}
                  placeholder={String(item.reorderThreshold)}
                />
                <Button variant="outline" onClick={() => doThreshold.mutate()} disabled={busy || !thresholdValid}>
                  {doThreshold.isPending && <Loader2 className="size-4 animate-spin" />}
                  Enregistrer
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
