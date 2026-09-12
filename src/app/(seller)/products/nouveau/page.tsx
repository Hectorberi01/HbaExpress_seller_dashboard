"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { useAutoChoisirUnique } from "@/lib/auto-choice";
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
import {
  CategoryAttributesForm,
  attributsANEnvoyer,
  attributsValides,
  obligatoiresManquants,
  problemeAttribut,
  type ValeursAttributs,
} from "@/components/product/category-attributes-form";
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
  SellerCategory,
  SellerShop,
} from "@/types/seller";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { peutVendre, raisonDeRefus } from "@/lib/selling";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * L'ÉTAPE « DÉCLINAISON » NE DEMANDAIT RIEN, ET ON LA TRAVERSAIT D'UN CLIC.
 *
 * Elle ne portait qu'un champ visible, le SKU — déjà pré-rempli au format de la
 * plateforme — au-dessus d'un bloc replié dont le seul champ obligatoire, le poids,
 * vaut déjà « 0 ». Sur chaque produit créé, le vendeur lisait une page et cliquait
 * « Continuer » sans avoir rien saisi.
 *
 * LE SKU REJOINT « VENTE & STOCK », et c'est sa place : c'est la référence qu'il
 * retrouvera sur ses offres, son stock et ses commandes — précisément ce que cette
 * étape met en place. Le bloc « Attributs de la déclinaison » reste replié à côté, pour
 * qui vend en plusieurs tailles ou couleurs.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
const STEPS = ["Produit", "Vente & stock", "Récapitulatif"] as const;

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
  /**
   * ═════════════════════════════════════════════════════════════════════════════════
   * CINQ CHAMPS ONT QUITTÉ CET ASSISTANT. CE QU'ILS SONT DEVENUS.
   *
   * L'audit a posé une seule question à chacun : QUI LIT CETTE VALEUR ENSUITE ?
   *
   *   PLUS DEMANDÉS NULLE PART DANS CETTE CONSOLE — aucune fonction ne les lit :
   *     - EAN : doublon de GTIN. Même type, même nettoyage, même colonne
   *       (`HasMaxLength(14)` pour les deux), et le seul contrôle serveur est une
   *       longueur maximale identique pour les deux. La fiche produit n'expose plus
   *       qu'un champ « Code-barres du produit », qui lit l'une ou l'autre colonne.
   *       (La donnée reste en base, l'admin continue de l'afficher, et l'app mobile
   *       vendeur demande toujours les deux champs séparément — c'est un écart entre
   *       les deux clients, à traiter le jour où le mobile sera repris.)
   *     - Code-barres de déclinaison : projeté jusqu'au contrat et jamais consommé —
   *       ni scan, ni recherche, ni affichage acheteur, ni affichage admin. La valeur
   *       déjà saisie est reconduite à chaque enregistrement, jamais effacée.
   *
   *   DÉPLACÉS SUR LA FICHE PRODUIT — lus par quelqu'un, mais corrigeables ensuite,
   *   donc sans raison de barrer la route de la première mise en vente :
   *     - Marque (lue par l'admin), GTIN, mots-clés, poids, délai de préparation.
   *
   * Le poids devient FACULTATIF au passage : il était obligatoire ici, et il n'entre
   * dans aucun calcul — `ShippingRate` est un forfait par commune de destination, qui
   * ne dépend « ni du poids, ni du volume, ni du nombre d'articles ».
   *
   * Les champs correspondants restent dans le domaine et en base : on retire ce qu'on
   * DEMANDE, pas ce qui est stocké. Les valeurs déjà saisies sont donc intactes, et la
   * fiche produit les rend toutes modifiables.
   * ═════════════════════════════════════════════════════════════════════════════════
   */

  /**
   * ═════════════════════════════════════════════════════════════════════════════════
   * CARACTÉRISTIQUES DE LA CATÉGORIE — L'ASSISTANT N'EN ENVOYAIT AUCUNE.
   *
   * Le `FormData` portait `categoryId`, `name`, `description`, `brandId`, `gtin`,
   * `ean`, `tags` et `images`, jamais `attributesJson` — que le serveur accepte
   * pourtant depuis toujours. Dès que l'administration pose un attribut obligatoire
   * sur une catégorie, `CategoryAttributeSchema.Validate` refusait donc TOUTE création
   * dans cette catégorie, et le refus arrivait après le téléversement des photos.
   * Impasse complète, sans un seul champ à l'écran pour satisfaire la règle.
   *
   * LES VALEURS SONT VIDÉES QUAND LA CATÉGORIE CHANGE. Les clés d'un schéma n'ont
   * aucun sens dans un autre : les garder enverrait des attributs « inattendus » dans
   * une catégorie fermée, c'est-à-dire un refus que le vendeur ne pourrait pas
   * expliquer — il n'aurait jamais vu ces champs.
   * ═════════════════════════════════════════════════════════════════════════════════
   */
  const [attributsCategorie, setAttributsCategorie] = useState<ValeursAttributs>({});

  // ── Déclinaison : saisie dans l'étape 2, avec la mise en vente ──
  const [sku, setSku] = useState("");
  const [skuTouched, setSkuTouched] = useState(false);
  const [attributes, setAttributes] = useState<AttributeRow[]>([]);
  const [variantOptions, setVariantOptions] = useState(false);

  // ── Mise en vente et stock : seconde moitié de l'étape 2 ──
  const [condition, setCondition] = useState("New");
  const [sellerPrice, setSellerPrice] = useState("");
  const [locationId, setLocationId] = useState("");
  const [onHand, setOnHand] = useState("1");
  const [threshold, setThreshold] = useState("0");
  const [creatingLocation, setCreatingLocation] = useState(false);

  const categories = useQuery({
    queryKey: ["seller-categories"],
    queryFn: () => bff<SellerCategory[]>("/seller/categories"),
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

  // Un seul entrepôt : on le pose, plutôt que de faire ouvrir une liste d'un.
  useAutoChoisirUnique(locationId, setLocationId, locationList.map((l) => l.id));

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

  // Schéma de la catégorie choisie. Le serveur l'envoie avec chaque catégorie ; il
  // suffit de le retrouver dans la liste déjà chargée.
  const categorieChoisie = (categories.data ?? []).find((c) => c.id === categoryId);
  const schemaCategorie = categorieChoisie?.attributeSchema ?? [];
  /** Vrai quand la catégorie refuse toute clé hors schéma. Voir la note près du champ. */
  const categorieFermee = categorieChoisie?.allowUnknownAttributes === false;

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

      // On arrête ICI, avant le téléversement des photos, ce que le serveur aurait
      // refusé après. C'est tout l'intérêt : le refus tardif était l'essentiel du mal.
      const manquants = obligatoiresManquants(schemaCategorie, attributsCategorie);
      if (manquants.length > 0) {
        return manquants.length === 1
          ? `« ${manquants[0]} » est obligatoire dans cette catégorie.`
          : `Ces caractéristiques sont obligatoires dans cette catégorie : ${manquants.join(", ")}.`;
      }
      if (!attributsValides(schemaCategorie, attributsCategorie)) {
        const premier = schemaCategorie
          .map((def) => problemeAttribut(def, attributsCategorie[def.key] ?? ""))
          .find((x) => x !== null);
        return premier ?? "Une caractéristique est invalide.";
      }
      return null;
    }
    if (target === 1) {
      // LES DEUX ANCIENNES ÉTAPES, DANS L'ORDRE DE L'ÉCRAN : la référence d'abord (le
      // SKU — le poids a quitté cette étape), la mise en vente ensuite. Le premier
      // message pointe donc toujours le champ le plus haut, comme avant la fusion.
      const value = effectiveSku.trim().toUpperCase();
      if (value.length === 0) return "Le SKU est obligatoire.";
      if (value.length > 64) return "Le SKU doit faire 64 caractères au plus.";
      if (!SKU_PATTERN.test(value))
        return "Le SKU n'accepte que lettres, chiffres, tirets et underscores — ni espace, ni accent.";

      // Le serveur refuse la création (403) si la boutique n'est ni active ni en
      // attente — la fiche ET l'offre, depuis que `CreateWithImagesAsync` est gardée.
      // Le bandeau le dit dès l'étape 0 ; ce contrôle-ci garde le cas où le statut
      // change pendant la saisie. La règle vient de `peutVendre`, pas d'une liste
      // recopiée qui divergerait au premier changement de politique.
      if (shop.data && !peutVendre(shop.data.status))
        return raisonDeRefus(shop.data.status, shop.data.suspensionReason);
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
      // Le dépliage forcé de la section « Attributs » n'a plus lieu d'être : le seul
      // champ obligatoire qu'elle contenait — le poids — a quitté cet assistant. Ce
      // qui y reste est facultatif, et ne peut donc plus faire échouer une étape.
      toastError(err);
      return;
    }
    setStep((s) => s + 1);
  }

  // ── Création : les quatre appels, dans l'ordre, avec nettoyage ──
  async function submit() {
    if (submitting.current) return;

    // Les étapes SAISISSABLES : 0 et 1. La 2 est le récapitulatif, elle ne valide rien.
    for (let s = 0; s <= 1; s++) {
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
      // Marque, GTIN et mots-clés ne sont plus demandés ici : ils sont facultatifs,
      // corrigeables depuis la fiche, et le multipart les traite comme absents quand
      // le champ n'est pas posé — `Product.Create` reçoit donc `null` et une liste de
      // tags vide, exactement ce qu'il recevait d'un formulaire laissé en blanc.

      // Le serveur attend un objet clé/valeur sérialisé (`attributesJson`), et refuse
      // un JSON mal formé en 400. On n'envoie le champ QUE s'il y a quelque chose
      // dedans : une chaîne « {} » n'apporterait rien et ferait passer le formulaire
      // pour rempli dans les journaux.
      const attributsProduit = attributsANEnvoyer(attributsCategorie);
      if (Object.keys(attributsProduit).length > 0) {
        form.append("attributesJson", JSON.stringify(attributsProduit));
      }

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
          // Code-barres et dimensions ne sont plus demandés — personne ne les lit.
          // Le poids part à 0, valeur que le domaine accepte (`>= 0`) et que la fiche
          // produit permet de corriger ; aucun calcul ne s'en sert aujourd'hui.
          barcode: null,
          weightGrams: 0,
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
          // Deux jours, la valeur que le champ proposait par défaut. Il se règle
          // désormais depuis la carte « Mises en vente » de la fiche produit.
          handlingTime: 2,
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
      // le démontage réel, le récapitulatif reste à l'écran. Relâcher `submitting` dans le
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

      <QueryError of={[categories, locations, shop]} />

      {/* ═══════════════════════════════════════════════════════════════════════════
          LE DROIT DE VENDRE, DIT À L'ÉTAPE 0 ET PLUS À L'ÉTAPE 1.

          Le contrôle existait, mais dans `validate(1)` : il ne tombait qu'au clic sur
          « Suivant », c'est-à-dire APRÈS le choix de la catégorie, la rédaction de la
          fiche, les caractéristiques et le téléversement des photos. C'est l'écran le
          plus exposé du lot — `CreateWithImagesAsync` ne refusait rien du tout avant
          ce même lot, et le refuse désormais.

          Le contrôle de `validate` reste en place : il garde le cas où le statut
          change pendant la saisie.
          ═══════════════════════════════════════════════════════════════════════════ */}
      {shop.data && !peutVendre(shop.data.status) && (
        <Card className="mb-4 p-4 text-sm">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <p className="font-medium">Création indisponible</p>
              <p className="text-muted-foreground">
                {raisonDeRefus(shop.data.status, shop.data.suspensionReason)}
              </p>
            </div>
          </div>
        </Card>
      )}

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
                      onChange={(id) => {
                        setCategoryId(id);
                        // Voir `attributsCategorie` : les clés d'un schéma n'ont aucun
                        // sens dans un autre.
                        setAttributsCategorie({});
                      }}
                      loading={categories.isLoading}
                      /* Le serveur refuse une catégorie qui a des sous-catégories. Les
                         filtrer ici évite de l'apprendre après avoir rempli quatre
                         étapes et téléversé les photos. */
                      feuillesSeulement
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    Elle détermine le classement en boutique, les caractéristiques qui vous
                    seront demandées, et n&apos;est plus modifiable ensuite.
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

                {/* Placé AVANT les photos, délibérément. Un attribut obligatoire non
                    renseigné bloque l'étape ; le découvrir après avoir choisi et
                    téléversé cinq images, c'est exactement le parcours qu'on répare.
                    Masqué quand la catégorie n'impose rien, pour ne pas ajouter une
                    section vide au cas le plus courant. */}
                {schemaCategorie.length > 0 && (
                  <div className="space-y-1.5">
                    <Label>Caractéristiques de la catégorie</Label>
                    <CategoryAttributesForm
                      schema={schemaCategorie}
                      valeurs={attributsCategorie}
                      onChange={setAttributsCategorie}
                      categorieChoisie={categoryId !== ""}
                    />
                  </div>
                )}

                {/* UN SCHÉMA VIDE AVEC `allowUnknown: false` EST UN CAS RÉEL, et il ne
                    se voyait nulle part. `CategoryAttributeSchema` accepte zéro attribut
                    tout en refusant les clés inconnues : `IsEmpty` est alors faux et
                    `Validate` rejette TOUTE caractéristique. Comme il n'y a rien à
                    dessiner, le bloc ci-dessus reste masqué — et l'assistant n'aurait
                    rien dit du tout. Ici il n'y a encore rien à saisir, mais le vendeur
                    saura pourquoi la fiche refusera ses ajouts plus tard. */}
                {categoryId !== "" && schemaCategorie.length === 0 && categorieFermee && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Cette catégorie n&apos;accepte aucune caractéristique personnalisée. Vous
                    pourrez décrire le produit dans la description, mais pas y ajouter de
                    couples « nom : valeur » depuis la fiche.
                  </p>
                )}

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

                {/* ═══════════════════════════════════════════════════════════════
                    LE REPLI « PLUS D'INFORMATIONS » A DISPARU AVEC SON CONTENU.

                    Il portait exactement quatre champs — marque, GTIN, EAN, mots-clés —
                    et les quatre ont été retirés ou déplacés sur la fiche. Garder le
                    dépliant vide aurait laissé croire qu'il reste quelque chose à
                    remplir.
                    ═══════════════════════════════════════════════════════════════ */}
              </>
            )}

            {/* ══════════════ Étape 2 — Référence, vente et stock ══════════════ */}
            {step === 1 && (
              <>
                <p className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  Le <strong>SKU</strong> est la référence que vous retrouverez en stock, sur
                  vos offres et sur vos commandes. Un article simple n&apos;en a qu&apos;une —
                  vous pourrez ajouter d&apos;autres déclinaisons (taille, couleur) plus tard
                  depuis la fiche.
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

                {/* Le titre ne parle plus de « logistique » : le code-barres et le poids
                    l'ont quitté. Ne reste que ce qu'un ACHETEUR lit — les attributs
                    pilotent son sélecteur de taille ou de couleur. */}
                <Expandable
                  title="Attributs de la déclinaison (facultatif)"
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

                  </div>
                </Expandable>

                {/* Césure entre les deux moitiés de l'étape fusionnée : la référence
                    au-dessus, la mise en vente en dessous. Sans elle, huit champs se
                    suivent sans qu'on voie qu'ils parlent de deux choses. */}
                <div className="border-t border-border pt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Mise en vente et stock initial
                </div>

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
                  {/* ═══════════════════════════════════════════════════════════════
                      DIT AU MOMENT DU CHOIX, PLUS SEULEMENT AU RÉCAPITULATIF.

                      `Offer.Condition` n'est affecté qu'au constructeur, et aucune des
                      méthodes du domaine ne le change (`ChangePrice`, `ApplyDiscount`,
                      `RemoveDiscount`, `SetHandlingTime`, `ChangeShipFromLocation`,
                      `Activate`, `Pause`, `MarkOutOfStock`). Aucune route non plus :
                      `SellerOfferEndpoints` ne monte que `price`, `status`,
                      `handling-time`, `discount` et `DELETE`.

                      La catégorie, elle, annonçait déjà son caractère définitif à
                      l'endroit du choix. Ces deux-là ne le faisaient nulle part : le
                      vendeur l'apprenait au récapitulatif, une étape plus loin, ou pas
                      du tout.
                      ═══════════════════════════════════════════════════════════════ */}
                  <p className="text-xs text-muted-foreground">
                    Ce choix n&apos;est <strong>plus modifiable ensuite</strong> : le corriger
                    demande de supprimer la mise en vente et de la recréer.
                  </p>
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
                    /* L'ENTREPÔT N'ESTIME AUCUN DÉLAI. Le délai annoncé à l'acheteur vient de la zone
                       de DESTINATION : `GetRatesForCommuneAsync(communeCode)` résout la commune de
                       l'acheteur, puis rend le `ShippingRate.Eta` de cette zone.

                       `ShipFromLocationId` n'est lu par le module Shipping que pour deux choses, dont
                       aucune n'est un délai : grouper les expéditions par (vendeur, entrepôt), et
                       donner au coursier l'adresse où il vient chercher le colis. */
                    <div className="rounded-xl bg-amber-100 p-3 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
                      Aucun entrepôt enregistré. C&apos;est l&apos;adresse où le coursier vient
                      chercher vos colis.
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
                  {/* ═══════════════════════════════════════════════════════════════
                      MÊME SILENCE QUE POUR L'ÉTAT, AVEC UNE CONSÉQUENCE DE PLUS.

                      `Offer.ShipFromLocationId` a bien une méthode de domaine
                      (`ChangeShipFromLocation`) — mais elle n'a AUCUN appelant : ni
                      commande, ni handler, ni route, ni test. Elle est prête à être
                      branchée, elle ne l'est pas.

                      Et le remède ne se limite pas à refaire l'offre. Le stock est
                      indexé par (SKU, lieu) — index UNIQUE — et la réservation se fait
                      sur le lieu PORTÉ PAR L'OFFRE : `TryReserveAsync(line.Sku,
                      line.ShipFromLocationId, …)`. Une offre recréée sur un entrepôt
                      sans stock reste en vitrine et fait échouer chaque commande en
                      `ordering.out_of_stock`, pendant que la page Stock affiche les
                      unités en rayon. C'est ce piège-là qu'il faut nommer, pas seulement
                      l'impossibilité de modifier.
                      ═══════════════════════════════════════════════════════════════ */}
                  <p className="text-xs text-muted-foreground">
                    C&apos;est d&apos;ici que partiront vos colis, et le stock y est rattaché.
                    Ce choix n&apos;est <strong>plus modifiable ensuite</strong> : en changer
                    demande de refaire la mise en vente, puis de suivre la référence au
                    nouvel entrepôt et de ramener l&apos;ancien à zéro.
                  </p>
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
                    {/* `InventoryItem.IsLowStock => Available <= ReorderThreshold` : le
                        seuil est INCLUS. « En dessous » se trompait d'un cran — à seuil 5
                        et stock 5, la référence est déjà signalée. */}
                    <p className="text-xs text-muted-foreground">
                      À ce niveau ou en dessous, la référence est signalée en stock faible.
                    </p>
                  </div>
                </div>

                {/* ═══════════════════════════════════════════════════════════════
                    LE DÉLAI DE PRÉPARATION A QUITTÉ L'ASSISTANT.

                    Aucun calcul ne s'en sert — ni date promise, ni SLA, ni alerte de
                    retard : ces notions n'existent nulle part dans le dépôt. Le délai
                    que l'acheteur LIT vient de `ShippingRate.Eta`, attaché au mode de
                    livraison qu'il choisit, et l'entrepôt de départ n'y entre pas.

                    Il reste utile au vendeur, qui le retrouve sur la carte « Mises en
                    vente » de la fiche produit (« Préparation : N jour(s) ») et l'y règle
                    en un clic. Le demander AVANT la première mise en vente, pour une
                    valeur qui ne sort de la console qu'en repère personnel, coûtait un
                    champ à tout le monde pour n'en servir aucun.

                    La création part sur deux jours — ce que le champ proposait déjà par
                    défaut, donc la valeur que la quasi-totalité des offres portait.
                    ═══════════════════════════════════════════════════════════════ */}
              </>
            )}

            {/* ══════════════ Étape 3 — Récapitulatif ══════════════ */}
            {step === 2 && (
              <>
                {/* ═══════════════════════════════════════════════════════════════
                    « TOUT RESTE MODIFIABLE ENSUITE » — TROIS CHAMPS SUR CET ÉCRAN
                    DÉMENTAIENT CETTE PHRASE, ET C'EST LA DERNIÈRE QUE LE VENDEUR LIT
                    AVANT DE VALIDER.

                      - CATÉGORIE : définitive. `Product.CategoryId` n'est affecté que
                        dans le constructeur, et `UpdateProductCommand` ne le porte pas.
                        Aucune route, aucune méthode de domaine ne la change.
                      - ÉTAT DE L'ARTICLE et LIEU D'EXPÉDITION : `SellerOfferEndpoints` ne
                        monte que `price`, `status`, `handling-time`, `discount` et
                        `DELETE`. Ni l'un ni l'autre n'a de route de modification.

                    Les deux derniers ont un remède : supprimer la mise en vente et la
                    recréer. La fiche produit, elle, survit — `DeleteOfferCommandHandler`
                    ne touche ni au produit, ni aux médias, ni au stock.

                    MAIS CE REMÈDE EST INCOMPLET POUR LE LIEU, ET LA PREMIÈRE RÉDACTION LE
                    DONNAIT COMME SUFFISANT. Le stock est indexé par (SKU, lieu) — index
                    UNIQUE, `InventoryItemConfiguration` — et la réservation se fait sur le
                    lieu PORTÉ PAR L'OFFRE : `TryReserveAsync(line.Sku,
                    line.ShipFromLocationId, …)`. Recréer l'offre au nouvel entrepôt sans y
                    déplacer le stock donne une offre en vitrine dont chaque commande
                    échoue en `ordering.out_of_stock` — « stock insuffisant » — pendant que
                    la page Stock affiche les unités en rayon. Un recours à moitié donné
                    est pire qu'un recours tu : il est suivi.

                    L'écran ne prévient QU'ICI, à la dernière étape, alors que les choix ont
                    été faits à l'étape précédente. C'est mieux que rien ; le signaler au
                    moment du choix est le point suivant de l'ordre de réparation.
                    ═══════════════════════════════════════════════════════════════ */}
                <p className="text-sm text-muted-foreground">
                  Vérifiez avant de créer. Presque tout reste modifiable ensuite depuis la fiche
                  — sauf trois choix. La <strong>catégorie</strong> est définitive.
                  L&apos;<strong>état de l&apos;article</strong> demande de supprimer la mise en
                  vente et de la recréer. Le <strong>lieu d&apos;expédition</strong> aussi, et il
                  faut en plus y déplacer votre stock : une offre qui expédie depuis un entrepôt
                  sans stock fait échouer chaque commande.
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
                    /* ANNONCÉ PARCE QU'ÉCRIT. Le délai n'est plus demandé, mais l'offre
                       naît quand même avec une valeur — et l'écran dit « vérifiez avant
                       de créer ». Taire un champ qu'on écrit, c'est demander une
                       vérification impossible. */
                    ["Délai de préparation", "2 jours — modifiable depuis la fiche"],
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
    /* L'ENTREPÔT N'ESTIME AUCUN DÉLAI. Le délai annoncé à l'acheteur vient de la zone
       de DESTINATION : `GetRatesForCommuneAsync(communeCode)` résout la commune de
       l'acheteur, puis rend le `ShippingRate.Eta` de cette zone.

       `ShipFromLocationId` n'est lu par le module Shipping que pour deux choses, dont
       aucune n'est un délai : grouper les expéditions par (vendeur, entrepôt), et
       donner au coursier l'adresse où il vient chercher le colis. */
    <Dialog
      open={open}
      onClose={onClose}
      title="Nouvel entrepôt"
      description="C'est l'adresse où le coursier vient chercher vos colis. Le délai annoncé à l'acheteur, lui, dépend de sa commune de livraison."
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
