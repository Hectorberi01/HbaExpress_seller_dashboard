"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { shouldNavigateOnRowClick } from "@/lib/row-navigation";
import { categoryReadablePath } from "@/lib/categories";
import { formatXof, shortId } from "@/lib/utils";
import { catalogTone, statusLabel } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import type { SellerBrand, SellerCategory, SellerOffer, SellerProduct } from "@/types/seller";
import { ImageOff, Plus, Search } from "lucide-react";

export default function ProductsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const products = useQuery({
    queryKey: ["seller-products"],
    queryFn: () => bff<SellerProduct[]>("/seller/products"),
  });
  // Les offres sont chargées EN UNE FOIS, pas une requête par ligne. Une liste de
  // vingt produits ne doit pas déclencher vingt appels — c'est le défaut « rafale de
  // requêtes » relevé sur la console admin (§1.2).
  const offers = useQuery({
    queryKey: ["seller-offers"],
    queryFn: () => bff<SellerOffer[]>("/seller/offers"),
  });
  const categories = useQuery({
    queryKey: ["seller-categories"],
    queryFn: () => bff<SellerCategory[]>("/seller/categories"),
  });
  const brands = useQuery({
    queryKey: ["seller-brands"],
    queryFn: () => bff<SellerBrand[]>("/seller/brands"),
  });

  // Ni `path` brut (« /electronique/telephones » : une suite de slugs d'URL), ni `name`
  // seul (« Accessoires », que plusieurs branches portent) : le CHEMIN LISIBLE,
  // reconstruit à partir des noms des ancêtres — « Électronique › Téléphones ».
  const catName = useMemo(() => {
    const all = categories.data ?? [];
    return new Map(all.map((c) => [c.id, categoryReadablePath(c, all)]));
  }, [categories.data]);
  const brandName = useMemo(() => new Map((brands.data ?? []).map((b) => [b.id, b.name])), [brands.data]);

  /** Offres regroupées par produit, pour afficher prix et statut sur chaque ligne. */
  const offersByProduct = useMemo(() => {
    const m = new Map<string, SellerOffer[]>();
    for (const o of offers.data ?? []) {
      const list = m.get(o.productId);
      if (list) list.push(o);
      else m.set(o.productId, [o]);
    }
    return m;
  }, [offers.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = products.data ?? [];
    if (!needle) return all;
    return all.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.variants.some((v) => v.sku.toLowerCase().includes(needle)),
    );
  }, [products.data, search]);

  function primaryImage(p: SellerProduct): string | undefined {
    return (p.media?.find((m) => m.isPrimary) ?? p.media?.[0])?.url;
  }

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Produits &amp; offres</h1>
          <p className="text-sm text-muted-foreground">
            {products.isLoading ? "Chargement…" : `${rows.length} produit(s)`}
          </p>
        </div>
        <Link href="/products/nouveau">
          <Button>
            <Plus className="size-4" /> Nouveau produit
          </Button>
        </Link>
      </header>

      <PageNote>
        Votre catalogue et le prix de vente associé à chaque référence. Les montants qui vous
        reviennent sont <strong>calculés par la plateforme</strong> selon le barème en vigueur : ce
        que vous lisez ici est ce qui sera réellement versé. Ouvrez un produit pour modifier sa
        fiche, ses photos, ses déclinaisons et ses prix.
      </PageNote>

      <QueryError of={[products, offers, categories, brands]} />

      <div className="mb-4 relative sm:max-w-xs">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nom ou SKU…"
          className="pl-9"
        />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14" />
              <TableHead>Produit</TableHead>
              <TableHead>Catégorie</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Offres</TableHead>
              <TableHead className="text-right">Prix acheteur</TableHead>
              <TableHead className="text-right">Vous percevez</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Chargement…
                </TableCell>
              </TableRow>
            ) : products.isError ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Catalogue non chargé.
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  {search ? "Aucun produit ne correspond." : "Aucun produit dans votre catalogue."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((p) => {
                const list = offersByProduct.get(p.id) ?? [];
                // La plus basse : c'est elle qui devient le prix affiché à l'acheteur.
                const best = list.reduce<SellerOffer | null>(
                  (acc, o) => (acc === null || o.productPrice < acc.productPrice ? o : acc),
                  null,
                );
                const img = primaryImage(p);

                return (
                  // Voir la note de la liste des commandes : le lien du nom porte
                  // l'accessibilité, le clic sur la ligne n'est qu'un confort souris.
                  <TableRow
                    key={p.id}
                    className="cursor-pointer"
                    onClick={() => {
                      if (shouldNavigateOnRowClick()) router.push(`/products/${p.id}`);
                    }}
                  >
                    <TableCell>
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt="" className="size-10 rounded-lg object-cover" />
                      ) : (
                        <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <ImageOff className="size-4" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {/* Vrai lien sur le nom : c'est lui qui rend possible le clic
                          milieu et le « ouvrir dans un nouvel onglet ». Le `onClick`
                          de la ligne, lui, ne sert que le confort. */}
                      <Link
                        href={`/products/${p.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {p.name}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">
                        {p.variants.length > 0 ? p.variants[0].sku : shortId(p.id)}
                        {p.variants.length > 1 && ` +${p.variants.length - 1}`}
                        {p.brandId && brandName.has(p.brandId) && ` · ${brandName.get(p.brandId)}`}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {catName.get(p.categoryId) ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={catalogTone(p.status)}>{statusLabel(p.status, "product")}</Badge>
                    </TableCell>
                    <TableCell>
                      {offers.isError ? (
                        // On ne prétend pas « aucune offre » quand la requête a échoué :
                        // un vendeur en créerait une seconde en doublon.
                        <span className="text-xs text-muted-foreground">indisponible</span>
                      ) : list.length === 0 ? (
                        <span className="text-xs text-muted-foreground">aucune</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {list.slice(0, 2).map((o) => (
                            <Badge key={o.id} variant={catalogTone(o.status)}>
                              {statusLabel(o.status, "offer")}
                            </Badge>
                          ))}
                          {list.length > 2 && <Badge variant="neutral">+{list.length - 2}</Badge>}
                        </div>
                      )}
                    </TableCell>
                    {/* « — » signifie « aucun prix défini ». Quand la requête des offres
                        a échoué, on n'en sait rien : on le dit, comme dans la colonne
                        « Offres » juste avant. Deux cellules plus loin, le même piège. */}
                    <TableCell className="text-right tabular-nums">
                      {offers.isError ? (
                        <span className="text-xs text-muted-foreground">indisponible</span>
                      ) : best ? (
                        formatXof(best.productPrice)
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-primary">
                      {offers.isError ? (
                        <span className="text-xs font-normal text-muted-foreground">
                          indisponible
                        </span>
                      ) : best ? (
                        formatXof(best.sellerPrice)
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

    </div>
  );
}
