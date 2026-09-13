"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { shouldNavigateOnRowClick } from "@/lib/row-navigation";
import { categoryReadablePath } from "@/lib/categories";
import { cn, formatMoney, shortId } from "@/lib/utils";
import { catalogTone, statusLabel } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import { ViewToggle, useVueListe } from "@/components/view-toggle";
import type { SellerBrand, SellerCategory, SellerOffer, SellerProduct } from "@/types/seller";
import { ImageOff, Plus, Search } from "lucide-react";

export default function ProductsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const { vue, choisir } = useVueListe("mp_seller_vue_produits");

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

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * LES DEUX VUES LISENT LA MÊME LISTE DÉRIVÉE. C'EST LA SEULE FAÇON DE TENIR.
   *
   * Tableau et catalogue montrent les mêmes produits, les mêmes prix et les mêmes
   * statuts. Recalculer tout cela deux fois — une fois par vue — aurait produit deux
   * écrans qui divergent au premier correctif appliqué d'un seul côté : la meilleure
   * offre choisie autrement, une marque oubliée, un « — » là où l'autre dit
   * « indisponible ». Le vendeur bascule d'une vue à l'autre et lit deux vérités.
   *
   * Tout ce qui demande une décision est donc arrêté ICI, une fois ; les deux vues ne
   * font plus que disposer le résultat.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const lignes = useMemo(
    () =>
      rows.map((p) => {
        const offres = offersByProduct.get(p.id) ?? [];
        // La plus basse : c'est elle qui devient le prix affiché à l'acheteur.
        const meilleure = offres.reduce<SellerOffer | null>(
          (acc, o) => (acc === null || o.productPrice < acc.productPrice ? o : acc),
          null,
        );
        const media = p.media?.find((m) => m.isPrimary) ?? p.media?.[0];
        return {
          produit: p,
          offres,
          meilleure,
          image: media?.url,
          // Le texte alternatif saisi par le vendeur, s'il en a mis un.
          alt: media?.altText?.trim() || undefined,
          categorie: catName.get(p.categoryId) ?? "—",
          reference:
            (p.variants.length > 0 ? p.variants[0].sku : shortId(p.id)) +
            (p.variants.length > 1 ? ` +${p.variants.length - 1}` : "") +
            (p.brandId && brandName.has(p.brandId) ? ` · ${brandName.get(p.brandId)}` : ""),
        };
      }),
    [rows, offersByProduct, catName, brandName],
  );

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * « PAS D'OFFRE » ET « JE NE SAIS PAS ENCORE » SONT DEUX CHOSES DIFFÉRENTES.
   *
   * Les produits et les offres sont DEUX requêtes indépendantes, et la liste des
   * produits est la plus légère : elle arrive presque toujours la première. Pendant
   * cet intervalle, `offersByProduct` est vide. Ne tester que l'échec faisait donc
   * afficher « aucune » et « — » sur TOUTES les lignes, à chaque ouverture de
   * l'écran — soit très exactement le message « ce produit n'a pas de prix » qu'un
   * vendeur corrige en recréant une offre en doublon.
   *
   * Le test porte donc sur la PRÉSENCE de la donnée, pas sur l'absence d'erreur : il
   * couvre d'un coup le chargement et l'échec sans réponse. Un échec APRÈS une
   * première réponse laisse au contraire les prix connus à l'écran — `QueryError`,
   * au-dessus, dit déjà que la dernière tentative a échoué.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const offresInconnues = !offers.data;

  /**
   * Le montant à afficher, ou `null` quand on ne sait pas.
   *
   * La devise vient de l'offre, pas d'une constante : `formatMoney`, jamais
   * `formatXof` — le contrat porte un champ `currency`, et coller « F CFA » sur un
   * montant en euros n'est pas une approximation, c'est un chiffre faux. (Le choix de
   * la « meilleure » offre, lui, compare des nombres nus : il suppose une devise
   * unique, ce qui est le cas de la plateforme aujourd'hui.)
   */
  function montant(ligne: (typeof lignes)[number], champ: "productPrice" | "sellerPrice") {
    if (offresInconnues) return null;
    if (!ligne.meilleure) return "—";
    return formatMoney(ligne.meilleure[champ], ligne.meilleure.currency);
  }

  /**
   * Chargement, échec, liste vide : UN SEUL endroit, pour les deux vues.
   *
   * `products.isError` seul aurait effacé un catalogue encore en mémoire : React Query
   * conserve `data` quand un rechargement échoue. On ne déclare l'écran vide que si
   * l'on n'a vraiment rien à montrer — sinon `QueryError`, au-dessus, dit déjà que la
   * dernière tentative a échoué, et le vendeur garde sa liste sous les yeux.
   */
  const catalogueInconnu = products.isLoading || !products.data;
  const etat: string | null = products.isLoading
    ? "Chargement…"
    : !products.data
      ? "Catalogue non chargé."
      : lignes.length === 0
        ? search
          ? "Aucun produit ne correspond."
          : "Aucun produit dans votre catalogue."
        : null;

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Produits &amp; offres</h1>
          <p className="text-sm text-muted-foreground">
            {/* « 0 produit(s) » sur un catalogue qui n'a pas répondu serait un
                décompte inventé, à côté d'un corps de page qui dit l'inverse. */}
            {products.isLoading ? "Chargement…" : catalogueInconnu ? null : `${lignes.length} produit(s)`}
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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nom ou SKU…"
            className="pl-9"
          />
        </div>
        <ViewToggle vue={vue} onChange={choisir} />
      </div>

      {vue === "tableau" ? (
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
              {etat ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    {etat}
                  </TableCell>
                </TableRow>
              ) : (
                lignes.map((l) => (
                  // Voir la note de la liste des commandes : le lien du nom porte
                  // l'accessibilité, le clic sur la ligne n'est qu'un confort souris.
                  <TableRow
                    key={l.produit.id}
                    className="cursor-pointer"
                    onClick={() => {
                      if (shouldNavigateOnRowClick()) router.push(`/products/${l.produit.id}`);
                    }}
                  >
                    <TableCell>
                      <Vignette url={l.image} alt={l.alt} taille="sm" />
                    </TableCell>
                    <TableCell>
                      {/* Vrai lien sur le nom : c'est lui qui rend possible le clic
                          milieu et le « ouvrir dans un nouvel onglet ». Le `onClick`
                          de la ligne, lui, ne sert que le confort. */}
                      <Link
                        href={`/products/${l.produit.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {l.produit.name}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{l.reference}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{l.categorie}</TableCell>
                    <TableCell>
                      <Badge variant={catalogTone(l.produit.status)}>
                        {statusLabel(l.produit.status, "product")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Offres offres={l.offres} indisponible={offresInconnues} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Montant texte={montant(l, "productPrice")} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Montant texte={montant(l, "sellerPrice")} fort />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      ) : etat ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">{etat}</Card>
      ) : (
        /* ═══════════════════════════════════════════════════════════════════════════
           LA CARTE ENTIÈRE EST UN LIEN, ET NON UNE CARTE MUNIE D'UN `onClick`.

           Le tableau garde son clic de ligne parce qu'une ligne ne peut pas être un
           lien sans casser la sémantique du tableau — d'où le vrai lien porté par le
           nom, et le `onClick` en simple confort. Une carte n'a pas cette contrainte :
           un `<Link>` autour de tout donne le clic milieu, l'ouverture dans un nouvel
           onglet, le focus clavier et l'annonce « lien » sans une ligne de JavaScript.
           Elle ne contient d'ailleurs aucun autre élément interactif à imbriquer.

           `draggable={false}` EST LA CONTREPARTIE, ET ELLE N'EST PAS COSMÉTIQUE. Un
           lien se GLISSE par défaut : sélectionner un SKU à la souris pour le coller
           dans un message aurait déclenché le glisser natif au lieu d'une sélection.
           C'est le geste que `row-navigation` protège explicitement côté tableau ; le
           catalogue ne pouvait pas le perdre en silence.

           LES DEUX PRIX GARDENT LEUR ÉTIQUETTE. Dans le tableau, ce sont les en-têtes
           de colonne qui disent lequel est lequel. Sur une carte, deux montants posés
           côte à côte sans un mot seraient indistinguables — et confondre « prix
           acheteur » et « vous percevez » est précisément l'erreur que cet écran
           existe pour empêcher.
           ═══════════════════════════════════════════════════════════════════════════ */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {lignes.map((l) => (
            <Link
              key={l.produit.id}
              href={`/products/${l.produit.id}`}
              draggable={false}
              className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="flex h-full flex-col">
                <Vignette url={l.image} alt={l.alt} taille="lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {/* `truncate` COUPE SANS LE DIRE : le texte reste dans le DOM —
                          les lecteurs d'écran l'ont en entier — mais l'œil perd la fin
                          d'un nom long. `title` le rend de nouveau lisible à la souris.
                          Le tableau, lui, passe ces champs à la ligne et n'en a pas
                          besoin. */}
                      <div className="truncate font-medium group-hover:text-primary" title={l.produit.name}>
                        {l.produit.name}
                      </div>
                      <div className="truncate font-mono text-xs text-muted-foreground" title={l.reference}>
                        {l.reference}
                      </div>
                    </div>
                    <Badge variant={catalogTone(l.produit.status)} className="shrink-0">
                      {statusLabel(l.produit.status, "product")}
                    </Badge>
                  </div>

                  <div className="truncate text-xs text-muted-foreground" title={l.categorie}>
                    {l.categorie}
                  </div>

                  <Offres offres={l.offres} indisponible={offresInconnues} />

                  {/* `mt-auto` : le nom et la catégorie tiennent sur une ligne, mais
                      la rangée d'offres, non — zéro, une, deux pastilles, ou deux plus
                      un « +N » qui passe à la ligne sur une carte étroite. Sans cela,
                      les prix de cartes voisines flottent à des hauteurs différentes et
                      l'œil ne peut plus les comparer d'un coup. */}
                  {/* UN MONTANT NE SE TRONQUE JAMAIS, et c'est le seul endroit de
                      l'écran où la règle change quelque chose : un libellé coupé se
                      voit, « 1 234 5… » se lit comme un prix plus petit et parfaitement
                      crédible. Les deux blocs passent donc à la ligne (`flex-wrap`)
                      plutôt que de rogner le chiffre. */}
                  <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-t pt-2.5 text-sm">
                    <div>
                      <div className="text-[11px] text-muted-foreground">Prix acheteur</div>
                      <div className="whitespace-nowrap tabular-nums">
                        <Montant texte={montant(l, "productPrice")} />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-muted-foreground">Vous percevez</div>
                      <div className="whitespace-nowrap tabular-nums">
                        <Montant texte={montant(l, "sellerPrice")} fort />
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ═════════════════════════════════════════════════════════════════════════════════
 * CES TROIS COMPOSANTS VIVENT HORS DE `ProductsPage`, ET CE N'EST PAS UN RANGEMENT.
 *
 * Définis dans le corps du composant, ils auraient été RECRÉÉS à chaque rendu : React
 * compare les types d'éléments par identité, et un type différent n'est pas un rendu
 * différent — c'est un démontage suivi d'un remontage, à chaque frappe dans le champ
 * de recherche. Ici le sous-arbre est sans état, donc rien ne se serait vu ; c'est
 * exactement pourquoi il faut l'écrire, parce que le jour où l'un d'eux prendra un
 * état ou une transition, le défaut apparaîtra loin de sa cause. Et « invisible » est
 * déjà optimiste : un `<img>` remonté est un nœud NEUF, que le navigateur redemande et
 * redécode — soit un scintillement des vignettes à chaque frappe dans la recherche.
 * ═════════════════════════════════════════════════════════════════════════════════
 */

/** Pastilles d'offres, communes aux deux vues. */
function Offres({ offres, indisponible }: { offres: SellerOffer[]; indisponible: boolean }) {
  if (indisponible) {
    // On ne prétend pas « aucune offre » quand la requête a échoué :
    // un vendeur en créerait une seconde en doublon.
    return <span className="text-xs text-muted-foreground">indisponible</span>;
  }
  if (offres.length === 0) {
    return <span className="text-xs text-muted-foreground">aucune</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {offres.slice(0, 2).map((o) => (
        <Badge key={o.id} variant={catalogTone(o.status)}>
          {statusLabel(o.status, "offer")}
        </Badge>
      ))}
      {offres.length > 2 && <Badge variant="neutral">+{offres.length - 2}</Badge>}
    </div>
  );
}

/** Un montant, ou la mention d'ignorance. Même rendu dans les deux vues. */
function Montant({ texte, fort }: { texte: string | null; fort?: boolean }) {
  if (texte === null) {
    return <span className="text-xs font-normal text-muted-foreground">indisponible</span>;
  }
  return <span className={fort ? "font-medium text-primary" : undefined}>{texte}</span>;
}

/**
 * Image principale d'un produit, ou son absence dite explicitement.
 *
 * Une photo manquante n'est pas un vide : c'est une fiche incomplète, invisible en
 * vitrine. Le pictogramme le signale, là où un cadre gris se lirait comme un
 * chargement qui n'en finit pas.
 *
 * `alt` VIDE PAR DÉFAUT, ET C'EST LE BON DÉFAUT : le nom du produit est juste à côté,
 * dans les deux vues, et le répéter ferait entendre deux fois la même chose. Quand le
 * vendeur a pris la peine d'écrire un texte alternatif, en revanche, il dit autre
 * chose que le nom — on le rend alors tel quel.
 */
function Vignette({ url, alt, taille }: { url?: string; alt?: string; taille: "sm" | "lg" }) {
  const cadre = taille === "sm" ? "size-10 rounded-lg" : "aspect-[4/3] w-full border-b";

  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={alt ?? ""} className={cn(cadre, "object-cover")} />;
  }
  return (
    <div
      className={cn(cadre, "flex items-center justify-center bg-muted text-muted-foreground")}
      aria-hidden
    >
      <ImageOff className={taille === "sm" ? "size-4" : "size-7"} />
    </div>
  );
}
