/**
 * Numéros de téléphone béninois.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * UN SEUL FORMAT, ET IL EST FIXE : +229 SUIVI DE 10 CHIFFRES.
 *
 * Le Bénin est passé à dix chiffres, préfixés « 01 ». Un numéro valide s'écrit donc
 * +229 01 XX XX XX XX — treize chiffres après le « + » en tout.
 *
 * Le serveur, lui, accepte « 8 à 15 chiffres, indicatif optionnel » (`PhoneNumber`
 * dans le module Identity). C'est un filet volontairement large, pensé pour ne pas
 * bloquer un cas non prévu — mais qui laisse passer un numéro à huit chiffres de
 * l'ancien plan, un numéro d'un autre pays, ou une saisie tronquée. Or ce numéro sert
 * au SMS et au Mobile Money : un chiffre manquant, et c'est un versement qui n'arrive
 * pas.
 *
 * L'interface est donc plus stricte que le serveur, à dessein. L'indicatif n'est pas
 * saisissable : il est affiché, figé, et ajouté à l'envoi. On ne demande jamais au
 * vendeur de taper « +229 » — c'est une occasion de se tromper offerte gratuitement.
 * ─────────────────────────────────────────────────────────────────────────────────
 */

export const BENIN_DIALING_CODE = "+229";
export const BENIN_LOCAL_LENGTH = 10;

/**
 * Extrait la partie locale (10 chiffres) d'un numéro stocké, quelle que soit sa forme.
 *
 * Les données existantes sont hétérogènes : « +2290197000000 », « 2290197000000 »,
 * « 0197000000 », « 97 00 00 00 » (ancien plan à huit chiffres). On retire l'indicatif
 * quand il est là, on garde le reste tel quel — y compris s'il est trop court : le
 * champ affichera alors la valeur réelle et signalera qu'elle est incomplète, plutôt
 * que de la vider en silence et de laisser croire qu'aucun numéro n'est enregistré.
 */
export function toLocalPhone(stored: string | null | undefined): string {
  const digits = (stored ?? "").replace(/\D/g, "");
  if (digits.startsWith("229")) {
    return digits.slice(3, 3 + BENIN_LOCAL_LENGTH);
  }
  return digits.slice(0, BENIN_LOCAL_LENGTH);
}

/** Forme envoyée au serveur : indicatif + partie locale, sans espace. */
export function toStoredPhone(local: string): string {
  return `${BENIN_DIALING_CODE}${local.replace(/\D/g, "")}`;
}

export function isCompletePhone(local: string): boolean {
  return new RegExp(`^\\d{${BENIN_LOCAL_LENGTH}}$`).test(local);
}

/** Affichage groupé « 01 97 00 00 00 » — plus facile à relire qu'une suite de dix chiffres. */
export function formatLocalPhone(local: string): string {
  const digits = local.replace(/\D/g, "");
  return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
}
