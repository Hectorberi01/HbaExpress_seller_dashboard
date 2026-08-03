/**
 * Export CSV côté navigateur.
 *
 * Volontairement minuscule et sans dépendance : un tableur ne demande pas davantage,
 * et une bibliothèque de plus pour concaténer des lignes serait mal employée.
 */

/**
 * Échappe une cellule.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * DEUX PROTECTIONS, PAS UNE.
 *
 * 1. Guillemets, points-virgules et sauts de ligne : la règle CSV habituelle.
 *
 * 2. INJECTION DE FORMULE. Excel et LibreOffice interprètent une cellule commençant
 *    par « = », « + », « - » ou « @ » comme une FORMULE. Un libellé venant du serveur
 *    — et les libellés d'écriture contiennent des données saisies ailleurs — peut donc
 *    devenir du code exécuté à l'ouverture du fichier, sur le poste du vendeur.
 *    On préfixe d'une apostrophe, qui force le tableur à traiter la cellule comme du
 *    texte sans altérer ce qui s'affiche.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
function cell(value: string): string {
  const raw = value ?? "";

  // ⚠️ NE PAS NEUTRALISER LES NOMBRES.
  //
  // Le garde ci-dessus attrape aussi le « - » d'un montant négatif. Appliqué sans
  // discernement, il sortait « -1500 » en « '-1500 » : Excel lisait la cellule comme du
  // TEXTE, la colonne des montants n'était plus sommable, et comme la majorité des
  // écritures d'un relevé sont négatives (commissions, frais, remboursements), l'export
  // perdait tout son intérêt.
  //
  // Un nombre pur ne peut pas être une formule : on le laisse passer.
  const isNumeric = /^-?\d+(?:[.,]\d+)?$/.test(raw);
  const guarded = !isNumeric && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;

  return `"${guarded.replace(/"/g, '""')}"`;
}

/**
 * Assemble un CSV.
 *
 * Séparateur : le POINT-VIRGULE. Excel en locale française attend celui-ci ; avec une
 * virgule, tout le fichier atterrit dans une seule colonne. Le BOM UTF-8 ajouté par
 * `downloadCsv` complète l'affaire pour les accents.
 */
export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
}

/** Déclenche le téléchargement d'un CSV depuis le navigateur. */
export function downloadCsv(filename: string, content: string): void {
  // « ﻿ » : sans ce BOM, Excel lit le fichier en ANSI et les accents deviennent
  // illisibles — sur une console entièrement en français, ce n'est pas un détail.
  const blob = new Blob([`﻿${content}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Libération différée : révoquer dans la foulée de `click()` fonctionne sous Chrome,
  // mais produit ailleurs un fichier vide — le navigateur n'a pas fini de lire le blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
