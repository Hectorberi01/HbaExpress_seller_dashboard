"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProductVariant, SellerProduct } from "@/types/seller";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";

/** Ligne d'attribut avec identité propre — voir la même note dans `ProductIdentityForm`. */
type AttributeRow = { uid: number; key: string; value: string };

let attributeSeq = 0;
const toRows = (source: Record<string, string> | undefined): AttributeRow[] =>
  Object.entries(source ?? {}).map(([key, value]) => ({ uid: ++attributeSeq, key, value }));

/** Vrai si la chaîne est un entier positif ou nul — le serveur attend un `int`. */
const isWholeNumber = (s: string) => /^\d+$/.test(s.trim());

type Draft = {
  sku: string;
  barcode: string;
  weightGrams: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  attributes: AttributeRow[];
};

const EMPTY: Draft = {
  sku: "",
  barcode: "",
  weightGrams: "0",
  lengthMm: "",
  widthMm: "",
  heightMm: "",
  attributes: [],
};

/**
 * Déclinaisons (taille, couleur…).
 *
 * ⚠️ ASYMÉTRIE ENTRE CRÉATION ET MODIFICATION
 *
 * `AddProductVariantCommand` accepte les dimensions (longueur, largeur, hauteur) ;
 * `UpdateProductVariantCommand` ne les prend pas, et `ProductVariantSummary` ne les
 * renvoie pas. Elles sont donc saisissables À LA CRÉATION SEULEMENT, et invisibles
 * ensuite. Les proposer à la modification aurait produit le pire des cas : un champ
 * qu'on remplit, qu'on enregistre, et dont la valeur part à la poubelle sans un mot.
 */
export function ProductVariantsManager({
  product,
  onChanged,
}: {
  product: SellerProduct;
  onChanged: () => Promise<unknown>;
}) {
  const [pane, setPane] = useState<"none" | "create" | "edit">("none");
  const [editing, setEditing] = useState<ProductVariant | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [confirmDelete, setConfirmDelete] = useState<ProductVariant | null>(null);

  function openCreate() {
    setEditing(null);
    setDraft(EMPTY);
    setPane("create");
  }

  function closePane() {
    setPane("none");
    setEditing(null);
  }

  function openEdit(v: ProductVariant) {
    setEditing(v);
    setDraft({
      sku: v.sku,
      barcode: v.barcode ?? "",
      weightGrams: String(v.weightGrams ?? 0),
      lengthMm: "",
      widthMm: "",
      heightMm: "",
      attributes: toRows(v.attributes),
    });
    setPane("edit");
  }

  function payload(withDimensions: boolean) {
    // Champ vide ou non numérique → `null`, jamais `NaN`. `JSON.stringify(NaN)` émet
    // `null` de toute façon, mais sur un `int` NON nullable côté serveur cela produit
    // un 400 de désérialisation sans message métier — une erreur qu'on ne peut ni
    // expliquer au vendeur, ni corriger depuis l'écran.
    const num = (s: string) => (isWholeNumber(s) ? Number(s) : null);
    return {
      sku: draft.sku.trim(),
      attributes: Object.fromEntries(
        draft.attributes.filter((a) => a.key.trim().length > 0).map((a) => [a.key.trim(), a.value]),
      ),
      barcode: draft.barcode.trim() || null,
      weightGrams: num(draft.weightGrams) ?? 0,
      lengthMm: withDimensions ? num(draft.lengthMm) : null,
      widthMm: withDimensions ? num(draft.widthMm) : null,
      heightMm: withDimensions ? num(draft.heightMm) : null,
    };
  }

  const create = useMutation({
    mutationFn: () =>
      bff<{ variantId: string }>(`/seller/products/${product.id}/variants`, {
        method: "POST",
        body: JSON.stringify(payload(true)),
      }),
    onSuccess: async () => {
      closePane();
      await onChanged();
    },
    meta: { successMessage: "Déclinaison ajoutée.", errorMessage: "Ajout impossible." },
  });

  const update = useMutation({
    mutationFn: () =>
      bff(`/seller/products/${product.id}/variants/${editing?.id}`, {
        method: "PUT",
        body: JSON.stringify(payload(false)),
      }),
    onSuccess: async () => {
      closePane();
      await onChanged();
    },
    meta: { successMessage: "Déclinaison enregistrée.", errorMessage: "Enregistrement impossible." },
  });

  const remove = useMutation({
    mutationFn: (variantId: string) =>
      bff(`/seller/products/${product.id}/variants/${variantId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirmDelete(null);
      await onChanged();
    },
    meta: { successMessage: "Déclinaison retirée.", errorMessage: "Suppression impossible." },
  });

  const isCreate = pane === "create";
  const saving = create.isPending || update.isPending;
  // ───────────────────────────────────────────────────────────────────────────────
  // LE POIDS EST OBLIGATOIRE.
  //
  // Il part vers un `int` non nullable : « 1,5 » ou « abc » ferait échouer la
  // désérialisation avant toute validation métier. Mais surtout, un champ VIDE était
  // converti en `0` sans un mot — la déclinaison était enregistrée à 0 g, et c'est
  // cette donnée qui sert aux calculs d'expédition. Un poids nul ne se distingue pas
  // d'un poids oublié : on exige donc une saisie.
  // ───────────────────────────────────────────────────────────────────────────────
  const weightOk = isWholeNumber(draft.weightGrams);
  const canSave = draft.sku.trim().length > 0 && weightOk;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>Déclinaisons ({product.variants.length})</CardTitle>
        <Button size="sm" variant="outline" onClick={openCreate}>
          <Plus className="size-4" /> Ajouter
        </Button>
      </CardHeader>

      <CardContent className="space-y-2 pt-0">
        {product.variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune déclinaison. Le SKU d&apos;une déclinaison est la référence que vous
            retrouverez en stock et sur vos offres.
          </p>
        ) : (
          product.variants.map((v) => (
            <div
              key={v.id}
              className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs font-medium">{v.sku}</div>
                <div className="text-xs text-muted-foreground">
                  {Object.entries(v.attributes ?? {})
                    .map(([k, val]) => `${k} : ${val}`)
                    .join(" · ") || "Aucun attribut"}
                  {v.weightGrams > 0 && ` · ${v.weightGrams} g`}
                  {v.barcode && ` · ${v.barcode}`}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" aria-label="Modifier" onClick={() => openEdit(v)}>
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-destructive"
                  aria-label="Retirer"
                  onClick={() => setConfirmDelete(v)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      <Dialog
        open={pane !== "none"}
        // `editing` doit tomber AVEC le panneau : il n'était nettoyé qu'au succès de
        // l'enregistrement, si bien qu'après une annulation l'URL de mise à jour
        // (`.../variants/${editing?.id}`) pointait encore sur la déclinaison
        // précédente — protégée seulement par le drapeau `isCreate`.
        onClose={closePane}
        title={isCreate ? "Nouvelle déclinaison" : "Modifier la déclinaison"}
        footer={
          <>
            <Button variant="outline" onClick={closePane}>
              Annuler
            </Button>
            <Button
              disabled={saving || !canSave}
              onClick={() => (isCreate ? create.mutate() : update.mutate())}
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isCreate ? "Ajouter" : "Enregistrer"}
            </Button>
          </>
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="v-sku">SKU</Label>
          <Input
            id="v-sku"
            value={draft.sku}
            onChange={(e) => setDraft((d) => ({ ...d, sku: e.target.value }))}
            placeholder="Ex. TSHIRT-BLEU-M"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="v-weight">Poids (g)</Label>
            <Input
              id="v-weight"
              inputMode="numeric"
              value={draft.weightGrams}
              onChange={(e) => setDraft((d) => ({ ...d, weightGrams: e.target.value }))}
            />
            {!weightOk && (
              <p className="text-xs text-destructive">
                Un nombre entier de grammes est attendu (0 si le poids est négligeable).
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="v-barcode">Code-barres</Label>
            <Input
              id="v-barcode"
              value={draft.barcode}
              onChange={(e) => setDraft((d) => ({ ...d, barcode: e.target.value }))}
              placeholder="Facultatif"
            />
          </div>
        </div>

        {isCreate && (
          <div className="space-y-1.5">
            <Label>Dimensions du colis (mm)</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input
                inputMode="numeric"
                aria-label="Longueur en millimètres"
                placeholder="Long."
                value={draft.lengthMm}
                onChange={(e) => setDraft((d) => ({ ...d, lengthMm: e.target.value }))}
              />
              <Input
                inputMode="numeric"
                aria-label="Largeur en millimètres"
                placeholder="Larg."
                value={draft.widthMm}
                onChange={(e) => setDraft((d) => ({ ...d, widthMm: e.target.value }))}
              />
              <Input
                inputMode="numeric"
                aria-label="Hauteur en millimètres"
                placeholder="Haut."
                value={draft.heightMm}
                onChange={(e) => setDraft((d) => ({ ...d, heightMm: e.target.value }))}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              À renseigner maintenant : les dimensions ne sont plus modifiables après la
              création de la déclinaison.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label>Attributs</Label>
          {draft.attributes.map((a) => (
            <div key={a.uid} className="flex gap-2">
              <Input
                value={a.key}
                aria-label="Nom de l'attribut"
                placeholder="Couleur"
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    attributes: d.attributes.map((r) =>
                      r.uid === a.uid ? { ...r, key: e.target.value } : r,
                    ),
                  }))
                }
              />
              <Input
                value={a.value}
                aria-label="Valeur de l'attribut"
                placeholder="Bleu"
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    attributes: d.attributes.map((r) =>
                      r.uid === a.uid ? { ...r, value: e.target.value } : r,
                    ),
                  }))
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Retirer cet attribut"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    attributes: d.attributes.filter((r) => r.uid !== a.uid),
                  }))
                }
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                attributes: [...d.attributes, { uid: ++attributeSeq, key: "", value: "" }],
              }))
            }
          >
            <Plus className="size-4" /> Ajouter un attribut
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Retirer cette déclinaison ?"
        description={
          confirmDelete
            ? `${confirmDelete.sku} disparaîtra de la fiche. Le stock et les offres portant ce SKU, eux, ne sont pas supprimés : vérifiez-les ensuite.`
            : ""
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" />}
              Retirer
            </Button>
          </>
        }
      />
    </Card>
  );
}
