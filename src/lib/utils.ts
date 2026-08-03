import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Fusionne des classes Tailwind (shadcn/ui standard). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formate un montant en francs CFA (XOF), sans décimales. */
export function formatXof(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "XOF",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

/** Date lisible FR (jj/mm/aaaa hh:mm), à partir d'un ISO UTC. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 8 premiers caractères d'un GUID, pour l'affichage compact. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

/** Ancienneté lisible depuis un ISO UTC (à l'instant / min / h / j). */
export function ageFrom(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} j`;
}

/** Vrai si l'ISO date de plus de `hours` heures (signale un retard). */
export function isOlderThanHours(iso: string | null | undefined, hours: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && Date.now() - t > hours * 3_600_000;
}

/** Masque un numéro de compte, ne laissant que les 4 derniers caractères. */
export function maskAccount(account: string | null | undefined): string {
  if (!account) return "—";
  const a = account.trim();
  if (a.length <= 4) return a;
  return "•".repeat(Math.min(a.length - 4, 6)) + a.slice(-4);
}
