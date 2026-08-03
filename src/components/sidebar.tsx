"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiLogout } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Bell,
  Boxes,
  LayoutDashboard,
  LineChart,
  LogOut,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Package,
  ScrollText,
  ShieldAlert,
  ShoppingBag,
  Star,
  Store,
  Truck,
  Undo2,
  UserCog,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

/**
 * Une entrée SANS `href` s'affiche grisée avec la mention « bientôt ».
 *
 * Le mécanisme est conservé bien qu'AUCUNE entrée ne l'utilise aujourd'hui : les
 * quatorze écrans du menu existent tous. Il a servi pendant la construction — montrer
 * ce qui arrive plutôt que le cacher — et resservira au prochain domaine ouvert.
 *
 * C'est exactement ce qui manquait au tableau de bord Blazor : Retours et Litiges y
 * étaient absents sans que rien ne le signale, et un vendeur pouvait chercher longtemps
 * un remboursement introuvable.
 */
type NavItem = { label: string; href?: string; icon: LucideIcon };

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Vue d'ensemble",
    items: [{ label: "Tableau de bord", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    section: "Ventes",
    items: [
      { label: "Commandes", href: "/orders", icon: ShoppingBag },
      { label: "Expéditions", href: "/shipments", icon: Truck },
      { label: "Retours", href: "/returns", icon: Undo2 },
      { label: "Litiges", href: "/disputes", icon: ShieldAlert },
    ],
  },
  {
    section: "Catalogue",
    items: [
      { label: "Produits & offres", href: "/products", icon: Package },
      { label: "Stock", href: "/inventory", icon: Boxes },
    ],
  },
  {
    section: "Argent",
    items: [
      { label: "Portefeuille", href: "/wallet", icon: Wallet },
      { label: "Finances", href: "/finance", icon: LineChart },
    ],
  },
  {
    section: "Relation client",
    items: [
      { label: "Avis", href: "/reviews", icon: Star },
      { label: "Messagerie", href: "/messages", icon: MessagesSquare },
    ],
  },
  {
    section: "Boutique",
    items: [
      { label: "Ma boutique", href: "/shop", icon: Store },
      { label: "Notifications", href: "/notifications", icon: Bell },
      { label: "Documents KYB", href: "/shop#kyb", icon: ScrollText },
      { label: "Mon compte", href: "/account", icon: UserCog },
    ],
  },
];

const STORAGE_KEY = "mp_seller_sidebar_collapsed";

export function Sidebar({
  name,
  email,
  mobileOpen = false,
  onMobileClose,
}: {
  name: string;
  email?: string;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  // `collapsed` = mode icônes, DESKTOP uniquement (via classes lg:*). Sur mobile le
  // tiroir s'affiche toujours en entier.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "1") setCollapsed(true);
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  async function logout() {
    setLoggingOut(true);
    await apiLogout();
    router.replace("/login");
    router.refresh();
  }

  // Classe pour masquer un libellé quand la barre est réduite (desktop only).
  const labelHidden = collapsed && "lg:hidden";

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex h-screen w-64 shrink-0 flex-col bg-white shadow-[8px_0_24px_rgba(60,64,74,0.14),2px_0_6px_rgba(60,64,74,0.08)] transition-transform duration-200 dark:bg-card",
        "lg:sticky lg:top-0 lg:z-30 lg:translate-x-0 lg:transition-[width]",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        collapsed ? "lg:w-16" : "lg:w-64",
      )}
    >
      <div className={cn("flex items-center py-4 px-5", collapsed && "lg:justify-center lg:px-2")}>
        <div className="nm-raised-sm flex size-9 shrink-0 items-center justify-center rounded-xl bg-card text-primary">
          <Store className="size-5" />
        </div>
        <div className={cn("min-w-0 pl-2 leading-tight", labelHidden)}>
          <div className="truncate text-sm font-semibold">HBA Express</div>
          <div className="truncate text-xs text-muted-foreground">Espace vendeur</div>
        </div>
        {/* Fermer le tiroir (mobile) */}
        <button
          type="button"
          onClick={onMobileClose}
          aria-label="Fermer le menu"
          className="ml-auto text-muted-foreground hover:text-foreground lg:hidden"
        >
          <X className="size-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map((group) => (
          <div key={group.section} className="mb-4">
            <div
              className={cn(
                "px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
                labelHidden,
              )}
            >
              {group.section}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.href && (pathname === item.href || pathname.startsWith(item.href + "/"));
                const Icon = item.icon;

                if (!item.href) {
                  return (
                    <li key={item.label}>
                      <span
                        title={collapsed ? `${item.label} (bientôt)` : undefined}
                        className={cn(
                          "flex cursor-default items-center gap-2.5 rounded-md px-2 py-2 text-sm text-muted-foreground/50",
                          collapsed && "lg:justify-center lg:gap-0",
                        )}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className={cn(labelHidden)}>{item.label}</span>
                        <span className={cn("ml-auto text-[10px]", labelHidden)}>bientôt</span>
                      </span>
                    </li>
                  );
                }

                return (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      onClick={onMobileClose}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-[box-shadow,color] duration-200",
                        collapsed && "lg:justify-center lg:gap-0 lg:px-2",
                        active
                          ? "nm-inset-sm bg-background font-medium text-primary"
                          : "text-foreground/75 hover:text-primary hover:shadow-[var(--nm-raised-sm)]",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className={cn(labelHidden)}>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t p-3">
        {/* Réduire : desktop uniquement */}
        <button
          onClick={toggle}
          title={collapsed ? "Déployer le menu" : "Réduire le menu"}
          className={cn(
            "mb-2 hidden w-full items-center gap-2.5 rounded-md px-2 py-2 text-sm text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground lg:flex",
            collapsed && "lg:justify-center lg:gap-0",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4 shrink-0" />
          ) : (
            <>
              <PanelLeftClose className="size-4 shrink-0" /> Réduire
            </>
          )}
        </button>

        <div className="mb-2 px-2 py-1">
          <div
            className={cn(
              "mx-auto hidden size-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary",
              collapsed && "lg:flex",
            )}
          >
            {(name || "?").charAt(0).toUpperCase()}
          </div>
          <div className={cn(labelHidden)}>
            <div className="truncate text-sm font-medium">{name}</div>
            {email && <div className="truncate text-xs text-muted-foreground">{email}</div>}
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className={cn("w-full", collapsed && "lg:px-0")}
          onClick={logout}
          disabled={loggingOut}
          title={collapsed ? "Se déconnecter" : undefined}
        >
          <LogOut className="size-4" />
          <span className={cn(labelHidden)}>Se déconnecter</span>
        </Button>
      </div>
    </aside>
  );
}
