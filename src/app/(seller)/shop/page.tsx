"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { toastError, toastSuccess } from "@/lib/toast";
import { peutVendre, raisonDeRefus } from "@/lib/selling";
import { ReadOnlyNote } from "@/components/read-only-note";
import { CommuneSelect } from "@/components/commune-select";
import { formatDateTime, maskAccount } from "@/lib/utils";
import { accountTone, kybTone, statusLabel } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { isCompletePhone, toLocalPhone, toStoredPhone } from "@/lib/phone";
import { Textarea } from "@/components/ui/textarea";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import type { KybDocument, SellerShop } from "@/types/seller";
import { PAYOUT_PROVIDERS, isPayableProvider } from "@/lib/payout";
import { AlertTriangle, Download, ImageOff, Loader2, Star, Trash2, Upload } from "lucide-react";

/** Types de pièce acceptés par le domaine (`KybDocumentType`). */
const KYB_TYPES = ["IdCard", "BusinessRegistry", "TaxId", "ProofOfAddress"] as const;

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * LA LISTE DES OPÉRATEURS VIENT DE `@/lib/payout`, ET ELLE A RÉTRÉCI.
 *
 * Elle proposait cinq entrées — `Wave` et `BankAccount` comprises. Le serveur les
 * accepte à l'ENREGISTREMENT (`Enum.TryParse` sur `PayoutProvider`) et les refuse au
 * RETRAIT (`WalletPayout.IsMobileMoney` ne connaît que `mtnmomo`, `moovmoney`,
 * `celtis`). Un vendeur pouvait donc enregistrer un compte parfaitement valide à
 * l'écran, dont aucun versement ne partirait jamais — et l'apprendre des semaines plus
 * tard, sans qu'aucun message ne relie l'échec à ce choix.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */

export default function ShopPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["seller-shop"], queryFn: () => bff<SellerShop>("/seller/shop") });
  const shop = q.data;

  // ───────────────────────────────────────────────────────────────────────────────
  // `refetchQueries`, PAS `invalidateQueries`.
  //
  // `invalidate` marque la donnée périmée et déclenche un rechargement, mais la
  // promesse qu'elle rend n'attend pas forcément que la nouvelle réponse soit là :
  // la mutation se termine, le toast de succès s'affiche, et la liste reste celle
  // d'avant pendant un instant. Sur l'écran des pièces KYB, cet instant suffisait à
  // faire croire qu'un dépôt n'avait pas été pris en compte.
  //
  // `refetch` attend la réponse. Le bandeau de vérification, qui observe la même
  // clé, se met à jour du même coup.
  // ───────────────────────────────────────────────────────────────────────────────
  const invalidate = () => qc.refetchQueries({ queryKey: ["seller-shop"] });

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Ma boutique</h1>
        <p className="text-sm text-muted-foreground">
          Profil public, informations société, compte de versement et pièces justificatives.
        </p>
      </header>

      <PageNote>
        Le <strong>nom, le logo et la description</strong> sont visibles par les acheteurs. Les
        informations société et les pièces justificatives ne le sont pas : elles servent à la
        vérification de votre boutique par la plateforme.
      </PageNote>

      <QueryError of={q} />

      {q.isLoading ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">Chargement…</Card>
      ) : q.isError || !shop ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          Boutique non chargée — voir le message ci-dessus.
        </Card>
      ) : (
        <div className="space-y-6">
          <ShopHeader shop={shop} onChanged={invalidate} />
          <ProfileCard shop={shop} onChanged={invalidate} />
          <CompanyCard shop={shop} onChanged={invalidate} />
          <PayoutCard shop={shop} onChanged={invalidate} />
          <KybCard shop={shop} onChanged={invalidate} />
        </div>
      )}
    </div>
  );
}

/** Bandeau d'identité : logo, statuts, note, commission. */
function ShopHeader({ shop, onChanged }: { shop: SellerShop; onChanged: () => Promise<unknown> }) {
  // ═════════════════════════════════════════════════════════════════════════════════
  // LE LOGO EST UNE ÉCRITURE GARDÉE, ET C'EST L'ÉCRAN QUI AFFICHE LE STATUT.
  //
  // `POST /seller/shop/logo` passe par `ResolveSellingSellerAsync`. Cet écran montrait
  // la pastille « Suspendue » à trois centimètres d'un bouton qui allait prendre un
  // 403 — le statut était sous les yeux du vendeur, et la console ne s'en servait pas.
  //
  // On le lit sur `shop`, déjà chargé : pas de requête supplémentaire, et pas d'écart
  // possible entre la pastille affichée et le bouton neutralisé.
  // ═════════════════════════════════════════════════════════════════════════════════
  const ecritureBloquee = !peutVendre(shop.status);

  const fileRef = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      // Pas de Content-Type posé à la main : `bff()` laisse le navigateur écrire la
      // « boundary » multipart lui-même. La forcer casserait l'envoi.
      return bff<{ logoUrl: string }>("/seller/shop/logo", { method: "POST", body: form });
    },
    onSuccess: () => onChanged(),
    meta: {
      successMessage: "Logo mis à jour.",
      errorMessage: "Le logo n'a pas pu être téléversé.",
    },
  });

  return (
    <Card>
      <CardContent className="flex flex-wrap items-start gap-5 p-5">
        <div className="shrink-0">
          {shop.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shop.logoUrl} alt="" className="size-20 rounded-2xl object-cover" />
          ) : (
            <div className="flex size-20 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <ImageOff className="size-7" />
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              // On vide le champ AVANT de partir : sans cela, re-choisir le même
              // fichier après un échec ne déclenche aucun `change`.
              e.target.value = "";
              if (f) upload.mutate(f);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-full"
            onClick={() => fileRef.current?.click()}
            disabled={ecritureBloquee || upload.isPending}
          >
            {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Logo
          </Button>
          {/* Un bouton grisé sans motif visible envoie chercher la cause partout sauf
              où elle est, et `disabled:pointer-events-none` interdit l'infobulle. Le
              motif complet est dans la carte « Profil public » juste en dessous ; ici,
              une ligne suffit à faire le lien. */}
          {ecritureBloquee && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Indisponible dans l&apos;état actuel de votre boutique — voir « Profil public ».
            </p>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">{shop.shopName}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={accountTone(shop.status)}>{statusLabel(shop.status, "sellerStatus")}</Badge>
            <Badge variant={kybTone(shop.kybStatus)}>
              Vérification : {statusLabel(shop.kybStatus, "kybStatus")}
            </Badge>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Note</dt>
              <dd className="mt-0.5 inline-flex items-center gap-1 tabular-nums">
                {shop.rating > 0 ? (
                  <>
                    <Star className="size-3.5 fill-amber-400 text-amber-400" />
                    {shop.rating.toFixed(1)}
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Ventes</dt>
              <dd className="mt-0.5 tabular-nums">{shop.salesCount}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Commission</dt>
              {/* `commissionRate` est un DÉCIMAL (0,10), pas un pourcentage. */}
              <dd className="mt-0.5 tabular-nums">{(shop.commissionRate * 100).toFixed(1)} %</dd>
            </div>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}

/** Nom, description — la partie visible par les acheteurs. */
function ProfileCard({ shop, onChanged }: { shop: SellerShop; onChanged: () => Promise<unknown> }) {
  // `PUT /seller/shop/profile` passe par `ResolveSellingSellerAsync`. Même lecture que
  // pour le logo, même source : le `shop` déjà chargé.
  const ecritureBloquee = !peutVendre(shop.status);
  const motifRefus = ecritureBloquee ? raisonDeRefus(shop.status, shop.suspensionReason) : null;

  const [name, setName] = useState(shop.shopName);
  const [description, setDescription] = useState(shop.description ?? "");

  // Le formulaire suit les données fraîches : après un rechargement (ou un
  // téléversement de logo qui réécrit le profil), on ne garde pas une saisie périmée.
  useEffect(() => {
    setName(shop.shopName);
    setDescription(shop.description ?? "");
  }, [shop.shopName, shop.description]);

  const save = useMutation({
    mutationFn: () =>
      bff("/seller/shop/profile", {
        method: "PUT",
        // ⚠️ `logoUrl` est RENVOYÉ tel quel : cette route écrase le profil entier.
        // Omettre le champ effacerait le logo à chaque enregistrement du nom.
        body: JSON.stringify({
          shopName: name.trim(),
          logoUrl: shop.logoUrl ?? null,
          description: description.trim() || null,
        }),
      }),
    onSuccess: () => onChanged(),
    meta: { successMessage: "Profil enregistré.", errorMessage: "Le profil n'a pas pu être enregistré." },
  });

  const dirty = name.trim() !== shop.shopName || (description.trim() || null) !== (shop.description ?? null);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Profil public</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-5 pt-0">
        {/* Le motif EN CLAIR, ici : contrairement aux autres écrans, cette page n'a pas
            de bandeau de tête où aller le lire. */}
        {motifRefus && <ReadOnlyNote>{motifRefus}</ReadOnlyNote>}
        <div className="space-y-1.5">
          <Label htmlFor="shopName">Nom de la boutique</Label>
          <Input id="shopName" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="desc">Description</Label>
          <Textarea
            id="desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Ce que vous vendez, en quelques lignes."
          />
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => save.mutate()}
            disabled={ecritureBloquee || save.isPending || !dirty || !name.trim()}
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            Enregistrer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Informations société — tous les champs sont optionnels côté serveur. */
function CompanyCard({ shop, onChanged }: { shop: SellerShop; onChanged: () => Promise<unknown> }) {
  const m = shop.metadata;
  const [form, setForm] = useState({
    legalName: m?.legalName ?? "",
    rccm: m?.rccm ?? "",
    ifu: m?.ifu ?? "",
    address: m?.address ?? "",
    commune: m?.commune ?? "",
    activity: m?.activity ?? "",
    managerName: m?.managerName ?? "",
    // Partie LOCALE : l'indicatif est ajouté à l'envoi.
    phone: toLocalPhone(m?.phone),
  });

  useEffect(() => {
    setForm({
      legalName: m?.legalName ?? "",
      rccm: m?.rccm ?? "",
      ifu: m?.ifu ?? "",
      address: m?.address ?? "",
      commune: m?.commune ?? "",
      activity: m?.activity ?? "",
      managerName: m?.managerName ?? "",
      phone: toLocalPhone(m?.phone),
    });
  }, [m]);

  const save = useMutation({
    mutationFn: () =>
      bff("/seller/shop/metadata", {
        method: "PUT",
        // Chaîne vide → null : le domaine attend des champs absents, pas vides.
        //
        // Le téléphone fait exception : le champ ne contient que la partie locale, il
        // faut lui rendre son indicatif avant l'envoi. L'oublier enregistrerait dix
        // chiffres nus, indistinguables d'un numéro étranger tronqué.
        body: JSON.stringify(
          Object.fromEntries(
            Object.entries(form).map(([k, v]) => [
              k,
              k === "phone" ? (v ? toStoredPhone(v) : null) : v.trim() || null,
            ]),
          ),
        ),
      }),
    onSuccess: () => onChanged(),
    meta: {
      successMessage: "Informations société enregistrées.",
      errorMessage: "Les informations n'ont pas pu être enregistrées.",
    },
  });

  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) =>
    // Le téléphone se compare sur sa partie locale des DEUX côtés : « 0197000000 »
    // face à « +2290197000000 » aurait toujours paru modifié.
    k === "phone"
      ? form.phone !== toLocalPhone(m?.phone)
      : (form[k].trim() || null) !== ((m?.[k] ?? null) || null),
  );

  const field = (key: keyof typeof form, label: string, placeholder?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        value={form[key]}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Informations société</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-5 pt-0">
        <p className="text-xs text-muted-foreground">
          Non visibles par les acheteurs. Elles servent à la vérification de votre boutique et
          doivent correspondre à vos pièces justificatives.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("legalName", "Raison sociale")}
          {field("managerName", "Gérant")}
          {field("rccm", "RCCM")}
          {field("ifu", "IFU")}
          {field("activity", "Activité")}
          <div className="space-y-1.5">
            <Label htmlFor="company-phone">Téléphone</Label>
            <PhoneInput
              id="company-phone"
              value={form.phone}
              onChange={(local) => setForm({ ...form, phone: local })}
            />
          </div>
          {field("address", "Adresse")}
          {/* Commune choisie dans la liste officielle, comme partout ailleurs.
              Ce champ reste FACULTATIF : c'est du déclaratif de dossier KYB, pas
              une adresse de livraison. */}
          <CommuneSelect
            value={form.commune}
            onChange={(code) => setForm((f) => ({ ...f, commune: code }))}
            label="Commune"
          />
        </div>
        <div className="flex justify-end">
          {/* Inactif tant que rien n'a changé, comme le profil public : cette route
              écrase les huit champs à chaque envoi, autant ne pas le faire pour rien. */}
          <Button
            onClick={() => save.mutate()}
            disabled={
              save.isPending ||
              !dirty ||
              (form.phone.length > 0 && !isCompletePhone(form.phone))
            }
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            Enregistrer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Compte de versement — c'est là que part l'argent. */
function PayoutCard({ shop, onChanged }: { shop: SellerShop; onChanged: () => Promise<unknown> }) {
  // ═════════════════════════════════════════════════════════════════════════════════
  // ICI, C'EST `CanWithdraw` QUI DÉCIDE, PAS `CanSell`.
  //
  // `SetPayoutAccountAsync` passe par `ResolvePayableSellerAsync` : une boutique
  // FERMÉE ou en attente de réactivation garde la main sur son compte de reversement —
  // l'argent gagné avant la fermeture lui appartient. Seule la SUSPENSION bloque, le
  // temps de l'instruction.
  //
  // Appliquer `peutVendre` ici aurait donc été un sur-blocage : on aurait empêché un
  // vendeur fermé de corriger le numéro sur lequel on doit le payer.
  // ═════════════════════════════════════════════════════════════════════════════════
  const versementSuspendu = (shop.status ?? "").toLowerCase() === "suspended";

  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState(shop.payout?.provider ?? "");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState(shop.payout?.accountName ?? "");

  function reset() {
    setProvider(shop.payout?.provider ?? "");
    setAccountNumber("");
    setAccountName(shop.payout?.accountName ?? "");
  }

  const save = useMutation({
    mutationFn: () =>
      bff("/seller/shop/payout-account", {
        method: "PUT",
        body: JSON.stringify({
          provider: provider.trim(),
          // Champ laissé vide sur le même opérateur = « je ne change que le titulaire ».
          accountNumber: numeroConserve
            ? (shop.payout?.accountNumber ?? "")
            : accountNumber.trim(),
          accountName: accountName.trim(),
        }),
      }),
    onSuccess: async () => {
      await onChanged();
      reset();
      setOpen(false);
    },
    meta: {
      successMessage: "Compte de versement enregistré.",
      errorMessage: "Le compte de versement n'a pas pu être enregistré.",
    },
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * RETAPER LE NUMÉRO N'A DE SENS QUE SI LE COMPTE CHANGE.
   *
   * Les trois champs étaient exigés, y compris pour corriger une faute dans le nom du
   * titulaire : le vendeur devait retrouver et ressaisir son numéro complet pour une
   * modification qui ne le concerne pas.
   *
   * LA JUSTIFICATION D'ORIGINE RESTE BONNE, ET ON LA GARDE : retaper un numéro de
   * versement est la dernière occasion de s'apercevoir qu'on s'est trompé de compte,
   * et un versement mal adressé n'est pas récupérable. Mais elle ne vaut que quand le
   * compte change. Si l'opérateur est le même et que le champ reste vide, il n'y a
   * rien à vérifier — on renvoie le numéro déjà enregistré.
   *
   * LE SERVEUR ÉCRASE LES TROIS CHAMPS (`SetPayoutAccountCommand`), il n'existe pas de
   * mise à jour partielle : c'est donc bien à la console de renvoyer l'existant.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const memeOperateur = !!shop.payout && provider.trim() === shop.payout.provider;
  // On exige aussi qu'il Y AIT un numéro à conserver. `PayoutAccount.Create` interdit
  // d'en écrire un vide, donc le cas n'est pas atteignable aujourd'hui — mais sans ce
  // test, la règle reposerait sur cette garantie distante plutôt que sur elle-même, et
  // un champ vide partirait au serveur pour revenir en 400.
  const numeroConserve =
    memeOperateur &&
    accountNumber.trim().length === 0 &&
    (shop.payout?.accountNumber ?? "").trim().length > 0;

  const valid =
    provider.trim() && accountName.trim() && (accountNumber.trim() || numeroConserve);

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Compte de versement</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {shop.payout ? "Modifier" : "Renseigner"}
          </Button>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          {shop.payout ? (
            <>
            {/* UN COMPTE ENREGISTRÉ N'EST PAS FORCÉMENT UN COMPTE PAYABLE.
                Le serveur accepte Wave et le compte bancaire ici, et les refuse au
                retrait. Sans cette ligne, la carte affiche un compte d'apparence
                parfaite et l'échec ne se découvre qu'au premier retrait — au moment où
                le vendeur a besoin de son argent, pas avant. */}
            {!isPayableProvider(shop.payout.provider) && (
              <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p>
                  <strong>Ce compte ne peut pas recevoir de versement.</strong> Seuls MTN MoMo,
                  Moov Money et Celtiis Cash sont reversés aujourd&apos;hui. Vos demandes de
                  retrait seront refusées tant que ce compte n&apos;est pas remplacé.
                </p>
              </div>
            )}
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Opérateur</dt>
                <dd className="mt-0.5">{statusLabel(shop.payout.provider, "payoutProvider")}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Numéro</dt>
                {/* Masqué : ce numéro n'a aucune raison d'être lisible en entier sur un
                    écran qu'on consulte au comptoir. Le versement, lui, est automatique. */}
                <dd className="mt-0.5 font-mono text-xs">{maskAccount(shop.payout.accountNumber)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Titulaire</dt>
                <dd className="mt-0.5">{shop.payout.accountName}</dd>
              </div>
            </dl>
            </>
          ) : (
            <div className="flex items-start gap-2.5 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <p className="text-muted-foreground">
                Aucun compte renseigné. <strong>Vos retraits ne pourront pas être versés</strong>{" "}
                tant que ce compte manque.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onClose={() => {
          if (save.isPending) return;
          reset();
          setOpen(false);
        }}
        title="Compte de versement"
        description="C'est sur ce compte que vos retraits seront versés."
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                reset();
                setOpen(false);
              }}
              disabled={save.isPending}
            >
              Annuler
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={versementSuspendu || save.isPending || !valid}
            >
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {versementSuspendu && (
            <ReadOnlyNote>
              Votre boutique est suspendue : son compte de reversement ne peut pas être modifié
              tant que la mesure court. Les sommes déjà gagnées ne sont pas perdues, elles
              attendent la décision.
            </ReadOnlyNote>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="prov">Opérateur</Label>
            <select
              id="prov"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              autoFocus
            >
              <option value="">— Choisir —</option>
              {PAYOUT_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {statusLabel(p, "payoutProvider")}
                </option>
              ))}
              {/* LE CANAL DÉJÀ ENREGISTRÉ GARDE SON ENTRÉE, MÊME S'IL N'EST PLUS
                  PROPOSÉ. Un `select` n'affiche RIEN quand sa valeur ne figure pas
                  parmi ses options : le vendeur qui a enregistré Wave verrait un champ
                  vide, croirait son compte perdu, et ne comprendrait pas pourquoi. On
                  le montre, nommé et marqué, pour qu'il soit remplaçable plutôt
                  qu'escamoté. */}
              {provider && !PAYOUT_PROVIDERS.some((p) => p === provider) && (
                <option value={provider}>
                  {statusLabel(provider, "payoutProvider")} — versement indisponible
                </option>
              )}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="num">Numéro de compte</Label>
            <Input
              id="num"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder={shop.payout ? "Saisissez à nouveau le numéro complet" : ""}
            />
            {shop.payout && (
              // CHOIX délibéré, pas une contrainte technique : `PayoutAccountSummary`
              // porte bien `accountNumber` en clair, on pourrait pré-remplir. On ne le
              // fait pas — retaper un numéro de versement est la dernière occasion de
              // s'apercevoir qu'on s'est trompé de compte, et un versement mal adressé
              // n'est pas récupérable par la plateforme.
              <p className="text-xs text-muted-foreground">
                {memeOperateur && (shop.payout.accountNumber ?? "").trim().length > 0
                  ? `Laissez ce champ vide pour conserver le numéro actuel (${maskAccount(shop.payout.accountNumber)}) — utile si vous ne corrigez que le titulaire. `
                  : `Numéro actuel : ${maskAccount(shop.payout.accountNumber)}. `}
                Il n&apos;est volontairement pas pré-rempli : le retaper est la dernière occasion
                de s&apos;apercevoir qu&apos;on s&apos;est trompé de compte.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="holder">Nom du titulaire</Label>
            <Input id="holder" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
          </div>
          <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            Vérifiez le numéro : un versement envoyé au mauvais compte n&apos;est pas récupérable
            par la plateforme.
          </p>
        </div>
      </Dialog>
    </>
  );
}

/**
 * ═════════════════════════════════════════════════════════════════════════════════
 * CE QU'ON ANNONCE APRÈS UN DÉPÔT DE PIÈCE DÉPEND DU STATUT D'AVANT.
 *
 * Le message était fixe : « Votre dossier repasse en vérification. » Il contredisait,
 * à quatre-vingt-dix lignes de distance, le paragraphe de cette même carte qui dit —
 * à juste titre — que sur une boutique déjà vérifiée un ajout n'interrompt rien.
 *
 * `Seller.AddKybDocument` ne repasse en revue QUE depuis « non commencé » ou
 * « refusé ». Sur une boutique vérifiée, la pièce est enregistrée et le statut ne
 * bouge pas ; sur un dossier déjà en examen, elle rejoint simplement la pile.
 * ═════════════════════════════════════════════════════════════════════════════════
 */
function messageAjoutPiece(statutAvant: string | null | undefined): string {
  switch ((statutAvant ?? "").toLowerCase()) {
    case "notstarted":
    case "rejected":
      return "Pièce ajoutée. Votre dossier repasse en vérification.";
    case "inreview":
      return "Pièce ajoutée au dossier, déjà en cours d'examen.";
    case "verified":
      return "Pièce ajoutée. La vérification de votre boutique reste acquise.";
    default:
      return "Pièce ajoutée à votre dossier.";
  }
}

/** Pièces justificatives KYB. */
function KybCard({ shop, onChanged }: { shop: SellerShop; onChanged: () => Promise<unknown> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<string>(KYB_TYPES[0]);
  const [toDelete, setToDelete] = useState<KybDocument | null>(null);
  const docs = shop.kybDocuments ?? [];

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("type", type);
      return bff<{ documentId: string; url: string }>("/seller/shop/kyb-documents/upload", {
        method: "POST",
        body: form,
      });
    },
    // Le statut d'AVANT l'envoi décide de ce qu'on annonce. Le lire dans `onSuccess`
    // donnerait celui d'après l'invalidation, c'est-à-dire pas toujours le bon.
    onMutate: () => ({ statutAvant: shop.kybStatus }),
    onSuccess: async (_data, _file, ctx) => {
      await onChanged();
      toastSuccess(messageAjoutPiece(ctx?.statutAvant));
    },
    meta: {
      // Message émis à la main juste au-dessus : il dépend du statut, et `meta` ne
      // porte qu'une chaîne fixe.
      successMessage: "",
      errorMessage: "La pièce n'a pas pu être téléversée.",
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => bff(`/seller/shop/kyb-documents/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await onChanged();
      setToDelete(null);
    },
    meta: { successMessage: "Pièce supprimée.", errorMessage: "La pièce n'a pas pu être supprimée." },
  });

  const [link, setLink] = useState<{ doc: KybDocument; url: string } | null>(null);

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * TÉLÉCHARGEMENT : DEUX CLICS ET UNE FENÊTRE POUR UN FICHIER QU'ON A SOI-MÊME DÉPOSÉ.
   *
   * Le serveur renvoie une URL PRÉSIGNÉE temporaire, il ne sert pas le fichier
   * lui-même. On demande donc cette URL — jamais `fileUrl` du document, qui pointe un
   * stockage privé et répondrait 403.
   *
   * LE PROBLÈME EST RÉEL, LA PARADE ÉTAIT TROP CHÈRE. `window.open` appelé APRÈS un
   * `await` n'est plus rattaché au clic : les bloqueurs de fenêtres l'arrêtent, et le
   * vendeur voit un bouton qui ne fait rien. D'où l'ancienne solution — un dialogue
   * portant un lien à cliquer — qui coûtait un second clic et une fenêtre à fermer,
   * à chaque consultation.
   *
   * ON OUVRE L'ONGLET PENDANT LE CLIC, ET ON LE REMPLIT APRÈS. `window.open("")`
   * synchrone reste rattaché au geste de l'utilisateur, donc passe les bloqueurs ; on
   * pose l'URL dessus quand elle arrive. Si le navigateur a quand même refusé
   * (`null`), on retombe sur le dialogue : la parade reste, elle n'est simplement plus
   * le chemin normal.
   *
   * PAS DE `noopener` DANS LES OPTIONS, ET C'EST LE PIÈGE QUI A COÛTÉ UNE PREMIÈRE
   * VERSION. La spécification HTML est explicite : quand `noopener` est demandé,
   * `window.open` rend `null` — c'est le principe même, l'appelant ne DOIT pas garder
   * de prise sur la fenêtre ouverte. En le passant, on obtenait donc toujours `null`,
   * le repli sur le dialogue devenait le seul chemin, et l'onglet blanc restait ouvert
   * par-dessus : deux clics, un dialogue, ET un onglet à fermer. Pire qu'avant.
   *
   * La protection contre le « reverse tabnabbing » est obtenue autrement : on efface
   * `opener` sur la fenêtre encore vierge, avant de la faire naviguer. La page cible
   * n'a alors aucune prise sur celle-ci.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  /**
   * L'onglet ouvert ET LA PIÈCE POUR LAQUELLE il l'a été.
   *
   * Garder la seule fenêtre ne suffisait pas : deux clics rapprochés sur DEUX pièces
   * différentes laissent les deux requêtes en vol, et `useMutation` exécute les deux
   * `onSuccess`. Celui de la première trouvait alors l'onglet de la SECONDE et y
   * affichait la première pièce ; la seconde, ne trouvant plus d'onglet, ouvrait le
   * dialogue par-dessus. Le vendeur avait cliqué B et obtenait A, plus une fenêtre.
   */
  const onglet = useRef<{ id: string; win: Window | null } | null>(null);

  const download = useMutation({
    mutationFn: (id: string) => bff<{ url: string }>(`/seller/shop/kyb-documents/${id}/download`),
    onSuccess: (data, id) => {
      // Réponse d'une demande abandonnée : le vendeur a cliqué autre chose depuis. On
      // ne touche ni à l'onglet courant, qui appartient à la demande en cours, ni à
      // l'écran.
      if (onglet.current !== null && onglet.current.id !== id) return;

      const win = onglet.current?.win ?? null;
      onglet.current = null;

      const url = (data as { url?: string })?.url;
      const doc = docs.find((d) => d.id === id);
      if (!url || !doc) {
        win?.close();
        // `successMessage: ""` rend cette mutation muette : sans ce toast, l'onglet
        // s'ouvrait, se refermait, et le bouton passait pour mort.
        toastError("Le document n'a pas pu être ouvert. Réessayez dans un instant.");
        return;
      }

      if (win && !win.closed) {
        win.location.replace(url);
        return;
      }

      // Onglet refusé par le navigateur, ou refermé entre-temps : le dialogue reprend
      // la main, avec le lien et l'avertissement sur l'expiration.
      setLink({ doc, url });
    },
    onError: (_e, id) => {
      if (onglet.current !== null && onglet.current.id !== id) return;
      // On ne laisse pas un onglet vide ouvert derrière une erreur.
      onglet.current?.win?.close();
      onglet.current = null;
    },
    meta: { successMessage: "", errorMessage: "Le lien de téléchargement n'a pas pu être obtenu." },
  });

  /** Ouvre l'onglet DANS le geste de clic, puis demande l'URL. L'ordre compte. */
  function ouvrirPiece(id: string) {
    // Un clic sur une AUTRE pièce pendant qu'une demande est en vol laisserait le
    // premier onglet blanc derrière lui : on le referme avant d'en ouvrir un second.
    const precedent = onglet.current?.win;
    if (precedent && !precedent.closed) precedent.close();

    const fenetre = window.open("", "_blank");
    // On coupe le lien vers cette page avant toute navigation — ce que `noopener`
    // aurait fait, au prix de la référence elle-même. La fenêtre est encore
    // `about:blank`, donc de notre origine : l'écriture est permise, et le
    // « désaveu » qu'elle pose survit à la navigation vers l'URL présignée.
    if (fenetre) fenetre.opener = null;

    onglet.current = { id, win: fenetre };
    download.mutate(id);
  }

  return (
    <>
      <Card id="kyb">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pièces justificatives (KYB)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-5 pt-0">
          {/* ═══════════════════════════════════════════════════════════════════════
              LE MOTIF DU REFUS, LÀ OÙ TROIS ÉCRANS PROMETTAIENT DE LE TROUVER.

              Le bandeau KYB envoie le vendeur ici pour lire « les motifs », et cette
              carte ne les affichait pas : `kybRejectionReason` était servi par
              `/seller/shop` et lu nulle part. Le vendeur re-téléversait donc la pièce
              refusée sans savoir ce qu'on lui reprochait — exactement ce que le domaine
              redoute en commentaire de `RejectKyb`.
              ═══════════════════════════════════════════════════════════════════════ */}
          {shop.kybRejectionReason?.trim() && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p className="min-w-0 break-words">
                <strong>Motif du refus :</strong> {shop.kybRejectionReason.trim()}
              </p>
            </div>
          )}

          {/* CETTE PHRASE DISAIT « ajouter ou retirer une pièce remet votre dossier en
              vérification ». Faux dans les deux sens : `Seller.AddKybDocument` ne
              repasse en revue QUE depuis « non commencé » ou « refusé », et
              `RemoveKybDocument` ne touche pas au statut du tout — son propre code le
              dit en commentaire. Un vendeur déjà vérifié renonçait à corriger son
              dossier de peur de perdre sa vérification. */}
          <p className="text-xs text-muted-foreground">
            Le statut affiché est celui de la boutique entière — les pièces ne sont pas examinées
            une par une. Déposer une première pièce, ou en redéposer après un refus, remet le
            dossier en vérification ; sur une boutique déjà vérifiée, un ajout n&apos;interrompt
            rien.
          </p>

          {/* ═══════════════════════════════════════════════════════════════════════
              LE RECOURS, DIT UNE SEULE FOIS ET SEULEMENT QUAND IL SERT.

              Première rédaction : « déposez la nouvelle version, elle remplacera
              l'ancienne à l'examen ». Fausse deux fois. `AddKybDocument` AJOUTE — il
              ne cherche même pas une pièce du même type — et la périmée reste dans la
              liste, par construction : le domaine écrit qu'elle « reste consultable,
              ce qui est précisément l'intérêt d'un dossier de conformité ». Et sur une
              boutique déjà vérifiée, aucun examen n'est déclenché : le statut ne bouge
              pas, aucun événement n'est levé.

              Seconde rédaction, fausse aussi : « c'est la plus récente qui fait foi ».
              Rien ne le dit — `ApproveKyb` re-tamponne TOUTES les pièces comme
              validées, la projection ne porte aucune notion de récence, et
              l'administration approuve la boutique, jamais une pièce. On s'en tient
              donc à ce qui est observable : les deux restent dans le dossier, et c'est
              la plateforme qui tranche.
              ═══════════════════════════════════════════════════════════════════════ */}
          {docs.some((d) => d.verifiedAtUtc) && (
            <p className="text-xs text-muted-foreground">
              Une pièce déjà validée ne peut plus être retirée : elle fait partie de votre dossier
              de conformité et doit y rester. Si elle a changé — carte renouvelée, adresse
              différente — <strong>déposez la nouvelle version</strong> ci-dessous. Les deux
              resteront dans la liste, avec leur date de dépôt : c&apos;est la plateforme qui
              décide laquelle retenir lors du prochain examen.
            </p>
          )}

          {docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune pièce déposée.</p>
          ) : (
            <div className="space-y-1.5">
              {docs.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {statusLabel(d.type, "kybDocumentType")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      déposée le {formatDateTime(d.uploadedAtUtc)}
                      {d.verifiedAtUtc && (
                        // On dit POURQUOI la corbeille a disparu. Un bouton qui
                        // s'évapore sans un mot se lit comme un bogue d'affichage, et
                        // le vendeur va le chercher ailleurs.
                        <> · validée — <span className="whitespace-nowrap">non supprimable</span></>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant={kybTone(d.status)}>{statusLabel(d.status, "kybStatus")}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => ouvrirPiece(d.id)}
                      disabled={download.isPending && download.variables === d.id}
                      aria-label="Télécharger"
                    >
                      <Download className="size-4" />
                    </Button>
                    {/* ═══════════════════════════════════════════════════════════
                        UNE PIÈCE VALIDÉE NE SE SUPPRIME PAS, ET LA CORBEILLE ÉTAIT
                        PROPOSÉE SUR TOUTES.

                        `Seller.RemoveKybDocument` refuse en 409 toute pièce portant
                        `VerifiedAtUtc` : elle fait partie du dossier de conformité.
                        Sur une boutique fraîchement vérifiée, c'est le cas de TOUTES
                        les pièces — `ApproveKyb` les marque toutes — et le vendeur
                        cliquait la corbeille, lisait un avertissement alarmant,
                        confirmait, et récoltait un refus, à chaque fois. Une pièce
                        déposée APRÈS la validation, elle, reste supprimable : c'est
                        bien le champ qu'on lit, pas le statut de la boutique.

                        Le champ arrivait pourtant dans la réponse depuis toujours ;
                        cet écran ne le lisait simplement pas.
                        ═══════════════════════════════════════════════════════════ */}
                    {!d.verifiedAtUtc && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => setToDelete(d)}
                        aria-label="Supprimer"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="kybType">Type de pièce</Label>
              <select
                id="kybType"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {KYB_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {statusLabel(t, "kybDocumentType")}
                  </option>
                ))}
              </select>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) upload.mutate(f);
              }}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              Téléverser
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={toDelete !== null}
        onClose={() => !remove.isPending && setToDelete(null)}
        title="Supprimer cette pièce ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setToDelete(null)} disabled={remove.isPending}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={() => toDelete && remove.mutate(toDelete.id)}
              disabled={remove.isPending}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" />}
              Supprimer
            </Button>
          </>
        }
      >
        {toDelete && (
          // CE TEXTE ANNONÇAIT UNE PERTE DE VÉRIFICATION QUI N'ARRIVE PAS.
          // `RemoveKybDocument` n'écrit jamais `KybStatus` — son propre code le dit :
          // « Le retrait ne change pas le statut KYB de la boutique ». La peur était
          // dissuasive : on renonçait à retirer un justificatif déposé par erreur. Et
          // depuis que la corbeille ne s'affiche plus sur une pièce validée, le seul
          // cas encore atteignable est celui où la phrase mentait le plus fort — une
          // pièce ajoutée après validation, sur une boutique qui reste vérifiée.
          <p className="text-sm">
            <strong>{statusLabel(toDelete.type, "kybDocumentType")}</strong> sera retirée de votre
            dossier. Le statut de vérification de votre boutique n&apos;en est pas affecté ; seule
            la pièce disparaît.
          </p>
        )}
      </Dialog>

      <Dialog
        open={link !== null}
        onClose={() => setLink(null)}
        title="Télécharger la pièce"
        footer={
          <Button variant="ghost" onClick={() => setLink(null)}>
            Fermer
          </Button>
        }
      >
        {link && (
          <div className="space-y-3">
            <p className="text-sm">
              {statusLabel(link.doc.type, "kybDocumentType")} — déposée le{" "}
              {formatDateTime(link.doc.uploadedAtUtc)}.
            </p>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="nm-button inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              <Download className="size-4" /> Ouvrir le document
            </a>
            <p className="text-xs text-muted-foreground">
              Ce lien est temporaire et personnel : il expire au bout de quelques minutes. Ne le
              transmettez pas.
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
