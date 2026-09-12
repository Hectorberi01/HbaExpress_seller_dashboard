/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * LES JOURS, LES BORNES ET LE DÉCALAGE — ÉCRITS UNE SEULE FOIS.
 *
 * Ces trois fonctions vivaient dans l'écran « Finances ». Dès qu'un deuxième écran a
 * eu besoin d'interroger une période, les recopier aurait garanti la divergence : ce
 * sont exactement les fonctions dont l'erreur ne se voit pas — un relevé décalé d'un
 * jour reste un relevé plausible.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */

/**
 * Date du jour (moins N jours) en heure LOCALE, au format « AAAA-MM-JJ ».
 *
 * `toISOString()` bascule en UTC : entre minuit et 1 h au Bénin (UTC+1), il renvoyait
 * la VEILLE de ce que le vendeur lit sur sa montre.
 */
export function jourLocal(ilYaNJours: number): string {
  const d = new Date();
  d.setDate(d.getDate() - ilYaNJours);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Convertit « AAAA-MM-JJ » + une heure locale en instant UTC (ISO avec « Z »).
 *
 * Sans cela on envoyait « 2026-08-03T00:00:00 » sans fuseau ; le serveur fait
 * `SpecifyKind(..., Utc)` et prenait donc l'heure murale pour de l'UTC. Au Bénin
 * (UTC+1), la fenêtre réellement interrogée était décalée d'une heure : les écritures
 * du premier jour entre 00 h et 01 h manquaient, et celles du lendemain de la fin de
 * période s'y ajoutaient — affichées, après reconversion locale, à une date HORS de
 * la période demandée.
 *
 * `setFullYear`, PAS le constructeur : `new Date(50, 2, 1)` ne vaut pas l'an 50 mais
 * 1950, la spécification mappant les années 0-99 sur 1900-1999. Un champ `type="date"`
 * accepte une année à un seul chiffre.
 */
export function borneLocale(jour: string, finDeJournee: boolean): string {
  const [y, m, d] = jour.split("-").map(Number);
  const date = new Date(2000, 0, 1);
  date.setFullYear(y, m - 1, d);
  if (finDeJournee) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date.toISOString();
}

/**
 * La valeur d'un `<input type="date">` est-elle une date exploitable ?
 *
 * Deux pièges, tous deux atteignables au clavier :
 *   - le champ VIDÉ renvoie une chaîne vide — `borneLocale("")` construit alors une
 *     date invalide et `toISOString()` LÈVE ;
 *   - l'année accepte jusqu'à six chiffres et n'est pas complétée à gauche. Au-delà
 *     de quatre, la comparaison lexicographique s'inverse : « 20250-09-12 » est
 *     alphabétiquement INFÉRIEUR à « 2026-08-13 », donc une fin postérieure de
 *     dix-huit mille ans passait pour antérieure au début.
 *
 * On exige la forme canonique sur dix caractères — seule forme où comparer deux
 * chaînes revient à comparer deux dates — ET on vérifie que la date revient sur
 * elle-même : « 2026-02-30 » respecte la forme, et `Date` la NORMALISE en silence
 * vers le 2 mars.
 */
export function dateExploitable(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return false;
  }
  const [y, m, d] = v.split("-").map(Number);
  const test = new Date(2000, 0, 1);
  test.setFullYear(y, m - 1, d);
  return test.getFullYear() === y && test.getMonth() === m - 1 && test.getDate() === d;
}

/**
 * Décalage du navigateur par rapport à UTC, en MINUTES VERS L'EST (60 au Bénin).
 *
 * `getTimezoneOffset()` renvoie l'inverse — les minutes à AJOUTER à l'heure locale
 * pour obtenir UTC, donc -60 au Bénin. Le signe est la faute classique, et elle ne se
 * voit pas : elle déplace les commandes d'un jour, pas de douze heures.
 *
 * Le serveur en a besoin pour découper la série en JOURS : un jour n'existe que dans
 * un fuseau, et une commande passée à 00 h 30 à Cotonou vaut 23 h 30 UTC la veille.
 */
export function decalageMinutesVersEst(): number {
  return -new Date().getTimezoneOffset();
}

/** « 2026-09-12 » → « 12 sept. ». Format d'axe : court, sans année. */
export function formatJourCourt(jourIso: string): string {
  const [y, m, d] = jourIso.split("-").map(Number);
  if (!y || !m || !d) return jourIso;
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** « 2026-09-12 » → « 12/09/2026 ». Format de tableau : complet, non ambigu. */
export function formatJourLong(jourIso: string): string {
  const [y, m, d] = jourIso.split("-").map(Number);
  if (!y || !m || !d) return jourIso;
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Somme par JOUR LOCAL d'une liste d'écritures datées en UTC, jours vides compris.
 *
 * Les jours vides sont la raison d'être de cette fonction. Une courbe qui les saute
 * relie le 3 au 11 par un segment droit et donne à une semaine morte l'allure d'une
 * progression régulière.
 *
 * `du` et `au` sont des jours LOCAUX « AAAA-MM-JJ », comme les champs de saisie.
 *
 * CE QUI TOMBE HORS DE LA GRILLE EST PERDU, ET C'EST À L'APPELANT DE S'EN GARDER.
 * Un élément daté hors de `[du, au]` est rangé dans un seau que la projection ne relit
 * jamais : il ne casse rien, il n'apparaît nulle part. Les deux appelants actuels sont
 * à l'abri — le relevé interroge le serveur sur exactement les mêmes bornes que sa
 * grille, le portefeuille pré-filtre avant d'appeler — mais un troisième appelant qui
 * passerait une liste plus large qu'elle verrait sa somme diverger de son tableau sans
 * le moindre signal.
 */
export function agregeParJour<T>(
  elements: ReadonlyArray<T>,
  dateUtcDe: (e: T) => string,
  valeursDe: (e: T) => Record<string, number>,
  du: string,
  au: string,
  clesAttendues: string[],
): Array<{ date: string } & Record<string, number>> {
  const seaux = new Map<string, Record<string, number>>();

  for (const e of elements) {
    const brut = dateUtcDe(e);
    const d = new Date(brut);
    if (Number.isNaN(d.getTime())) continue;

    // `getFullYear`/`getMonth`/`getDate` sont LOCAUX : le seau est donc le jour que le
    // vendeur lit sur sa montre, pas le jour UTC.
    const p = (n: number) => String(n).padStart(2, "0");
    const jour = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;

    const seau = seaux.get(jour) ?? Object.fromEntries(clesAttendues.map((k) => [k, 0]));
    for (const [k, v] of Object.entries(valeursDe(e))) {
      // UNE CLÉ NON DÉCLARÉE EST UNE ERREUR, PAS UNE DONNÉE À RANGER DISCRÈTEMENT.
      // Elle était accumulée puis jetée à la projection : la valeur disparaissait
      // sans erreur, sans trace, et le total du graphe ne correspondait plus à rien.
      if (!clesAttendues.includes(k)) {
        throw new Error(
          `agregeParJour : la clé « ${k} » n'est pas déclarée dans clesAttendues ` +
            `(${clesAttendues.join(", ")}). Elle serait comptée puis perdue.`,
        );
      }
      seau[k] = (seau[k] ?? 0) + v;
    }
    seaux.set(jour, seau);
  }

  const points: Array<{ date: string } & Record<string, number>> = [];
  const debut = new Date(2000, 0, 1);
  const [dy, dm, dd] = du.split("-").map(Number);
  debut.setFullYear(dy, dm - 1, dd);
  debut.setHours(12, 0, 0, 0); // midi : à l'abri d'un éventuel changement d'heure

  const fin = new Date(2000, 0, 1);
  const [fy, fm, fd] = au.split("-").map(Number);
  fin.setFullYear(fy, fm - 1, fd);
  fin.setHours(12, 0, 0, 0);

  const p = (n: number) => String(n).padStart(2, "0");
  for (const curseur = new Date(debut); curseur <= fin; curseur.setDate(curseur.getDate() + 1)) {
    const jour = `${curseur.getFullYear()}-${p(curseur.getMonth() + 1)}-${p(curseur.getDate())}`;
    const seau = seaux.get(jour);
    points.push({
      date: jour,
      ...Object.fromEntries(clesAttendues.map((k) => [k, seau?.[k] ?? 0])),
    } as { date: string } & Record<string, number>);
  }

  return points;
}
