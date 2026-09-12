import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Fusionne des classes Tailwind (shadcn/ui standard). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * FORMATE UN MONTANT DANS SA DEVISE — CELLE QUE LE SERVEUR A ENVOYÉE.
 *
 * `formatXof` codait « XOF » en dur et s'appliquait à des montants dont le contrat
 * porte pourtant un champ `currency` renseigné : tableau de bord, détail de commande,
 * versements, soldes, mouvements, retours, offres. Un montant en euros s'affichait
 * donc « 12 F CFA », à côté d'une étiquette de champ qui lisait déjà « (EUR) ».
 *
 * LE NOMBRE DE DÉCIMALES VIENT DE LA DEVISE, PAS D'UNE CONSTANTE. `Intl` sait qu'un
 * franc CFA n'a pas de centimes et qu'un euro en a deux ; forcer zéro partout
 * arrondissait 12,40 € à 12 €. On ne fixe donc rien et on laisse la table faire.
 *
 * UNE DEVISE VIDE OU INCONNUE RETOMBE SUR XOF plutôt que de lever. `Intl` refuse un
 * code invalide par une exception, et une exception dans un rendu React démonte
 * l'écran entier — un prix mal libellé vaut mieux qu'une page blanche. Le code à trois
 * lettres est la seule forme que le domaine produit (`Money`, `NormaliserDevise`).
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
export function formatMoney(value: number, currency: string | null | undefined): string {
  const code = (currency ?? "").trim().toUpperCase();
  const devise = /^[A-Z]{3}$/.test(code) ? code : "XOF";
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: devise }).format(value ?? 0);
  } catch {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XOF" }).format(value ?? 0);
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * COMBIEN DE DÉCIMALES CETTE DEVISE ADMET-ELLE ? 0 POUR LE FRANC CFA, 2 POUR L'EURO.
 *
 * La console codait « entier » partout. C'est juste pour le XOF — qui n'a pas de
 * subdivision — et faux pour toute autre devise : une offre en euros à 12,40
 * préremplissait « 12.4 », la validation refusait, et l'écran répondait « un montant
 * entier strictement positif est attendu » alors que le domaine, lui, accepte les
 * décimales d'une devise qui en a. Une offre non-XOF était intarifiable depuis la
 * console.
 *
 * ON NE TIENT PAS DE TABLE. `Intl` porte déjà la liste ISO 4217 des subdivisions, et
 * elle est plus à jour que ce que nous recopierions. Un code inconnu retombe sur deux
 * décimales, ce qu'`Intl` fait lui-même — plus permissif que le domaine, donc sans
 * risque de refuser ici une saisie qu'il aurait acceptée.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
export function decimalesDeDevise(currency: string | null | undefined): number {
  const code = (currency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return 0;
  try {
    return (
      new Intl.NumberFormat("fr-FR", { style: "currency", currency: code }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 0;
  }
}

/**
 * Formate un montant en francs CFA (XOF), sans décimales.
 *
 * À RÉSERVER AUX MONTANTS DONT LA DEVISE EST RÉELLEMENT XOF PAR CONSTRUCTION : le
 * relevé financier (dont les champs se nomment `…Xof`), les retraits et le portefeuille
 * — la sortie d'argent passe par un prestataire Mobile Money qui ne connaît que le
 * franc CFA. Partout où le serveur renvoie un champ `currency`, c'est `formatMoney`
 * qu'il faut appeler : afficher « F CFA » sur un montant en euros n'est pas une
 * approximation d'affichage, c'est un chiffre faux.
 */
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
