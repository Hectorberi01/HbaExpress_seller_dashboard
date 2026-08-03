"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordResetFlow } from "@/components/password-reset-flow";
import { ShieldCheck } from "lucide-react";

/**
 * Réinitialisation directe : on arrive ici avec le code déjà en main.
 *
 * Cette route existait pour un parcours par LIEN — elle lisait `email` et `token` dans
 * la query string et affichait « Lien invalide ou incomplet » sans eux. Or le serveur
 * envoie un code, jamais de lien : l'écran était donc inatteignable autrement que par
 * erreur, et toujours en échec.
 *
 * Elle est conservée parce qu'un lien profond depuis l'application mobile peut y mener
 * avec `?email=` : on pré-remplit alors l'adresse et on ouvre directement la saisie du
 * code, plutôt que de refaire demander un code — ce qui invaliderait celui déjà reçu.
 */
function ResetEntry() {
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  return <PasswordResetFlow initialEmail={email} startAtCode={email !== ""} />;
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="size-6" />
          </div>
          <CardTitle className="text-xl">Réinitialiser le mot de passe</CardTitle>
          <CardDescription>Espace vendeur — HBA Express</CardDescription>
        </CardHeader>
        <Suspense
          fallback={
            <CardContent>
              <p className="text-center text-sm text-muted-foreground">Chargement…</p>
            </CardContent>
          }
        >
          <ResetEntry />
        </Suspense>
      </Card>
    </div>
  );
}
