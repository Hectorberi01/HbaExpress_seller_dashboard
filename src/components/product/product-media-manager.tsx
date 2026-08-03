"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { toastError } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
 * L'ORDRE COMPTE : la première image est celle des cartes de résultats, des paniers et
 * des notifications. C'est aussi la seule que verront la plupart des acheteurs.
 *
 * Réordonnancement par FLÈCHES et non par glisser-déposer : le glisser-déposer ne
 * fonctionne ni au clavier ni au doigt sans une couche de code conséquente, et cette
 * console s'utilise beaucoup depuis un téléphone.
 */
export function ProductMediaManager({
  product,
  onChanged,
}: {
  product: SellerProduct;
  onChanged: () => Promise<unknown>;
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

  const setPrimary = useMutation({
    mutationFn: (mediaId: string) =>
      bff(`/seller/products/${product.id}/media/${mediaId}/primary`, { method: "POST" }),
    onSuccess: () => onChanged(),
    meta: { successMessage: "Photo principale mise à jour." },
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

  const remove = useMutation({
    mutationFn: (mediaId: string) =>
      bff(`/seller/products/${product.id}/media/${mediaId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirmDelete(null);
      await onChanged();
    },
    meta: { successMessage: "Photo supprimée.", errorMessage: "Suppression impossible." },
  });

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= media.length) return;
    const ids = media.map((m) => m.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
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

  const busy = upload.isPending || setPrimary.isPending || reorder.isPending || remove.isPending;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>Photos ({media.length})</CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInput.current?.click()}
          disabled={upload.isPending}
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
                    {!m.isPrimary && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label="Définir comme photo principale"
                        disabled={busy}
                        onClick={() => setPrimary.mutate(m.id)}
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
          JPEG, PNG ou WebP, 5 Mo maximum. La photo marquée « Principale » est celle affichée
          partout ailleurs sur la boutique.
        </p>
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
