# Audit — le formulaire de création de produit

**Console vendeur `Seller_MP_Next`**, assistant `src/app/(seller)/products/nouveau/page.tsx`.
Backend vérifié : `marketPlace`. Apps comparées : `HbaExpressPro` (vendeur),
`Client_Mobile_Portail` (acheteur), `Admin_MP_Next`.

---

## La question posée, et celle qu'il fallait poser

La demande était : « quels champs sont inutiles ? ». Répondre par « ceux que le serveur
n'exige pas » aurait été rapide et faux — le serveur n'exige presque rien, et ce n'est
pas ce qui rend un champ utile.

Trois questions décident, dans cet ordre :

1. **Qui lit ce champ ensuite ?** Pas « où est-il stocké » — qui s'en sert. Un champ
   écrit en base et jamais relu coûte du temps au vendeur et ne rend rien à personne.
2. **Peut-on le renseigner après coup ?** Un champ corrigeable depuis la fiche n'a pas
   à barrer la route de la première mise en vente.
3. **Que se passe-t-il si on se trompe ?** Un champ qu'aucune route ne permet de
   modifier ensuite doit être demandé à la création, même s'il est facultatif pour le
   serveur — parce que l'erreur y est définitive.

C'est la troisième qui réserve les surprises : **trois champs de cet assistant ne sont
plus modifiables du tout après création**, et rien à l'écran ne le dit pour deux d'entre
eux.

---

## 1. Le tableau, champ par champ

L'assistant a **trois** étapes (`page.tsx:80`), pas quatre — l'ancienne étape
« Déclinaison » a été fusionnée dans « Vente & stock ». L'app mobile vendeur, elle, en
a encore quatre.

Légende de la colonne « lecteurs » : **acheteur** = la valeur atteint l'écran d'un
client ; **moteur** = elle entre dans un calcul, un filtre, une recherche ou une règle
métier ; **vendeur seul** = elle ne fait que revenir à celui qui l'a saisie ; **aucun** =
personne, nulle part.

| Champ | Étape | Oblig. écran | Oblig. serveur | Lecteurs | Corrigeable après ? |
|---|---|---|---|---|---|
| Catégorie | 1 | oui | oui | moteur + acheteur | **NON — définitif** |
| Nom | 1 | oui (≥3) | oui | moteur (seul champ cherché) + acheteur | oui |
| Description | 1 | oui (≥10) | **non** | acheteur | oui |
| Caractéristiques de catégorie | 1 | si le schéma l'impose | oui si `required` | garde de schéma (admin) | oui |
| Photos | 1 | oui (≥1) | oui (≥1) | acheteur + vignette d'index | oui |
| Marque | 1 | non | non | admin seul | oui |
| **GTIN** | 1 | non | non | **aucun** | oui |
| **EAN** | 1 | non | non | **aucun** | oui |
| **Mots-clés** | 1 | non | non | **aucun** (sauf le mot `featured`) | oui |
| SKU | 2 | oui | **non** (généré si vide) | moteur + acheteur | oui, sauf si une offre existe (409) |
| Attributs de déclinaison | 2 | non | non | acheteur (sélecteur de taille/couleur) | oui |
| **Code-barres** | 2 | non | non | **aucun** | oui |
| **Poids** | 2 | **oui** | ≥ 0 | vendeur seul — **aucun calcul** | oui |
| État de l'article | 2 | non (défaut Neuf) | oui (énumération) | acheteur | **NON — aucune route** |
| Prix perçu | 2 | oui (>0) | oui (>0) | moteur + acheteur | oui |
| Lieu d'expédition | 2 | oui | oui | moteur, de bout en bout | **NON — aucune route** |
| Stock initial | 2 | oui (≥1) | ≥ 0 | moteur | oui |
| Seuil d'alerte | 2 | oui | ≥ 0 | écran Stock | oui |
| **Délai de préparation** | 2 | non (défaut 2) | ≥ 0 | **vendeur seul** | oui |

Deux champs que l'on croit présents ne le sont pas : **les dimensions** sont envoyées en
dur à `null` (`page.tsx:428-430`), et **`productGroupId`** n'est jamais demandé.

---

## 2. Les champs dont personne ne lit la valeur

Chaque affirmation ci-dessous a été vérifiée dans le code, pas déduite d'un nom de
champ. « Aucun lecteur » signifie : recherche exhaustive sur `marketPlace/src`,
`marketPlace/tests` et les quatre applications ; les seuls résultats sont le chemin
d'écriture, la configuration EF et, parfois, un ré-affichage au vendeur lui-même.

### GTIN et EAN — deux champs pour une seule notion, et aucun des deux ne sert

Un EAN-13 **est** un GTIN-13. On peut vouloir distinguer les deux dans un référentiel
qui les traite différemment. Ce n'est pas le cas ici :

- même type, même nettoyage, même colonne : `Product.cs:63-64` et `:140-141`,
  `ProductConfiguration.cs:25-26` (`HasMaxLength(14)` pour les deux) ;
- **aucune validation ne les distingue** — pas de contrôle de longueur, pas de clé de
  contrôle. Une recherche `luhn|checkdigit|gtin13` sur les quatre dépôts ne rend rien.
  Un EAN à sept chiffres passe ;
- l'écran ne filtre que les non-chiffres (`page.tsx:724` et `:733`) ;
- **l'admin lui-même ne les distingue pas** : il les concatène dans une seule ligne,
  `[p.gtin, p.ean].filter(Boolean).join(" / ")` ;
- l'acheteur ne les voit jamais : le client mobile ne les désérialise même pas.

Aucune recherche, aucun dédoublonnage, aucun rapprochement de fiches ne s'appuie
dessus. **Deux champs, une notion, zéro usage.**

### Code-barres de déclinaison — écrit, projeté, jamais consommé

Il est bien transmis jusqu'au contrat (`ProductVariantSummary.Barcode`), et là il
s'arrête : ni scan, ni recherche, ni affichage acheteur, ni affichage admin. Le seul
endroit où il réapparaît est la liste des déclinaisons du vendeur qui l'a saisi.

### Dimensions — le cas le plus net, et elles ne sont même pas demandées ici

Elles n'existent pas dans l'assistant, mais elles existent dans la fiche produit, à la
création d'une déclinaison — et il faut le dire parce que c'est pire :

- elles ne sont **pas projetées** dans `ProductVariantSummary` (`ProductSummary.cs:24-29`
  ne porte que `Id, Sku, Attributes, Barcode, WeightGrams`). **Le vendeur qui les saisit
  ne peut plus jamais les relire** — le formulaire de modification les réinitialise à
  vide, et la commande de mise à jour ne les porte pas ;
- leur seule lecture dans tout le dépôt est un test unitaire.

### Mots-clés — l'aide à l'écran décrit une fonction qui n'existe pas

`page.tsx:745-747` : « Ils aident la recherche à trouver votre article. »

C'est faux, et c'est vérifiable en deux gestes : `SearchDocument` ne porte aucun tag,
et la recherche ne compare que le nom et le slug. Le seul consommateur de `Tags` dans
toute la plateforme est `.Where(p => p.Tags.Contains("featured"))`, qui alimente la page
d'accueil acheteur — un drapeau éditorial administratif.

Un vendeur qui saisit « cuir, sac, artisanal » remplit un champ que rien ne lit, sur la
foi d'une phrase qui lui promet le contraire.

### Délai de préparation — même mensonge, sur un champ plus visible

`page.tsx:1011-1013` : « C'est ce délai qui sert à annoncer une date de livraison. »

Faux également. `handlingTime` n'apparaît nulle part dans les modules Shipping,
Ordering, Cart, ni dans le BFF acheteur — il n'est même pas dans la projection envoyée
au client. Le délai annoncé à l'acheteur vient de `ShippingRate.Eta`, **un texte libre
saisi par zone** (« Livraison sous 24h à 48h »).

Le champ n'est donc pas inutile — le vendeur s'en sert pour lui-même — mais il ne fait
pas ce que l'écran lui promet.

### Poids — obligatoire à l'écran, utilisé par aucun calcul

Celui-ci mérite sa nuance. Le poids **est** ré-affiché dans trois écrans, il n'est donc
pas orphelin. Mais il n'entre dans **aucun calcul**, et la raison est structurelle :

> « Le montant est un forfait, pas un calcul. Il ne dépend ni du poids, ni du volume, ni
> du nombre d'articles — seulement de la zone de destination et du service choisi. »
> — `ShippingRate.cs`

Le seul point d'entrée tarifaire prend **une commune**, rien d'autre. Et pourtant le
poids est un champ **obligatoire** de l'étape 2 : le vendeur ne peut pas avancer sans le
renseigner, pour une donnée que le tarif ignore.

### `productGroupId` — un index PostgreSQL pour une requête qui n'a jamais été écrite

C'est le mécanisme qui permettrait à plusieurs vendeurs de partager une même fiche
(« une fiche, N offres »). Aujourd'hui : personne ne le génère, aucun service
d'appariement n'existe, aucune requête ne le filtre ni ne le groupe. Le seul écran qui
le saisit est du **code mort** dans l'app mobile (`ProductCreateSheet`, qui n'est
référencé nulle part — l'app ouvre `ProductWizardSheet`).

À ne pas supprimer pour autant : c'est une intention d'architecture, pas un oubli. Mais
il n'a rien à faire dans un formulaire tant que rien ne l'exploite — et il n'y est pas.

---

## 3. Les trois champs définitifs, dont deux ne le disent pas

C'est le vrai enjeu de ce formulaire, et il est passé inaperçu parce qu'il ne ressemble
pas à un problème de champ.

| Champ | Ce que le vendeur lit | Ce qu'il peut faire s'il se trompe |
|---|---|---|
| **Catégorie** | « n'est plus modifiable ensuite » (`page.tsx:622`) | Rien. L'écran le dit — c'est le seul. |
| **État de l'article** | rien | Rien. Les seules routes d'offre sont prix, statut, délai, remise, suppression. Il faut **supprimer l'offre et la recréer**. |
| **Lieu d'expédition** | rien | Rien. Même remède. |

Et le récapitulatif de la dernière étape affirme l'inverse :

> « Vérifiez avant de créer. **Tout reste modifiable ensuite** depuis la fiche du
> produit. » — `page.tsx:1023-1024`

Trois champs sur dix-neuf démentent cette phrase. Un vendeur qui choisit « Occasion »
par erreur sur un article neuf devra supprimer sa mise en vente et tout recommencer,
après avoir lu qu'il pourrait la corriger.

---

## 4. Ce que je propose

Le principe : **on ne demande à la création que ce qu'on ne peut pas corriger ensuite,
plus le strict nécessaire pour vendre.** Tout le reste va sur la fiche produit, où le
vendeur revient de toute façon.

### À retirer du formulaire — et du produit

Ces champs ne sont lus par personne. Les déplacer sur la fiche ne ferait que déplacer le
temps perdu.

| Champ | Pourquoi |
|---|---|
| **EAN** | Doublon de GTIN, sans distinction de traitement ni de validation. |
| **Code-barres de déclinaison** | Aucun lecteur, aucun scan. |
| **Dimensions** (dans la fiche) | Aucun lecteur, et le vendeur ne peut même pas les relire. |

### À déplacer sur la fiche produit

| Champ | Pourquoi |
|---|---|
| **GTIN** (renommé « Code-barres du produit ») | Un seul champ au lieu de deux. Aucun usage aujourd'hui, mais c'est la donnée qui rendrait `productGroupId` exploitable un jour. À garder, pas à demander en premier. |
| **Marque** | Facultative, corrigeable, lue par l'admin seul. |
| **Mots-clés** | Corrigeables, et sans effet tant que la recherche ne les indexe pas. |
| **Poids** | À rendre **facultatif** : aucun calcul ne l'utilise. Il redeviendra obligatoire le jour où le tarif cessera d'être forfaitaire — et ce jour-là, ce sera une décision explicite. |
| **Délai de préparation** | Défaut à 2 jours, corrigeable en un clic depuis la carte « Mises en vente ». |

### À garder à la création — et à mieux dire

| Champ | Pourquoi |
|---|---|
| Catégorie, nom, description, photos, caractéristiques obligatoires | Le produit n'existe pas sans eux. |
| SKU, prix, stock, seuil | La mise en vente n'existe pas sans eux. |
| **État de l'article** | À garder **et à signaler comme définitif**, au même titre que la catégorie. |
| **Lieu d'expédition** | Idem. |

### Le résultat

**Dix-neuf champs demandés aujourd'hui, onze après.** Les trois replis « Plus
d'informations » de l'étape 1 disparaissent : il ne reste rien à y mettre.

Et deux phrases à corriger avant tout le reste, parce qu'elles coûtent moins cher que
n'importe quel déplacement de champ :

- « Ils aident la recherche à trouver votre article » (mots-clés) ;
- « C'est ce délai qui sert à annoncer une date de livraison » (délai de préparation) ;
- « Tout reste modifiable ensuite » (récapitulatif) — à nuancer par la liste des trois
  champs définitifs.

---

## 5. Trois trouvailles hors sujet, qui ne peuvent pas attendre l'audit suivant

### A. Un vendeur peut se mettre lui-même en page d'accueil

Le tag `featured` est censé être réservé à l'admin, via sa propre route
(`SetProductTagsCommand`, « tableau de bord admin — notamment pour marquer/démarquer
*featured* »). Mais :

- `Product.Create` et `Product.Update` acceptent le tableau `tags` **sans filtrer aucune
  valeur réservée** ;
- les deux routes vendeur (`POST /seller/products`, `PUT /seller/products/{id}`)
  transmettent le champ tel quel ;
- la page d'accueil acheteur sert
  `.Where(p => p.Status == Active && p.Tags.Contains("featured"))`.

Un vendeur dont un produit est déjà publié semble donc pouvoir s'ajouter au carrousel
d'accueil en tapant `featured` dans un champ de texte libre — celui-là même dont
l'écran lui dit qu'il « aide la recherche ».

**Je ne l'ai pas exécuté** : c'est une lecture de code, elle demande confirmation en
recette. Si elle se confirme, la correction est d'une ligne, dans le domaine plutôt que
dans chaque endpoint.

### B. Le chemin de création réel de la plateforme n'a aucun validateur

`CreateProductWithImagesCommand` est la commande utilisée par la console **et** par
l'app mobile. C'est le seul des trois chemins de création/modification de produit sans
`AbstractValidator`. Conséquence : longueur du nom (200), de la description (4 000), du
GTIN et de l'EAN (14) ne sont contrôlées qu'au niveau de la colonne PostgreSQL — donc
**après** le téléversement des photos sur R2. Le vendeur attend l'envoi de huit images,
puis reçoit une erreur de base de données.

Asymétrie à corriger au passage : `CreateProductCommandValidator` valide `Gtin` et
**oublie `Ean`**.

### C. La justification des caractéristiques de catégorie est périmée

`ProductAttributeGuard` invoque « la recherche à facettes » pour justifier la
normalisation des attributs. Il n'y a aucune facette : les critères de recherche sont
`(Text, CategoryId, SortBy, Page, PageSize, SellerId, CategoryIds)`, et `SearchDocument`
ne contient aucun attribut.

Ce n'est pas un défaut — constituer la donnée d'avance est un choix défendable — mais
c'est une promesse que le code fait et que la plateforme ne tient pas encore. À trancher
plutôt qu'à laisser vieillir : soit les facettes arrivent, soit le commentaire change.

---

## 6. Ordre de réparation proposé

1. **Les trois phrases fausses.** Coût quasi nul, effet immédiat : le vendeur cesse de
   remplir des champs sur la foi d'une promesse.
2. **Signaler les champs définitifs** (état de l'article, lieu d'expédition), comme la
   catégorie l'est déjà.
3. **Retirer EAN, code-barres et dimensions.** Aucun lecteur : rien à migrer, rien à
   préserver.
4. **Déplacer marque, GTIN, mots-clés, poids et délai** sur la fiche produit ; rendre le
   poids facultatif.
5. **Le tag `featured`** — à confirmer en recette, puis à filtrer dans le domaine.
6. **Le validateur manquant** sur `CreateProductWithImagesCommand`.

Les points 1 à 4 sont de la console. Les points 5 et 6 sont du backend et demandent ta
compilation.
