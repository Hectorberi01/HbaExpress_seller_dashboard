"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { CommuneSelect } from "@/components/commune-select";
import { LocationField, type GeoPoint } from "@/components/location-field";
import { formatXof } from "@/lib/utils";
import { computeBreakdown } from "@/lib/pricing";
import { statusLabel } from "@/lib/status-labels";
import { toastError, toastSuccess } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import { CategoryPicker } from "@/components/product/category-picker";
import { PriceBreakdown, usePricingRates } from "@/components/product/price-breakdown";
import { categoryReadablePath } from "@/lib/categories";
import { Dialog } from "@/components/ui/dialog";
import {
  MAX_TOTAL_BYTES,
  ProductImagesField,
  collectImageUrls,
  imagePayload,
  isImageTooLarge,
  releaseImageUrls,
  totalImageBytes,
  type DraftImage,
  type ImageUrlRegistry,
} from "@/components/product/product-images-field";
import type {
  FulfillmentLocation,
  SellerBrand,
  SellerCategory,
  SellerShop,
} from "@/types/seller";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  Plus,
  X,
} from "lucide-react";

const STEPS = ["Produit", "Déclinaison", "Vente & stock", "Récapitulatif"] as const;

const HANDLING_TIMES = [1, 2, 3, 5];

/**
 * Format exigé par `Sku.Create` côté serveur : lettres, chiffres, tirets, underscores,
 * 64 caractères au plus. Le contrôler ICI n'est pas de la coquetterie : sans lui, un
 * SKU contenant une espace (« REF 001 ») passait l'assistant, et l'échec ne survenait
 * qu'à l'étape 2 du serveur — APRÈS la création du produit et le téléversement des
 * photos sur R2, aussitôt défaits par le nettoyage. Toute la saisie était à refaire
 * pour une règle connue d'avance.
 */
const SKU_PATTERN = /^[A-Z0-9_-]+$/;

type AttributeRow = { uid: number; key: string; value: string };
let attributeSeq = 0;

/**
 * Assistant de création d'un produit VENDABLE — même parcours que l'app mobile vendeur.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * LA RÈGLE MÉTIER : PAS DE PRODUIT SANS DÉCLINAISON, MISE EN VENTE ET STOCK.
 *
 * Le serveur, lui, sait très bien créer un produit seul. Mais un produit sans SKU,
 * sans prix et sans stock n'est pas vendable, et l'expérience montre qu'on ne revient
 * presque jamais le compléter : il reste en brouillon, invisible, et le vendeur croit
 * avoir mis un article en ligne. L'app mobile a tranché en enchaînant quatre appels à
 * la dernière étape ; cet écran fait la même chose, dans le même ordre :
 *
 *   1. POST /seller/products               (multipart, images comprises) → productId
 *   2. POST /seller/products/{id}/variants → SKU
 *   3. POST /seller/offers                 → prix, état, lieu d'expédition
 *   4. POST /seller/inventory/items        → quantité, au MÊME lieu
 *
 * Si une étape échoue après la première, on défait ce qui a été créé : mieux vaut
 * redemander la saisie que laisser un produit à moitié né dans le catalogue.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
/**
 * Libellé court d'un lieu d'expédition : commune + point de repère. Même règle que
 * dans l'écran Stock — deux libellés différents pour la même donnée sèmeraient le doute.
 */
function locationLabel(l: { communeName: string; landmark?: string | null; line?: string | null }): string {
  const detail = l.landmark || l.line;
  return detail ? `${l.communeName} — ${detail}` : l.communeName;
}

export default function NewProductPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  // Garde de double soumission : `disabled={saving}` ne prend effet qu'au rendu
  // suivant, et un double clic rapide lancerait deux chaînes de création.
  const submitting = useRef(false);

  // ── Étape 1 : produit ──
  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<DraftImage[]>([]);
  const [imagesTouched, setImagesTouched] = useState(false);
  const [brandId, setBrandId] = useState("");
  const [gtin, setGtin] = useState("");
  const [ean, setEan] = useState("");
  const [tags, setTags] = useState("");
  const [moreInfo, setMoreInfo] = useState(false);

  // ── Étape 2 : déclinaison ──
  const [sku, setSku] = useState("");
  const [skuTouched, setSkuTouched] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [weight, setWeight] = useState("0");
  const [attributes, setAttributes] = useState<AttributeRow[]>([]);
  const [variantOptions, setVariantOptions] = useState(false);

  // ── Étape 3 : mise en vente et stock ──
  const [condition, setCondition] = useState("New");
  const [sellerPrice, setSellerPrice] = useState("");
  const [locationId, setLocationId] = useState("");
  const [onHand, setOnHand] = useState("1");
  const [threshold, setThreshold] = useState("0");
  const [handlingTime, setHandlingTime] = useState("2");
  const [creatingLocation, setCreatingLocation] = useState(false);

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
  const shop = useQuery({
    queryKey: ["seller-shop"],
    queryFn: () => bff<SellerShop>("/seller/shop"),
  });
  // Barème en vigueur, pour montrer le prix acheteur pendant la saisie.
  const pricing = usePricingRates();

  // Le détourage est-il réellement branché côté serveur ? Sans identifiants, le
  // serveur renvoie l'image d'origine avec un succès — le bouton n'aurait aucun effet.
  const mediaCapabilities = useQuery({
    queryKey: ["seller-media-capabilities"],
    queryFn: () => bff<{ backgroundRemoval: boolean }>("/seller/products/media/capabilities"),
    staleTime: 30 * 60 * 1000,
  });

  const priceNumber = Number(sellerPrice.replace(/\s/g, "")) || 0;

  // ───────────────────────────────────────────────────────────────────────────────
  // SKU SUGGÉRÉ : CALCULÉ UNE FOIS, PUIS PLUS JAMAIS.
  //
  // Deux pièges successifs, tous deux vécus :
  //   • le calculer à chaque rendu faisait CHANGER le SKU sous les doigts du vendeur
  //     à l'arrivée de `/seller/shop` (« XY7K2P9Q » devenait « A1B2C3-XY7K2P9Q »), et
  //     de nouveau à chaque refetch au retour de focus ;
  //   • ne stabiliser que la partie aléatoire ne suffisait pas : le préfixe, lui,
  //     dépend encore de la requête.
  //
  // On attend donc que la requête ait RÉPONDU — succès ou échec — puis on fige. Tant
  // qu'elle est en vol, le champ affiche « Génération… » plutôt qu'une valeur qui va
  // se contredire.
  // ───────────────────────────────────────────────────────────────────────────────
  const [suggestedSku, setSuggestedSku] = useState("");
  useEffect(() => {
    if (shop.isPending || suggestedSku) return;
    setSuggestedSku(buildSuggestedSku(shop.data?.id));
  }, [shop.isPending, shop.data?.id, suggestedSku]);

  const effectiveSku = skuTouched ? sku : suggestedSku;

  const locationList = locations.data ?? [];

  // ───────────────────────────────────────────────────────────────────────────────
  // LIBÉRATION DES APERÇUS À LA SORTIE DE LA PAGE.
  //
  // Chaque photo importée épingle un `URL.createObjectURL` — donc ses octets, jusqu'à
  // 5 Mo pièce. Le champ photos ne peut pas s'en charger : il est démonté au
  // changement d'étape, alors que les images vivent ici. C'est donc le PROPRIÉTAIRE de
  // l'état qui nettoie, une seule fois, en quittant l'assistant.
  //
  // La ref suit la valeur courante : l'effet de démontage ne s'exécute qu'une fois et
  // capturerait sinon le tableau vide du premier rendu.
  // ───────────────────────────────────────────────────────────────────────────────
  const urlRegistry = useRef<ImageUrlRegistry>(new Set());
  // Après chaque rendu appliqué : on libère les aperçus que l'état ne référence plus.
  // C'est le seul moment où l'on SAIT ce qui est encore affiché — le décider au moment
  // de l'appel revenait à parier sur la façon dont React planifie ses mises à jour.
  useEffect(() => {
    collectImageUrls(urlRegistry.current, images);
  }, [images]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => releaseImageUrls(urlRegistry.current), []);

  // Fermer l'onglet pendant l'enregistrement laisserait un brouillon orphelin, sans
  // aucun nettoyage possible : la chaîne des quatre appels est interrompue net.
  useEffect(() => {
    if (!saving) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving]);

  // ── Validation, étape par étape (mêmes règles que l'app mobile) ──
  function validate(target: number): string | null {
    if (target === 0) {
      if (!categoryId) return "Choisissez une catégorie.";
      if (name.trim().length < 3) return "Le nom doit faire au moins 3 caractères.";
      if (description.trim().length < 10)
        return "Décrivez le produit en 10 caractères au minimum.";
      if (images.length === 0) return "Ajoutez au moins une photo.";
      if (images.some(isImageTooLarge)) return "Une photo dépasse 5 Mo.";
      if (totalImageBytes(images) > MAX_TOTAL_BYTES)
        return `Vos photos pèsent trop lourd au total (${MAX_TOTAL_BYTES / 1024 / 1024} Mo au maximum). Retirez-en ou allégez-les.`;
      if (images.some((i) => i.processing)) return "Un détourage est encore en cours.";
      return null;
    }
    if (target === 1) {
      const value = effectiveSku.trim().toUpperCase();
      if (value.length === 0) return "Le SKU est obligatoire.";
      if (value.length > 64) return "Le SKU doit faire 64 caractères au plus.";
      if (!SKU_PATTERN.test(value))
        return "Le SKU n'accepte que lettres, chiffres, tirets et underscores — ni espace, ni accent.";
      if (!/^\d+$/.test(weight.trim()))
        return "Le poids doit être un nombre entier de grammes.";
      return null;
    }
    if (target === 2) {
      // Le serveur refuse la création d'offre (403) si la boutique n'est ni active ni
      // en attente. On le sait déjà — autant le dire avant les photos, pas après.
      const status = shop.data?.status?.toLowerCase();
      if (status && status !== "active" && status !== "pending")
        return "Votre boutique n'est pas en mesure de mettre un article en vente. Vérifiez son statut sur « Ma boutique ».";
      if (!/^\d+$/.test(sellerPrice.replace(/\s/g, "")) || Number(sellerPrice.replace(/\s/g, "")) <= 0)
        return "Indiquez le montant que vous percevez, en nombre entier.";
      if (!locationId) return "Choisissez un lieu d'expédition.";
      if (!/^\d+$/.test(onHand.trim()) || Number(onHand) < 1)
        return "Le stock initial doit être d'au moins 1.";
      if (!/^\d+$/.test(threshold.trim())) return "Le seuil d'alerte doit être un entier.";
      return null;
    }
    return null;
  }

  function next() {
    const err = validate(step);
    if (err) {
      if (step === 0) setImagesTouched(true);
      // Le champ fautif peut vivre dans une section repliée : un toast rouge sans
      // aucun champ en erreur à l'écran, c'est une impasse. On déplie.
      if (step === 1 && !/^\d+$/.test(weight.trim())) setVariantOptions(true);
      toastError(err);
      return;
    }
    setStep((s) => s + 1);
  }

  // ── Création : les quatre appels, dans l'ordre, avec nettoyage ──
  async function submit() {
    if (submitting.current) return;

    for (let s = 0; s <= 2; s++) {
      const err = validate(s);
      if (err) {
        setStep(s);
        toastError(err);
        return;
      }
    }

    submitting.current = true;
    setSaving(true);
    let succeeded = false;
    // Retenus pour le nettoyage : ce sont eux qu'il faudra défaire si la suite casse.
    let createdProductId: string | null = null;
    let createdOfferId: string | null = null;
    let stage = "du produit";
    // `Sku.Create` passe en majuscules côté serveur. On envoie la même valeur aux
    // trois appels qui la portent (déclinaison, offre, stock) : sans cela, le stock
    // serait créé sur une variante orthographiée autrement que la référence stockée.
    const normalizedSku = effectiveSku.trim().toUpperCase();

    try {
      // 1. Produit (brouillon) + images, en multipart.
      const form = new FormData();
      form.append("categoryId", categoryId);
      form.append("name", name.trim());
      // `description` n'est PAS optionnel côté serveur (paramètre non nullable) :
      // omettre le champ ferait échouer le binding multipart avant toute validation.
      form.append("description", description.trim());
      if (brandId) form.append("brandId", brandId);
      if (gtin.trim()) form.append("gtin", gtin.trim());
      if (ean.trim()) form.append("ean", ean.trim());

      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      // Une seule chaîne « a,b,c » : le binding multipart d'un tableau de chaînes
      // n'est pas fiable, et le serveur découpe lui-même sur la virgule.
      if (tagList.length > 0) form.append("tags", tagList.join(","));

      // L'ORDRE des fichiers compte : le serveur fait de la première l'image principale.
      for (const image of images) form.append("images", imagePayload(image));

      const created = await bff<{ productId: string }>("/seller/products", {
        method: "POST",
        body: form,
      });
      createdProductId = created.productId;

      // 2. Déclinaison.
      stage = "de la déclinaison";
      const attributeMap = Object.fromEntries(
        attributes
          .filter((a) => a.key.trim() && a.value.trim())
          .map((a) => [a.key.trim(), a.value.trim()]),
      );
      await bff(`/seller/products/${createdProductId}/variants`, {
        method: "POST",
        body: JSON.stringify({
          sku: normalizedSku,
          attributes: attributeMap,
          barcode: barcode.trim() || null,
          weightGrams: Number(weight.trim()),
          lengthMm: null,
          widthMm: null,
          heightMm: null,
        }),
      });

      // 3. Mise en vente.
      stage = "de la mise en vente";
      const offer = await bff<{ offerId: string }>("/seller/offers", {
        method: "POST",
        body: JSON.stringify({
          productId: createdProductId,
          sku: normalizedSku,
          sellerPrice: Number(sellerPrice.replace(/\s/g, "")),
          currency: "XOF",
          condition,
          fulfillmentType: "Fbs",
          shipFromLocationId: locationId,
          handlingTime: Number(handlingTime),
        }),
      });
      createdOfferId = offer.offerId;

      // 4. Stock, au MÊME lieu que la mise en vente.
      stage = "du stock";
      await bff("/seller/inventory/items", {
        method: "POST",
        body: JSON.stringify({
          sku: normalizedSku,
          locationId,
          onHand: Number(onHand.trim()),
          reorderThreshold: Number(threshold.trim()),
        }),
      });

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["seller-products"] }),
        qc.invalidateQueries({ queryKey: ["seller-offers"] }),
        qc.invalidateQueries({ queryKey: ["seller-inventory"] }),
      ]);

      toastSuccess("Produit créé. Sa mise en vitrine sera validée par l'administration.");
      // ⚠️ ON NE RELÂCHE PAS LA GARDE ICI.
      //
      // `router.replace` est asynchrone : entre le déclenchement de la navigation et
      // le démontage réel, l'étape 4 reste à l'écran. Relâcher `submitting` dans le
      // `finally` rallumait le bouton « Créer le produit » pendant cet intervalle —
      // un second clic recréait produit et déclinaison, puis échouait en 409 sur le
      // SKU déjà pris, et affichait un ÉCHEC alors qu'un produit venait d'être créé.
      succeeded = true;
      router.replace(`/products/${createdProductId}`);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inattendue.";
      const cleaned = await rollback(createdProductId, createdOfferId);
      toastError(
        `Échec à l'étape ${stage} : ${message} ${
          cleaned ? "Rien n'a été conservé." : "Un brouillon incomplet subsiste dans vos produits."
        }`,
      );
    } finally {
      if (!succeeded) {
        submitting.current = false;
        setSaving(false);
      }
    }
  }

  /**
   * Défait ce qui a été créé. Renvoie vrai si le catalogue est propre.
   *
   * ⚠️ L'OFFRE D'ABORD, LE PRODUIT ENSUITE.
   *
   * `DELETE /seller/products/{id}` refuse (409) tant qu'une mise en vente y est
   * rattachée — le garde-fou qui empêche de laisser des offres sans fiche produit.
   * Supprimer le produit en premier échouerait donc précisément dans le seul cas où
   * le nettoyage compte : quand l'étape « stock » a cassé après la création de l'offre.
   */
  async function rollback(productId: string | null, offerId: string | null): Promise<boolean> {
    if (!productId) return true;
    try {
      let toDelete = offerId;

      // ⚠️ L'OFFRE A PU ÊTRE CRÉÉE SANS QU'ON EN CONNAISSE L'IDENTIFIANT : si la
      // réponse du serveur s'est perdue (coupure, délai dépassé), l'appel a pourtant
      // abouti. On relit alors la liste des offres pour retrouver celle qui porte ce
      // PRODUIT — il vient d'être créé, il n'en a donc qu'une. Sans cela, la
      // suppression du produit se heurterait au 409, précisément dans le seul cas où
      // le nettoyage compte.
      if (!toDelete) {
        const all = await bff<{ id: string; productId: string }[]>("/seller/offers");
        toDelete = all.find((o) => o.productId === productId)?.id ?? null;
      }

      if (toDelete) {
        await bff(`/seller/offers/${toDelete}`, { method: "DELETE" });
      }
      await bff(`/seller/products/${productId}`, { method: "DELETE" });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["seller-products"] }),
        qc.invalidateQueries({ queryKey: ["seller-offers"] }),
      ]);
      return true;
    } catch {
      // Nettoyage au mieux : en cas d'échec, le brouillon reste retirable à la main
      // depuis la fiche produit. On le dit, plutôt que de prétendre le contraire.
      await qc.invalidateQueries({ queryKey: ["seller-products"] });
      return false;
    }
  }

  return (
    <div className="p-6 lg:p-8">
      <Link
        href="/products"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Tous les produits
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Nouveau produit</h1>
        <p className="text-sm text-muted-foreground">
          Étape {step + 1} sur {STEPS.length} — {STEPS[step]}
        </p>
      </header>

      <PageNote>
        Un produit n&apos;est vendable qu&apos;avec une <strong>déclinaison</strong>, un{" "}
        <strong>prix</strong> et du <strong>stock</strong>. Cet assistant les crée ensemble,
        à la dernière étape : rien n&apos;est enregistré avant votre confirmation.
      </PageNote>

      <QueryError of={[categories, brands, locations, shop]} />

      <StepBar step={step} />

      <div className="mx-auto max-w-3xl">
        <Card>
          <CardContent className="space-y-5 p-6">
            {/* ══════════════ Étape 1 — Produit ══════════════ */}
            {step === 0 && (
              <>
                <div className="space-y-1.5">
                  <Label>Catégorie</Label>
                  {categories.isError ? (
                    <p className="text-sm text-destructive">
                      Catégories indisponibles — rechargez la page avant de continuer.
                    </p>
                  ) : (
                    <CategoryPicker
                      categories={categories.data ?? []}
                      value={categoryId}
                      onChange={setCategoryId}
                      loading={categories.isLoading}
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    Elle détermine le classement en boutique et n&apos;est plus modifiable
                    ensuite.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="w-name">Nom du produit</Label>
                  <Input
                    id="w-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex. Sac à main en cuir tressé"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="w-desc">Description</Label>
                  <Textarea
                    id="w-desc"
                    rows={5}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Matière, dimensions, contenu du colis, garantie…"
                  />
                  <p className="text-xs text-muted-foreground">
                    C&apos;est ce que lit l&apos;acheteur avant de commander : les questions
                    qu&apos;il vous posera sont celles auxquelles vous ne répondez pas ici.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Photos</Label>
                  <ProductImagesField
                    images={images}
                    onChange={setImages}
                    registry={urlRegistry.current}
                    backgroundRemovalAvailable={
                      mediaCapabilities.data?.backgroundRemoval ?? false
                    }
                    showRequiredError={imagesTouched && images.length === 0}
                  />
                </div>

                <Expandable
                  title="Plus d'informations (facultatif)"
                  open={moreInfo}
                  onToggle={() => setMoreInfo((v) => !v)}
                >
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="w-brand">Marque</Label>
                      <Select
                        id="w-brand"
                        value={brandId}
                        onChange={(e) => setBrandId(e.target.value)}
                      >
                        <option value="">Sans marque</option>
                        {(brands.data ?? []).map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="w-gtin">GTIN</Label>
                        <Input
                          id="w-gtin"
                          inputMode="numeric"
                          value={gtin}
                          onChange={(e) => setGtin(e.target.value.replace(/\D/g, ""))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="w-ean">EAN</Label>
                        <Input
                          id="w-ean"
                          inputMode="numeric"
                          value={ean}
                          onChange={(e) => setEan(e.target.value.replace(/\D/g, ""))}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="w-tags">Mots-clés</Label>
                      <Input
                        id="w-tags"
                        value={tags}
                        onChange={(e) => setTags(e.target.value)}
                        placeholder="cuir, sac, artisanal"
                      />
                      <p className="text-xs text-muted-foreground">
                        Séparés par des virgules. Ils aident la recherche à trouver votre
                        article.
                      </p>
                    </div>
                  </div>
                </Expandable>
              </>
            )}

            {/* ══════════════ Étape 2 — Déclinaison ══════════════ */}
            {step === 1 && (
              <>
                <p className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  Une déclinaison, c&apos;est une version précise de l&apos;article (une
                  taille, une couleur). Son <strong>SKU</strong> est la référence que vous
                  retrouverez en stock, sur vos offres et sur vos commandes. Un article
                  simple n&apos;en a qu&apos;une — vous pourrez en ajouter d&apos;autres plus
                  tard depuis la fiche.
                </p>

                <div className="space-y-1.5">
                  <Label htmlFor="w-sku">SKU</Label>
                  <Input
                    id="w-sku"
                    value={effectiveSku}
                    placeholder={shop.isPending ? "Génération…" : "Ex. REF-001"}
                    onChange={(e) => {
                      setSkuTouched(true);
                      setSku(e.target.value);
                    }}
                  />
                  {/* Le texte d'aide suit la RÉALITÉ : promettre un pré-remplissage
                      devant un champ vide (suggestion impossible à générer) laisserait
                      le vendeur attendre quelque chose qui ne viendra pas. */}
                  <p className="text-xs text-muted-foreground">
                    {shop.isPending
                      ? "Une référence vous est proposée dans un instant — vous pourrez la remplacer."
                      : suggestedSku
                        ? "Pré-rempli au format de la plateforme. Remplacez-le par votre propre référence si vous en tenez une."
                        : "Saisissez votre référence : lettres, chiffres, tirets et underscores uniquement."}
                  </p>
                </div>

                <Expandable
                  title="Attributs et logistique (facultatif)"
                  open={variantOptions}
                  onToggle={() => setVariantOptions((v) => !v)}
                >
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Les attributs décrivent cette déclinaison précise : « Couleur :
                        Bleu », « Taille : M ».
                      </p>
                      {attributes.map((a) => (
                        <div key={a.uid} className="flex gap-2">
                          <Input
                            value={a.key}
                            aria-label="Nom de l'attribut"
                            placeholder="Couleur"
                            onChange={(e) =>
                              setAttributes((rows) =>
                                rows.map((r) =>
                                  r.uid === a.uid ? { ...r, key: e.target.value } : r,
                                ),
                              )
                            }
                          />
                          <Input
                            value={a.value}
                            aria-label="Valeur de l'attribut"
                            placeholder="Bleu"
                            onChange={(e) =>
                              setAttributes((rows) =>
                                rows.map((r) =>
                                  r.uid === a.uid ? { ...r, value: e.target.value } : r,
                                ),
                              )
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Retirer cet attribut"
                            onClick={() =>
                              setAttributes((rows) => rows.filter((r) => r.uid !== a.uid))
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
                          setAttributes((rows) => [
                            ...rows,
                            { uid: ++attributeSeq, key: "", value: "" },
                          ])
                        }
                      >
                        <Plus className="size-4" /> Ajouter un attribut
                      </Button>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="w-barcode">Code-barres</Label>
                        <Input
                          id="w-barcode"
                          value={barcode}
                          onChange={(e) => setBarcode(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="w-weight">Poids (g)</Label>
                        <Input
                          id="w-weight"
                          inputMode="numeric"
                          value={weight}
                          onChange={(e) => setWeight(e.target.value)}
                        />
                        {!/^\d+$/.test(weight.trim()) && (
                          <p className="text-xs text-destructive">
                            Un nombre entier de grammes est attendu.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </Expandable>
              </>
            )}

            {/* ══════════════ Étape 3 — Vente et stock ══════════════ */}
            {step === 2 && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="w-condition">État de l&apos;article</Label>
                  <Select
                    id="w-condition"
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                  >
                    <option value="New">Neuf</option>
                    <option value="Used">Occasion</option>
                    <option value="Refurbished">Reconditionné</option>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="w-price">Ce que vous percevez (XOF)</Label>
                  <Input
                    id="w-price"
                    inputMode="numeric"
                    value={sellerPrice}
                    onChange={(e) => setSellerPrice(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    C&apos;est le montant qui vous sera versé. La commission de la
                    plateforme et les frais de paiement s&apos;ajoutent par-dessus.
                  </p>
                  {/* Détail calculé avec le barème SERVEUR (`GET /seller/pricing`),
                      jamais avec des taux écrits ici. */}
                  <PriceBreakdown
                    sellerPrice={priceNumber}
                    rates={pricing.data}
                    unavailable={pricing.isError}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="w-location">Lieu d&apos;expédition</Label>
                  {locations.isError ? (
                    <p className="text-sm text-destructive">
                      Lieux indisponibles — rechargez la page avant de continuer.
                    </p>
                  ) : locationList.length === 0 && !locations.isLoading ? (
                    <div className="rounded-xl bg-amber-100 p-3 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
                      Aucun entrepôt enregistré. C&apos;est le point de départ utilisé pour
                      estimer les délais de livraison.
                      <div className="mt-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setCreatingLocation(true)}
                        >
                          <Plus className="size-4" /> Créer un entrepôt
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Select
                        id="w-location"
                        value={locationId}
                        onChange={(e) => setLocationId(e.target.value)}
                        disabled={locations.isLoading}
                      >
                        <option value="">
                          {locations.isLoading ? "Chargement…" : "Choisir un entrepôt"}
                        </option>
                        {locationList.map((l) => (
                          <option key={l.id} value={l.id}>
                            {locationLabel(l)}
                          </option>
                        ))}
                      </Select>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() => setCreatingLocation(true)}
                      >
                        <Plus className="size-3.5" /> Ajouter un entrepôt
                      </Button>
                    </>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="w-onhand">Stock initial</Label>
                    <Input
                      id="w-onhand"
                      inputMode="numeric"
                      value={onHand}
                      onChange={(e) => setOnHand(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="w-threshold">Seuil d&apos;alerte</Label>
                    <Input
                      id="w-threshold"
                      inputMode="numeric"
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      En dessous, la référence est signalée en stock faible.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="w-handling">Délai de préparation</Label>
                  <Select
                    id="w-handling"
                    value={handlingTime}
                    onChange={(e) => setHandlingTime(e.target.value)}
                  >
                    {HANDLING_TIMES.map((d) => (
                      <option key={d} value={String(d)}>
                        {d} jour{d > 1 ? "s" : ""}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Entre la commande et la remise du colis au transporteur. C&apos;est ce
                    délai qui sert à annoncer une date de livraison.
                  </p>
                </div>
              </>
            )}

            {/* ══════════════ Étape 4 — Récapitulatif ══════════════ */}
            {step === 3 && (
              <>
                <p className="text-sm text-muted-foreground">
                  Vérifiez avant de créer. Tout reste modifiable ensuite depuis la fiche du
                  produit.
                </p>

                <SummaryCard
                  title="Produit"
                  rows={[
                    ["Nom", name.trim()],
                    [
                      "Catégorie",
                      (() => {
                        const all = categories.data ?? [];
                        const c = all.find((x) => x.id === categoryId);
                        return c ? categoryReadablePath(c, all) : "—";
                      })(),
                    ],
                    [
                      "Marque",
                      (brands.data ?? []).find((b) => b.id === brandId)?.name ?? "Sans marque",
                    ],
                    ["Photos", `${images.length}`],
                  ]}
                >
                  {images.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pt-1">
                      {images.map((image) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={image.uid}
                          src={image.processedUrl ?? image.originalUrl}
                          alt=""
                          className="size-14 shrink-0 rounded-lg object-cover"
                        />
                      ))}
                    </div>
                  )}
                </SummaryCard>

                <SummaryCard
                  title="Déclinaison"
                  rows={[
                    ["SKU", effectiveSku.trim()],
                    [
                      "Attributs",
                      attributes
                        .filter((a) => a.key.trim() && a.value.trim())
                        .map((a) => `${a.key.trim()} : ${a.value.trim()}`)
                        .join(" · ") || "—",
                    ],
                    ["Poids", `${weight.trim() || 0} g`],
                  ]}
                />

                <SummaryCard
                  title="Mise en vente et stock"
                  rows={[
                    ["État", statusLabel(condition, "offerCondition")],
                    ["Vous percevez", formatXof(priceNumber)],
                    ...(pricing.data
                      ? ([
                          [
                            "Prix affiché à l'acheteur",
                            formatXof(computeBreakdown(priceNumber, pricing.data).productPrice),
                          ],
                        ] as [string, string][])
                      : []),
                    [
                      "Lieu d'expédition",
                      (() => {
                        const l = locationList.find((x) => x.id === locationId);
                        return l ? locationLabel(l) : "—";
                      })(),
                    ],
                    ["Stock initial", onHand.trim()],
                    ["Délai de préparation", `${handlingTime} jour(s)`],
                  ]}
                />

                <p className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  Le produit sera créé en <strong>brouillon</strong> : sa mise en vitrine est
                  validée par l&apos;administration. Vous pourrez d&apos;ici là compléter la
                  fiche et ajuster le prix.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Navigation ── */}
        <div className="mt-5 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => (step === 0 ? router.push("/products") : setStep((s) => s - 1))}
            disabled={saving}
          >
            {step === 0 ? "Annuler" : "Précédent"}
          </Button>

          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={next}>
              Continuer <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button type="button" onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Créer le produit
            </Button>
          )}
        </div>
      </div>

      <NewLocationDialog
        open={creatingLocation}
        onClose={() => setCreatingLocation(false)}
        onCreated={async (id) => {
          setCreatingLocation(false);
          await qc.invalidateQueries({ queryKey: ["seller-locations"] });
          // On SÉLECTIONNE l'entrepôt qu'on vient de créer, comme le fait l'app
          // mobile. Le laisser à choisir dans la liste, juste après l'avoir saisi,
          // c'est demander deux fois la même chose.
          if (id) setLocationId(id);
        }}
      />
    </div>
  );
}

/**
 * SKU suggéré : 6 caractères de l'identifiant boutique + code aléatoire, au format de
 * `Sku.Generate` côté serveur.
 *
 * `crypto.getRandomValues` et non `Math.random` : deux onglets ouverts à la même
 * milliseconde ne doivent pas proposer la même référence. Si l'API manque — cas de
 * figure très improbable en navigateur —, on renvoie une chaîne VIDE plutôt qu'un
 * repli qui produirait toujours la même valeur. L'écran s'adapte alors et demande au
 * vendeur de saisir sa propre référence, au lieu de lui promettre un pré-remplissage
 * qui n'a pas eu lieu.
 *
 * Ce n'est qu'une SUGGESTION : l'unicité est vérifiée par le serveur, qui refuse un
 * doublon sur la boutique. On ne prétend pas garantir ici ce que le navigateur ne peut
 * pas savoir.
 */
function buildSuggestedSku(sellerId: string | undefined): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  if (typeof crypto === "undefined" || !crypto.getRandomValues) return "";

  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];

  const compact = (sellerId ?? "").replace(/-/g, "");
  if (compact.length < 6) return code;
  return `${compact.slice(0, 6).toUpperCase()}-${code}`;
}

function StepBar({ step }: { step: number }) {
  return (
    <ol className="mx-auto mb-5 flex max-w-3xl items-center gap-2">
      {STEPS.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <div
            className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              i < step
                ? "bg-primary text-primary-foreground"
                : i === step
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
            }`}
            aria-current={i === step ? "step" : undefined}
          >
            {i < step ? <Check className="size-3.5" /> : i + 1}
          </div>
          <span
            className={`hidden text-xs sm:block ${
              i === step ? "font-medium text-foreground" : "text-muted-foreground"
            }`}
          >
            {label}
          </span>
          {i < STEPS.length - 1 && <div className="h-px flex-1 bg-border" />}
        </li>
      ))}
    </ol>
  );
}

function Expandable({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-medium"
      >
        {title}
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="border-t border-border p-4">{children}</div>}
    </div>
  );
}

function SummaryCard({
  title,
  rows,
  children,
}: {
  title: string;
  rows: [string, string][];
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-muted/40 p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <dl className="space-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="truncate text-right font-medium">{v || "—"}</dd>
          </div>
        ))}
      </dl>
      {children}
    </div>
  );
}

/** Création d'un entrepôt sans quitter l'assistant. */
function NewLocationDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Reçoit l'identifiant du lieu créé, pour le sélectionner aussitôt. */
  onCreated: (id: string | null) => Promise<void>;
}) {
  const [communeCode, setCommuneCode] = useState("");
  const [quartier, setQuartier] = useState("");
  const [landmark, setLandmark] = useState("");
  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [line, setLine] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    setSaving(true);
    let newId: string | null = null;
    try {
      // Le serveur renvoie `{ locationId }` — PAS `{ id }`. Lire `id` donnait une
      // chaîne vide, qui traversait la validation et partait dans l'offre suivante.
      // (Le même piège existait dans l'app mobile ; il y est corrigé depuis.)
      const created = await bff<{ locationId: string }>("/seller/locations", {
        method: "POST",
        body: JSON.stringify({
          // « commune » côté serveur : il accepte le code comme le libellé, on envoie le code.
          commune: communeCode,
          quartier: quartier.trim() || null,
          landmark: landmark.trim(),
          line: line.trim() || null,
          latitude: point?.latitude ?? null,
          longitude: point?.longitude ?? null,
        }),
      });
      setCommuneCode("");
      setQuartier("");
      setLandmark("");
      setPoint(null);
      setLine("");
      toastSuccess("Entrepôt créé.");
      newId = created?.locationId ?? null;
    } catch (err) {
      toastError(err instanceof Error ? err.message : "L'entrepôt n'a pas pu être créé.");
      setSaving(false);
      return;
    }

    // HORS du `try` de création : si le rafraîchissement de la liste échoue (réseau),
    // ce n'est pas la création qui a raté. Annoncer « L'entrepôt n'a pas pu être
    // créé » alors qu'il existe enverrait le vendeur en créer un second.
    try {
      await onCreated(newId);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nouvel entrepôt"
      description="C'est le point de départ de vos colis : il sert à estimer les délais de livraison annoncés à l'acheteur."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button
            onClick={create}
            // La rue n'entre PAS dans la condition : beaucoup de lieux n'en ont pas.
            // Ce sont la commune et le repère qui rendent l'entrepôt trouvable.
            disabled={saving || !communeCode || !landmark.trim()}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Créer
          </Button>
        </>
      }
    >
      {/* Mêmes champs, même ordre que l'écran Stock : un vendeur ne doit pas
          rencontrer deux formulaires différents pour la même chose. */}
      <CommuneSelect value={communeCode} onChange={setCommuneCode} required />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="loc-quartier">Quartier</Label>
          <Input id="loc-quartier" value={quartier} onChange={(e) => setQuartier(e.target.value)} placeholder="Fidjrossè" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loc-line">Rue, carré (facultatif)</Label>
          <Input id="loc-line" value={line} onChange={(e) => setLine(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="loc-landmark">
          Point de repère<span className="ml-0.5 text-destructive">*</span>
        </Label>
        <Input
          id="loc-landmark"
          value={landmark}
          onChange={(e) => setLandmark(e.target.value)}
          placeholder="En face de la pharmacie Sainte-Rita"
        />
      </div>
      <LocationField value={point} onChange={setPoint} />
    </Dialog>
  );
}
