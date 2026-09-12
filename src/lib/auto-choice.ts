"use client";

import { useEffect, useRef } from "react";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * UNE LISTE À UN SEUL CHOIX N'EST PAS UN CHOIX.
 *
 * Trois écrans demandaient d'ouvrir un menu déroulant pour y désigner l'unique entrée :
 * l'entrepôt de l'assistant de création, celui de « Suivre une référence », et la
 * déclinaison comme l'entrepôt de la mise en vente. Pour le vendeur mono-entrepôt et
 * mono-déclinaison — le cas majoritaire — c'est trois ouvertures de liste par produit
 * pour une information que l'écran connaît déjà.
 *
 * L'ASSISTANT AVAIT DÉJÀ LE BON RÉFLEXE pour le lieu qu'il vient de créer : « Le
 * laisser à choisir dans la liste, juste après l'avoir saisi, c'est demander deux fois
 * la même chose ». Ce hook applique la même idée au cas où la liste n'a jamais compté
 * qu'une entrée.
 *
 * ON N'APPLIQUE QU'UNE FOIS PAR VALEUR. Si le vendeur revient à « — Choisir — »
 * délibérément, on ne lui remet pas la valeur sous les doigts au rendu suivant : une
 * présélection qu'on ne peut pas défaire est pire que pas de présélection du tout.
 *
 * ET ON MÉMORISE AUSSI QUAND ON NE FAIT RIEN. Première version : la garde n'était
 * posée que lorsque le hook écrivait lui-même. Une valeur venue d'ailleurs — l'écran
 * de création d'entrepôt de l'assistant, qui sélectionne le lieu qu'il vient de
 * créer — laissait donc la garde vide, et le premier effacement volontaire du vendeur
 * était annulé au rendu suivant. Exactement ce que le paragraphe ci-dessus promet
 * d'éviter.
 *
 * DÈS DEUX ENTRÉES, ON NE CHOISIT PAS. Deviner lequel des deux entrepôts le vendeur
 * veut, c'est se tromper une fois sur deux — et sur un envoi, l'erreur se paie en
 * livraison partie du mauvais endroit.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
export function useAutoChoisirUnique(
  value: string,
  onChoose: (value: string) => void,
  options: readonly string[],
): void {
  const applique = useRef<string | null>(null);

  // LA DÉPENDANCE EST LE CONTENU, PAS LE TABLEAU. Les appelants construisent leur
  // liste d'options à chaque rendu (`locations.map(l => l.id)`) : dépendre du tableau
  // ferait tourner l'effet à chaque frappe dans n'importe quel champ de la page.
  const seule = options.length === 1 ? options[0] : null;

  useEffect(() => {
    if (!seule) return;
    if (applique.current === seule) return;

    // Une valeur est déjà là — posée par le vendeur, ou par un autre chemin. On ne la
    // touche pas, ET on note que cette option est traitée : sans cela, un effacement
    // ultérieur rouvrirait la porte à une présélection non désirée.
    if (value.trim().length > 0) {
      applique.current = seule;
      return;
    }

    applique.current = seule;
    onChoose(seule);
    // `onChoose` hors dépendances : les appelants passent un setter `useState`, stable
    // par construction, mais le hook n'a aucun moyen de l'exiger d'un appelant futur.
    // La garde `applique` rend l'effet idempotent quoi qu'il arrive — c'est elle qui
    // porte la correction, pas la liste de dépendances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seule, value]);
}
