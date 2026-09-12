"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { isCompletePhone, toStoredPhone } from "@/lib/phone";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2, Store } from "lucide-react";

/**
 * Auto-inscription vendeur, en DEUX ÉTAPES.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════
 * CET ÉCRAN PARLAIT UN CONTRAT QUI N'EXISTE PLUS, ET PERSONNE NE POUVAIT S'INSCRIRE.
 *
 * `POST /seller/auth/register` rendait autrefois `{ userId, isNewAccount }`. L'écran
 * enchaînait dessus. Le serveur a fermé son oracle d'énumération en septembre 2026 : la
 * réponse de SUCCÈS est désormais constante — `{ registered, message,
 * requiresVerification }` — et ne dit plus rien du sort réel de la demande, qu'un compte
 * ait été créé, qu'il existât déjà ou qu'aucun e-mail n'ait été envoyé. Le commentaire du
 * serveur est explicite : « `IsNewAccount` a disparu avec `UserId` : c'était le même aveu
 * sous un autre nom. »
 *
 * Les refus qui ne révèlent RIEN sur l'existence d'un compte, eux, sont toujours relayés
 * tels quels — mot de passe trop court, adresse mal formée (`SellerRegistrationEndpoints`
 * ne muselle que les conflits de compte existant). D'où le test sur le statut : il y a
 * bien des erreurs à afficher, simplement plus aucune qui trahisse un compte.
 *
 * L'écran, lui, testait `if (!res.ok || !data.userId)`. Il basculait donc TOUJOURS dans
 * sa branche d'erreur, et comme le corps ne porte ni `detail`, ni `error`, ni `title`,
 * il affichait son repli : « Inscription impossible. » Pendant ce temps le compte était
 * réellement créé et le code à six chiffres partait par e-mail. Le commerçant restait
 * à l'étape 1, avec un compte ouvert et un code qu'aucun écran ne lui permettait de
 * saisir — et en réessayant, il relisait la même phrase.
 *
 * ───────────────────────────────────────────────────────────────────────────────────
 * CE QUI CHANGE, ET CE QUI RESTE
 *
 * Plus rien ne transite entre les deux étapes que ce que l'utilisateur a lui-même
 * saisi : l'ADRESSE. `/verify` la prend désormais à la place de l'identifiant, pour la
 * même raison anti-énumération. Un succès de `/register` est donc simplement un 2xx,
 * et le message affiché est celui du serveur — volontairement prudent, parce qu'il ne
 * promet pas un envoi dont il ne peut pas parler sans trahir l'existence du compte.
 *
 * `isNewAccount` disparaît aussi de l'écran. On ne peut plus dire « cette adresse a
 * déjà un compte » : c'est précisément ce que le serveur refuse de divulguer.
 *
 * L'ÉTAPE 2 N'EST TOUJOURS PAS TRANSACTIONNELLE côté serveur — elle enchaîne
 * vérification du code, création de la boutique, attribution du rôle et activation. Un
 * nom de boutique déjà pris fait échouer la deuxième opération alors que le code est
 * CONSOMMÉ. On garde donc l'utilisateur sur cette étape, avec son adresse, pour qu'il
 * retente un autre nom sans repartir de zéro.
 *
 * ───────────────────────────────────────────────────────────────────────────────────
 * ON PEUT ENTRER DIRECTEMENT À L'ÉTAPE 2 : `/inscription?verifier=<adresse>`
 *
 * Un compte non vérifié qui tente de se connecter reçoit du serveur : « Saisissez le
 * code reçu par e-mail, ou demandez-en un nouveau. » Cette instruction n'était
 * exécutable nulle part — le seul champ de saisie du code vivait derrière un
 * `setStep("verify")` que plus rien ne déclenchait. L'écran de connexion pointe
 * désormais ici, et cette entrée est ce qui rend le message du serveur vrai.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
export default function SellerRegisterPage() {
  const router = useRouter();

  const [step, setStep] = useState<"account" | "verify" | "done">("account");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // L'erreur de téléphone n'apparaît qu'après une tentative d'envoi : la signaler dès
  // le premier caractère reviendrait à afficher « il manque 9 chiffres » à quelqu'un
  // qui vient de commencer à taper.
  const [phoneTouched, setPhoneTouched] = useState(false);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phoneNumber: "",
    password: "",
    confirm: "",
  });

  const [code, setCode] = useState("");
  const [shopName, setShopName] = useState("");
  /** Message du serveur après `/register` ou un renvoi : on l'affiche tel quel. */
  const [avis, setAvis] = useState<string | null>(null);
  /** Secondes restantes avant qu'un nouveau renvoi soit permis. 0 = permis. */
  const [attente, setAttente] = useState(0);
  /**
   * Vrai quand on est arrivé directement à l'étape 2 par `?verifier=`.
   *
   * C'est le seul cas où l'adresse doit rester modifiable : elle vient de l'URL et non
   * d'une saisie qu'on vient de faire. Dans le parcours normal, la changer ici ferait
   * vérifier le code contre une adresse à laquelle il n'a pas été envoyé.
   */
  const [entreeDirecte, setEntreeDirecte] = useState(false);

  // ───────────────────────────────────────────────────────────────────────────────
  // ENTRÉE DIRECTE À L'ÉTAPE 2 DEPUIS LA CONNEXION.
  //
  // `window.location.search` plutôt que `useSearchParams()` : ce dernier force la page
  // en rendu dynamique ou exige une frontière Suspense, pour lire une valeur dont on
  // n'a besoin qu'au montage. L'écran de connexion lit déjà son `?redirect=` de cette
  // façon — autant garder un seul procédé dans le dépôt.
  // ───────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const aVerifier = new URLSearchParams(window.location.search).get("verifier");
    if (!aVerifier) return;
    setForm((f) => ({ ...f, email: aVerifier }));
    setEntreeDirecte(true);
    setStep("verify");
  }, []);

  // Décompte du délai de renvoi. Le serveur impose une minute entre deux envois et
  // rend `retryAfterSeconds` constant précisément pour qu'on puisse désactiver le
  // bouton — ce qui supprime le geste dans le vide au lieu de l'expliquer après coup.
  useEffect(() => {
    if (attente <= 0) return;
    const t = setTimeout(() => setAttente((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [attente]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submitAccount(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Vérifié ICI : le serveur ne reçoit qu'un seul mot de passe, il ne peut pas
    // contrôler la confirmation. Sans cela, une faute de frappe crée un compte dont
    // personne ne connaît le mot de passe.
    if (form.password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (form.password !== form.confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    // Dix chiffres exigés ICI, alors que le serveur en accepte huit à quinze : ce
    // numéro sert au SMS et au Mobile Money, un chiffre manquant est un versement qui
    // n'arrive pas.
    if (!isCompletePhone(form.phoneNumber)) {
      setPhoneTouched(true);
      setError("Le téléphone doit comporter 10 chiffres après +229.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          // Reconstitué avec l'indicatif : le champ ne contient que la partie locale.
          phoneNumber: toStoredPhone(form.phoneNumber),
          password: form.password,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        detail?: string;
        title?: string;
        error?: string;
      };

      // ON NE TESTE PLUS QUE LE STATUT. La réponse de succès est constante et ne porte
      // aucun identifiant : exiger un `userId` faisait basculer CHAQUE inscription
      // réussie dans la branche d'erreur. Voir l'en-tête de ce fichier.
      if (!res.ok) {
        setError(data.detail ?? data.error ?? data.title ?? "Inscription impossible.");
        return;
      }

      // Le message du serveur, tel quel. Il est volontairement prudent — « si cette
      // adresse peut ouvrir une boutique, un code vient d'être envoyé » — parce qu'il
      // ne peut pas affirmer un envoi sans révéler l'existence du compte. Le réécrire
      // en « un code vient d'être envoyé » serait reprendre d'une main ce que le
      // serveur protège de l'autre, et mentir une fois sur trois.
      setAvis(data.message ?? null);
      setAttente(60);
      setStep("verify");
    } catch {
      setError("Erreur réseau. Réessayez.");
    } finally {
      setLoading(false);
    }
  }

  async function submitVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (code.trim().length !== 6) {
      setError("Le code comporte six chiffres.");
      return;
    }
    if (shopName.trim().length === 0) {
      setError("Le nom de votre boutique est requis.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim(),
          code: code.trim(),
          shopName: shopName.trim(),
          company: null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        sellerId?: string;
        detail?: string;
        title?: string;
        error?: string;
      };

      if (!res.ok || !data.sellerId) {
        setError(data.detail ?? data.error ?? data.title ?? "Vérification impossible.");
        return;
      }
      setStep("done");
    } catch {
      setError("Erreur réseau. Réessayez.");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Renvoi du code.
   *
   * CETTE FONCTION NE FAISAIT LITTÉRALEMENT RIEN. Elle lisait un `userId` que le
   * serveur ne rend plus, et n'avait aucune autre branche : pas de message, pas d'état
   * modifié. Le vendeur cliquait, le spinner passait, l'écran était identique — alors
   * il recliquait, et tombait sur le délai d'une minute côté serveur, toujours sans
   * rien voir.
   *
   * Le serveur fournit `retryAfterSeconds`, CONSTANT, exactement pour ça : il ne
   * dépend ni de l'existence du compte ni de l'état du délai, donc il ne divulgue
   * rien, et il suffit à désactiver le bouton pendant une minute.
   */
  async function resendCode() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/resend-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        retryAfterSeconds?: number;
        error?: string;
      };

      if (!res.ok) {
        setError(data.error ?? "Renvoi impossible. Réessayez dans un instant.");
        return;
      }

      setAvis(data.message ?? "Si un compte existe pour cette adresse et n'est pas encore vérifié, un code vient de lui être envoyé.");
      setAttente(typeof data.retryAfterSeconds === "number" ? data.retryAfterSeconds : 60);
    } catch {
      setError("Erreur réseau. Réessayez.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Store className="size-6" />
          </div>
          <CardTitle className="text-xl">Devenir vendeur</CardTitle>
          <CardDescription>
            {step === "account"
              ? "Créez votre compte, puis votre boutique."
              : step === "verify"
                ? "Confirmez votre e-mail et nommez votre boutique."
                : "Votre boutique est créée."}
          </CardDescription>
        </CardHeader>

        {step === "done" ? (
          <CardContent className="space-y-4 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="size-6" />
            </div>
            <p className="text-sm text-muted-foreground">
              <strong>{shopName}</strong> est enregistrée. Connectez-vous pour compléter votre
              dossier : les pièces justificatives et le compte de versement sont nécessaires avant
              de vendre et d&apos;être payé.
            </p>
            <Button className="w-full" onClick={() => router.replace("/login")}>
              Aller à la connexion
            </Button>
          </CardContent>
        ) : step === "account" ? (
          <CardContent>
            <form onSubmit={submitAccount} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">Prénom</Label>
                  <Input id="firstName" required value={form.firstName} onChange={set("firstName")} autoFocus />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">Nom</Label>
                  <Input id="lastName" required value={form.lastName} onChange={set("lastName")} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={form.email}
                  onChange={set("email")}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="phone">Téléphone</Label>
                {/* Obligatoire : le contrat du BFF le déclare nullable, mais le
                    validateur de `RegisterUserCommand` exige `NotEmpty()`. Le laisser
                    optionnel produirait un 400 incompréhensible. */}
                <PhoneInput
                  id="phone"
                  required
                  showError={phoneTouched}
                  value={form.phoneNumber}
                  onChange={(local) => setForm((f) => ({ ...f, phoneNumber: local }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Mot de passe</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={form.password}
                    onChange={set("password")}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-xl text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">8 caractères minimum.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirmer le mot de passe</Label>
                <Input
                  id="confirm"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={form.confirm}
                  onChange={set("confirm")}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="size-4 animate-spin" />}
                Continuer
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                Vous avez déjà un compte acheteur ? Utilisez la même adresse : votre compte ne sera
                pas dupliqué, une boutique y sera rattachée.
              </p>

              <div className="text-center">
                <Link href="/login" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="size-4" /> J&apos;ai déjà un compte vendeur
                </Link>
              </div>
            </form>
          </CardContent>
        ) : (
          <CardContent>
            <form onSubmit={submitVerify} className="space-y-4">
              {/* ─────────────────────────────────────────────────────────────────
                  LE MESSAGE VIENT DU SERVEUR, ET ON NE LE RÉÉCRIT PAS.

                  L'écran affirmait « un code vient d'être envoyé ». Le serveur, lui,
                  n'envoie rien dans trois cas — compte suspendu, adresse déjà
                  rattachée à une boutique, numéro déjà pris — et sa formulation est
                  prudente pour cette raison : « SI cette adresse peut ouvrir une
                  boutique… ». Affirmer l'envoi, c'était reprendre d'une main ce que
                  le serveur protège de l'autre, et se tromper une fois sur trois.

                  On ne dit plus non plus si l'adresse avait déjà un compte : c'est
                  précisément ce que le serveur refuse désormais de divulguer.
                  ───────────────────────────────────────────────────────────────── */}
              <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                {avis ?? (
                  <>
                    Saisissez le code à six chiffres reçu par e-mail à l&apos;adresse{" "}
                    <strong>{form.email.trim()}</strong>. Pensez à regarder vos courriers
                    indésirables.
                  </>
                )}
              </p>

              {/* ─────────────────────────────────────────────────────────────────
                  MODIFIABLE UNIQUEMENT À L'ENTRÉE DIRECTE, ET CETTE FOIS C'EST VRAI.

                  La version précédente de ce commentaire annonçait cette restriction
                  sans la poser : le champ n'avait ni `disabled` ni condition. Dans le
                  parcours normal, l'adresse vient de l'étape 1 et le code a été envoyé
                  À ELLE ; la corriger ici fait valider le code contre une autre adresse
                  (`VerifyEmailCodeCommand(Email, Code)`), donc échouer alors que le code
                  est bon — et l'utilisateur n'a aucun moyen de comprendre pourquoi.

                  À l'entrée directe depuis la connexion, en revanche, l'adresse vient de
                  l'URL : il faut pouvoir la corriger si elle est fausse.
                  ───────────────────────────────────────────────────────────────── */}
              <div className="space-y-1.5">
                <Label htmlFor="verifyEmail">Adresse e-mail</Label>
                <Input
                  id="verifyEmail"
                  type="email"
                  required
                  value={form.email}
                  onChange={set("email")}
                  disabled={!entreeDirecte}
                  placeholder="vous@exemple.com"
                />
                {!entreeDirecte && (
                  <p className="text-xs text-muted-foreground">
                    Le code a été envoyé à cette adresse. Pour en utiliser une autre, revenez à
                    l&apos;étape précédente.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="code">Code reçu par e-mail</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="text-center font-mono text-lg tracking-[0.4em]"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="shopName">Nom de votre boutique</Label>
                <Input
                  id="shopName"
                  required
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder="Le nom que verront vos acheteurs"
                />
                <p className="text-xs text-muted-foreground">
                  Il doit être unique sur la plateforme. Vous pourrez le modifier ensuite.
                </p>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="size-4 animate-spin" />}
                Créer ma boutique
              </Button>

              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setStep("account");
                    setError(null);
                    setAvis(null);
                  }}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="size-4" /> Modifier mes informations
                </button>
                <button
                  type="button"
                  onClick={resendCode}
                  disabled={loading || attente > 0}
                  className="text-primary hover:underline disabled:opacity-50"
                >
                  {attente > 0 ? `Renvoyer le code (${attente} s)` : "Renvoyer le code"}
                </button>
              </div>
            </form>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
