"use client";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordResetFlow } from "@/components/password-reset-flow";
import { ShieldCheck } from "lucide-react";

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="size-6" />
          </div>
          <CardTitle className="text-xl">Mot de passe oublié</CardTitle>
          {/* Un CODE, pas un lien : c'est ce que produit `GenerateNumericCode()` côté
              serveur. La formulation précédente promettait un lien qui n'existe pas, et
              renvoyait vers un écran attendant un jeton dans l'URL — jamais fourni. */}
          <CardDescription>On vous envoie un code à six chiffres par e-mail.</CardDescription>
        </CardHeader>
        <PasswordResetFlow />
      </Card>
    </div>
  );
}
