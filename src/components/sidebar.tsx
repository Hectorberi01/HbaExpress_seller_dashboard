"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiLogout } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCompteursNav, type CompteursNav } from "@/lib/nav-counts";
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
type NavItem = {
  label: string;
  href?: string;
  icon: LucideIcon;
  /**
   * Compteur affiché en bout de ligne. La valeur vient de `useCompteursNav`, qui
   * rejoue le calcul de l'écran visé sur le cache de cet écran — pas un compte maison.
   *
   * RIEN N'EST AFFICHÉ NI QUAND LE COMPTE EST NUL, NI QUAND IL EST INCONNU. Les deux
   * se ressemblent, et c'est assumé : une pastille absente n'affirme rien, là où un
   * « 0 » affirmerait que le vendeur est à jour. Le menu n'est pas l'endroit où l'on
   * annonce une panne — le tableau de bord porte un bandeau pour cela.
   */
  compteur?: keyof CompteursNav;
};

/**
 * Ce que le nombre compte, en toutes lettres. « Commandes 4 » ne dit pas si ce sont
 * quatre commandes au total ou quatre à traiter ; « Commandes — 4 à traiter » le dit.
 *
 * Chaque libellé est une FONCTION du nombre parce que l'un d'eux s'accorde : « 1 non
 * lu » et non « 1 non lus ». Les trois autres sont invariables, et le restent.
 */
const COMPTEUR_TITRES: Record<keyof CompteursNav, (n: number) => string> = {
  commandes: () => "à traiter",
  avis: () => "sans réponse",
  messages: (n) => (n > 1 ? "non lus" : "non lu"),
  stock: () => "sous le seuil d'alerte",
};

/** Au-delà de 99, le chiffre exact n'aide plus et déforme la ligne. */
function texteCompteur(n: number): string {
  return n > 99 ? "99+" : String(n);
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Vue d'ensemble",
    items: [{ label: "Tableau de bord", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    section: "Ventes",
    items: [
      { label: "Commandes", href: "/orders", icon: ShoppingBag, compteur: "commandes" },
      { label: "Expéditions", href: "/shipments", icon: Truck },
      { label: "Retours", href: "/returns", icon: Undo2 },
      { label: "Litiges", href: "/disputes", icon: ShieldAlert },
    ],
  },
  {
    section: "Catalogue",
    items: [
      { label: "Produits & offres", href: "/products", icon: Package },
      { label: "Stock", href: "/inventory", icon: Boxes, compteur: "stock" },
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
      { label: "Avis", href: "/reviews", icon: Star, compteur: "avis" },
      { label: "Messagerie", href: "/messages", icon: MessagesSquare, compteur: "messages" },
    ],
  },
  {
    section: "Boutique",
    items: [
      { label: "Ma boutique", href: "/shop", icon: Store },
      { label: "Notifications", href: "/notifications", icon: Bell },
      // ═══════════════════════════════════════════════════════════════════════════
      // « DOCUMENTS KYB » A ÉTÉ RETIRÉ : DEUX LIBELLÉS, UN SEUL ÉCRAN.
      //
      // L'entrée pointait `/shop#kyb`. L'ancre `id="kyb"` n'est rendue qu'une fois la
      // requête aboutie — tant que la page charge, elle ne contient qu'une carte
      // « Chargement… ». En arrivant depuis un autre écran, l'ancre n'existe donc pas
      // au moment où le navigateur la cherche : la page s'ouvre en haut, c'est-à-dire
      // au résultat exact de « Ma boutique ».
      //
      // Le vendeur lisait deux libellés différents, obtenait deux fois le même écran,
      // et devait descendre jusqu'à la cinquième carte dans les deux cas. L'ancre
      // reste en place dans la page : un lien direct venu d'ailleurs continue de
      // fonctionner une fois la page chargée.
      // ═══════════════════════════════════════════════════════════════════════════
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
  const compteurs = useCompteursNav();

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
                // `null` = inconnu : on n'affiche rien, exactement comme pour zéro,
                // mais sans jamais avoir écrit zéro nulle part.
                const n = item.compteur ? compteurs[item.compteur] : null;
                const pastille = item.compteur && n !== null && n > 0 ? texteCompteur(n) : null;

                // ═══════════════════════════════════════════════════════════════════
                // LE NOM ACCESSIBLE EST CALCULÉ ICI, ET IL NE PEUT PAS VENIR DU CONTENU.
                //
                // En mode icônes, le libellé du lien est en `lg:hidden` — donc en
                // `display:none`, donc EXCLU du nom accessible. Un lecteur d'écran
                // n'entendait plus que le nombre : « 3 à traiter », sans savoir de quoi.
                // Un texte `sr-only` posé à côté n'aurait rien réglé : il aurait
                // remplacé un nom vide (jusqu'ici rattrapé par `title`) par un nom
                // amputé, et fait annoncer le `title` EN PLUS, en description.
                //
                // `aria-label` tranche : un seul nom, identique dans les deux modes, et
                // il reprend le NOMBRE EXACT — le plafond « 99+ » est une contrainte de
                // largeur de pastille, elle n'a pas à s'appliquer à ce qui est lu.
                // `title` reçoit la même chaîne quand la barre est réduite : les
                // lecteurs d'écran taisent une description identique au nom, et la
                // souris retrouve son infobulle.
                // ═══════════════════════════════════════════════════════════════════
                const titreCompteur =
                  item.compteur && n !== null ? COMPTEUR_TITRES[item.compteur](n) : "";
                const nomAccessible = pastille ? `${item.label} — ${n} ${titreCompteur}` : item.label;

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
                      aria-label={pastille ? nomAccessible : undefined}
                      title={collapsed ? nomAccessible : undefined}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-[box-shadow,color] duration-200",
                        collapsed && "lg:justify-center lg:gap-0 lg:px-2",
                        active
                          ? "nm-inset-sm bg-background font-medium text-primary"
                          : "text-foreground/75 hover:text-primary hover:shadow-[var(--nm-raised-sm)]",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className={cn("min-w-0 flex-1 truncate", labelHidden)}>{item.label}</span>

                      {/* ═══════════════════════════════════════════════════════════
                          DEUX RENDUS POUR UNE SEULE PASTILLE, PARCE QUE LA BARRE A
                          DEUX FORMES.

                          Barre déployée (et TOUJOURS sur mobile, où le tiroir
                          s'affiche en entier quel que soit `collapsed`) : le nombre
                          se pose en bout de ligne, en face du libellé.

                          Barre réduite en mode icônes (desktop seulement) : le
                          libellé disparaît, et avec lui la place du nombre. La
                          pastille passe alors en coin de l'icône — sans quoi réduire
                          la barre ferait disparaître l'information, c'est-à-dire
                          exactement l'inverse de ce qu'on cherche.

                          Les deux variantes se croisent au point de bascule `lg` et
                          ne sont donc jamais visibles ensemble.
                          ═══════════════════════════════════════════════════════════ */}
                      {pastille && (
                        <>
                          <span
                            aria-hidden
                            className={cn(
                              "ml-auto shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-primary",
                              labelHidden,
                            )}
                          >
                            {pastille}
                          </span>
                          {collapsed && (
                            <span
                              aria-hidden
                              className="absolute -right-0.5 -top-0.5 hidden rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 tabular-nums text-primary-foreground lg:block"
                            >
                              {pastille}
                            </span>
                          )}
                        </>
                      )}
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
