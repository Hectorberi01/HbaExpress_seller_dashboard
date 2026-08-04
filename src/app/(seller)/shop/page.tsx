"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/lib/api";
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
import { AlertTriangle, Download, ImageOff, Loader2, Star, Trash2, Upload } from "lucide-react";

/** Types de pièce acceptés par le domaine (`KybDocumentType`). */
const KYB_TYPES = ["IdCard", "BusinessRegistry", "TaxId", "ProofOfAddress"] as const;

/**
 * Canaux de reversement acceptés (`PayoutProvider`).
 *
 * Liste FERMÉE : le serveur fait `Enum.TryParse` et rejette tout le reste. Un champ
 * libre laissait le vendeur saisir « MTN MoMo » — avec une espace — et recevoir un 400
 * sur l'écran qui décide où part son argent.
 */
const PAYOUT_PROVIDERS = ["MtnMomo", "MoovMoney", "Wave", "BankAccount", "Celtis"] as const;

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
            disabled={upload.isPending}
          >
            {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Logo
          </Button>
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
          <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty || !name.trim()}>
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
          accountNumber: accountNumber.trim(),
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

  const valid = provider.trim() && accountNumber.trim() && accountName.trim();

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
            <Button onClick={() => save.mutate()} disabled={save.isPending || !valid}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="space-y-3">
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
                Le numéro actuel ({maskAccount(shop.payout.accountNumber)}) n&apos;est
                volontairement pas pré-rempli : saisissez-le en entier, même si vous ne changez
                que le titulaire.
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
    onSuccess: () => onChanged(),
    meta: {
      successMessage: "Pièce ajoutée. Votre dossier repasse en vérification.",
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
   * Téléchargement : le serveur renvoie une URL PRÉSIGNÉE temporaire, il ne sert pas le
   * fichier lui-même. On demande cette URL, et jamais `fileUrl` du document — qui pointe
   * un stockage privé et répondrait 403.
   *
   * ⚠️ On AFFICHE le lien au lieu d'ouvrir un onglet. `window.open` appelé après un
   * `await` n'est plus rattaché au clic de l'utilisateur : les bloqueurs de fenêtres
   * l'arrêtent, et le vendeur voit un bouton qui ne fait rien. Un lien qu'il clique
   * lui-même passe toujours, et permet au passage de dire que l'URL expire.
   */
  const download = useMutation({
    mutationFn: (id: string) => bff<{ url: string }>(`/seller/shop/kyb-documents/${id}/download`),
    onSuccess: (data, id) => {
      const url = (data as { url?: string })?.url;
      const doc = docs.find((d) => d.id === id);
      if (url && doc) setLink({ doc, url });
    },
    meta: { successMessage: "", errorMessage: "Le lien de téléchargement n'a pas pu être obtenu." },
  });

  return (
    <>
      <Card id="kyb">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pièces justificatives (KYB)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-5 pt-0">
          <p className="text-xs text-muted-foreground">
            Ajouter ou retirer une pièce <strong>remet votre dossier en vérification</strong>. Le
            statut affiché est celui de la boutique entière — les pièces ne sont pas examinées une
            par une.
          </p>

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
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant={kybTone(d.status)}>{statusLabel(d.status, "kybStatus")}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => download.mutate(d.id)}
                      disabled={download.isPending && download.variables === d.id}
                      aria-label="Télécharger"
                    >
                      <Download className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setToDelete(d)}
                      aria-label="Supprimer"
                    >
                      <Trash2 className="size-4" />
                    </Button>
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
          <p className="text-sm">
            <strong>{statusLabel(toDelete.type, "kybDocumentType")}</strong> sera retirée de votre
            dossier, qui <strong>repassera en vérification</strong>. Si votre boutique était
            vérifiée, elle ne le sera plus tant que la plateforme n&apos;aura pas réexaminé le
            dossier.
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
