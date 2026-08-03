"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardContent } from "@/components/ui/card";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";

/**
 * Parcours de réinitialisation du mot de passe, en DEUX ÉTAPES SUR UN SEUL ÉCRAN.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * POURQUOI PAS DE LIEN
 *
 * `RequestPasswordResetCommandHandler` appelle `GenerateNumericCode()` : le serveur
 * envoie un **code numérique à six chiffres**, valable une heure — pas une URL. Le
 * commentaire du handler l'explique : un code se saisit dans une application mobile,
 * un lien se copie mal.
 *
 * L'écran précédent, recopié de la console admin, promettait pourtant « un lien de
 * réinitialisation », et la page de réinitialisation attendait un `token` dans la
 * query string. Ce jeton n'arrivant jamais, elle affichait « Lien invalide ou
 * incomplet » à tous ceux qui y parvenaient. Le parcours entier était donc une
 * impasse : on recevait un code que rien ne permettait de saisir.
 *
 * ÉTAPE 2 ATTEINTE MÊME SI LE COMPTE N'EXISTE PAS
 *
 * Le serveur répond 204 que l'adresse existe ou non, pour ne pas devenir un annuaire
 * de comptes. On passe donc à l'étape « code » dans tous les cas : s'arrêter au premier
 * échec révélerait précisément ce que le backend prend soin de taire.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
export function PasswordResetFlow({
  /** Adresse pré-remplie (lien profond depuis l'application mobile, par exemple). */
  initialEmail = "",
  /** `true` pour ouvrir directement sur la saisie du code. */
  startAtCode = false,
}: {
  initialEmail?: string;
  startAtCode?: boolean;
}) {
  const router = useRouter();

  const [step, setStep] = useState<"request" | "code" | "done">(
    startAtCode && initialEmail ? "code" : "request",
  );
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      // Succès ou non : on avance. Voir la note de neutralité en tête de fichier.
      setStep("code");
    } catch {
      setError("Erreur réseau. Réessayez.");
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Contrôles faits ICI : le serveur ne reçoit qu'un seul mot de passe, il ne peut
    // donc pas vérifier la confirmation. Sans cela, une faute de frappe devient un
    // mot de passe que personne ne connaît.
    if (code.trim().length !== 6) {
      setError("Le code comporte six chiffres.");
      return;
    }
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), token: code.trim(), newPassword: password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Code invalide ou expiré.");
        return;
      }
      setStep("done");
    } catch {
      setError("Erreur réseau. Réessayez.");
    } finally {
      setLoading(false);
    }
  }

  if (step === "done") {
    return (
      <CardContent className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 className="size-6" />
        </div>
        <p className="text-sm text-muted-foreground">Votre mot de passe a été mis à jour.</p>
        <Button className="w-full" onClick={() => router.replace("/login")}>
          Aller à la connexion
        </Button>
      </CardContent>
    );
  }

  if (step === "request") {
    return (
      <CardContent>
        <form onSubmit={requestCode} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            Recevoir le code
          </Button>

          <div className="flex items-center justify-between text-sm">
            <Link href="/login" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" /> Connexion
            </Link>
            {/* Un code déjà reçu ne doit pas obliger à en redemander un : le précédent
                serait invalidé, et l'e-mail déjà ouvert deviendrait inutilisable. */}
            <button
              type="button"
              onClick={() => setStep("code")}
              className="text-primary hover:underline"
            >
              J&apos;ai déjà un code
            </button>
          </div>
        </form>
      </CardContent>
    );
  }

  return (
    <CardContent>
      <form onSubmit={resetPassword} className="space-y-4">
        <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
          Si un compte existe pour <strong>{email.trim() || "cette adresse"}</strong>, un code à six
          chiffres vient d&apos;être envoyé par e-mail. Vérifiez votre boîte, et les indésirables.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="rEmail">E-mail</Label>
          <Input
            id="rEmail"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="code">Code reçu par e-mail</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            // Filtré à la saisie : le champ ne peut contenir que ce qui sera envoyé.
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="text-center font-mono text-lg tracking-[0.4em]"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">Six chiffres, valables une heure.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Nouveau mot de passe</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="size-4 animate-spin" />}
          Changer le mot de passe
        </Button>

        <div className="flex items-center justify-between text-sm">
          <Link href="/login" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Connexion
          </Link>
          <button
            type="button"
            onClick={() => {
              setStep("request");
              setCode("");
              setError(null);
            }}
            className="text-primary hover:underline"
          >
            Renvoyer un code
          </button>
        </div>
      </form>
    </CardContent>
  );
}
