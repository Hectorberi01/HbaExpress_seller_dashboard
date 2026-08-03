"use client";

import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Textes de notification portés par une mutation.
 *
 * `MutationCache` ci-dessous notifie TOUTES les mutations : une page qui ajoute en plus
 * son propre `toastSuccess`/`toastError` dans `onSuccess`/`onError` en fait afficher
 * deux. C'était le cas sur l'écran Règlement, où chaque opération empilait le message
 * métier et le générique « Modification enregistrée. ».
 *
 * La règle est donc : une page ne toaste pas depuis une mutation, elle déclare son texte
 * ici. Les seuls `toastError` légitimes dans une page sont ceux d'une validation locale,
 * hors mutation (un lien mal formé, par exemple) — le cache ne les voit pas passer, il
 * n'y a rien à dédoubler.
 */
type MutationToastMeta = {
  /**
   * Message de succès sur mesure. À défaut : « Modification enregistrée. ».
   *
   * Une chaîne VIDE signifie « ne rien annoncer en cas de succès » — utile quand
   * l'écran montre déjà le résultat (une pastille qui disparaît, une ligne qui change).
   * Elle ne coupe PAS les erreurs, contrairement à `silent`.
   */
  successMessage?: string;
  /** Repli quand le rejet n'a pas de message lisible. Le message serveur reste prioritaire. */
  errorMessage?: string;
  /**
   * Aucune notification, ni succès NI ERREUR.
   *
   * ⚠️ À manier avec précaution : une mutation d'écriture qui échoue sans le dire
   * laisse l'utilisateur croire que rien ne s'est passé, et recommencer. Pour taire
   * seulement le succès, préférer `successMessage: ""`.
   */
  silent?: boolean;
};

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        // Émetteur UNIQUE des notifications de mutation (voir MutationToastMeta).
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            const meta = mutation.meta as MutationToastMeta | undefined;
            if (meta?.silent) return;
            // Le message du serveur prime : il dit POURQUOI l'opération a échoué.
            // `errorMessage` n'est qu'un repli pour les rejets sans texte exploitable.
            const fromServer = error instanceof Error ? error.message.trim() : "";
            toastError(fromServer || meta?.errorMessage || "Une erreur est survenue.");
          },
          onSuccess: (_data, _vars, _ctx, mutation) => {
            const meta = mutation.meta as MutationToastMeta | undefined;
            if (meta?.silent) return;
            const message = meta?.successMessage ?? "Modification enregistrée.";
            // Chaîne vide = succès volontairement muet. Sans ce test, `toastSuccess("")`
            // affichait un bandeau vide — pire que pas de bandeau du tout.
            if (message.trim().length === 0) return;
            toastSuccess(message);
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
