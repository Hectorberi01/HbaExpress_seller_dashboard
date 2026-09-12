"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { useDroitDeVendre } from "@/lib/selling";
import { shortId } from "@/lib/utils";
import { catalogTone, statusLabel } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import { Card } from "@/components/ui/card";
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
import { AlertTriangle, ArrowLeft, Loader2, Trash2 } from "lucide-react";

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
  const droit = useDroitDeVendre();
  const id = params?.id ?? "";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  /**
   * « ARCHIVER » PARTAIT AU PREMIER CLIC, JUSTE À CÔTÉ D'UN BOUTON PLUS LÉGER QUI,
   * LUI, DEMANDAIT CONFIRMATION.
   *
   * L'argument invoqué pour confirmer « Retirer de la vente » — le retour en vitrine
   * passe par l'administration, donc un clic accidentel coûte un délai que le vendeur
   * ne maîtrise pas — vaut au moins autant pour l'archivage, qui impose le même détour.
   * Les deux boutons sont côte à côte, et le seul sans filet était le plus lourd des
   * deux : l'asymétrie faisait lire l'archivage comme le geste anodin.
   */
  const [confirmArchive, setConfirmArchive] = useState(false);

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

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * LA SUPPRESSION EST REFUSÉE DÈS QU'UNE OFFRE EXISTE — SUSPENDUE COMPRISE.
   *
   * Le dialogue annonçait « si le produit est encore EN VENTE, la suppression sera
   * refusée ». Le serveur, lui, compte TOUTES les mises en vente du vendeur sur ce
   * produit, sans regarder leur statut : une offre suspendue bloque autant qu'une
   * offre active. Le vendeur qui venait justement de suspendre la sienne concluait
   * que la règle ne le concernait pas, cliquait deux fois — bouton, puis
   * « Supprimer définitivement » — et se prenait un refus.
   *
   * ON NE BLOQUE PAS SUR L'INCERTITUDE. Si la liste des offres n'a pas chargé, on
   * laisse le bouton actif : le serveur tranchera. Traiter une panne réseau comme un
   * empêchement enfermerait le vendeur sur un produit qu'il a le droit de supprimer.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const offresIncertaines = offers.isLoading || offers.isError;
  const bloqueParOffres = !offresIncertaines && productOffers.length > 0;

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
              disabled={droit.bloque || changeStatus.isPending}
              onClick={() => setConfirmUnpublish(true)}
            >
              Retirer de la vente
            </Button>
          )}
          {status === "archived" && (
            <Button
              size="sm"
              variant="outline"
              disabled={droit.bloque || changeStatus.isPending}
              onClick={() => changeStatus.mutate("Draft")}
            >
              Remettre en brouillon
            </Button>
          )}
          {status !== "archived" && (
            <Button
              size="sm"
              variant="outline"
              disabled={droit.bloque || changeStatus.isPending}
              onClick={() => setConfirmArchive(true)}
            >
              Archiver
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => setConfirmDelete(true)}
            disabled={bloqueParOffres}
            title={
              bloqueParOffres
                ? `Ce produit porte ${productOffers.length} mise(s) en vente, suspendues comprises. Retirez-les d'abord.`
                : undefined
            }
          >
            <Trash2 className="size-4" /> Supprimer
          </Button>

          {/* LE MOTIF EN CLAIR, PAS SEULEMENT AU SURVOL : le survol n'existe pas sur
              un téléphone, et un bouton inerte sans explication envoie chercher la
              cause partout sauf où elle est. */}
          {bloqueParOffres && (
            <p className="w-full text-xs text-muted-foreground">
              Suppression impossible : ce produit porte {productOffers.length} mise
              {productOffers.length > 1 ? "s" : ""} en vente, suspendue
              {productOffers.length > 1 ? "s" : ""} comprise
              {productOffers.length > 1 ? "s" : ""}.{" "}
              {/* NE PAS ENVOYER VERS UNE CARTE DONT LES BOUTONS SONT GRISÉS. La consigne
                  « retirez-les depuis la carte Mises en vente » était juste tant que la
                  boutique avait le droit d'écrire ; en lecture seule, elle désigne un
                  bouton désactivé, et l'écran se contredit à deux paragraphes d'écart. */}
              {droit.bloque
                ? "Le retrait d'une mise en vente demande le droit de vendre, que votre boutique n'a pas actuellement."
                : "Retirez-les depuis la carte « Mises en vente » ci-dessous."}
            </p>
          )}
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════════════════════
          LE DROIT D'ÉCRIRE, DIT UNE FOIS EN HAUT PLUTÔT QU'À CHAQUE BOUTON.

          Sans ce bandeau, une boutique suspendue ou fermée découvrait le refus bouton
          par bouton, après avoir rédigé, téléversé, saisi un prix.

          ON ÉNUMÈRE, ON NE GÉNÉRALISE PAS. La première rédaction disait « toutes les
          écritures de cet écran » passent par `SellerRights.CanSell`. C'était faux :
          `DeleteAsync` n'a aucun contrôle de statut, volontairement (voir la note en
          tête de ce handler). Annoncer un catalogue entièrement figé aurait retiré au
          vendeur, en paroles, une action qu'il conserve — le défaut exact que l'audit
          reproche à l'écran d'origine, dans l'autre sens.
          ═══════════════════════════════════════════════════════════════════════════ */}
      {droit.bloque && (
        <Card className="mb-4 p-4 text-sm">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <p className="font-medium">Modifications indisponibles</p>
              <p className="text-muted-foreground">{droit.raison}</p>
              <p className="text-muted-foreground">
                Sont figés : la fiche, les photos, les déclinaisons, les mises en vente et le
                statut du produit.{" "}
                {bloqueParOffres ? (
                  <>
                    La <strong>suppression</strong> du produit, elle, n&apos;est pas soumise à
                    l&apos;état de votre boutique — mais elle exige de retirer d&apos;abord les
                    mises en vente, ce que vous ne pouvez pas faire pour le moment.
                  </>
                ) : (
                  <>
                    La <strong>suppression</strong> du produit reste possible.
                  </>
                )}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* MÊME CONDITIONNEMENT QUE LA NOTE « ARCHIVÉ » CI-DESSOUS, ET POUR LA MÊME
          RAISON — celle-ci avait été oubliée, alors que « brouillon » est de loin
          l'état le plus fréquent : « vous pouvez d'ici préparer la fiche, les photos
          et le prix » s'affichait à six lignes de « Modifications indisponibles ». */}
      {status === "draft" && (
        <PageNote>
          Ce produit est en <strong>brouillon</strong> : il n&apos;apparaît pas encore en
          boutique. Sa mise en vitrine est validée par l&apos;administration
          {droit.bloque ? (
            <>
              {" "}
              — et, dans l&apos;état actuel de votre boutique, la fiche n&apos;est pas
              modifiable.
            </>
          ) : (
            <> — vous pouvez d&apos;ici préparer la fiche, les photos et le prix.</>
          )}
        </PageNote>
      )}
      {/* ═══════════════════════════════════════════════════════════════════════════
          « REPASSEZ-LE EN BROUILLON POUR LE RÉÉDITER » ENVOYAIT FAIRE UN ALLER-RETOUR
          POUR RIEN.

          Aucune garde d'archivage n'existe sur l'édition : ni `GuardAsync` côté BFF,
          qui ne regarde que le droit de vendre et la propriété, ni `Product.Update`,
          `AddVariant` ou les routes média côté domaine. La fiche, les photos, les
          déclinaisons et les offres restent pleinement modifiables sur un produit
          archivé — et le reste de cet écran le montre, juste en dessous.

          Le vendeur désarchivait donc par précaution, perdait l'état qu'il avait
          choisi, et devait le reposer ensuite. Ce qui est réellement bloqué, c'est la
          remise en vitrine : `ChangeStatusAsync` refuse « Active » en 403 quel que soit
          l'état de départ — elle passe par l'administration.
          ═══════════════════════════════════════════════════════════════════════════ */}
      {/* LA PHRASE DÉPEND DU DROIT D'ÉCRIRE, SINON LES DEUX ENCARTS SE CONTREDISENT.
          Sur une boutique suspendue et un produit archivé, les deux s'affichaient
          ensemble, à vingt-cinq lignes l'un de l'autre : « Modifications
          indisponibles » d'un côté, « vous pouvez continuer à le modifier » de
          l'autre. */}
      {status === "archived" && (
        <PageNote>
          Ce produit est <strong>archivé</strong> : il n&apos;est plus en vente.{" "}
          {droit.bloque ? (
            <>
              Sa remise en vitrine passe par l&apos;administration — et, dans l&apos;état
              actuel de votre boutique, le reste de la fiche n&apos;est pas modifiable non
              plus.
            </>
          ) : (
            <>
              Vous pouvez continuer à le modifier — fiche, photos, déclinaisons, mises en
              vente. Seule sa remise en vitrine passe par l&apos;administration.
            </>
          )}
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
            lectureSeule={droit.bloque}
          />
        </div>

        <div className="space-y-6">
          <ProductMediaManager product={p} onChanged={refresh} lectureSeule={droit.bloque} />
          <ProductVariantsManager
            product={p}
            onChanged={refresh}
            /* Les offres sont déjà chargées ici pour le gestionnaire d'offres : on les
               passe plutôt que de les redemander. Le doute de chargement est transmis
               tel quel — voir la note sur `skusEngages` dans le composant. */
            offresDuProduit={productOffers}
            offresIndisponibles={offers.isLoading || offers.isError}
            lectureSeule={droit.bloque}
          />
          <ProductOffersManager
            product={p}
            offers={productOffers}
            locations={locations.data ?? []}
            offersLoading={offers.isLoading}
            offersUnavailable={offers.isError}
            onChanged={refresh}
            lectureSeule={droit.bloque}
          />
        </div>
      </div>

      <Dialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title="Archiver ce produit ?"
        description="Il quitte la vitrine, mais reste dans votre liste de produits. Le remettre en vente devra être validé par l'administration : vous ne pourrez pas le déclencher vous-même."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmArchive(false)}>
              Annuler
            </Button>
            <Button
              disabled={droit.bloque || changeStatus.isPending}
              onClick={() =>
                changeStatus.mutate("Archived", { onSuccess: () => setConfirmArchive(false) })
              }
            >
              {changeStatus.isPending && <Loader2 className="size-4 animate-spin" />}
              Archiver
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Pour retirer le produit de la vitrine tout en gardant la main dessus, « Retirer de la
          vente » suffit : il repasse en brouillon et reste dans vos listes.
        </p>
      </Dialog>

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
              disabled={droit.bloque || changeStatus.isPending}
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
        description="La fiche et toutes ses photos sont effacées définitivement."
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
