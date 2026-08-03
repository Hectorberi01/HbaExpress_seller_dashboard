"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { shortId } from "@/lib/utils";
import { catalogTone, statusLabel } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import { ProductIdentityForm } from "@/components/product/product-identity-form";
import { ProductMediaManager } from "@/components/product/product-media-manager";
import { ProductVariantsManager } from "@/components/product/product-variants-manager";
import { ProductOffersManager } from "@/components/product/product-offers-manager";
import type {
  FulfillmentLocation,
  SellerBrand,
  SellerCategory,
  SellerOffer,
  SellerProduct,
} from "@/types/seller";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";

/**
 * Fiche produit complète — consultation et gestion.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * CE QUE LE VENDEUR NE PEUT PAS FAIRE, ET POURQUOI ON LE DIT
 *
 * `PATCH /seller/products/{id}/status` REFUSE explicitement « Active » (403) : la
 * publication en vitrine passe par l'administration. L'écran n'affiche donc aucun
 * bouton « Publier ». Le proposer et laisser le serveur refuser aurait été la pire
 * des options — le vendeur clique, échoue, et ne comprend ni pourquoi ni quoi faire.
 *
 * Restent à sa main : repasser en brouillon (retrait de la vente, réversible) et
 * archiver (retrait complet).
 * ─────────────────────────────────────────────────────────────────────────────────
 */
export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const id = params?.id ?? "";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);

  const product = useQuery({
    queryKey: ["seller-product", id],
    queryFn: () => bff<SellerProduct>(`/seller/products/${id}`),
    enabled: id.length > 0,
  });

  // Toutes les offres de la boutique, filtrées ensuite sur ce produit : le BFF n'a
  // pas de filtre `?productId=`, et cette requête est déjà en cache depuis la liste.
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
  const locations = useQuery({
    queryKey: ["seller-locations"],
    queryFn: () => bff<FulfillmentLocation[]>("/seller/locations"),
  });

  const productOffers = useMemo(
    () => (offers.data ?? []).filter((o) => o.productId === id),
    [offers.data, id],
  );

  /** Recharge fiche ET offres : une action sur l'une change souvent l'autre. */
  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["seller-product", id] }),
      qc.invalidateQueries({ queryKey: ["seller-offers"] }),
      qc.invalidateQueries({ queryKey: ["seller-products"] }),
    ]);
  }

  const changeStatus = useMutation({
    mutationFn: (status: string) =>
      bff(`/seller/products/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => refresh(),
    meta: { successMessage: "Statut du produit mis à jour." },
  });

  const remove = useMutation({
    mutationFn: () => bff(`/seller/products/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirmDelete(false);
      await qc.invalidateQueries({ queryKey: ["seller-products"] });
      router.replace("/products");
    },
    meta: {
      successMessage: "Produit supprimé.",
      // Repli seulement : le serveur renvoie un message précis quand des offres
      // subsistent (« Ce produit porte encore N offre(s)… »), qui a la priorité.
      errorMessage: "Suppression impossible.",
    },
  });

  if (product.isLoading) {
    return (
      <div className="p-6 lg:p-8">
        <BackLink />
        <p className="text-sm text-muted-foreground">Chargement du produit…</p>
      </div>
    );
  }

  if (product.isError || !product.data) {
    return (
      <div className="p-6 lg:p-8">
        <BackLink />
        <QueryError of={product} />
        <p className="text-sm text-muted-foreground">
          Ce produit est introuvable, ou n&apos;appartient pas à votre boutique.
        </p>
      </div>
    );
  }

  const p = product.data;
  const status = p.status.toLowerCase();

  return (
    <div className="p-6 lg:p-8">
      <BackLink />

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
          <p className="font-mono text-xs text-muted-foreground">
            {p.slug || shortId(p.id)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={catalogTone(p.status)}>{statusLabel(p.status, "product")}</Badge>

          {/* Retrait de la vitrine. Confirmation OBLIGATOIRE : le retour en vente ne
              dépend plus du vendeur (« Active » lui est refusé en 403), il passe par
              l'administration. Un clic accidentel coûte donc un délai qu'il ne
              maîtrise pas — c'est plus lourd que la suppression d'une photo, qui,
              elle, a déjà sa confirmation. */}
          {status === "active" && (
            <Button
              size="sm"
              variant="outline"
              disabled={changeStatus.isPending}
              onClick={() => setConfirmUnpublish(true)}
            >
              Retirer de la vente
            </Button>
          )}
          {status === "archived" && (
            <Button
              size="sm"
              variant="outline"
              disabled={changeStatus.isPending}
              onClick={() => changeStatus.mutate("Draft")}
            >
              Remettre en brouillon
            </Button>
          )}
          {status !== "archived" && (
            <Button
              size="sm"
              variant="outline"
              disabled={changeStatus.isPending}
              onClick={() => changeStatus.mutate("Archived")}
            >
              Archiver
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4" /> Supprimer
          </Button>
        </div>
      </header>

      {status === "draft" && (
        <PageNote>
          Ce produit est en <strong>brouillon</strong> : il n&apos;apparaît pas encore en
          boutique. Sa mise en vitrine est validée par l&apos;administration — vous pouvez
          d&apos;ici préparer la fiche, les photos et le prix.
        </PageNote>
      )}
      {status === "archived" && (
        <PageNote>
          Ce produit est <strong>archivé</strong> : il n&apos;est plus en vente. Repassez-le
          en brouillon pour le rééditer.
        </PageNote>
      )}

      <QueryError of={[offers, categories, brands, locations]} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <ProductIdentityForm
            product={p}
            categories={categories.data ?? []}
            brands={brands.data ?? []}
            onSaved={refresh}
          />
        </div>

        <div className="space-y-6">
          <ProductMediaManager product={p} onChanged={refresh} />
          <ProductVariantsManager product={p} onChanged={refresh} />
          <ProductOffersManager
            product={p}
            offers={productOffers}
            locations={locations.data ?? []}
            offersLoading={offers.isLoading}
            offersUnavailable={offers.isError}
            onChanged={refresh}
          />
        </div>
      </div>

      <Dialog
        open={confirmUnpublish}
        onClose={() => setConfirmUnpublish(false)}
        title="Retirer ce produit de la vente ?"
        description="Il repassera en brouillon et disparaîtra de la boutique. Sa remise en vitrine devra être validée par l'administration : vous ne pourrez pas la déclencher vous-même."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmUnpublish(false)}>
              Annuler
            </Button>
            {/* La boîte reste ouverte pendant l'appel — comme celle de suppression
                juste en dessous. La fermer avant `mutate()` faisait disparaître le
                bouton au moment précis où `isPending` devenait vrai : ni indicateur
                de chargement, ni protection contre le double clic. */}
            <Button
              disabled={changeStatus.isPending}
              onClick={() =>
                changeStatus.mutate("Draft", { onSuccess: () => setConfirmUnpublish(false) })
              }
            >
              {changeStatus.isPending && <Loader2 className="size-4 animate-spin" />}
              Retirer de la vente
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Pour suspendre temporairement la vente sans quitter la vitrine, préférez «
          Suspendre la vente » sur la mise en vente concernée.
        </p>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Supprimer ce produit ?"
        description="La fiche et toutes ses photos sont effacées définitivement. Si le produit est encore en vente, la suppression sera refusée : retirez d'abord ses mises en vente."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Annuler
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending && <Loader2 className="size-4 animate-spin" />}
              Supprimer définitivement
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Les commandes déjà passées sur ce produit ne sont pas affectées : elles conservent
          leur historique.
        </p>
      </Dialog>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/products"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> Tous les produits
    </Link>
  );
}
