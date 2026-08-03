/**
 * Clic sur une ligne de tableau qui NAVIGUE — sauf si l'on vient de sélectionner du
 * texte.
 *
 * Sur une ligne entièrement cliquable, sélectionner à la souris le nom d'un client
 * pour le copier se termine par un `click` sur la ligne : la page change au moment
 * même où l'on croyait avoir capturé le texte, et la sélection est perdue. Le geste
 * est banal — coller une référence dans une conversation ou un e-mail —, la
 * frustration l'est tout autant.
 *
 * On vérifie donc qu'il ne reste aucune sélection avant de partir. Le lien contenu
 * dans la ligne, lui, reste le chemin nominal (clavier, clic milieu, nouvel onglet).
 */
export function shouldNavigateOnRowClick(): boolean {
  if (typeof window === "undefined") return true;
  const selection = window.getSelection();
  return !selection || selection.isCollapsed || selection.toString().trim().length === 0;
}
