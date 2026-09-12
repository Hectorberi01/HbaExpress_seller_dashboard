"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReadOnlyNote } from "@/components/read-only-note";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProductVariant, SellerOffer, SellerProduct } from "@/types/seller";
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
  attributes: AttributeRow[];
};

const EMPTY: Draft = {
  sku: "",
  barcode: "",
  weightGrams: "0",
  attributes: [],
};

/**
 * Déclinaisons (taille, couleur…).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════
 * L'ASYMÉTRIE CRÉATION / MODIFICATION A ÉTÉ RÉSOLUE EN RETIRANT LE CHAMP, PAS EN
 * L'ÉTENDANT.
 *
 * `AddProductVariantCommand` accepte les dimensions ; `UpdateProductVariantCommand` ne
 * les prend pas, et `ProductVariantSummary` ne les renvoie pas. Le formulaire les
 * proposait donc à la création seulement, avec un avertissement honnête (« plus
 * modifiables ensuite »).
 *
 * La question qu'on ne s'était pas posée est celle de l'audit : QUI LES LIT ? Personne.
 * Ni le transport — le tarif est un forfait par commune —, ni l'acheteur, ni l'admin,
 * ni le vendeur lui-même, qui ne peut pas les relire. Étendre la modification aurait
 * rendu modifiable une donnée morte ; on a retiré la demande.
 *
 * Le poids reste, parce qu'il revient au moins à l'écran (ici, sur l'app mobile et
 * chez l'admin) — mais il n'entre lui non plus dans aucun calcul, et il est devenu
 * facultatif à la création d'un produit.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
export function ProductVariantsManager({
  product,
  onChanged,
  offresDuProduit,
  offresIndisponibles,
  lectureSeule = false,
}: {
  product: SellerProduct;
  onChanged: () => Promise<unknown>;
  /** Offres du vendeur sur CE produit — sert à savoir quels SKU sont engagés. */
  offresDuProduit: SellerOffer[];
  /** Vrai tant qu'on ne SAIT pas : chargement en cours, ou échec. */
  offresIndisponibles: boolean;
  /**
   * La boutique n'a plus le droit d'écrire. Ajout, modification et retrait de
   * déclinaison sont tous gardés côté serveur (l'ajout l'est depuis le même lot que
   * ce correctif).
   */
  lectureSeule?: boolean;
}) {
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * LE SKU D'UNE DÉCLINAISON DÉJÀ MISE EN VENTE NE SE RENOMME PLUS.
   *
   * Ce champ était librement modifiable, sans un mot — alors que la boîte de
   * SUPPRESSION, elle, porte un avertissement. L'asymétrie disait au vendeur que
   * renommer était le geste sans conséquence des deux.
   *
   * C'est l'inverse. `Product.UpdateVariant` écrit le nouveau SKU et ne lève AUCUN
   * événement : `Offer.VariantSku` et `InventoryItem.Sku` gardent l'ancien. Le
   * sélecteur de création d'offre calcule les SKU libres en comparant variantes et
   * offres — la variante renommée redevient « libre », le vendeur crée une seconde
   * mise en vente dessus, sans stock derrière. Et `IsInStockAsync` répond
   * « disponible » pour un SKU que personne ne suit. C'est une vente à découvert, sur
   * une fiche qui affiche deux offres dont l'une est fantôme.
   *
   * Le serveur refuse désormais ce renommage (409). Ce verrou d'écran est ce qui évite
   * de l'apprendre après avoir tout ressaisi.
   *
   * TANT QU'ON NE SAIT PAS, ON VERROUILLE. Si les offres sont en cours de chargement
   * ou n'ont pas pu être lues, on ne peut pas affirmer que ce SKU est libre. Ouvrir le
   * champ « par défaut » rendrait le verrou absent exactement les jours où le serveur
   * est instable — et le vendeur recevrait un 409 sans rien comprendre.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const skusEngages = new Set(
    offresDuProduit.map((o) => (o.sku ?? "").trim().toUpperCase()).filter((x) => x.length > 0),
  );

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
      attributes: toRows(v.attributes),
    });
    setPane("edit");
  }

  function payload() {
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
      // CODE-BARRES : PLUS DE CHAMP, MAIS LA VALEUR EXISTANTE EST RENVOYÉE.
      // `openEdit` charge `v.barcode` dans le brouillon ; l'omettre ici effacerait le
      // code-barres des déclinaisons qui en portent un, à la première modification de
      // leur poids. Personne ne le lit — ce n'est pas une raison pour le détruire.
      barcode: draft.barcode.trim() || null,
      weightGrams: num(draft.weightGrams) ?? 0,
      // Dimensions : voir la note du formulaire. Plus demandées, donc jamais posées.
      lengthMm: null,
      widthMm: null,
      heightMm: null,
    };
  }

  const create = useMutation({
    mutationFn: () =>
      bff<{ variantId: string }>(`/seller/products/${product.id}/variants`, {
        method: "POST",
        body: JSON.stringify(payload()),
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
        body: JSON.stringify(payload()),
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
  // LE POIDS EST OBLIGATOIRE ICI, ET LA RAISON N'EST PAS CELLE QUI ÉTAIT ÉCRITE.
  //
  // Le commentaire précédent disait « c'est cette donnée qui sert aux calculs
  // d'expédition ». FAUX, et contredit par la note du formulaire plus bas :
  // `ShippingRate` est un forfait par commune de destination, qui « ne dépend ni du
  // poids, ni du volume, ni du nombre d'articles ». Aucun calcul ne lit le poids.
  //
  // Ce qui reste vrai, et qui suffit à exiger une saisie : le champ part vers un `int`
  // NON NULLABLE. « 1,5 » ou « abc » fait échouer la désérialisation avant toute
  // validation métier, avec un 400 que l'écran ne sait pas expliquer. On demande donc
  // un entier — 0 compris, et le message d'erreur le dit.
  //
  // La création d'un produit, elle, n'exige plus rien : l'assistant envoie 0 et laisse
  // le vendeur préciser ici s'il en a l'usage.
  // ───────────────────────────────────────────────────────────────────────────────
  const weightOk = isWholeNumber(draft.weightGrams);

  // Verrou du SKU : jamais à la création (rien n'est encore engagé), toujours à la
  // modification tant qu'on ignore l'état des offres, et sinon dès qu'une offre porte
  // la référence ACTUELLE — pas celle en cours de saisie, qui est justement ce qu'on
  // empêche de changer.
  const skuVerrouille =
    !isCreate &&
    (offresIndisponibles || skusEngages.has((editing?.sku ?? "").trim().toUpperCase()));

  const canSave = draft.sku.trim().length > 0 && weightOk;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>Déclinaisons ({product.variants.length})</CardTitle>
        <Button size="sm" variant="outline" onClick={openCreate} disabled={lectureSeule}>
          <Plus className="size-4" /> Ajouter
        </Button>
      </CardHeader>

      <CardContent className="space-y-2 pt-0">
        {lectureSeule && <ReadOnlyNote />}
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
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Modifier"
                  onClick={() => openEdit(v)}
                  disabled={lectureSeule}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-destructive"
                  aria-label="Retirer"
                  onClick={() => setConfirmDelete(v)}
                  disabled={lectureSeule}
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
            disabled={skuVerrouille}
            aria-describedby={skuVerrouille || !isCreate ? "v-sku-note" : undefined}
          />
          {skuVerrouille ? (
            <p id="v-sku-note" className="text-xs text-amber-700 dark:text-amber-400">
              {offresIndisponibles
                ? "Vos mises en vente n'ont pas pu être lues : tant qu'on ignore si ce SKU est engagé, il n'est pas modifiable. Rechargez la page."
                : "Cette référence porte une de vos mises en vente. La renommer laisserait l'offre et le stock sur l'ancienne : retirez l'offre, renommez, puis recréez-la — ou ajoutez une nouvelle déclinaison."}
            </p>
          ) : !isCreate ? (
            <p id="v-sku-note" className="text-xs text-muted-foreground">
              Modifiable tant qu&apos;aucune mise en vente ne porte cette référence.
            </p>
          ) : null}
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
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════
            LES DIMENSIONS ONT ÉTÉ RETIRÉES, ET C'EST LE CAS LE PLUS NET DE L'AUDIT.

            Personne ne les lit. Elles ne sont pas dans `ProductVariantSummary`
            (`Id, Sku, Attributes, Barcode, WeightGrams`), donc le vendeur qui les
            saisissait ne pouvait PLUS JAMAIS les relire : le formulaire de modification
            les réinitialisait à vide, et `UpdateProductVariantCommand` ne les porte pas.
            Leur unique lecture dans tout le dépôt était un test unitaire.

            Elles ne servent pas davantage au transport : `ShippingRate` le dit en toutes
            lettres — « Le montant est un forfait, pas un calcul. Il ne dépend ni du
            poids, ni du volume, ni du nombre d'articles. » Le seul point d'entrée
            tarifaire prend une commune de destination.

            L'ancien texte « À renseigner maintenant : les dimensions ne sont plus
            modifiables après la création » était exact, et c'est bien ce qui le rendait
            insoutenable : on demandait un effort définitif pour une donnée que rien ne
            consomme.

            Le champ reste dans le domaine et en base ; ce qui disparaît, c'est la
            demande. `payload` envoie désormais `null` sur les trois.
            ═══════════════════════════════════════════════════════════════════════ */}

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
