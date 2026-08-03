"use client";

import { useState } from "react";
import { Menu, Store } from "lucide-react";
import { Sidebar } from "./sidebar";
import { KybBanner } from "./kyb-banner";

/**
 * Coquille responsive : sidebar en tiroir sur mobile (< lg), collée en permanence sur
 * desktop. Sur mobile, une barre supérieure porte le hamburger ; un voile ferme le
 * tiroir au clic.
 */
export function AppShell({
  name,
  email,
  children,
}: {
  name: string;
  email?: string;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <Sidebar name={name} email={email} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      {/* Voile mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-white/95 px-4 py-3 backdrop-blur lg:hidden dark:bg-card/95">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Ouvrir le menu"
            className="nm-raised-sm flex size-9 items-center justify-center rounded-xl bg-card text-foreground"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex items-center gap-2">
            <Store className="size-5 text-primary" />
            <span className="text-sm font-semibold">HBA Express</span>
          </div>
        </header>

        <main className="min-w-0 flex-1 bg-muted/30">
          {/* Vérification de la boutique : le bandeau vit ICI, au-dessus du contenu de
              chaque écran, et disparaît de lui-même une fois les documents validés.
              Le placer dans chaque page l'aurait fait oublier sur la prochaine. */}
          <KybBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
