"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { toastError } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReadOnlyNote } from "@/components/read-only-note";
import { Dialog } from "@/components/ui/dialog";
import { ImageViewer } from "@/components/image-viewer";
import type { SellerProduct } from "@/types/seller";
import {
  ArrowLeft,
  ArrowRight,
  ImagePlus,
  Loader2,
  Star,
  Trash2,
  ZoomIn,
} from "lucide-react";

/** Contraintes du serveur (`UploadValidation`) — répétées ici pour refuser AVANT l'envoi. */
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

/**
 * Photos du produit.
 *
 * C'EST LA PRINCIPALE QUI COMPTE, PAS LA PREMIÈRE. Tous les chemins acheteur prennent
 * `FirstOrDefault(m => m.IsPrimary) ?? FirstOrDefault()` — cartes de résultats, panier,
 * commandes, index de recherche. La première image n'est le repli que si AUCUNE n'est
 * marquée principale. Les deux coïncident presque toujours, parce qu'enregistrer un
 * ordre promeut la photo de tête ; le presque est ce que le bandeau plus bas explique.
 *
 * C'est la seule image que verront la plupart des acheteurs.
 *
 * Réordonnancement par FLÈCHES et non par glisser-déposer : le glisser-déposer ne
 * fonctionne ni au clavier ni au doigt sans une couche de code conséquente, et cette
 * console s'utilise beaucoup depuis un téléphone.
 */
export function ProductMediaManager({
  product,
  onChanged,
  lectureSeule = false,
}: {
  product: SellerProduct;
  onChanged: () => Promise<unknown>;
  /**
   * La boutique n'a plus le droit d'écrire. Les quatre routes média — téléversement,
   * réordonnancement, photo principale, suppression — sont toutes gardées côté
   * serveur (le téléversement l'est depuis le même lot que ce correctif).
   */
  lectureSeule?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Tri d'affichage = tri réel : `position` fait foi, l'image principale n'est pas
  // forcément la première du tableau renvoyé.
  const media = useMemo(
    () => [...(product.media ?? [])].sort((a, b) => a.position - b.position),
    [product.media],
  );

  const urls = useMemo(() => media.map((m) => m.url), [media]);

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      // Première image envoyée sur un produit qui n'en a aucune : elle devient
      // principale d'office, sinon le produit s'afficherait sans vignette.
      form.append("isPrimary", media.length === 0 ? "true" : "false");
      // `bff()` ne force pas de Content-Type sur un FormData : le navigateur pose
      // lui-même la « boundary » multipart, indispensable côté serveur.
      return bff<{ url: string }>(`/seller/products/${product.id}/media/upload`, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: () => onChanged(),
    meta: { successMessage: "Photo ajoutée.", errorMessage: "L'envoi a échoué." },
  });

  const reorder = useMutation({
    mutationFn: (orderedMediaIds: string[]) =>
      bff(`/seller/products/${product.id}/media/order`, {
        method: "PUT",
        body: JSON.stringify({ orderedMediaIds }),
      }),
    onSuccess: () => onChanged(),
    // Réordonner est une opération que l'on répète cinq fois d'affilée : un toast à
    // chaque flèche noierait l'écran. `""` fait taire le SUCCÈS seulement — les
    // erreurs continuent de s'afficher.
    meta: { successMessage: "" },
  });

  // La photo principale sera celle qui se retrouve en tête après le déplacement : le
  // dire une fois sous la grille vaut mieux qu'un toast à chaque flèche.
  const plusieursPhotos = media.length > 1;

  /** Vrai quand le serveur désigne comme principale une photo qui n'est pas en tête. */
  const indexPrincipale = media.findIndex((m) => m.isPrimary);
  const principaleHorsTete = indexPrincipale > 0;

  const remove = useMutation({
    mutationFn: (mediaId: string) =>
      bff(`/seller/products/${product.id}/media/${mediaId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirmDelete(null);
      await onChanged();
    },
    meta: { successMessage: "Photo supprimée.", errorMessage: "Suppression impossible." },
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * UN SEUL GESTE, PARCE QUE LE SERVEUR N'A QU'UNE SEULE RÈGLE.
   *
   * L'écran proposait DEUX commandes qui se défaisaient l'une l'autre. Les flèches
   * appellent `PUT /media/order` → `Product.ReorderMedia`, qui fait `UnsetPrimary()`
   * sur TOUTES les images puis `ordered[0].MakePrimary()`. L'étoile appelait
   * `POST /media/{id}/primary` → `SetPrimaryMedia`, qui change la principale SANS
   * toucher aux positions.
   *
   * Le vendeur désignait donc la photo 3 comme principale, permutait ensuite les
   * photos 1 et 2 — sans toucher à la 3 — et l'étoile sautait sur la première. Son
   * geste précédent était annulé en silence, sans un message, sans rien qui laisse
   * deviner un rapport entre les deux boutons.
   *
   * UN AVERTISSEMENT NE SUFFISAIT PAS, et c'était la première tentative : la note
   * sous la grille disait « les flèches et l'étoile agissent sur la même chose ».
   * Expliquer une contradiction ne la lève pas — elle demandait au vendeur de tenir
   * en tête une règle que l'interface continuait de démentir.
   *
   * L'ÉTOILE DÉPLACE DONC EN TÊTE, en un seul appel `order` — un seul geste, un seul
   * effet.
   *
   * MAIS L'INVARIANT « position 0 ⇔ principale » N'EST PAS GARANTI PAR LE DOMAINE, et
   * prétendre le contraire serait la troisième version du même mensonge. Deux chemins
   * posent encore la principale ailleurs qu'en tête :
   *   • `AddMedia(isPrimary: true)` place le nouveau média EN DERNIER et principal ;
   *   • `SetPrimaryMedia` désigne sans déplacer — et l'app mobile l'appelle toujours
   *     (`catalog_data.dart` : `setPrimaryImage`), sans jamais appeler `/media/order`.
   *
   * Le vendeur qui désigne sa photo 3 depuis son téléphone ouvre donc cette console
   * sur un état où la principale n'est pas la première. On ne le masque pas : l'étoile
   * s'affiche sur TOUTE photo hors tête — y compris la principale mal placée, qu'un
   * clic remet d'aplomb — et une note dit ce qui se passe. La conditionner sur
   * `!isPrimary` rendait une étoile INERTE sur la première vignette : `promote(0)`
   * sort immédiatement, sans requête et sans toast. Un clic mort, exactement la classe
   * de défaut qu'on ferme ici.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= media.length) return;
    const ids = media.map((m) => m.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids);
  }

  /** Met la photo en tête — donc en principale. Un seul aller-retour. */
  function promote(index: number) {
    if (index <= 0) return;
    const ids = media.map((m) => m.id);
    const [moved] = ids.splice(index, 1);
    ids.unshift(moved);
    reorder.mutate(ids);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Réinitialiser tout de suite : sans cela, resélectionner LE MÊME fichier après
    // un échec ne déclenche aucun `change` et le vendeur croit l'interface figée.
    e.target.value = "";
    if (!file) return;

    if (!ACCEPTED.includes(file.type)) {
      toastError("Formats acceptés : JPEG, PNG ou WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toastError("Photo trop lourde : 5 Mo maximum.");
      return;
    }
    upload.mutate(file);
  }

  // `lectureSeule` rejoint `busy` : tous les boutons d'écriture de cette carte le
  // portent déjà, et une boutique sans droit d'écriture est, de leur point de vue,
  // dans le même état qu'une mutation en cours — inopérante.
  const busy = lectureSeule || upload.isPending || reorder.isPending || remove.isPending;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>Photos ({media.length})</CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInput.current?.click()}
          disabled={lectureSeule || upload.isPending}
        >
          {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          Ajouter
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED.join(",")}
          className="hidden"
          onChange={onPick}
        />
      </CardHeader>

      <CardContent className="pt-0">
        {lectureSeule && (
          <div className="mb-3">
            <ReadOnlyNote />
          </div>
        )}
        {media.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune photo. Un produit sans image n&apos;apparaît quasiment jamais dans les
            résultats de recherche.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {media.map((m, i) => (
              <div key={m.id} className="group relative overflow-hidden rounded-xl bg-muted">
                <button
                  type="button"
                  onClick={() => setViewerAt(i)}
                  aria-label={`Agrandir la photo ${i + 1}`}
                  className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt={m.altText || ""} className="aspect-square w-full object-cover" />
                  <ZoomIn className="absolute right-2 top-2 size-4 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-100" />
                </button>

                {m.isPrimary && (
                  <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    Principale
                  </span>
                )}

                <div className="flex items-center justify-between gap-1 p-1.5">
                  <div className="flex gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label="Déplacer avant"
                      disabled={i === 0 || busy}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowLeft className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label="Déplacer après"
                      disabled={i === media.length - 1 || busy}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </div>
                  <div className="flex gap-0.5">
                    {/* SUR TOUTE PHOTO HORS TÊTE, y compris une principale mal
                        placée : c'est le clic qui la remet d'aplomb. Conditionner sur
                        `!isPrimary` laissait une étoile inerte sur la première
                        vignette dès que la principale était ailleurs. */}
                    {i > 0 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label="Mettre en photo principale"
                        title="Mettre en photo principale — elle passe en première position"
                        disabled={busy}
                        onClick={() => promote(i)}
                      >
                        <Star className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-destructive"
                      aria-label="Supprimer cette photo"
                      disabled={busy}
                      onClick={() => setConfirmDelete(m.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mt-3 text-xs text-muted-foreground">
          JPEG, PNG ou WebP, 5 Mo maximum.
          {plusieursPhotos && (
            <>
              {" "}
              La photo marquée <strong>Principale</strong> est celle que l&apos;acheteur voit dans
              les listes. L&apos;étoile met une photo en tête — et la tête est ce que
              l&apos;enregistrement de l&apos;ordre retient comme principale.
            </>
          )}
        </p>

        {/* ON NE MASQUE PAS L'ÉTAT INCOHÉRENT, ON LE NOMME. Il arrive pour de vrai :
            l'app mobile désigne la principale sans déplacer la photo, et un envoi
            marqué « principale » place l'image en dernier. Le vendeur voit alors un
            badge « Principale » ailleurs qu'en première case et n'a aucune raison de
            deviner que le prochain réordonnancement le déplacera. */}
        {principaleHorsTete && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            Votre photo principale n&apos;est pas la première de la grille. Elle le reste pour
            l&apos;instant — mais le prochain déplacement, comme la suppression de cette photo,
            rendra principale celle qui se retrouvera en tête. Cliquez son étoile pour la
            remettre en première position et lever l&apos;ambiguïté.
          </p>
        )}
      </CardContent>

      {viewerAt !== null && urls.length > 0 && (
        <ImageViewer images={urls} startIndex={viewerAt} onClose={() => setViewerAt(null)} />
      )}

      <Dialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Supprimer cette photo ?"
        description="Le fichier est effacé du stockage : l'opération est définitive et la photo devra être renvoyée."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => confirmDelete && remove.mutate(confirmDelete)}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" />}
              Supprimer
            </Button>
          </>
        }
      />
    </Card>
  );
}
