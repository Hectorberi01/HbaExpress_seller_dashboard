"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { bff } from "@/lib/api";
import { categoryReadablePath } from "@/lib/categories";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ReadOnlyNote } from "@/components/read-only-note";
import {
  CategoryAttributesForm,
  attributsANEnvoyer,
  attributsValides,
  obligatoiresManquants,
  type ValeursAttributs,
} from "@/components/product/category-attributes-form";
import type { SellerBrand, SellerCategory, SellerProduct } from "@/types/seller";
import { AlertTriangle, Info, Loader2, Plus, X } from "lucide-react";

/**
 * Ligne de caractéristique avec identité PROPRE.
 *
 * Un couple clé/valeur ne peut pas servir de clé de liste : deux lignes vides
 * naissantes sont identiques, et la clé change dès qu'on tape. L'index non plus —
 * retirer la première ligne décale toutes les suivantes, et le curseur se retrouve
 * dans un autre champ que celui qu'on éditait.
 */
type AttributeRow = { uid: number; key: string; value: string };

let attributeSeq = 0;
const toRows = (source: Record<string, string> | undefined): AttributeRow[] =>
  Object.entries(source ?? {}).map(([key, value]) => ({ uid: ++attributeSeq, key, value }));

/**
 * Fiche descriptive du produit.
 *
 * ⚠️ `PUT /seller/products/{id}` envoie un objet COMPLET (`UpdateProductRequest`) : les
 * champs absents ne sont pas « laissés tels quels », ils sont écrasés. On repart donc
 * toujours de la fiche chargée, jamais d'un formulaire vide.
 *
 * ⚠️ La CATÉGORIE ne figure pas dans `UpdateProductCommand` : elle est fixée à la
 * création et n'est pas modifiable ici. On l'affiche en lecture seule plutôt que de
 * proposer un champ qui serait silencieusement ignoré.
 */
export function ProductIdentityForm({
  product,
  categories,
  brands,
  onSaved,
  lectureSeule = false,
}: {
  product: SellerProduct;
  categories: SellerCategory[];
  brands: SellerBrand[];
  onSaved: () => Promise<unknown>;
  /**
   * La boutique n'a plus le droit d'écrire (`SellerRights.CanSell`). `PUT
   * /seller/products/{id}` passe par `GuardAsync` et répondra 403 : on le dit avant
   * la rédaction, pas après.
   */
  lectureSeule?: boolean;
}) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description);
  const [brandId, setBrandId] = useState(product.brandId ?? "");
  /**
   * ═════════════════════════════════════════════════════════════════════════════════
   * UN SEUL CHAMP À L'ÉCRAN, DEUX COLONNES EN BASE : IL FAUT LIRE LES DEUX.
   *
   * Le champ fusionné ne lisait que `gtin`. Or l'app mobile vendeur demande TOUJOURS
   * les deux séparément (`product_wizard_sheet.dart`) : un produit créé sur mobile avec
   * le seul EAN s'ouvrait dans la console avec un code-barres VIDE, sous une phrase qui
   * promet « GTIN ou EAN ». Le vendeur concluait à une perte, ressaisissait, et la même
   * valeur se retrouvait dans les deux colonnes — l'admin affichant alors
   * « 376… / 376… ».
   *
   * `codeBarres` lit donc `gtin` puis, à défaut, `ean`. `eanExistant` retient la valeur
   * d'origine pour décider, à l'enregistrement, si elle a été absorbée ou si elle vit sa
   * propre vie (deux valeurs DIFFÉRENTES : cas hérité, qu'on ne détruit pas en silence).
   * ═════════════════════════════════════════════════════════════════════════════════
   */
  const [codeBarres, setCodeBarres] = useState(product.gtin || product.ean || "");
  const [eanExistant, setEanExistant] = useState(product.ean ?? "");
  const [tags, setTags] = useState<string[]>(product.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [attributes, setAttributes] = useState<AttributeRow[]>(() => toRows(product.attributes));

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * LES CARACTÉRISTIQUES DU SCHÉMA SORTENT DES LIGNES LIBRES.
   *
   * Cet écran éditait TOUT en clé/valeur libres : deux champs texte par ligne,
   * placeholders « Nom » et « Valeur ». Le serveur, lui, contrôle le type, les bornes
   * et l'appartenance à une liste fermée — et refuse toute clé inconnue quand la
   * catégorie ne les autorise pas. Le vendeur tapait « Bleu marine » dans une
   * catégorie qui n'admet que rouge, bleu ou noir : refus, sans que l'écran lui ait
   * jamais montré la liste que le serveur lui envoie pourtant à chaque chargement.
   * Sur une catégorie fermée, une seule ligne surnuméraire faisait échouer
   * l'enregistrement ENTIER de la fiche.
   *
   * LA SÉPARATION SE FAIT SUR LA CLÉ. Ce que le schéma décrit passe dans le
   * formulaire dessiné ; le reste reste en lignes libres — et seulement si la
   * catégorie les autorise (`allowUnknownAttributes`). Les deux moitiés sont
   * refusionnées à l'enregistrement.
   *
   * LES VALEURS HORS SCHÉMA NE SONT PAS JETÉES QUAND LA CATÉGORIE SE FERME. Un
   * produit peut porter des attributs antérieurs au schéma : les faire disparaître de
   * l'écran les ferait disparaître de la fiche au premier enregistrement, en silence.
   * Ils restent visibles, et le refus du serveur dit alors lequel retirer.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const category = categories.find((c) => c.id === product.categoryId);
  const schemaCategorie = category?.attributeSchema ?? [];
  const clesDuSchema = new Set(schemaCategorie.map((a) => a.key.toLowerCase()));
  const libresAutorisees = category?.allowUnknownAttributes ?? true;

  const [attributsSchema, setAttributsSchema] = useState<ValeursAttributs>({});

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * LE SCHÉMA ARRIVE PAR UNE AUTRE REQUÊTE, ET LE PREMIER JET PERDAIT DES DONNÉES.
   *
   * Les catégories sont chargées en parallèle du produit (`products/[id]/page.tsx`),
   * et l'écran se rend dès que le PRODUIT est là. Quand `/seller/categories` répondait
   * après lui, `schemaCategorie` valait `[]` au montage : la répartition entre
   * formulaire dessiné et lignes libres se faisait avec un schéma vide, l'initialiseur
   * `useState` ne rejouait jamais, et l'effet de resynchronisation ne dépendait que de
   * `product.id` — inchangé.
   *
   * Les clés du schéma étaient ensuite RETIRÉES de l'affichage (elles appartiennent au
   * formulaire dessiné) sans jamais y être ENTRÉES. Au premier enregistrement — et ce
   * `PUT` remplace la fiche entière — leurs valeurs disparaissaient de la base. Sur
   * une catégorie à attribut obligatoire, le bouton restait de surcroît désactivé pour
   * toujours, y compris pour corriger le nom.
   *
   * LA RÉPARTITION EST DONC REJOUÉE DÈS QUE LE SCHÉMA CHANGE, et elle repart de
   * `product.attributes` — la source — plutôt que de l'état local, ce qui la rend
   * indépendante de l'ordre d'arrivée des deux requêtes.
   *
   * `schemaSignature` PLUTÔT QUE LE TABLEAU : `attributeSchema` est un objet neuf à
   * chaque rendu de la requête, donc inutilisable comme dépendance.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const schemaCles = schemaCategorie.map((a) => a.key);
  const schemaSignature = schemaCles.join("|");

  useEffect(() => {
    const canoniques = new Map(schemaCles.map((k) => [k.toLowerCase(), k]));
    const repris: Record<string, string> = {};
    const libres: AttributeRow[] = [];

    for (const [cle, valeur] of Object.entries(product.attributes ?? {})) {
      const canonique = canoniques.get(cle.trim().toLowerCase());
      if (canonique !== undefined && !(canonique in repris)) {
        repris[canonique] = valeur;
      } else {
        // Tout le reste RESTE VISIBLE, y compris un doublon de clé du schéma : le
        // serveur retient la première graphie (`Normalize`), et faire disparaître la
        // seconde de l'écran la ferait disparaître de la fiche sans un mot.
        libres.push({ uid: ++attributeSeq, key: cle, value: valeur });
      }
    }

    const complet: ValeursAttributs = {};
    for (const k of schemaCles) complet[k] = repris[k] ?? "";

    setAttributsSchema(complet);
    setAttributes(libres);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, schemaSignature]);

  // ───────────────────────────────────────────────────────────────────────────────
  // RESYNCHRONISATION SUR L'IDENTIFIANT, PAS SUR L'OBJET.
  //
  // La version précédente dépendait de `product` — un objet recréé à CHAQUE refetch.
  // Or toute action des panneaux voisins (ajouter une photo, créer une déclinaison,
  // changer un prix, archiver) appelle `refresh()`, qui invalide la fiche.
  //
  // Résultat : le vendeur rédigeait sa description, ajoutait une photo dans la colonne
  // de droite, et sa description disparaissait — remplacée par la valeur serveur, sans
  // le moindre signal. Le champ ne se vidait pas : il revenait en arrière, ce qui est
  // plus insidieux encore.
  //
  // On ne resynchronise donc qu'au CHANGEMENT DE PRODUIT (navigation d'une fiche à
  // l'autre, où React réutilise le composant). Les autres champs de la fiche ne sont
  // modifiables que d'ici : personne d'autre ne peut les faire diverger.
  // ───────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    setName(product.name);
    setDescription(product.description);
    setBrandId(product.brandId ?? "");
    setCodeBarres(product.gtin || product.ean || "");
    setEanExistant(product.ean ?? "");
    setTags(product.tags ?? []);
    // Les attributs sont répartis par l'effet ci-dessus, qui dépend AUSSI du schéma :
    // les toucher ici les remettrait dans le mauvais panier si le schéma est déjà là.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const save = useMutation({
    mutationFn: () =>
      bff(`/seller/products/${product.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          // Chaîne vide = « aucune marque ». L'envoyer telle quelle ferait échouer la
          // désérialisation d'un Guid? côté serveur.
          brandId: brandId || null,
          gtin: codeBarres.trim() || null,
          // ─────────────────────────────────────────────────────────────────────
          // L'EAN N'EST PLUS SAISI, ET SON SORT DÉPEND DE CE QU'IL VAUT.
          //
          // La route écrase le produit ENTIER : omettre `ean` effacerait la valeur des
          // fiches qui en portent une. On ne l'omet donc jamais — on décide.
          //
          //   - L'EAN a été ABSORBÉ par le champ (la fiche n'avait pas de GTIN, le
          //     champ a donc affiché l'EAN) : on le vide, sans quoi la même valeur
          //     resterait en double dans les deux colonnes.
          //   - L'EAN porte une valeur DIFFÉRENTE du champ : cas hérité d'un produit
          //     où les deux colonnes divergent. On le reconduit tel quel. Il n'est plus
          //     affiché, mais le détruire au passage serait une perte silencieuse, et
          //     l'écran ne demande à personne de trancher.
          // ─────────────────────────────────────────────────────────────────────
          ean: eanExistant && eanExistant !== codeBarres.trim() ? eanExistant : null,
          productGroupId: product.productGroupId ?? null,
          // Les deux moitiés, refusionnées. Le schéma passe EN DERNIER : si une
          // ligne libre porte encore l'ancienne graphie d'une clé du schéma, c'est le
          // champ dessiné qui fait foi — c'est lui que le vendeur vient de remplir.
          attributes: {
            ...Object.fromEntries(
              attributes
                .filter((a) => a.key.trim().length > 0 && !clesDuSchema.has(a.key.trim().toLowerCase()))
                .map((a) => [a.key.trim(), a.value]),
            ),
            ...attributsANEnvoyer(attributsSchema),
          },
          tags,
        }),
      }),
    onSuccess: () => onSaved(),
    meta: {
      successMessage: "Fiche produit enregistrée.",
      errorMessage: "La fiche n'a pas pu être enregistrée.",
    },
  });

  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) {
      setTagInput("");
      return;
    }
    setTags([...tags, t]);
    setTagInput("");
  }

  // Chemin LISIBLE (« Électronique › Téléphones ») : `path` n'est qu'une suite de
  // slugs d'URL, et `name` seul est ambigu — plusieurs branches partagent le même.
  // `category` est résolue plus haut, avec le schéma qu'elle porte.
  const categoryLabel = category ? categoryReadablePath(category, categories) : "—";

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * UNE CATÉGORIE ARCHIVÉE GÈLE LA FICHE, ET RIEN NE LE DISAIT.
   *
   * `UpdateProductCommandHandler` passe par `ProductAttributeGuard.ResolveAsync`, dont
   * le contrôle d'archivage est INCONDITIONNEL — seul le contrôle de feuille est
   * réservé à la création. Toute modification d'un produit rangé dans une catégorie
   * archivée depuis est donc refusée en 409, y compris pour corriger une faute dans la
   * description.
   *
   * LE MESSAGE DU SERVEUR AGGRAVAIT LE PIÈGE : « choisissez-en une autre » désigne une
   * sortie qui n'existe NULLE PART. `Product.CategoryId` n'est affecté que dans le
   * constructeur, aucune méthode du domaine ne le change, et aucun contrat de
   * modification — vendeur, admin ou mobile — ne le transporte. Le vendeur remplissait,
   * enregistrait, et découvrait une impasse dont on lui indiquait la sortie par une
   * porte murée.
   *
   * LA PORTÉE EST BIEN CELLE-CI, ET PAS PLUS. Le garde n'est branché que sur
   * `CreateProduct`, `CreateProductWithImages` et `UpdateProduct` : les photos, les
   * déclinaisons, les mises en vente et le changement de statut continuent de
   * fonctionner. On le dit, plutôt que de laisser croire la fiche entièrement morte.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const categorieArchivee = (category?.status ?? "").toLowerCase() === "archived";

  /**
   * ON NE FILTRE PLUS L'AFFICHAGE SUR LA CLÉ COURANTE.
   *
   * La version précédente masquait toute ligne dont la clé appartenait au schéma. Le
   * vendeur qui ajoutait une ligne et tapait « couleur » voyait sa ligne DISPARAÎTRE
   * sous ses doigts, au dernier caractère, avec son champ — et la valeur était ensuite
   * filtrée à l'enregistrement. Une saisie qui s'évapore sans message est pire que le
   * doublon qu'elle évitait.
   *
   * La répartition se fait désormais une fois, à la lecture du produit. Ce qui reste
   * ici est affiché tel quel ; une collision de clé est SIGNALÉE, pas escamotée.
   */
  const attributesLibres = attributes;

  // On bloque l'enregistrement sur ce que le serveur refusera de toute façon : même
  // règle, dite avant l'aller-retour plutôt qu'après.
  const schemaSatisfait = attributsValides(schemaCategorie, attributsSchema);
  const manquants = obligatoiresManquants(schemaCategorie, attributsSchema);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fiche produit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {lectureSeule && <ReadOnlyNote />}
        {categorieArchivee && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p>
                <strong>Cette fiche ne peut plus être enregistrée.</strong> Sa catégorie
                («&nbsp;{categoryLabel}&nbsp;») a été retirée du catalogue, et la plateforme refuse
                toute modification d&apos;un produit qui s&apos;y trouve — même pour corriger une
                faute.
              </p>
              {/* CETTE PHRASE DÉPEND DU DROIT D'ÉCRIRE, SINON ELLE CONTREDIT L'ENCART
                  DE LECTURE SEULE RENDU JUSTE AU-DESSUS — et elle désigne précisément
                  les trois surfaces que ce droit ferme. */}
              {!lectureSeule && (
                <p>
                  Les photos, les déclinaisons et les mises en vente restent modifiables — seul
                  l&apos;enregistrement de cette fiche est bloqué.
                </p>
              )}
              <p>
                {/* ═══════════════════════════════════════════════════════════════
                    DEUX RÉDACTIONS FAUSSES AVANT CELLE-CI, ET LA MÊME ERREUR LES DEUX
                    FOIS : PROMETTRE UNE PORTE QUI N'EXISTE PAS.

                    « Contactez la plateforme pour faire déplacer ce produit » :
                    `Product.CategoryId` n'est affecté que dans le constructeur, aucune
                    méthode du domaine ne le change, aucun contrat de modification ne
                    le transporte. Personne ne peut déplacer un produit.

                    « Demander à la plateforme de remettre cette catégorie au
                    catalogue » : l'archivage d'une catégorie est TERMINAL. `Publish()`
                    et `Unpublish()` refusent tous deux une catégorie archivée, `Archive()`
                    n'a pas d'inverse, et l'administration ne monte aucune route de
                    désarchivage. La catégorie ne reviendra pas.

                    Il reste UNE sortie, et on ne prétend plus qu'elle est indolore :
                    l'index d'unicité des SKU est GLOBAL, les déclinaisons de la fiche
                    recréée devront donc en porter de nouveaux.
                    ═══════════════════════════════════════════════════════════════ */}
                Une seule issue, et elle coûte : <strong>recréer la fiche</strong> dans une
                catégorie active. Un produit ne change pas de catégorie une fois créé, et une
                catégorie archivée ne revient pas au catalogue. Pensez à donner de{" "}
                <strong>nouveaux SKU</strong> aux déclinaisons de la nouvelle fiche — les anciens
                restent pris par celle-ci.
              </p>
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="p-name">Nom</Label>
          <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="p-desc">Description</Label>
          <Textarea
            id="p-desc"
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="p-brand">Marque</Label>
            <Select id="p-brand" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              <option value="">Sans marque</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Catégorie</Label>
            <div className="flex h-9 items-center rounded-xl bg-muted px-3.5 text-sm text-muted-foreground">
              {categoryLabel}
            </div>
            <p className="text-xs text-muted-foreground">
              Fixée à la création : elle détermine le classement en boutique et ne se
              change pas depuis ici.
            </p>
          </div>

          {/* ═══════════════════════════════════════════════════════════════════════
              UN SEUL CHAMP DE CODE-BARRES, PLUS DEUX.

              GTIN et EAN étaient deux champs pour une seule notion — un EAN-13 EST un
              GTIN-13. CÔTÉ SERVEUR rien ne les distingue : même type, même nettoyage
              (`Clean`), même colonne (`HasMaxLength(14)` pour les deux), et le seul
              contrôle existant est une longueur maximale IDENTIQUE pour les deux
              (`UpdateProductCommandValidator`). Aucune clé de contrôle nulle part.
              L'admin lui-même les affiche concaténés,
              `[p.gtin, p.ean].filter(Boolean).join(" / ")`.

              (L'app mobile vendeur, elle, valide des longueurs DIFFÉRENTES — GTIN
              8/12/13/14, EAN 8/13. C'est le seul endroit de la plateforme où la
              distinction existe, et elle ne change rien à ce qu'on en fait ensuite.)

              ON NE PERD PAS LES VALEURS DÉJÀ SAISIES : voir la note de `codeBarres` plus
              haut et celle du champ `ean` à l'enregistrement. Le champ n'est plus
              PROPOSÉ ; la donnée n'est pas supprimée.

              Aucun lecteur MÉTIER n'existe pour l'un ni pour l'autre — ni recherche, ni
              dédoublonnage, ni rapprochement de fiches, et l'acheteur ne les désérialise
              même pas. On garde le GTIN parce que c'est la donnée qui rendrait
              `productGroupId` exploitable le jour où le rapprochement de fiches entre
              vendeurs existera ; on ne garde pas le doublon.
              ═══════════════════════════════════════════════════════════════════════ */}
          <div className="space-y-1.5">
            <Label htmlFor="p-gtin">Code-barres du produit</Label>
            <Input
              id="p-gtin"
              value={codeBarres}
              onChange={(e) => setCodeBarres(e.target.value)}
              placeholder="Facultatif"
            />
            <p className="text-xs text-muted-foreground">
              GTIN ou EAN, au choix. Aucune fonction de la plateforme ne s&apos;en sert
              aujourd&apos;hui — il n&apos;est affiché qu&apos;ici et côté administration.
            </p>
          </div>
        </div>

        {/* ───────── Mots-clés ───────── */}
        <div className="space-y-1.5">
          <Label htmlFor="p-tag">Mots-clés</Label>
          <div className="flex gap-2">
            <Input
              id="p-tag"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  // Sinon la touche Entrée soumettrait le formulaire parent et
                  // enregistrerait la fiche au lieu d'ajouter le mot-clé.
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="Ajouter un mot-clé puis Entrée"
            />
            <Button type="button" variant="outline" onClick={addTag} disabled={!tagInput.trim()}>
              <Plus className="size-4" />
            </Button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => setTags(tags.filter((x) => x !== t))}
                    aria-label={`Retirer le mot-clé ${t}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ───────── Caractéristiques attendues par la catégorie ───────── */}
        {schemaCategorie.length > 0 && (
          <div className="space-y-2">
            <Label>Caractéristiques de la catégorie</Label>
            <CategoryAttributesForm
              schema={schemaCategorie}
              valeurs={attributsSchema}
              onChange={setAttributsSchema}
              categorieChoisie
            />
          </div>
        )}

        {/* ───────── Caractéristiques libres ───────── */}
        <div className="space-y-2">
          <Label>{schemaCategorie.length > 0 ? "Autres caractéristiques" : "Caractéristiques"}</Label>
          {!libresAutorisees && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Cette catégorie n&apos;accepte aucune autre caractéristique que celles ci-dessus. Toute ligne
              ajoutée ici fera échouer l&apos;enregistrement de la fiche entière — celles qui
              restent affichées viennent d&apos;avant ce réglage, et sont à retirer.
            </p>
          )}
          {attributesLibres.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {schemaCategorie.length > 0 ? "Aucune autre caractéristique." : "Aucune caractéristique."} Ce
              sont les couples « Matière : coton », « Garantie : 12 mois » affichés sur la fiche
              acheteur.
            </p>
          )}
          {attributesLibres.map((a) => (
            <div key={a.uid} className="space-y-1">
            <div className="flex gap-2">
              <Input
                value={a.key}
                aria-label="Nom de la caractéristique"
                placeholder="Nom"
                onChange={(e) =>
                  setAttributes((rows) =>
                    rows.map((r) => (r.uid === a.uid ? { ...r, key: e.target.value } : r)),
                  )
                }
              />
              <Input
                value={a.value}
                aria-label="Valeur de la caractéristique"
                placeholder="Valeur"
                onChange={(e) =>
                  setAttributes((rows) =>
                    rows.map((r) => (r.uid === a.uid ? { ...r, value: e.target.value } : r)),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Retirer cette caractéristique"
                onClick={() => setAttributes((rows) => rows.filter((r) => r.uid !== a.uid))}
              >
                <X className="size-4" />
              </Button>
            </div>
            {clesDuSchema.has(a.key.trim().toLowerCase()) && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                «&nbsp;{a.key.trim()}&nbsp;» est déjà demandé ci-dessus : c'est la valeur du
                formulaire qui sera enregistrée, pas celle-ci. Retirez cette ligne.
              </p>
            )}
            </div>
          ))}
          {libresAutorisees && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setAttributes((rows) => [...rows, { uid: ++attributeSeq, key: "", value: "" }])
              }
            >
              <Plus className="size-4" /> Ajouter une caractéristique
            </Button>
          )}
        </div>

        <p className="flex items-start gap-1.5 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Enregistrer remplace la fiche entière par ce qui est affiché ci-dessus. Un champ
          vidé ici est vidé sur la boutique.
        </p>

        {manquants.length > 0 && (
          <p className="text-xs text-destructive">
            {manquants.length === 1
              ? `« ${manquants[0]} » est obligatoire dans cette catégorie.`
              : `Ces caractéristiques sont obligatoires : ${manquants.join(", ")}.`}
          </p>
        )}

        <div className="flex justify-end">
          <Button
            onClick={() => save.mutate()}
            disabled={
              lectureSeule ||
              save.isPending ||
              name.trim().length === 0 ||
              !schemaSatisfait ||
              categorieArchivee
            }
            title={
              categorieArchivee
                ? "Catégorie retirée du catalogue : la plateforme refuse toute modification de cette fiche."
                : undefined
            }
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            Enregistrer la fiche
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
