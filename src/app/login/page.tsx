"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, apiLogin } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, EyeOff, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Vrai quand le refus est « adresse non confirmée ».
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * LE SERVEUR DONNAIT UNE INSTRUCTION QUE L'APPLICATION NE PERMETTAIT PAS DE SUIVRE.
   *
   * Son message est : « Votre adresse e-mail n'est pas encore confirmée. Saisissez le
   * code reçu par e-mail, ou demandez-en un nouveau. » Or il n'existait AUCUN écran
   * atteignable pour saisir ce code : le seul champ vivait à l'étape 2 de
   * l'inscription, derrière un `setStep("verify")` que plus rien ne déclenchait.
   * L'écran de mot de passe oublié traite un autre code, celui de réinitialisation.
   *
   * Le compte était donc enfermé dehors : ni connexion, ni chemin pour se vérifier.
   *
   * ON BRANCHE SUR LE CODE, PAS SUR LA PHRASE. « Compte suspendu » et « adresse non
   * confirmée » sortent tous deux en 403 : le statut ne les distingue pas, et
   * reconnaître un message français serait se lier à une formulation qui changera.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const [aVerifier, setAVerifier] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAVerifier(false);
    setLoading(true);
    try {
      const res = await apiLogin(email, password, mfaRequired ? mfaCode : undefined);
      if (res.mfaRequired) {
        setMfaRequired(true);
        setError(null);
        return;
      }
      // ─────────────────────────────────────────────────────────────────────────
      // RETOUR À LA PAGE D'OÙ L'ON VENAIT.
      //
      // Quand une session expire en cours de travail, `bff()` renvoie ici avec
      // `?redirect=`. Sans cette reprise, le vendeur repartirait du tableau de bord
      // et devrait refaire toute sa navigation — filtres et recherche compris.
      //
      // La valeur vient de l'URL : c'est une entrée utilisateur, et elle décide où
      // l'on atterrit APRÈS une authentification réussie. Voir `safeRedirect`.
      // ─────────────────────────────────────────────────────────────────────────
      const raw = new URLSearchParams(window.location.search).get("redirect");
      router.replace(safeRedirect(raw));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion impossible.");
      setAVerifier(err instanceof ApiError && err.code === "identity.auth.email_not_verified");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="HBA Express" width={64} height={64} className="mx-auto size-16 rounded-2xl" />
          <CardTitle className="text-xl">Espace vendeur</CardTitle>
          <CardDescription>HBA Express — gestion de votre boutique</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={mfaRequired}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Mot de passe</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={mfaRequired}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={mfaRequired}
                  aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-xl text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            {mfaRequired && (
              <div className="space-y-1.5">
                <Label htmlFor="mfa">Code d&apos;authentification (2FA)</Label>
                <Input
                  id="mfa"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  autoFocus
                />
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}

            {/* L'instruction du serveur devient exécutable : ce lien mène à l'étape de
                saisie du code, avec l'adresse déjà remplie. Sans lui, le message
                « saisissez le code reçu par e-mail » désignait un écran qui n'existait
                nulle part, et le compte restait enfermé dehors. */}
            {aVerifier && (
              <Link
                href={`/inscription?verifier=${encodeURIComponent(email.trim())}`}
                className="block rounded-lg border border-primary/30 bg-primary/5 p-3 text-center text-sm font-medium text-primary hover:bg-primary/10"
              >
                Saisir mon code de vérification
              </Link>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              {mfaRequired ? "Valider le code" : "Se connecter"}
            </Button>
            {!mfaRequired && (
              <div className="text-center">
                <Link href="/mot-de-passe-oublie" className="text-sm text-muted-foreground hover:text-foreground">
                  Mot de passe oublié ?
                </Link>
              </div>
            )}
          </form>

          {/* L'auto-inscription existe bel et bien sur cette surface :
              `SellerRegistrationEndpoints` expose /register et /verify. Ce bloc
              renvoyait vers l'application mobile, ce qui était faux — et privait la
              console de son entrée la plus évidente. */}
          <div className="mt-6 border-t border-border pt-4 text-center">
            <p className="text-sm text-muted-foreground">Pas encore de boutique ?</p>
            <Link
              href="/inscription"
              className="mt-1 inline-block text-sm font-medium text-primary hover:underline"
            >
              Créer mon compte vendeur
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Destination de retour après connexion — validée, jamais recopiée telle quelle.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * LE FILTRE PRÉCÉDENT LAISSAIT PASSER UNE REDIRECTION EXTERNE.
 *
 * Il exigeait un « / » initial et refusait « // ». Mais le parseur d'URL des
 * navigateurs traite l'ANTISLASH comme une barre oblique sur les schémas web :
 * « /\evil.test » passait le test et se résolvait en « https://evil.test/ ».
 *
 * Le scénario est propre du point de vue de la victime, et c'est ce qui le rend
 * efficace : le lien pointe sur la VRAIE console, le vendeur y saisit son mot de passe
 * et son code à deux facteurs, tout fonctionne — puis il est expédié sur un site tiers
 * qui lui redemande ses identifiants. Rien, à aucun moment, ne paraît anormal.
 *
 * On ne devine donc plus la forme d'une URL : on la RÉSOUT contre l'origine courante et
 * l'on vérifie que le résultat y reste. C'est le navigateur qui tranche, avec les
 * mêmes règles que celles qu'il appliquera à la navigation.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
function safeRedirect(raw: string | null): string {
  const fallback = "/dashboard";
  if (!raw || !raw.startsWith("/")) {
    return fallback;
  }
  try {
    const target = new URL(raw, window.location.origin);
    if (target.origin !== window.location.origin) {
      return fallback;
    }
    // On ne rend que la partie chemin : recomposer depuis l'URL résolue neutralise au
    // passage les antislashs, les caractères de contrôle et les schémas exotiques.
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
