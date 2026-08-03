"use client";

import { useState } from "react";
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
 * ─────────────────────────────────────────────────────────────────────────────────
 * L'ORDRE VIENT DU SERVEUR, PAS D'UN CHOIX D'ERGONOMIE
 *
 * `POST /seller/auth/register` crée le compte (ou identifie l'existant) et envoie un
 * code. `POST /seller/auth/verify` valide ce code PUIS crée la boutique. Le nom de
 * boutique se saisit donc à l'étape 2, pas à l'étape 1 : l'onboarding vendeur exige un
 * e-mail vérifié, et demander le nom trop tôt donnerait l'illusion que la boutique
 * existe déjà.
 *
 * DEUX CAS, UN SEUL PARCOURS
 *
 * Un acheteur qui se lance a déjà un compte : le serveur ne le recrée pas, il lui envoie
 * un code pour prouver qu'il relève bien cette boîte avant de lui rattacher une
 * boutique. `isNewAccount` distingue les deux, et c'est la seule chose qui change à
 * l'écran — le mot de passe saisi est alors ignoré, autant le dire.
 *
 * ⚠️ L'ÉTAPE 2 N'EST PAS TRANSACTIONNELLE côté serveur : elle enchaîne vérification du
 * code, création de la boutique, attribution du rôle et activation. Un nom de boutique
 * déjà pris fait échouer la deuxième opération alors que le code est CONSOMMÉ. On garde
 * donc l'utilisateur sur cette étape avec son `userId`, pour qu'il retente un autre nom
 * sans repartir de zéro.
 * ─────────────────────────────────────────────────────────────────────────────────
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

  const [userId, setUserId] = useState<string | null>(null);
  const [isNewAccount, setIsNewAccount] = useState(true);
  const [code, setCode] = useState("");
  const [shopName, setShopName] = useState("");

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
        userId?: string;
        isNewAccount?: boolean;
        detail?: string;
        title?: string;
        error?: string;
      };

      if (!res.ok || !data.userId) {
        setError(data.detail ?? data.error ?? data.title ?? "Inscription impossible.");
        return;
      }

      setUserId(data.userId);
      setIsNewAccount(data.isNewAccount !== false);
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
        body: JSON.stringify({ userId, code: code.trim(), shopName: shopName.trim(), company: null }),
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

  async function resendCode() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/resend-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { userId?: string | null };
      // On rafraîchit l'identifiant au passage : si le premier appel s'est perdu, c'est
      // ici qu'on le récupère. Message identique dans tous les cas — voir la note de
      // la route /api/auth/resend-code sur l'oracle d'existence de comptes.
      if (data.userId) setUserId(data.userId);
      setError(null);
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
              <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                Un code à six chiffres vient d&apos;être envoyé à{" "}
                <strong>{form.email.trim()}</strong>. Vérifiez votre boîte, et les indésirables.
                {!isNewAccount && (
                  <>
                    {" "}
                    Cette adresse a déjà un compte : <strong>il ne sera pas dupliqué</strong> et
                    votre mot de passe actuel reste inchangé — celui saisi à l&apos;écran précédent
                    est ignoré.
                  </>
                )}
              </p>

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
                  }}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="size-4" /> Modifier mes informations
                </button>
                <button
                  type="button"
                  onClick={resendCode}
                  disabled={loading}
                  className="text-primary hover:underline disabled:opacity-50"
                >
                  Renvoyer le code
                </button>
              </div>
            </form>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
