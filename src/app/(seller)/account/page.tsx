"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiLogout, bff } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { accountTone, statusLabel } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { isCompletePhone, toLocalPhone, toStoredPhone } from "@/lib/phone";
import { QueryError } from "@/components/query-error";
import { PageNote } from "@/components/page-note";
import type { MfaSetup, SellerAccount, SellerShop } from "@/types/seller";
import { AlertTriangle, BadgeCheck, KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";

export default function AccountPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["seller-account"],
    queryFn: () => bff<SellerAccount>("/seller/account/me"),
  });
  const me = q.data;
  const invalidate = () => qc.invalidateQueries({ queryKey: ["seller-account"] });

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Mon compte</h1>
        <p className="text-sm text-muted-foreground">
          Vos informations personnelles et la sécurité de votre accès.
        </p>
      </header>

      <PageNote>
        Ce compte est <strong>distinct de votre boutique</strong> : le modifier ne change pas votre
        profil public. Pour le nom, le logo ou la description vus par les acheteurs, allez dans
        « Ma boutique ».
      </PageNote>

      <QueryError of={q} />

      {q.isLoading ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">Chargement…</Card>
      ) : q.isError || !me ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          Compte non chargé — voir le message ci-dessus.
        </Card>
      ) : (
        <div className="space-y-6">
          <IdentityCard me={me} onChanged={invalidate} />
          <PasswordCard />
          <MfaCard me={me} onChanged={invalidate} />
          <DangerCard me={me} onChanged={invalidate} />
        </div>
      )}
    </div>
  );
}

function IdentityCard({ me, onChanged }: { me: SellerAccount; onChanged: () => Promise<unknown> }) {
  const [form, setForm] = useState({
    firstName: me.firstName,
    lastName: me.lastName,
    // Partie LOCALE : l'indicatif est ajouté à l'envoi, pas saisi.
    phoneNumber: toLocalPhone(me.phoneNumber),
  });

  useEffect(() => {
    setForm({ firstName: me.firstName, lastName: me.lastName, phoneNumber: toLocalPhone(me.phoneNumber) });
  }, [me.firstName, me.lastName, me.phoneNumber]);

  const save = useMutation({
    mutationFn: () =>
      bff("/seller/account/me", {
        method: "PUT",
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phoneNumber: toStoredPhone(form.phoneNumber),
        }),
      }),
    onSuccess: () => onChanged(),
    meta: { successMessage: "Profil enregistré.", errorMessage: "Le profil n'a pas pu être enregistré." },
  });

  const dirty =
    form.firstName.trim() !== me.firstName ||
    form.lastName.trim() !== me.lastName ||
    form.phoneNumber !== toLocalPhone(me.phoneNumber);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Identité</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-5 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={accountTone(me.status)}>{statusLabel(me.status, "accountStatus")}</Badge>
          {me.emailVerified ? (
            <Badge variant="success">
              <BadgeCheck className="mr-1 size-3" /> E-mail vérifié
            </Badge>
          ) : (
            <Badge variant="warning">E-mail non vérifié</Badge>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fn">Prénom</Label>
            <Input id="fn" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ln">Nom</Label>
            <Input id="ln" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ph">Téléphone</Label>
            <PhoneInput
              id="ph"
              value={form.phoneNumber}
              onChange={(local) => setForm({ ...form, phoneNumber: local })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="em">E-mail</Label>
            {/* En lecture seule : aucune route ne permet de changer l'adresse, et un
                champ modifiable qu'on ne peut pas enregistrer ment à l'utilisateur. */}
            <Input id="em" value={me.email} disabled />
            <p className="text-xs text-muted-foreground">
              L&apos;adresse ne se change pas depuis cette console — contactez le support.
            </p>
          </div>
        </div>

        {me.acceptedTermsVersion && (
          <p className="text-xs text-muted-foreground">
            Conditions acceptées : version {me.acceptedTermsVersion}
            {me.acceptedTermsOnUtc ? ` le ${formatDateTime(me.acceptedTermsOnUtc)}` : ""}.
          </p>
        )}

        <div className="flex justify-end">
          <Button
            onClick={() => save.mutate()}
            disabled={
              save.isPending ||
              !dirty ||
              !form.firstName.trim() ||
              !form.lastName.trim() ||
              // Le champ est facultatif côté serveur, mais s'il est renseigné il
              // doit l'être complètement : un numéro tronqué ne vaut pas mieux
              // qu'un numéro absent, et se remarque beaucoup moins.
              (form.phoneNumber.length > 0 && !isCompletePhone(form.phoneNumber))
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

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const change = useMutation({
    mutationFn: () =>
      bff("/seller/account/me/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      }),
    onSuccess: async () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      // `User.ChangePassword` révoque TOUS les refresh tokens. La session courante ne
      // survivrait donc que le temps du jeton d'accès, puis retomberait au login sans
      // explication, au milieu d'une autre tâche. On sort tout de suite, en l'ayant dit.
      await apiLogout();
      window.location.replace("/login");
    },
    meta: {
      successMessage: "Mot de passe modifié. Reconnectez-vous.",
      errorMessage: "Le mot de passe n'a pas pu être modifié.",
    },
  });

  const mismatch = confirm.length > 0 && next !== confirm;
  const valid = current.length > 0 && next.length >= 8 && next === confirm;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Mot de passe</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-5 pt-0">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="cur">Mot de passe actuel</Label>
            <Input
              id="cur"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new">Nouveau</Label>
            <Input
              id="new"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cfm">Confirmation</Label>
            <Input
              id="cfm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
        {/* La confirmation est vérifiée ICI, pas par le serveur : il ne reçoit qu'un
            seul mot de passe. Sans ce contrôle, une faute de frappe devient un mot de
            passe qu'on ne connaît pas. */}
        {mismatch && <p className="text-xs text-destructive">Les deux saisies ne correspondent pas.</p>}
        {next.length > 0 && next.length < 8 && (
          <p className="text-xs text-muted-foreground">8 caractères minimum.</p>
        )}
        <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          Changer votre mot de passe déconnecte <strong>toutes vos sessions</strong>, y compris
          celle-ci et l&apos;application mobile. Vous devrez vous reconnecter.
        </p>
        <div className="flex justify-end">
          <Button onClick={() => change.mutate()} disabled={change.isPending || !valid}>
            {change.isPending && <Loader2 className="size-4 animate-spin" />}
            <KeyRound className="size-4" /> Changer le mot de passe
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MfaCard({ me, onChanged }: { me: SellerAccount; onChanged: () => Promise<unknown> }) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<MfaSetup | null>(null);

  const begin = useMutation({
    mutationFn: () => bff<MfaSetup>("/seller/account/me/mfa/setup", { method: "POST" }),
    onSuccess: (data) => {
      setSetup(data as MfaSetup);
      setSetupOpen(true);
    },
    meta: { successMessage: "", errorMessage: "L'activation n'a pas pu être démarrée." },
  });

  const confirm = useMutation({
    mutationFn: () =>
      bff("/seller/account/me/mfa/confirm", { method: "POST", body: JSON.stringify({ code: code.trim() }) }),
    onSuccess: async () => {
      await onChanged();
      setSetupOpen(false);
      setSetup(null);
      setCode("");
    },
    meta: {
      successMessage: "Double authentification activée.",
      errorMessage: "Code invalide — vérifiez l'heure de votre téléphone.",
    },
  });

  const disable = useMutation({
    mutationFn: () =>
      bff("/seller/account/me/mfa/disable", { method: "POST", body: JSON.stringify({ code: code.trim() }) }),
    onSuccess: async () => {
      await onChanged();
      setDisableOpen(false);
      setCode("");
    },
    meta: {
      successMessage: "Double authentification désactivée.",
      errorMessage: "Code invalide.",
    },
  });

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Double authentification</CardTitle>
          {me.mfaEnabled ? (
            <Badge variant="success">
              <ShieldCheck className="mr-1 size-3" /> Activée
            </Badge>
          ) : (
            <Badge variant="neutral">Désactivée</Badge>
          )}
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <p className="mb-3 text-sm text-muted-foreground">
            Un code à six chiffres, généré par une application d&apos;authentification, s&apos;ajoute
            à votre mot de passe. C&apos;est la protection la plus efficace pour un compte qui donne
            accès à de l&apos;argent.
          </p>
          {me.mfaEnabled ? (
            <Button
              variant="outline"
              onClick={() => {
                setCode("");
                setDisableOpen(true);
              }}
            >
              Désactiver
            </Button>
          ) : (
            <Button onClick={() => begin.mutate()} disabled={begin.isPending}>
              {begin.isPending && <Loader2 className="size-4 animate-spin" />}
              Activer
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={setupOpen}
        onClose={() => {
          if (confirm.isPending) return;
          setSetupOpen(false);
          setSetup(null);
          setCode("");
        }}
        title="Activer la double authentification"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setSetupOpen(false);
                setSetup(null);
                setCode("");
              }}
              disabled={confirm.isPending}
            >
              Annuler
            </Button>
            <Button onClick={() => confirm.mutate()} disabled={confirm.isPending || code.trim().length < 6}>
              {confirm.isPending && <Loader2 className="size-4 animate-spin" />}
              Confirmer
            </Button>
          </>
        }
      >
        {setup && (
          <div className="space-y-3">
            <p className="text-sm">
              Ajoutez ce compte à votre application d&apos;authentification, puis saisissez le code
              affiché.
            </p>
            <div className="space-y-1.5">
              <Label>Clé de configuration</Label>
              {/* Pas de QR code : générer une image demanderait une dépendance de plus.
                  La clé se saisit à la main dans toutes les applications courantes. */}
              <div className="select-all break-all rounded-lg bg-muted/50 p-3 font-mono text-sm">
                {setup.secret}
              </div>
              <p className="text-xs text-muted-foreground">
                Saisissez cette clé dans Google Authenticator, Authy ou équivalent.
              </p>
              {/* Sur mobile, ce lien ouvre directement l'application d'authentification
                  et remplit tout. Sur ordinateur il ne fait rien : on ne le présente
                  donc pas comme la voie principale. */}
              <a href={setup.otpAuthUri} className="text-xs text-primary hover:underline">
                Ouvrir dans mon application d&apos;authentification
              </a>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mfa">Code à six chiffres</Label>
              <Input
                id="mfa"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                autoFocus
              />
            </div>
            <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              Conservez cette clé hors de votre téléphone. Sans elle et sans votre application,
              vous ne pourrez plus vous connecter sans passer par le support.
              {/* Relancer « Activer » régénère un secret et invalide celui-ci : mieux
                  vaut le dire ici que laisser une entrée morte dans l'application. */}{" "}
              Si vous fermez cette fenêtre sans confirmer, cette clé sera remplacée à la
              prochaine tentative — supprimez alors l&apos;entrée de votre application.
            </p>
          </div>
        )}
      </Dialog>

      <Dialog
        open={disableOpen}
        onClose={() => !disable.isPending && setDisableOpen(false)}
        title="Désactiver la double authentification ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDisableOpen(false)} disabled={disable.isPending}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={() => disable.mutate()}
              disabled={disable.isPending || code.trim().length < 6}
            >
              {disable.isPending && <Loader2 className="size-4 animate-spin" />}
              Désactiver
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm">
            Votre compte ne sera plus protégé que par son mot de passe. Saisissez un code de votre
            application pour confirmer que c&apos;est bien vous.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="mfaOff">Code à six chiffres</Label>
            <Input
              id="mfaOff"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}

/** Fermeture de boutique, réactivation, suppression définitive. */
function DangerCard({ me, onChanged }: { me: SellerAccount; onChanged: () => Promise<unknown> }) {
  const qc = useQueryClient();
  const [closeOpen, setCloseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [password, setPassword] = useState("");

  // ───────────────────────────────────────────────────────────────────────────────
  // LE STATUT DE LA BOUTIQUE NE SE LIT PAS SUR LE COMPTE.
  //
  // `SellerAccountMe.Status` est un `UserStatus` (PendingVerification | Active |
  // Suspended | Deleted) ; « Closed » n'existe QUE dans `SellerStatus`, et
  // `RequestSellerClosureCommand` ne touche que la boutique.
  //
  // Déduire la fermeture de `me.status` avait donc deux effets, tous deux bloquants :
  // après une fermeture réussie l'écran proposait encore « Fermer » (le serveur
  // répondant alors 409 « déjà fermé »), et la réactivation restait inatteignable.
  // À l'inverse, un compte suspendu par un administrateur affichait « Demander la
  // réactivation », que le serveur refuse puisque la boutique, elle, est active.
  //
  // La même clé que l'écran « Ma boutique » : la donnée est déjà en cache, cette
  // requête ne coûte rien de plus.
  // ───────────────────────────────────────────────────────────────────────────────
  const shopQ = useQuery({ queryKey: ["seller-shop"], queryFn: () => bff<SellerShop>("/seller/shop") });
  const shopStatus = shopQ.data?.status?.toLowerCase();

  const closeShop = useMutation({
    mutationFn: () => bff("/seller/account/me/close", { method: "POST" }),
    onSuccess: async () => {
      // C'est la BOUTIQUE qui change d'état, pas le compte : invalider `seller-account`
      // seul laisserait le bouton « Fermer » en place.
      await qc.invalidateQueries({ queryKey: ["seller-shop"] });
      setCloseOpen(false);
    },
    meta: {
      successMessage: "Fermeture demandée.",
      errorMessage: "La fermeture n'a pas pu être demandée.",
    },
  });

  const reactivate = useMutation({
    mutationFn: () => bff("/seller/account/me/request-reactivation", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["seller-shop"] }),
    meta: {
      successMessage: "Réactivation demandée. La plateforme examinera votre demande.",
      errorMessage: "La demande n'a pas pu être envoyée.",
    },
  });

  const remove = useMutation({
    mutationFn: () =>
      bff("/seller/account/me", { method: "DELETE", body: JSON.stringify({ password }) }),
    onSuccess: async () => {
      // ─────────────────────────────────────────────────────────────────────────
      // ON EFFACE LA SESSION AVANT DE PARTIR.
      //
      // Le serveur révoque les refresh tokens, mais le JETON D'ACCÈS déjà émis reste
      // valide une quinzaine de minutes — et le cookie de session Next, lui, dure
      // trente jours. Un simple `replace("/login")` laissait donc une session
      // parfaitement utilisable sur un compte anonymisé : revenir sur /dashboard
      // rendait la console entière, avec l'ancien nom dans la barre latérale.
      //
      // `apiLogout()` appelle /api/auth/logout, qui révoque côté BFF puis efface le
      // cookie. C'est la même porte que le bouton « Se déconnecter ».
      // ─────────────────────────────────────────────────────────────────────────
      await apiLogout();
      window.location.replace("/login");
    },
    meta: {
      successMessage: "",
      errorMessage: "Le compte n'a pas pu être supprimé.",
    },
  });

  const closed = shopStatus === "closed";
  /** Tant que le statut boutique est inconnu, on ne propose ni fermeture ni réactivation. */
  const shopKnown = shopStatus !== undefined;

  return (
    <>
      <Card className="border-destructive/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-destructive">Zone sensible</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-5 pt-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Fermer la boutique</div>
              <p className="text-xs text-muted-foreground">
                Vos produits sont retirés de la vente. Votre compte reste actif et vous pouvez
                demander une réactivation.
              </p>
            </div>
            {!shopKnown ? (
              // Ni « Fermer » ni « Réactiver » tant qu'on ignore l'état réel : proposer
              // le mauvais des deux mène droit à un 409 incompréhensible.
              <Button variant="outline" disabled>
                {shopQ.isLoading ? "Chargement…" : "État indisponible"}
              </Button>
            ) : closed ? (
              <Button variant="outline" onClick={() => reactivate.mutate()} disabled={reactivate.isPending}>
                {reactivate.isPending && <Loader2 className="size-4 animate-spin" />}
                Demander la réactivation
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setCloseOpen(true)}>
                Fermer
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border pt-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-destructive">Supprimer mon compte</div>
              <p className="text-xs text-muted-foreground">
                Irréversible. Vos données personnelles sont anonymisées.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={() => {
                setPassword("");
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="size-4" /> Supprimer
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={closeOpen}
        onClose={() => !closeShop.isPending && setCloseOpen(false)}
        title="Fermer votre boutique ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCloseOpen(false)} disabled={closeShop.isPending}>
              Annuler
            </Button>
            <Button onClick={() => closeShop.mutate()} disabled={closeShop.isPending}>
              {closeShop.isPending && <Loader2 className="size-4 animate-spin" />}
              Fermer la boutique
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Vos produits ne seront plus visibles ni achetables. Ce n&apos;est pas définitif : vous
          pourrez demander une réactivation depuis cet écran. Vos commandes en cours restent à
          honorer.
        </p>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onClose={() => !remove.isPending && setDeleteOpen(false)}
        title="Supprimer définitivement votre compte ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={remove.isPending}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={() => remove.mutate()}
              disabled={remove.isPending || password.length === 0}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" />}
              Supprimer définitivement
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">Cette action est irréversible.</p>
              <p className="text-muted-foreground">
                Vos données personnelles sont anonymisées. Les enregistrements exigés par la loi —
                factures, versements — sont conservés, détachés de votre identité.
              </p>
            </div>
          </div>
          {/* Le serveur REFUSE la suppression s'il reste des commandes en cours (409),
              avec un message qui donne le nombre exact. On ne duplique pas ce contrôle
              ici : on laisserait un chiffre périmé à l'écran. */}
          <p className="text-xs text-muted-foreground">
            La suppression sera refusée s&apos;il vous reste des commandes en cours : livrez-les ou
            annulez-les d&apos;abord, sans quoi vos acheteurs n&apos;auraient plus d&apos;interlocuteur.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="pwd">Confirmez avec votre mot de passe</Label>
            <Input
              id="pwd"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
