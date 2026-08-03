"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { formatDateTime, formatXof } from "@/lib/utils";
import { catalogTone, statusLabel } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PriceBreakdown, usePricingRates } from "@/components/product/price-breakdown";
import type { FulfillmentLocation, SellerOffer, SellerProduct } from "@/types/seller";
import { AlertTriangle, Loader2, Plus, Tag, Trash2, TrendingDown } from "lucide-react";

/**
 * Normalise une saisie numérique FRANÇAISE avant analyse.
 *
 * Deux gestes très ordinaires cassaient la validation : copier un montant affiché par
 * l'écran (`formatXof` insère une espace fine insécable — « 10 000 F CFA ») et taper
 * une virgule décimale. Refuser « 10 000 » à un vendeur qui vient de le lire deux
 * lignes plus haut, c'est lui faire chercher une faute qu'il n'a pas commise.
 */
// `\s` en JavaScript couvre déjà l'espace insécable (U+00A0) et l'espace fine
// insécable (U+202F) — celles que produit `Intl.NumberFormat` en français.
const normalizeNumeric = (s: string) => s.replace(/\s/g, "").replace(",", ".");

/** Entier positif ou nul — pour les montants XOF, qui n'ont pas de centimes. */
const isWholeNumber = (s: string) => /^\d+$/.test(normalizeNumeric(s));

/** Nombre positif, décimales admises — pour un pourcentage (le domaine prend un `decimal`). */
const isDecimalNumber = (s: string) => /^\d+(\.\d+)?$/.test(normalizeNumeric(s));

const toNumber = (s: string) => Number(normalizeNumeric(s));

/**
 * Prix vendeur après remise, calculé EXACTEMENT comme le domaine.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * POURQUOI EN ARITHMÉTIQUE ENTIÈRE
 *
 * `Offer.ApplyDiscount` fait `Math.Round(reference * (1 - value / 100m))` sur des
 * `decimal` : calcul exact en base 10, puis arrondi AU PAIR (MidpointRounding.ToEven).
 * Reproduire cela avec des flottants binaires échoue deux fois — sur l'arrondi du
 * point milieu ET sur la représentation elle-même. Testé sur la plage réaliste des
 * prix, un aperçu flottant divergeait d'un franc dans environ 0,4 % des cas
 * (9 015 à −70 % : 2 705 affiché, 2 704 enregistré).
 *
 * Un aperçu qui se trompe une fois sur deux cent cinquante est pire qu'une absence
 * d'aperçu : il enseigne au vendeur à ne pas s'y fier.
 *
 * On travaille donc sur des entiers : `reference × (100·k − v·k) / (100·k)`, où `k`
 * absorbe les décimales du pourcentage. Le numérateur reste très en deçà de
 * `Number.MAX_SAFE_INTEGER`.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
function discountedSellerPrice(
  reference: number,
  type: "Percentage" | "Amount",
  rawValue: string,
): number | null {
  const text = normalizeNumeric(rawValue);

  if (type === "Amount") {
    // Le domaine fait `reference - Math.Round(value)` ; on n'accepte que des entiers
    // (un franc CFA ne se divise pas), l'arrondi est donc l'identité.
    if (!/^\d+$/.test(text)) return null;
    return reference - Number(text);
  }

  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const k = 10 ** fraction.length;
  const scaledValue = Number(whole) * k + (fraction === "" ? 0 : Number(fraction));

  const numerator = reference * (100 * k - scaledValue);
  const denominator = 100 * k;
  const quotient = Math.floor(numerator / denominator);
  const rest = numerator - quotient * denominator;

  if (2 * rest > denominator) return quotient + 1;
  if (2 * rest < denominator) return quotient;
  return quotient % 2 === 0 ? quotient : quotient + 1;
}

/** Horodatage local au format attendu par `<input type="datetime-local">`. */
function localNowForInput(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

/**
 * Prix et mise en vente.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * CE QUE LE VENDEUR SAISIT : CE QU'IL PERÇOIT, PAS CE QUE PAIE L'ACHETEUR.
 *
 * `PATCH /seller/offers/{id}/price` prend un `sellerPrice`. La plateforme EMPILE
 * ensuite sa commission et les frais du prestataire de paiement pour obtenir le prix
 * acheteur. Un vendeur qui saisit 10 000 reçoit 10 000 ; l'acheteur, lui, paiera plus.
 *
 * AUCUN TAUX N'EST ÉCRIT ICI.
 *
 * La décomposition des offres EXISTANTES vient telle quelle du serveur. Celle qui
 * s'affiche pendant la saisie d'un prix est calculée avec le barème lu sur
 * `GET /seller/pricing` — le vrai, celui qu'appliquera le domaine.
 *
 * L'application mobile vendeur, elle, refait le calcul avec des taux écrits en dur
 * (10 % et 5 % dans `app_config.dart`) : au premier changement de barème, elle ment
 * jusqu'à sa prochaine publication sur les stores. C'est cette dépendance-là qu'il ne
 * faut pas reproduire — pas le calcul lui-même, qui rend un vrai service au vendeur.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
export function ProductOffersManager({
  product,
  offers,
  locations,
  offersLoading,
  offersUnavailable,
  onChanged,
}: {
  product: SellerProduct;
  offers: SellerOffer[];
  locations: FulfillmentLocation[];
  /**
   * Vrai tant que la liste des offres n'est pas arrivée.
   *
   * `offers` vaut `[]` pendant le chargement comme en cas de liste réellement vide.
   * Sans ce drapeau, l'écran annonçait « Ce produit n'est pas en vente » aux premiers
   * instants de chaque visite, bouton « Mettre en vente » actif — soit exactement le
   * doublon que le cas d'erreur ci-dessous s'emploie à éviter.
   */
  offersLoading: boolean;
  /** Vrai si la requête des offres a ÉCHOUÉ — à distinguer de « aucune offre ». */
  offersUnavailable: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const [creating, setCreating] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const uncertain = offersLoading || offersUnavailable;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>Mises en vente ({uncertain ? "…" : offers.length})</CardTitle>
        <Button
          size="sm"
          variant="outline"
          // ─────────────────────────────────────────────────────────────────────
          // `key` INCRÉMENTÉ À CHAQUE OUVERTURE : le formulaire repart à neuf.
          //
          // `Dialog` rend `null` quand il est fermé, mais `CreateOfferDialog` — qui
          // le contient — reste monté, avec tout son état. Après une annulation, la
          // déclinaison choisie survivait ; si une offre avait été créée entre-temps,
          // elle disparaissait de la liste des SKU libres et le `<select>` s'affichait
          // vide… alors que `sku` restait renseigné. Le bouton « Mettre en vente »
          // était donc actif sur une déclinaison invisible à l'écran.
          //
          // Changer la clé force le remontage, donc la réinitialisation complète —
          // sans avoir à réécrire six `setState` que le prochain champ ajouté
          // oublierait.
          // ─────────────────────────────────────────────────────────────────────
          onClick={() => {
            setFormKey((k) => k + 1);
            setCreating(true);
          }}
          disabled={uncertain}
        >
          <Plus className="size-4" /> Mettre en vente
        </Button>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {offersLoading ? (
          <p className="text-sm text-muted-foreground">Chargement des mises en vente…</p>
        ) : offersUnavailable ? (
          // Ne JAMAIS afficher « aucune offre » sur une requête en échec : le vendeur
          // en créerait une seconde en doublon sur le même SKU.
          <p className="text-sm text-muted-foreground">
            Les mises en vente de ce produit n&apos;ont pas pu être chargées. Rechargez la
            page avant d&apos;en créer une, pour ne pas faire de doublon.
          </p>
        ) : offers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ce produit n&apos;est pas en vente. Une mise en vente porte le prix, l&apos;état
            de l&apos;article et l&apos;entrepôt d&apos;expédition.
          </p>
        ) : (
          offers.map((o) => <OfferBlock key={o.id} offer={o} onChanged={onChanged} />)
        )}
      </CardContent>

      <CreateOfferDialog
        key={formKey}
        open={creating}
        onClose={() => setCreating(false)}
        product={product}
        offers={offers}
        locations={locations}
        onChanged={onChanged}
      />
    </Card>
  );
}

/** Une mise en vente : décomposition du prix + actions. */
function OfferBlock({ offer, onChanged }: { offer: SellerOffer; onChanged: () => Promise<unknown> }) {
  const [pane, setPane] = useState<"none" | "price" | "handling" | "discount">("none");
  const [price, setPrice] = useState(String(offer.sellerPrice));
  const [handling, setHandling] = useState(String(offer.handlingTime));
  const [discountType, setDiscountType] = useState<"Percentage" | "Amount">("Percentage");
  const [discountValue, setDiscountValue] = useState("");
  const [discountEnds, setDiscountEnds] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pricing = usePricingRates();

  const hasDiscount = offer.compareAtAmount != null;

  // ───────────────────────────────────────────────────────────────────────────────
  // RÉINITIALISER LES CHAMPS À L'OUVERTURE, PAS AU MONTAGE.
  //
  // `useState(String(offer.sellerPrice))` ne s'évalue qu'une fois : la clé de liste
  // étant `offer.id`, ce bloc n'est jamais remonté. Après une remise (qui change
  // `sellerPrice`), rouvrir « Modifier le prix » affichait donc l'ANCIEN montant — et
  // « Enregistrer » l'écrivait, en annulant la remise au passage (`Offer.ChangePrice`
  // remet `OriginalSellerPrice` à null). Le vendeur perdait sa promotion en croyant
  // simplement consulter un prix.
  // ───────────────────────────────────────────────────────────────────────────────
  function openPane(target: "price" | "handling" | "discount") {
    if (target === "price") setPrice(String(offer.sellerPrice));
    if (target === "handling") setHandling(String(offer.handlingTime));
    if (target === "discount") {
      setDiscountValue("");
      setDiscountEnds("");
    }
    setPane(target);
  }

  const changePrice = useMutation({
    mutationFn: () =>
      bff(`/seller/offers/${offer.id}/price`, {
        method: "PATCH",
        body: JSON.stringify({ sellerPrice: toNumber(price) }),
      }),
    onSuccess: async () => {
      setPane("none");
      await onChanged();
    },
    meta: { successMessage: "Prix mis à jour.", errorMessage: "Le prix n'a pas pu être modifié." },
  });

  const changeStatus = useMutation({
    mutationFn: (status: string) =>
      bff(`/seller/offers/${offer.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => onChanged(),
    meta: { successMessage: "Statut mis à jour.", errorMessage: "Changement de statut impossible." },
  });

  const changeHandling = useMutation({
    mutationFn: () =>
      bff(`/seller/offers/${offer.id}/handling-time`, {
        method: "PATCH",
        body: JSON.stringify({ handlingTime: toNumber(handling) }),
      }),
    onSuccess: async () => {
      setPane("none");
      await onChanged();
    },
    meta: { successMessage: "Délai de préparation mis à jour." },
  });

  const applyDiscount = useMutation({
    mutationFn: () =>
      bff(`/seller/offers/${offer.id}/discount`, {
        method: "POST",
        body: JSON.stringify({
          type: discountType,
          value: toNumber(discountValue),
          // `datetime-local` rend une heure LOCALE sans fuseau. `new Date(...)`
          // l'interprète dans le fuseau du navigateur, `toISOString()` la convertit
          // en UTC — ce que le serveur attend. Envoyer la chaîne brute daterait la
          // fin de promotion d'une heure de décalage au Bénin (UTC+1).
          endsOnUtc: discountEnds ? new Date(discountEnds).toISOString() : null,
        }),
      }),
    onSuccess: async () => {
      setPane("none");
      setDiscountValue("");
      setDiscountEnds("");
      await onChanged();
    },
    meta: { successMessage: "Remise appliquée.", errorMessage: "La remise n'a pas pu être appliquée." },
  });

  const removeDiscount = useMutation({
    mutationFn: () => bff(`/seller/offers/${offer.id}/discount`, { method: "DELETE" }),
    onSuccess: () => onChanged(),
    meta: { successMessage: "Remise retirée." },
  });

  const deleteOffer = useMutation({
    mutationFn: () => bff(`/seller/offers/${offer.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirmDelete(false);
      await onChanged();
    },
    meta: {
      successMessage: "Mise en vente supprimée.",
      errorMessage: "La mise en vente n'a pas pu être supprimée.",
    },
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // VALIDATION DE LA REMISE — TOUTES LES BORNES DU DOMAINE, PAS SEULEMENT LA PREMIÈRE.
  //
  // `Offer.ApplyDiscount` refuse quatre choses : une valeur ≤ 0, un pourcentage ≥ 100,
  // une date de fin passée, et — APRÈS ARRONDI — un prix réduit ≤ 0 ou ≥ prix de
  // référence. Cette dernière borne est celle qu'on oublie : un prix de 30 avec 1 %
  // de remise donne 29,7, arrondi à 30, soit « aucune baisse » → 400 côté serveur, sur
  // une saisie que l'écran présentait comme valide.
  //
  // On teste donc sur le RÉSULTAT calculé, pas sur la saisie.
  // ───────────────────────────────────────────────────────────────────────────────
  const discountSyntaxOk =
    discountType === "Percentage" ? isDecimalNumber(discountValue) : isWholeNumber(discountValue);

  // ⚠️ L'aperçu n'est calculé que si AUCUNE remise n'est en cours : sinon le domaine
  // repart du prix d'origine (`OriginalSellerPrice`), que l'API ne renvoie pas.
  // (Le bouton d'ouverture de ce panneau est d'ailleurs masqué dans ce cas.)
  const preview = hasDiscount
    ? null
    : discountedSellerPrice(offer.sellerPrice, discountType, discountValue);

  const discountEndsValid =
    discountEnds === "" || new Date(discountEnds).getTime() > Date.now();

  const discountInRange =
    discountSyntaxOk &&
    toNumber(discountValue) > 0 &&
    (discountType !== "Percentage" || toNumber(discountValue) < 100) &&
    preview !== null &&
    preview > 0 &&
    preview < offer.sellerPrice;

  const discountSubmittable = discountInRange && discountEndsValid;

  const priceValid = isWholeNumber(price) && toNumber(price) > 0;
  const handlingValid = isWholeNumber(handling);

  return (
    <div className="rounded-xl bg-muted/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs font-medium">{offer.sku}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="neutral">{statusLabel(offer.condition, "offerCondition")}</Badge>
          <Badge variant="neutral">{statusLabel(offer.fulfillmentType, "fulfillmentType")}</Badge>
          <Badge variant={catalogTone(offer.status)}>{statusLabel(offer.status, "offer")}</Badge>
        </div>
      </div>

      <dl className="space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Prix payé par l&apos;acheteur</dt>
          <dd className="tabular-nums">
            {hasDiscount && (
              <span className="mr-1.5 text-muted-foreground line-through">
                {formatXof(offer.compareAtAmount ?? 0)}
              </span>
            )}
            {formatXof(offer.productPrice)}
          </dd>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <dt>Commission plateforme</dt>
          <dd className="tabular-nums">−{formatXof(offer.commissionAmount)}</dd>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <dt>Frais du prestataire de paiement</dt>
          <dd className="tabular-nums">−{formatXof(offer.providerFeeAmount)}</dd>
        </div>
        <div className="flex justify-between border-t border-border pt-1 font-semibold">
          <dt>Vous percevez</dt>
          <dd className="tabular-nums text-primary">{formatXof(offer.sellerPrice)}</dd>
        </div>
      </dl>

      <p className="mt-2 text-xs text-muted-foreground">
        Préparation : {offer.handlingTime} jour(s)
        {hasDiscount && (
          <>
            {" · "}
            <Tag className="inline size-3" /> Remise en cours
            {offer.discountEndsOnUtc
              ? ` jusqu'au ${formatDateTime(offer.discountEndsOnUtc)}`
              : " (sans date de fin)"}
          </>
        )}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => openPane("price")}>
          Modifier le prix
        </Button>
        <Button size="sm" variant="outline" onClick={() => openPane("handling")}>
          Délai de préparation
        </Button>
        {hasDiscount ? (
          <Button
            size="sm"
            variant="outline"
            disabled={removeDiscount.isPending}
            onClick={() => removeDiscount.mutate()}
          >
            {removeDiscount.isPending && <Loader2 className="size-4 animate-spin" />}
            Retirer la remise
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => openPane("discount")}>
            <TrendingDown className="size-4" /> Appliquer une remise
          </Button>
        )}

        {offer.status.toLowerCase() === "active" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={changeStatus.isPending}
            onClick={() => changeStatus.mutate("Paused")}
          >
            Suspendre la vente
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={changeStatus.isPending}
            onClick={() => changeStatus.mutate("Active")}
          >
            Remettre en vente
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

      {/* ───────── Prix ───────── */}
      <Dialog
        open={pane === "price"}
        onClose={() => setPane("none")}
        title="Modifier le prix"
        description="Saisissez ce que VOUS souhaitez percevoir. La plateforme ajoute ensuite sa commission et les frais de paiement pour former le prix affiché à l'acheteur."
        footer={
          <>
            <Button variant="outline" onClick={() => setPane("none")}>
              Annuler
            </Button>
            <Button disabled={changePrice.isPending || !priceValid} onClick={() => changePrice.mutate()}>
              {changePrice.isPending && <Loader2 className="size-4 animate-spin" />}
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor={`price-${offer.id}`}>Ce que vous percevez ({offer.currency})</Label>
          <Input
            id={`price-${offer.id}`}
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          {!priceValid && price.trim().length > 0 && (
            <p className="text-xs text-destructive">
              Un montant entier strictement positif est attendu, sans espace ni décimale.
            </p>
          )}
          {priceValid && (
            <PriceBreakdown
              sellerPrice={toNumber(price)}
              rates={pricing.data}
              unavailable={pricing.isError}
            />
          )}
        </div>
        {hasDiscount && (
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-100 p-3 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Une remise est en cours sur cette offre. Changer le prix l&apos;annule : le
            nouveau montant devient le prix de référence.
          </p>
        )}
      </Dialog>

      {/* ───────── Délai de préparation ───────── */}
      <Dialog
        open={pane === "handling"}
        onClose={() => setPane("none")}
        title="Délai de préparation"
        description="Nombre de jours entre la commande et la remise du colis au transporteur. C'est ce délai qui sert à annoncer une date de livraison à l'acheteur."
        footer={
          <>
            <Button variant="outline" onClick={() => setPane("none")}>
              Annuler
            </Button>
            <Button
              disabled={changeHandling.isPending || !handlingValid}
              onClick={() => changeHandling.mutate()}
            >
              {changeHandling.isPending && <Loader2 className="size-4 animate-spin" />}
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor={`handling-${offer.id}`}>Jours</Label>
          <Input
            id={`handling-${offer.id}`}
            inputMode="numeric"
            value={handling}
            onChange={(e) => setHandling(e.target.value)}
          />
          {handling.trim().length > 0 && !handlingValid && (
            <p className="text-xs text-destructive">Un nombre entier de jours est attendu.</p>
          )}
        </div>
      </Dialog>

      {/* ───────── Remise ───────── */}
      <Dialog
        open={pane === "discount"}
        onClose={() => setPane("none")}
        title="Appliquer une remise"
        footer={
          <>
            <Button variant="outline" onClick={() => setPane("none")}>
              Annuler
            </Button>
            <Button
              disabled={applyDiscount.isPending || !discountSubmittable}
              onClick={() => applyDiscount.mutate()}
            >
              {applyDiscount.isPending && <Loader2 className="size-4 animate-spin" />}
              Appliquer
            </Button>
          </>
        }
      >
        <p className="rounded-lg bg-amber-100 p-3 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
          <strong>Cette remise est à votre charge.</strong> Elle s&apos;applique à ce que vous
          percevez, pas à la commission de la plateforme : c&apos;est votre part qui baisse,
          et le prix acheteur suit.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor={`dtype-${offer.id}`}>Type</Label>
          <Select
            id={`dtype-${offer.id}`}
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as "Percentage" | "Amount")}
          >
            <option value="Percentage">Pourcentage</option>
            <option value="Amount">Montant fixe</option>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`dvalue-${offer.id}`}>
            {discountType === "Percentage"
              ? "Pourcentage (moins de 100)"
              : `Montant retiré (${offer.currency})`}
          </Label>
          <Input
            id={`dvalue-${offer.id}`}
            inputMode="numeric"
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
          />
          {discountValue.trim().length > 0 && !discountInRange && (
            <p className="text-xs text-destructive">
              {discountType === "Percentage"
                ? "Un pourcentage strictement compris entre 0 et 100, et qui fasse réellement baisser le prix arrondi."
                : `Un montant entier strictement inférieur à ${formatXof(offer.sellerPrice)} : la remise doit laisser un prix positif.`}
            </p>
          )}
          {preview !== null && (
            <p className="text-xs text-muted-foreground">
              Vous percevriez{" "}
              <span className="font-medium tabular-nums text-foreground">
                {formatXof(preview)}
              </span>{" "}
              au lieu de {formatXof(offer.sellerPrice)}. Le prix acheteur est recalculé par la
              plateforme.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`dends-${offer.id}`}>Fin de la remise</Label>
          <Input
            id={`dends-${offer.id}`}
            type="datetime-local"
            // Le domaine refuse une date passée : autant l'interdire dans le sélecteur
            // plutôt que de laisser découvrir la règle par un aller-retour raté.
            min={localNowForInput()}
            value={discountEnds}
            onChange={(e) => setDiscountEnds(e.target.value)}
          />
          {/* `min` marque le champ « invalide » côté navigateur, mais ne désactive
              rien : sans `<form>` ni `checkValidity()`, le bouton resterait cliquable.
              D'où ce contrôle explicite — utile aussi quand la boîte reste ouverte
              au-delà de l'heure choisie. */}
          {!discountEndsValid && (
            <p className="text-xs text-destructive">
              La date de fin doit être dans le futur.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Facultatif. Sans date, la remise court jusqu&apos;à ce que vous la retiriez.
          </p>
        </div>
      </Dialog>

      {/* ───────── Suppression ───────── */}
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Supprimer cette mise en vente ?"
        description="L'article n'est plus proposé et la référence est libérée. Pour une interruption temporaire (rupture, congés), préférez « Suspendre la vente » : le prix et les réglages sont conservés."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              disabled={deleteOffer.isPending}
              onClick={() => deleteOffer.mutate()}
            >
              {deleteOffer.isPending && <Loader2 className="size-4 animate-spin" />}
              Supprimer
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Les commandes déjà passées ne sont pas affectées : elles conservent le prix et la
          référence du jour de l&apos;achat.
        </p>
      </Dialog>
    </div>
  );
}

/** Création d'une mise en vente sur ce produit. */
function CreateOfferDialog({
  open,
  onClose,
  product,
  offers,
  locations,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  product: SellerProduct;
  offers: SellerOffer[];
  locations: FulfillmentLocation[];
  onChanged: () => Promise<unknown>;
}) {
  const [sku, setSku] = useState("");
  const [sellerPrice, setSellerPrice] = useState("");
  const [condition, setCondition] = useState("New");
  const [fulfillmentType, setFulfillmentType] = useState("Fbs");
  const [locationId, setLocationId] = useState("");
  const [handlingTime, setHandlingTime] = useState("2");
  const pricing = usePricingRates();

  // Devise reprise d'une offre existante quand il y en a une ; sinon XOF, la seule
  // devise de la plateforme aujourd'hui (`formatXof` en fait autant partout ailleurs).
  const currency = offers[0]?.currency ?? "XOF";

  // ⚠️ FILTRE PARTIEL, ET ASSUMÉ.
  //
  // On ne connaît ici que les offres DE CE PRODUIT, alors que le serveur refuse un
  // doublon de SKU sur TOUTE la boutique (`IOfferRepository.ExistsAsync(sellerId, sku)`).
  // Un SKU réutilisé sur deux fiches passera donc ce filtre et sera rejeté en 409 —
  // avec le message du serveur, qui dit précisément cela. On retire ce qu'on sait
  // déjà être pris ; on ne prétend pas que le reste est garanti libre.
  const takenSkus = new Set(offers.map((o) => o.sku));
  const freeSkus = product.variants.filter((v) => !takenSkus.has(v.sku));

  const create = useMutation({
    mutationFn: () =>
      bff<{ offerId: string }>("/seller/offers", {
        method: "POST",
        body: JSON.stringify({
          productId: product.id,
          sku: sku.trim(),
          sellerPrice: toNumber(sellerPrice),
          currency,
          condition,
          fulfillmentType,
          shipFromLocationId: locationId,
          handlingTime: toNumber(handlingTime),
        }),
      }),
    onSuccess: async () => {
      setSku("");
      setSellerPrice("");
      onClose();
      await onChanged();
    },
    meta: {
      successMessage: "Mise en vente créée.",
      errorMessage: "La mise en vente n'a pas pu être créée.",
    },
  });

  const priceValid = isWholeNumber(sellerPrice) && toNumber(sellerPrice) > 0;
  const handlingValid = isWholeNumber(handlingTime);
  const canCreate = sku.trim().length > 0 && priceValid && handlingValid && locationId.length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Mettre ce produit en vente"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={create.isPending || !canCreate} onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="size-4 animate-spin" />}
            Mettre en vente
          </Button>
        </>
      }
    >
      {product.variants.length === 0 ? (
        <p className="rounded-lg bg-amber-100 p-3 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
          Ce produit n&apos;a aucune déclinaison : créez-en une d&apos;abord, son SKU est la
          référence que porteront la mise en vente et le stock.
        </p>
      ) : freeSkus.length === 0 ? (
        <p className="rounded-lg bg-amber-100 p-3 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
          Toutes les déclinaisons de ce produit sont déjà en vente.
        </p>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="o-sku">Déclinaison</Label>
          <Select id="o-sku" value={sku} onChange={(e) => setSku(e.target.value)}>
            <option value="">Choisir…</option>
            {freeSkus.map((v) => (
              <option key={v.id} value={v.sku}>
                {v.sku}
                {Object.keys(v.attributes ?? {}).length > 0 &&
                  ` — ${Object.entries(v.attributes)
                    .map(([k, val]) => `${k} : ${val}`)
                    .join(", ")}`}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="o-price">Ce que vous percevez ({currency})</Label>
        <Input
          id="o-price"
          inputMode="numeric"
          value={sellerPrice}
          onChange={(e) => setSellerPrice(e.target.value)}
        />
        {sellerPrice.trim().length > 0 && !priceValid && (
          <p className="text-xs text-destructive">
            Un montant entier strictement positif est attendu, sans espace ni décimale.
          </p>
        )}
        {priceValid ? (
          <PriceBreakdown
            sellerPrice={toNumber(sellerPrice)}
            rates={pricing.data}
            unavailable={pricing.isError}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            La commission de la plateforme et les frais de paiement s&apos;ajoutent
            par-dessus pour former le prix acheteur.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="o-condition">État de l&apos;article</Label>
          <Select id="o-condition" value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="New">Neuf</option>
            <option value="Used">Occasion</option>
            <option value="Refurbished">Reconditionné</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="o-fulfillment">Expédition</Label>
          <Select
            id="o-fulfillment"
            value={fulfillmentType}
            onChange={(e) => setFulfillmentType(e.target.value)}
          >
            <option value="Fbs">Vous expédiez</option>
            <option value="Fbp">La plateforme expédie</option>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="o-location">Entrepôt d&apos;expédition</Label>
        {locations.length === 0 ? (
          <p className="rounded-lg bg-amber-100 p-3 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
            Aucun entrepôt enregistré. Créez-en un depuis la page Stock : c&apos;est le point
            de départ utilisé pour estimer les délais de livraison.
          </p>
        ) : (
          <Select id="o-location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Choisir…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.line} — {l.city}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="o-handling">Délai de préparation (jours)</Label>
        <Input
          id="o-handling"
          inputMode="numeric"
          value={handlingTime}
          onChange={(e) => setHandlingTime(e.target.value)}
        />
        {handlingTime.trim().length > 0 && !handlingValid && (
          <p className="text-xs text-destructive">Un nombre entier de jours est attendu.</p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        La mise en vente est active dès sa création. Le produit, lui, n&apos;est visible en
        boutique qu&apos;une fois publié par l&apos;administration.
      </p>
    </Dialog>
  );
}
