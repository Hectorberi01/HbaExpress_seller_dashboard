"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CategoryAttribute } from "@/types/seller";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * LE FORMULAIRE D'ATTRIBUTS, DESSINÉ DEPUIS LE SCHÉMA DE LA CATÉGORIE.
 *
 * `CategorySummary.AttributeSchema` existe depuis longtemps côté serveur, et son
 * commentaire dit exactement à quoi il sert : donner à l'application vendeur « de quoi
 * dessiner le formulaire (libellés, types, listes de valeurs, champs obligatoires) au
 * lieu d'un champ "attributs" libre où chacun invente ses clés ». La console ne le
 * lisait nulle part — zéro occurrence dans tout `src/`.
 *
 * CE QUE COÛTAIT CE TROU, ET IL COÛTAIT PLUS QUE DE L'ESTHÉTIQUE :
 *
 *  • L'ASSISTANT DE CRÉATION N'ENVOYAIT AUCUN ATTRIBUT. Dès que l'administration pose
 *    un attribut « obligatoire » sur une catégorie, `CategoryAttributeSchema.Validate`
 *    refuse toute création — et le refus arrive APRÈS le téléversement des photos.
 *    Impasse complète, sans un seul champ à l'écran pour satisfaire la règle.
 *
 *  • LA FICHE ÉDITAIT EN CLÉ/VALEUR LIBRES. Le serveur, lui, contrôle le type, les
 *    bornes, l'appartenance à une liste fermée, et refuse toute clé inconnue quand la
 *    catégorie ne les autorise pas. Le vendeur tapait « Bleu marine » dans une
 *    catégorie qui n'admet que rouge, bleu ou noir : refusé, sans que l'écran lui ait
 *    jamais montré la liste — que le serveur lui envoie pourtant à chaque chargement.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * DEUX RÈGLES DE CONCEPTION, TOUTES DEUX DICTÉES PAR LE SERVEUR.
 *
 * 1. ON N'ENVOIE PAS CE QUI EST VIDE. Un attribut facultatif laissé vide ne doit pas
 *    partir comme chaîne vide : `Validate` traite le blanc comme absent pour
 *    l'obligation, mais une clé vide dans une catégorie fermée deviendrait une clé
 *    « inattendue ». Le filtrage est fait au moment de produire l'objet, pas à la
 *    saisie — sans quoi le champ se viderait sous les doigts du vendeur.
 *
 * 2. LES CLÉS SONT CELLES DU SCHÉMA, TELLES QUELLES. Le domaine canonise (`Normalize`)
 *    et accepte les variantes de casse, mais c'est un rattrapage : la console n'a
 *    aucune raison d'en avoir besoin puisqu'elle tient la clé exacte.
 *
 * LES VALEURS RESTENT DES CHAÎNES, y compris pour les nombres et les booléens. C'est
 * la forme du contrat (`IReadOnlyDictionary<string, string>`) : convertir ici, puis
 * reconvertir à l'envoi, n'ajouterait qu'un endroit où « 1,5 » et « 1.5 » divergent.
 * Le séparateur décimal attendu est le POINT : `decimal.TryParse` est appelé en
 * `InvariantCulture`, où la virgule est un séparateur de milliers, pas une décimale.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */

/** Valeurs saisies, indexées par la clé technique du schéma. */
export type ValeursAttributs = Record<string, string>;

/**
 * Ne garde que ce qui est réellement renseigné. À appeler au moment de construire la
 * charge utile, jamais pendant la frappe.
 */
export function attributsANEnvoyer(valeurs: ValeursAttributs): Record<string, string> {
  const sortie: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(valeurs)) {
    const propre = (valeur ?? "").trim();
    if (propre.length > 0) sortie[cle] = propre;
  }
  return sortie;
}

/**
 * Les attributs obligatoires encore vides, par LIBELLÉ — c'est ce que le vendeur lit.
 * Miroir exact de la première boucle de `CategoryAttributeSchema.Validate`.
 */
export function obligatoiresManquants(
  schema: CategoryAttribute[],
  valeurs: ValeursAttributs,
): string[] {
  return schema
    .filter((a) => a.required && (valeurs[a.key] ?? "").trim().length === 0)
    .map((a) => a.label || a.key);
}

/**
 * Le message d'erreur d'UNE valeur, ou null si elle passe. Reprend `ValidateValue`
 * côté domaine — bornes comprises — pour que le refus arrive à la saisie et non après
 * l'envoi des photos. Le serveur reste l'autorité : ceci ne le remplace pas.
 */
export function problemeAttribut(def: CategoryAttribute, brut: string): string | null {
  const valeur = (brut ?? "").trim();
  if (valeur.length === 0) return null;

  const suffixe = def.unit ? ` ${def.unit}` : "";

  if (def.type === "number") {
    // ═════════════════════════════════════════════════════════════════════════════
    // ON ACCEPTE TOUT CE QUE LE SERVEUR ACCEPTE, ET RIEN DE MOINS.
    //
    // Le premier jet exigeait `^-?\d+(\.\d+)?$`. Le domaine, lui, appelle
    // `decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, …)`,
    // et `NumberStyles.Number` comprend AllowLeadingSign, AllowDecimalPoint,
    // AllowThousands et les espaces de bord : « +5 », « .5 », « 5. » et « 1,000 »
    // passent côté serveur et étaient refusés ici.
    //
    // CE N'EST PAS UN EXCÈS DE ZÈLE SANS CONSÉQUENCE. Cette fonction pilote
    // `attributsValides`, donc le bouton d'enregistrement de la fiche entière et le
    // passage d'étape de l'assistant : une valeur de ce format DÉJÀ EN BASE rendait la
    // fiche impossible à enregistrer, y compris pour en corriger le nom. Une
    // validation client plus stricte que le serveur ne protège de rien et enferme.
    // ═════════════════════════════════════════════════════════════════════════════
    const sansSeparateurs = valeur.replace(/,/g, "");
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(sansSeparateurs)) {
      return `« ${def.label} » doit être un nombre.`;
    }
    const n = Number(sansSeparateurs);
    if (def.min != null && n < def.min) {
      return `« ${def.label} » ne peut pas être inférieur à ${def.min}${suffixe}.`;
    }
    if (def.max != null && n > def.max) {
      return `« ${def.label} » ne peut pas dépasser ${def.max}${suffixe}.`;
    }
    return null;
  }

  if (def.type === "boolean") {
    // `bool.TryParse` est INSENSIBLE À LA CASSE, et « True » est exactement ce que
    // produit `bool.ToString()` en .NET — donc ce qu'on trouve en base. Comparer à
    // « true » seul rendait ces fiches définitivement non enregistrables.
    const b = valeur.toLowerCase();
    return b === "true" || b === "false" ? null : `« ${def.label} » doit valoir oui ou non.`;
  }

  if (def.type === "enum") {
    return (def.values ?? []).some((v) => v.toLowerCase() === valeur.toLowerCase())
      ? null
      : `« ${def.label} » doit être l'une des valeurs : ${(def.values ?? []).join(", ")}.`;
  }

  // Texte : Min et Max sont des LONGUEURS, pas des bornes numériques.
  if (def.min != null && valeur.length < def.min) {
    return `« ${def.label} » doit comporter au moins ${def.min} caractères.`;
  }
  const maxi = def.max ?? 500;
  return valeur.length > maxi
    ? `« ${def.label} » ne peut pas dépasser ${maxi} caractères.`
    : null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * CE QU'UN `<select>` PEUT RÉELLEMENT AFFICHER.
 *
 * La validation accepte « True » et « Rouge » — insensible à la casse, comme le
 * serveur. Un `<select>` non : `value="Rouge"` sans `<option value="Rouge">` n'affiche
 * RIEN. Le vendeur lisait donc un champ vide sur une donnée qui existe, et la croyait
 * perdue.
 *
 * On ramène donc la valeur à la graphie canonique quand elle correspond. Quand elle ne
 * correspond à rien — une valeur retirée du schéma depuis — on ne l'escamote pas : une
 * option supplémentaire la porte, marquée comme hors liste, pour qu'elle soit visible
 * et remplaçable plutôt que silencieusement écrasée au premier enregistrement.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
function valeurCanonique(def: CategoryAttribute, brut: string): string {
  const v = (brut ?? "").trim();
  if (v.length === 0) return "";
  if (def.type === "boolean") {
    const b = v.toLowerCase();
    return b === "true" ? "true" : b === "false" ? "false" : v;
  }
  if (def.type === "enum") {
    return (def.values ?? []).find((x) => x.toLowerCase() === v.toLowerCase()) ?? v;
  }
  return brut;
}

/** Vrai si la valeur ne figure dans aucune option — elle a besoin de la sienne. */
function horsListe(def: CategoryAttribute, canonique: string): boolean {
  if (canonique.length === 0) return false;
  if (def.type === "boolean") return canonique !== "true" && canonique !== "false";
  if (def.type === "enum") return !(def.values ?? []).includes(canonique);
  return false;
}

/** Vrai si tout le schéma est satisfait — obligatoires remplis et valeurs valides. */
export function attributsValides(
  schema: CategoryAttribute[],
  valeurs: ValeursAttributs,
): boolean {
  if (obligatoiresManquants(schema, valeurs).length > 0) return false;
  return schema.every((def) => problemeAttribut(def, valeurs[def.key] ?? "") === null);
}

export function CategoryAttributesForm({
  schema,
  valeurs,
  onChange,
  categorieChoisie,
}: {
  /** Le schéma de la catégorie choisie. Vide = la catégorie n'impose rien. */
  schema: CategoryAttribute[];
  valeurs: ValeursAttributs;
  onChange: (valeurs: ValeursAttributs) => void;
  /** Faux tant qu'aucune catégorie n'est choisie : on ne sait pas quoi demander. */
  categorieChoisie: boolean;
}) {
  const poser = (cle: string, valeur: string) => onChange({ ...valeurs, [cle]: valeur });

  const obligatoires = useMemo(() => schema.filter((a) => a.required).length, [schema]);
  const herites = useMemo(() => schema.filter((a) => a.inheritedFrom), [schema]);

  if (!categorieChoisie) {
    return (
      <p className="text-xs text-muted-foreground">
        Choisissez d&apos;abord une catégorie : c&apos;est elle qui détermine les
        caractéristiques attendues.
      </p>
    );
  }

  if (schema.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Cette catégorie n&apos;impose aucune caractéristique.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {obligatoires > 0 && (
        <p className="text-xs text-muted-foreground">
          {obligatoires === 1
            ? "Une caractéristique est obligatoire dans cette catégorie."
            : `${obligatoires} caractéristiques sont obligatoires dans cette catégorie.`}{" "}
          La fiche sera refusée sans elles.
        </p>
      )}

      {herites.length > 0 && (
        // ═══════════════════════════════════════════════════════════════════════
        // ON DIT D'OÙ VIENNENT LES CHAMPS, SANS LES SÉPARER EN DEUX FORMULAIRES.
        //
        // Le schéma servi compose désormais toute la branche : « Marque » vient
        // d'Informatique, « Processeur » d'Ordinateurs, « Taille d'écran » de la
        // feuille. Le vendeur n'a aucune raison de distinguer les trois — il remplit
        // une fiche, pas une hiérarchie — mais il a besoin de comprendre pourquoi on
        // lui demande « Marque » sur un ordinateur portable.
        //
        // Une seule phrase, en tête : deux sections repliables auraient donné à
        // l'héritage une importance qu'il n'a pas pour celui qui saisit.
        // ═══════════════════════════════════════════════════════════════════════
        <p className="text-xs text-muted-foreground">
          {herites.length === 1 ? "Une caractéristique vient" : `${herites.length} caractéristiques viennent`}
          {" "}des rayons parents ({Array.from(new Set(herites.map((a) => a.inheritedFrom))).join(", ")}) :
          {herites.length === 1 ? " elle s'applique" : " elles s'appliquent"} à tout ce rayon.
        </p>
      )}

      {schema.map((def) => {
        const brut = valeurs[def.key] ?? "";
        const valeur = valeurCanonique(def, brut);
        const probleme = problemeAttribut(def, brut);
        const champId = `attr-${def.key}`;
        const inconnue = horsListe(def, valeur);

        return (
          <div key={def.key} className="space-y-1.5">
            <Label htmlFor={champId}>
              {def.label || def.key}
              {def.required && <span className="ml-1 text-destructive">*</span>}
              {def.unit && <span className="ml-1 text-muted-foreground">({def.unit})</span>}
            </Label>

            {def.type === "enum" ? (
              <select
                id={champId}
                value={valeur}
                onChange={(e) => poser(def.key, e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {/* L'entrée vide reste proposée même sur un champ obligatoire : la
                    retirer choisirait une valeur à la place du vendeur, et la
                    première de la liste passerait pour un choix délibéré. */}
                <option value="">— Choisir —</option>
                {inconnue && (
                  <option value={valeur}>{valeur} — valeur hors liste, à remplacer</option>
                )}
                {(def.values ?? []).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : def.type === "boolean" ? (
              <select
                id={champId}
                value={valeur}
                onChange={(e) => poser(def.key, e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {/* Trois états, et c'est volontaire : une case à cocher n'aurait pas su
                    dire « non renseigné », et aurait envoyé « false » pour un champ
                    auquel le vendeur n'a jamais touché. */}
                <option value="">— Non renseigné —</option>
                {inconnue && (
                  <option value={valeur}>{valeur} — valeur hors liste, à remplacer</option>
                )}
                <option value="true">Oui</option>
                <option value="false">Non</option>
              </select>
            ) : (
              <Input
                id={champId}
                value={valeur}
                inputMode={def.type === "number" ? "decimal" : undefined}
                onChange={(e) => poser(def.key, e.target.value)}
                placeholder={def.type === "number" ? "Ex. 1.5 (point décimal)" : undefined}
                aria-invalid={probleme !== null}
              />
            )}

            {probleme && <p className="text-xs text-destructive">{probleme}</p>}
          </div>
        );
      })}
    </div>
  );
}
