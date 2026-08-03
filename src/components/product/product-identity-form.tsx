"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { categoryReadablePath } from "@/lib/categories";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SellerBrand, SellerCategory, SellerProduct } from "@/types/seller";
import { Info, Loader2, Plus, X } from "lucide-react";

/**
 * Ligne de caractéristique avec identité PROPRE.
 *
 * Un couple clé/valeur ne peut pas servir de clé de liste : deux lignes vides
 * naissantes sont identiques, et la clé change dès qu'on tape. L'index non plus —
 * retirer la première ligne décale toutes les suivantes, et le curseur se retrouve
 * dans un autre champ que celui qu'on éditait.
 */
type AttributeRow = { uid: number; key: string; value: string };

let attributeSeq = 0;
const toRows = (source: Record<string, string> | undefined): AttributeRow[] =>
  Object.entries(source ?? {}).map(([key, value]) => ({ uid: ++attributeSeq, key, value }));

/**
 * Fiche descriptive du produit.
 *
 * ⚠️ `PUT /seller/products/{id}` envoie un objet COMPLET (`UpdateProductRequest`) : les
 * champs absents ne sont pas « laissés tels quels », ils sont écrasés. On repart donc
 * toujours de la fiche chargée, jamais d'un formulaire vide.
 *
 * ⚠️ La CATÉGORIE ne figure pas dans `UpdateProductCommand` : elle est fixée à la
 * création et n'est pas modifiable ici. On l'affiche en lecture seule plutôt que de
 * proposer un champ qui serait silencieusement ignoré.
 */
export function ProductIdentityForm({
  product,
  categories,
  brands,
  onSaved,
}: {
  product: SellerProduct;
  categories: SellerCategory[];
  brands: SellerBrand[];
  onSaved: () => Promise<unknown>;
}) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description);
  const [brandId, setBrandId] = useState(product.brandId ?? "");
  const [gtin, setGtin] = useState(product.gtin ?? "");
  const [ean, setEan] = useState(product.ean ?? "");
  const [tags, setTags] = useState<string[]>(product.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [attributes, setAttributes] = useState<AttributeRow[]>(() => toRows(product.attributes));

  // ───────────────────────────────────────────────────────────────────────────────
  // RESYNCHRONISATION SUR L'IDENTIFIANT, PAS SUR L'OBJET.
  //
  // La version précédente dépendait de `product` — un objet recréé à CHAQUE refetch.
  // Or toute action des panneaux voisins (ajouter une photo, créer une déclinaison,
  // changer un prix, archiver) appelle `refresh()`, qui invalide la fiche.
  //
  // Résultat : le vendeur rédigeait sa description, ajoutait une photo dans la colonne
  // de droite, et sa description disparaissait — remplacée par la valeur serveur, sans
  // le moindre signal. Le champ ne se vidait pas : il revenait en arrière, ce qui est
  // plus insidieux encore.
  //
  // On ne resynchronise donc qu'au CHANGEMENT DE PRODUIT (navigation d'une fiche à
  // l'autre, où React réutilise le composant). Les autres champs de la fiche ne sont
  // modifiables que d'ici : personne d'autre ne peut les faire diverger.
  // ───────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    setName(product.name);
    setDescription(product.description);
    setBrandId(product.brandId ?? "");
    setGtin(product.gtin ?? "");
    setEan(product.ean ?? "");
    setTags(product.tags ?? []);
    setAttributes(toRows(product.attributes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const save = useMutation({
    mutationFn: () =>
      bff(`/seller/products/${product.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          // Chaîne vide = « aucune marque ». L'envoyer telle quelle ferait échouer la
          // désérialisation d'un Guid? côté serveur.
          brandId: brandId || null,
          gtin: gtin.trim() || null,
          ean: ean.trim() || null,
          productGroupId: product.productGroupId ?? null,
          attributes: Object.fromEntries(
            attributes.filter((a) => a.key.trim().length > 0).map((a) => [a.key.trim(), a.value]),
          ),
          tags,
        }),
      }),
    onSuccess: () => onSaved(),
    meta: {
      successMessage: "Fiche produit enregistrée.",
      errorMessage: "La fiche n'a pas pu être enregistrée.",
    },
  });

  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) {
      setTagInput("");
      return;
    }
    setTags([...tags, t]);
    setTagInput("");
  }

  // Chemin LISIBLE (« Électronique › Téléphones ») : `path` n'est qu'une suite de
  // slugs d'URL, et `name` seul est ambigu — plusieurs branches partagent le même.
  const category = categories.find((c) => c.id === product.categoryId);
  const categoryLabel = category ? categoryReadablePath(category, categories) : "—";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fiche produit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="space-y-1.5">
          <Label htmlFor="p-name">Nom</Label>
          <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="p-desc">Description</Label>
          <Textarea
            id="p-desc"
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="p-brand">Marque</Label>
            <Select id="p-brand" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value="">Sans marque</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Catégorie</Label>
            <div className="flex h-9 items-center rounded-xl bg-muted px-3.5 text-sm text-muted-foreground">
              {categoryLabel}
            </div>
            <p className="text-xs text-muted-foreground">
              Fixée à la création : elle détermine le classement en boutique et ne se
              change pas depuis ici.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-gtin">GTIN</Label>
            <Input id="p-gtin" value={gtin} onChange={(e) => setGtin(e.target.value)} placeholder="Facultatif" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-ean">EAN</Label>
            <Input id="p-ean" value={ean} onChange={(e) => setEan(e.target.value)} placeholder="Facultatif" />
          </div>
        </div>

        {/* ───────── Mots-clés ───────── */}
        <div className="space-y-1.5">
          <Label htmlFor="p-tag">Mots-clés</Label>
          <div className="flex gap-2">
            <Input
              id="p-tag"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  // Sinon la touche Entrée soumettrait le formulaire parent et
                  // enregistrerait la fiche au lieu d'ajouter le mot-clé.
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="Ajouter un mot-clé puis Entrée"
            />
            <Button type="button" variant="outline" onClick={addTag} disabled={!tagInput.trim()}>
              <Plus className="size-4" />
            </Button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => setTags(tags.filter((x) => x !== t))}
                    aria-label={`Retirer le mot-clé ${t}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ───────── Caractéristiques ───────── */}
        <div className="space-y-2">
          <Label>Caractéristiques</Label>
          {attributes.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Aucune caractéristique. Ce sont les couples « Matière : coton », « Garantie :
              12 mois » affichés sur la fiche acheteur.
            </p>
          )}
          {attributes.map((a) => (
            <div key={a.uid} className="flex gap-2">
              <Input
                value={a.key}
                aria-label="Nom de la caractéristique"
                placeholder="Nom"
                onChange={(e) =>
                  setAttributes((rows) =>
                    rows.map((r) => (r.uid === a.uid ? { ...r, key: e.target.value } : r)),
                  )
                }
              />
              <Input
                value={a.value}
                aria-label="Valeur de la caractéristique"
                placeholder="Valeur"
                onChange={(e) =>
                  setAttributes((rows) =>
                    rows.map((r) => (r.uid === a.uid ? { ...r, value: e.target.value } : r)),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Retirer cette caractéristique"
                onClick={() => setAttributes((rows) => rows.filter((r) => r.uid !== a.uid))}
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
              setAttributes((rows) => [...rows, { uid: ++attributeSeq, key: "", value: "" }])
            }
          >
            <Plus className="size-4" /> Ajouter une caractéristique
          </Button>
        </div>

        <p className="flex items-start gap-1.5 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Enregistrer remplace la fiche entière par ce qui est affiché ci-dessus. Un champ
          vidé ici est vidé sur la boutique.
        </p>

        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending || name.trim().length === 0}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            Enregistrer la fiche
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
