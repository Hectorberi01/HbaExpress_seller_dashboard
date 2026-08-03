"use client";

import { useRef, useState } from "react";
import { bffBlob } from "@/lib/api";
import { toastError } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { ImageViewer } from "@/components/image-viewer";
import {
  ArrowLeft,
  ArrowRight,
  ImagePlus,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";

/** Contraintes du serveur (`UploadValidation`), répétées ici pour refuser AVANT l'envoi. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * PLAFONDS D'ENVOI — parce que Kestrel en a un, et qu'il ne s'explique pas.
 *
 * Aucune limite de corps n'est configurée côté serveur : Kestrel applique donc son
 * défaut, 30 000 000 octets. Or rien n'empêchait d'ajouter dix photos de 5 Mo. Au-delà
 * du seuil, la requête est rejetée AVANT d'atteindre le code applicatif, avec un corps
 * vide — l'écran affichait « Erreur 413 », et le vendeur n'avait aucun moyen de savoir
 * qu'il devait retirer des photos.
 *
 * On garde une marge sous le seuil réel : les frontières multipart et les autres champs
 * pèsent aussi, et une limite intermédiaire (Traefik, un pare-feu applicatif) peut être
 * plus basse encore.
 */
export const MAX_IMAGES = 8;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

/**
 * Détourages menés de front. Même valeur que l'app mobile (`_concurrency`).
 *
 * Chaque appel téléverse l'original vers le service de traitement puis interroge le
 * rendu jusqu'à vingt-cinq secondes. Lancer huit requêtes d'un coup ferait patienter
 * le vendeur sur les huit à la fois, et ferait porter le pic au serveur. Par paquets
 * de trois, les premières vignettes se dévoilent pendant que les suivantes travaillent.
 */
const PROCESS_CONCURRENCY = 3;

/**
 * Une photo en cours de préparation.
 *
 * `original` est TOUJOURS conservé, même après détourage : c'est ce qui permet le
 * retour en arrière. Ce qu'on enverra, c'est `processed ?? original` — même règle que
 * `ProcessedImage.bytes` côté mobile.
 */
export type DraftImage = {
  uid: number;
  fileName: string;
  original: File;
  originalUrl: string;
  processed: Blob | null;
  processedUrl: string | null;
  processing: boolean;
  error: string | null;
};

let imageSeq = 0;

/** Octets réellement envoyés au serveur : la version détourée si elle existe. */
export function imagePayload(image: DraftImage): File {
  if (!image.processed) return image.original;

  // ─────────────────────────────────────────────────────────────────────────────
  // ON SUIT LE TYPE RÉELLEMENT RENVOYÉ, ON NE LE DEVINE PAS.
  //
  // Le processeur Cloudinary renvoie du JPEG quelle que soit l'entrée — mais
  // `NullImageProcessor`, utilisé quand Cloudinary n'est pas configuré, renvoie les
  // octets D'ORIGINE avec leur type d'origine. Coder « image/jpeg » en dur faisait
  // donc partir un PNG sous le nom « photo.jpg ». Le serveur, qui valide sur la
  // signature et non sur le nom, l'acceptait — et stockait un fichier mal étiqueté.
  //
  // Le `Blob` renvoyé par `bffBlob` porte déjà son Content-Type : il suffit de le
  // lire, et l'extension suit.
  // ─────────────────────────────────────────────────────────────────────────────
  const type = image.processed.type || image.original.type;
  const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const dot = image.fileName.lastIndexOf(".");
  const base = dot > 0 ? image.fileName.slice(0, dot) : image.fileName;
  return new File([image.processed], `${base}.${extension}`, { type });
}

export function imageSize(image: DraftImage): number {
  return image.processed ? image.processed.size : image.original.size;
}

export function isImageTooLarge(image: DraftImage): boolean {
  return imageSize(image) > MAX_IMAGE_BYTES;
}

export function totalImageBytes(images: readonly DraftImage[]): number {
  return images.reduce((sum, i) => sum + imageSize(i), 0);
}

/**
 * Registre des URL d'objet créées, et ramasse-miettes associé.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * POURQUOI UN REGISTRE PLUTÔT QU'UNE RÉVOCATION « AU BON MOMENT »
 *
 * La version précédente posait un drapeau DANS l'updater de `setState` et le lisait
 * juste après l'appel, pour savoir s'il fallait libérer l'URL fraîchement créée :
 *
 *     let attached = false;
 *     onChange((previous) => { attached = true; ... });
 *     if (!attached) URL.revokeObjectURL(nextUrl);   // ← FAUX
 *
 * React n'évalue PAS forcément l'updater de façon synchrone. Il le fait sur son
 * chemin rapide (« eager state »), uniquement quand aucune mise à jour n'est déjà en
 * attente sur ce composant — sinon l'évaluation est repoussée à la phase de rendu. Or
 * cette page fait cinq requêtes React Query : il suffit que l'une d'elles se règle au
 * même instant pour que le chemin rapide soit abandonné. `attached` restait alors
 * `false`, l'URL était révoquée AUSSITÔT — et la photo s'affichait cassée, avec le
 * badge « Détourée » par-dessus. Exactement le symptôme rapporté.
 *
 * On ne devine donc plus. Toute URL créée est enregistrée ; après chaque rendu, celles
 * que l'état ne référence plus sont libérées. La décision est prise sur le résultat,
 * pas sur une supposition de calendrier.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
export type ImageUrlRegistry = Set<string>;

export function createImageUrl(registry: ImageUrlRegistry, blob: Blob): string {
  const url = URL.createObjectURL(blob);
  registry.add(url);
  return url;
}

/** Libère toutes les URL que `images` ne référence plus. À appeler après chaque rendu. */
export function collectImageUrls(registry: ImageUrlRegistry, images: readonly DraftImage[]) {
  const live = new Set<string>();
  for (const image of images) {
    live.add(image.originalUrl);
    if (image.processedUrl) live.add(image.processedUrl);
  }
  for (const url of Array.from(registry)) {
    if (!live.has(url)) {
      URL.revokeObjectURL(url);
      registry.delete(url);
    }
  }
}

/** Libère tout. À appeler en quittant l'écran. */
export function releaseImageUrls(registry: ImageUrlRegistry) {
  registry.forEach((url) => URL.revokeObjectURL(url));
  registry.clear();
}

/**
 * Champ « photos du produit ».
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * LE DÉTOURAGE EST PROPOSÉ, PAS IMPOSÉ.
 *
 * L'app mobile détoure systématiquement à la sélection, en bloquant l'écran le temps
 * du traitement — cohérent sur un téléphone, où l'on photographie l'article sur une
 * table de salon. Depuis un ordinateur, le vendeur importe souvent des visuels déjà
 * préparés par un fournisseur : les repasser d'office au détourage les abîmerait.
 *
 * Le geste reste donc à un clic. L'ORDRE compte : la première photo devient la photo
 * principale.
 *
 * ⚠️ `onChange` PREND UNE FONCTION, pas un tableau.
 *
 * Le détourage dure plusieurs secondes et plusieurs peuvent tourner en parallèle. Avec
 * un `onChange(tableau)`, chaque complétion réécrivait le tableau capturé AVANT son
 * lancement : la seconde photo détourée effaçait la première, une suppression faite
 * entre-temps était annulée, et un indicateur « en cours » pouvait rester allumé pour
 * toujours — bloquant l'assistant sur « Un détourage est encore en cours ».
 *
 * Les URL d'objet ne sont PAS libérées ici : ce composant est démonté au changement
 * d'étape alors que les photos, elles, vivent dans l'assistant. Les révoquer au
 * démontage cassait toutes les vignettes du récapitulatif. C'est le propriétaire de
 * l'état qui tient le registre et passe le ramasse-miettes — voir `collectImageUrls`.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
export function ProductImagesField({
  images,
  onChange,
  registry,
  backgroundRemovalAvailable,
  showRequiredError,
}: {
  images: DraftImage[];
  onChange: (updater: (previous: DraftImage[]) => DraftImage[]) => void;
  /** Registre des URL d'objet, détenu par l'écran (voir `createImageUrl`). */
  registry: ImageUrlRegistry;
  /**
   * Faux quand le service de détourage n'est pas configuré côté serveur.
   *
   * Dans ce cas le serveur renvoie l'image D'ORIGINE avec un succès : proposer le
   * bouton reviendrait à afficher « Détourée » sur une photo intacte.
   */
  backgroundRemovalAvailable: boolean;
  showRequiredError?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);

  // Visionneuse : la série ouverte est celle de la photo cliquée, pas tout le lot.
  // Comparer un avant/après demande de basculer entre DEUX images ; y mêler les six
  // autres photos du produit ferait perdre le fil au premier coup de flèche.
  const [viewer, setViewer] = useState<{ srcs: string[]; labels: string[]; at: number } | null>(null);

  function openViewer(image: DraftImage, at: number) {
    const srcs = image.processedUrl ? [image.originalUrl, image.processedUrl] : [image.originalUrl];
    const labels = image.processedUrl ? ["Avant détourage", "Après détourage"] : ["Photo d'origine"];
    setViewer({ srcs, labels, at: Math.min(at, srcs.length - 1) });
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    // Réinitialisation immédiate : sans cela, resélectionner LE MÊME fichier après
    // une erreur ne déclenche aucun `change`, et l'interface paraît figée.
    e.target.value = "";
    if (picked.length === 0) return;

    const accepted: DraftImage[] = [];
    let room = MAX_IMAGES - images.length;
    // Poids cumulé suivi à l'AJOUT, pas seulement à la validation d'étape : refuser
    // une photo au moment où on la dépose est autrement plus clair que de laisser
    // découvrir le dépassement deux écrans plus loin.
    let budget = MAX_TOTAL_BYTES - totalImageBytes(images);

    for (const file of picked) {
      if (room <= 0) {
        toastError(`${MAX_IMAGES} photos au maximum : « ${file.name} » n'a pas été ajoutée.`);
        continue;
      }
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        toastError(`« ${file.name} » : formats acceptés JPEG, PNG ou WebP.`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toastError(`« ${file.name} » dépasse 5 Mo.`);
        continue;
      }
      if (file.size > budget) {
        toastError(
          `« ${file.name} » ferait dépasser ${MAX_TOTAL_BYTES / 1024 / 1024} Mo au total : elle n'a pas été ajoutée.`,
        );
        continue;
      }
      accepted.push({
        uid: ++imageSeq,
        fileName: file.name,
        original: file,
        originalUrl: createImageUrl(registry, file),
        processed: null,
        processedUrl: null,
        processing: false,
        error: null,
      });
      room--;
      budget -= file.size;
    }

    if (accepted.length === 0) return;

    onChange((previous) => [...previous, ...accepted]);

    // ─────────────────────────────────────────────────────────────────────────────
    // LE DÉTOURAGE PART TOUT SEUL.
    //
    // Il était derrière un bouton, par crainte d'abîmer des visuels déjà préparés par
    // un fournisseur. C'était se tromper d'utilisateur : un vendeur qui photographie
    // son article sur une table ne sait pas qu'un bouton « détourer » existe, encore
    // moins qu'il conditionne l'aspect de sa fiche. Il publiait donc une photo brute
    // au milieu d'un catalogue détouré — et l'écart se voit immédiatement.
    //
    // L'app mobile traite d'office à la sélection ; la console fait désormais pareil.
    // L'original reste conservé et le retour en arrière est à un clic : le vendeur qui
    // tient à sa photo d'origine peut toujours la rétablir, mais ce n'est plus à lui
    // d'y penser en premier.
    // ─────────────────────────────────────────────────────────────────────────────
    if (backgroundRemovalAvailable) void processAll(accepted);
  }

  /** Traite un lot par paquets. Un échec isolé n'emporte pas les autres. */
  async function processAll(batch: DraftImage[]) {
    for (let start = 0; start < batch.length; start += PROCESS_CONCURRENCY) {
      await Promise.all(batch.slice(start, start + PROCESS_CONCURRENCY).map(process));
    }
  }

  /** Mise à jour ciblée, toujours à partir de l'état LE PLUS RÉCENT. */
  function patch(uid: number, changes: Partial<DraftImage>) {
    onChange((previous) => previous.map((i) => (i.uid === uid ? { ...i, ...changes } : i)));
  }

  async function process(image: DraftImage) {
    patch(image.uid, { processing: true, error: null });
    try {
      const form = new FormData();
      // Champ « image » — celui qu'attend `ProcessMediaAsync`. Le nom compte : un
      // autre libellé produit un 400 « Fichier manquant ou vide ».
      form.append("image", image.original);
      const blob = await bffBlob("/seller/products/media/process", {
        method: "POST",
        body: form,
      });

      // L'URL est créée et ENREGISTRÉE avant l'updater, qui reste ainsi purement
      // fonctionnel. Si la photo a été retirée entre-temps, l'updater ne la trouvera
      // pas et le ramasse-miettes libérera cette URL au rendu suivant — sans qu'on ait
      // à deviner quoi que ce soit ici.
      const nextUrl = createImageUrl(registry, blob);
      onChange((previous) =>
        previous.map((i) =>
          i.uid === image.uid
            ? { ...i, processed: blob, processedUrl: nextUrl, processing: false, error: null }
            : i,
        ),
      );
    } catch (err) {
      // Échec ISOLÉ : la photo garde son original et reste utilisable. Le détourage
      // est un confort, pas une condition de mise en vente.
      patch(image.uid, {
        processing: false,
        error: err instanceof Error ? err.message : "Détourage impossible.",
      });
    }
  }

  function discardProcessed(uid: number) {
    // L'ancienne URL détourée n'est pas révoquée ici : le ramasse-miettes s'en charge
    // dès que l'état cesse de la référencer.
    onChange((previous) =>
      previous.map((i) => (i.uid === uid ? { ...i, processed: null, processedUrl: null } : i)),
    );
  }

  function remove(uid: number) {
    onChange((previous) => previous.filter((i) => i.uid !== uid));
  }

  /**
   * Déplacement repéré par `uid`, PAS par index.
   *
   * L'index vient du rendu. Si une suppression ou un ajout est traité dans le même
   * lot que le clic, l'index ne désigne plus la même photo — et c'est une autre qui
   * bouge. Le dernier endroit du fichier qui dépendait encore du rendu courant.
   */
  function move(uid: number, delta: number) {
    onChange((previous) => {
      const index = previous.findIndex((i) => i.uid === uid);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const total = totalImageBytes(images);
  const totalTooBig = total > MAX_TOTAL_BYTES;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInput.current?.click()}
          disabled={images.length >= MAX_IMAGES}
        >
          <ImagePlus className="size-4" /> Ajouter des photos
        </Button>
        <span className="text-xs text-muted-foreground">
          JPEG, PNG ou WebP · 5 Mo par photo · {MAX_IMAGES} photos au maximum
          {backgroundRemovalAvailable && " · détourage automatique"}
        </span>
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="hidden"
        onChange={onPick}
      />

      {images.length === 0 ? (
        <p className={showRequiredError ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          Au moins une photo est nécessaire. Un produit sans image n&apos;apparaît
          quasiment jamais dans les résultats de recherche.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image, i) => {
            const tooLarge = isImageTooLarge(image);
            return (
              <div
                key={image.uid}
                className={`overflow-hidden rounded-xl bg-muted ${tooLarge ? "ring-2 ring-destructive" : ""}`}
              >
                <div className="relative">
                  {/* ─────────────────────────────────────────────────────────────
                      CÔTE À CÔTE DÈS QUE LA PHOTO EST DÉTOURÉE.

                      Ne montrer que le résultat obligeait à cliquer « revenir à
                      l'original » pour comparer — donc à perdre le détourage pour
                      savoir s'il valait la peine d'être gardé. Le vendeur juge sur
                      pièces : l'avant et l'après sont l'un EN FACE de l'autre, et un
                      clic ouvre la visionneuse zoomable pour vérifier les contours.

                      `object-contain` et non `cover` : un recadrage masquerait
                      justement les bords, c'est-à-dire l'endroit où le détourage se
                      juge.
                      ───────────────────────────────────────────────────────────── */}
                  {image.processedUrl ? (
                    <div className="grid aspect-square w-full grid-cols-2 divide-x divide-border">
                      <ComparePane
                        src={image.originalUrl}
                        caption="Avant"
                        tone="bg-muted"
                        onOpen={() => openViewer(image, 0)}
                      />
                      <ComparePane
                        src={image.processedUrl}
                        caption="Après"
                        tone="bg-white"
                        onOpen={() => openViewer(image, 1)}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openViewer(image, 0)}
                      aria-label="Agrandir la photo"
                      className="group block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.originalUrl} alt="" className="aspect-square w-full object-cover" />
                      <Search className="absolute bottom-2 right-2 size-4 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-100" />
                    </button>
                  )}

                  {i === 0 && (
                    <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                      Principale
                    </span>
                  )}
                  {image.processed && (
                    <span className="absolute right-2 top-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                      Détourée
                    </span>
                  )}
                  {image.processing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 className="size-6 animate-spin text-white" />
                    </div>
                  )}
                </div>

                <div className="space-y-1 p-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex gap-0.5">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label="Déplacer avant"
                        disabled={i === 0}
                        onClick={() => move(image.uid, -1)}
                      >
                        <ArrowLeft className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label="Déplacer après"
                        disabled={i === images.length - 1}
                        onClick={() => move(image.uid, 1)}
                      >
                        <ArrowRight className="size-3.5" />
                      </Button>
                    </div>
                    <div className="flex gap-0.5">
                      {image.processed ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label="Revenir à la photo d'origine"
                          onClick={() => discardProcessed(image.uid)}
                        >
                          <RotateCcw className="size-3.5" />
                        </Button>
                      ) : (
                        // Plus de bouton « détourer » : le traitement est automatique.
                        // Ne subsiste qu'un RÉESSAI, et seulement après un échec —
                        // proposer l'action quand il n'y a rien à réparer ramènerait
                        // le geste manuel qu'on vient de supprimer.
                        backgroundRemovalAvailable &&
                        image.error && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            aria-label="Réessayer le détourage"
                            disabled={image.processing}
                            onClick={() => process(image)}
                          >
                            <Sparkles className="size-3.5" />
                          </Button>
                        )
                      )}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive"
                        aria-label="Retirer cette photo"
                        onClick={() => remove(image.uid)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  {tooLarge && (
                    <p className="flex items-start gap-1 px-1 text-[11px] text-destructive">
                      <TriangleAlert className="mt-0.5 size-3 shrink-0" /> Trop lourde
                      après traitement ({(imageSize(image) / 1024 / 1024).toFixed(1)} Mo).
                    </p>
                  )}
                  {image.error && (
                    <p className="px-1 text-[11px] text-muted-foreground">
                      Détourage échoué — la photo d&apos;origine sera envoyée. Vous pouvez
                      réessayer (<Sparkles className="inline size-3" />).
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {images.length > 0 && (
        <>
          <p className={totalTooBig ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
            {images.length} photo(s) · {(total / 1024 / 1024).toFixed(1)} Mo au total
            {totalTooBig &&
              ` — au-delà de ${MAX_TOTAL_BYTES / 1024 / 1024} Mo, l'envoi est refusé par le serveur. Retirez ou allégez des photos.`}
          </p>
          <p className="text-xs text-muted-foreground">
            La première photo est celle qui s&apos;affiche partout ailleurs.{" "}
            {backgroundRemovalAvailable ? (
              <>
                Chaque photo est <strong>détourée automatiquement</strong> sur fond blanc —
                c&apos;est ce qui donne au catalogue son aspect homogène. L&apos;original
                est conservé : le bouton <RotateCcw className="inline size-3" /> le
                rétablit si le résultat ne vous convient pas.
              </>
            ) : (
              // On le DIT plutôt que d'offrir un bouton sans effet : sans identifiants
              // de traitement, le serveur renvoie l'image d'origine avec un succès.
              <>
                Le détourage automatique n&apos;est pas activé sur cette installation :
                photographiez vos articles sur un fond clair et uni.
              </>
            )}
          </p>
        </>
      )}

      {viewer && (
        <ImageViewer
          images={viewer.srcs}
          labels={viewer.labels}
          startIndex={viewer.at}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

/**
 * Une moitié du comparatif : l'image, sa légende, et l'ouverture de la visionneuse.
 *
 * Le fond diffère volontairement d'un côté à l'autre — gris pour l'original, blanc
 * pour le détourage. C'est le fond blanc qui est l'objet du traitement : le montrer
 * derrière l'article permet de repérer d'un coup d'œil un contour resté sale.
 */
function ComparePane({
  src,
  caption,
  tone,
  onOpen,
}: {
  src: string;
  caption: string;
  tone: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Agrandir : ${caption} détourage`}
      className={`group relative flex h-full w-full items-center justify-center overflow-hidden ${tone} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="max-h-full max-w-full object-contain" />
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
        {caption}
      </span>
      <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
        <Search className="size-5 text-white drop-shadow" />
      </span>
    </button>
  );
}
