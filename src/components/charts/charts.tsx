"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * LES DEUX SEULES FORMES DE GRAPHE DE LA CONSOLE VENDEUR.
 *
 * Une ligne pour ce qui évolue dans le temps, des barres horizontales pour comparer
 * des grandeurs. Rien d'autre : chaque forme supplémentaire est une occasion de se
 * tromper, et aucune donnée de cette console n'en demande une troisième.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * JAMAIS DEUX AXES VERTICAUX SUR UN MÊME TRACÉ.
 *
 * C'est la règle la plus importante de ce fichier, et la plus tentante à enfreindre :
 * « commandes » et « chiffre d'affaires » sur un seul graphe, deux échelles, deux
 * couleurs. L'alignement des deux échelles est ARBITRAIRE — on le choisit — et il
 * fabrique une corrélation que la donnée ne contient pas. Deux mesures d'ordres de
 * grandeur différents font DEUX graphes.
 *
 * C'est pourquoi `SerieTemporelle` n'expose aucun axe secondaire : l'API rend la
 * faute impossible plutôt que de la déconseiller.
 * ─────────────────────────────────────────────────────────────────────────────────
 *
 * Les couleurs viennent de `--viz-series-*` (voir globals.css) : elles ont été
 * validées en vision déficiente, et elles changent de pas en thème sombre. On ne les
 * écrit jamais en dur ici.
 */

/**
 * Les trois emplacements de série, dans l'ordre. On ne les recycle pas au-delà : une
 * quatrième teinte engendrée à la volée n'est validée contre rien.
 *
 * ATTENTION AU MODE D'ÉCHEC. `COULEURS[3]` vaut `undefined`, React omet alors
 * l'attribut `stroke`, et un `stroke` absent sur un tracé SVG ne donne pas du noir :
 * il donne `none`, c'est-à-dire une courbe INVISIBLE. Une quatrième série ne serait
 * donc pas mal colorée, elle serait silencieusement absente du graphe tout en
 * figurant dans la légende et dans le tableau. D'où le garde-fou ci-dessous, qui
 * préfère un plantage lisible en développement à une donnée qui disparaît.
 */
const COULEURS = ["var(--viz-series-1)", "var(--viz-series-2)", "var(--viz-series-3)"];
const MAX_SERIES = COULEURS.length;

const GRILLE = "hsl(var(--border))";
const ENCRE_AXE = "hsl(var(--muted-foreground))";

export interface SerieDef {
  /** Clé du champ dans les données. */
  cle: string;
  /** Libellé affiché en légende et en infobulle. */
  libelle: string;
}

/** Infobulle commune : surface de carte, encre de texte, jamais la couleur de série pour le texte. */
function Infobulle({
  actif,
  payload,
  label,
  formatX,
  formatValeur,
}: {
  actif?: boolean;
  payload?: ReadonlyArray<{ dataKey?: string | number; name?: string | number; value?: number; color?: string }>;
  label?: string | number;
  formatX: (v: string) => string;
  formatValeur: (v: number) => string;
}) {
  if (!actif || !payload || payload.length === 0) return null;

  return (
    <div className="nm-elevated rounded-xl bg-white p-2.5 text-xs dark:bg-card">
      <div className="mb-1 font-medium">{formatX(String(label ?? ""))}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          {/* La pastille porte l'identité, le texte reste en encre : une valeur écrite
              dans la couleur de sa série devient illisible dès que le contraste baisse. */}
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: p.color }}
          />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto tabular-nums">{formatValeur(Number(p.value ?? 0))}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Courbe d'évolution. Une à trois séries, UNE seule échelle verticale.
 *
 * Les points ne portent pas de marqueur permanent : un rond sur chaque jour d'une
 * période de trois mois fait une chenille, pas une courbe. Le marqueur apparaît au
 * survol, à 8 px de diamètre, avec un anneau de la couleur de la surface.
 */
export function SerieTemporelle({
  donnees,
  cleX,
  series,
  formatX,
  formatValeur,
  formatAxeY,
}: {
  /**
   * Les points, dans l'ordre. `object` plutôt que `Record<string, unknown>` : une
   * interface aux champs connus — la forme normale d'un contrat de ce dépôt — n'a pas
   * de signature d'index et ne s'assigne donc pas à `Record`. Exiger `Record` aurait
   * poussé chaque appelant à élargir son type, c'est-à-dire à perdre la vérification
   * qui l'intéresse.
   */
  donnees: readonly object[];
  cleX: string;
  /** Une à trois séries. Au-delà, il faut regrouper ou séparer en plusieurs graphes. */
  series: SerieDef[];
  /** Formate une valeur de l'axe X pour l'affichage (date ISO → « 12 sept. »). */
  formatX: (v: string) => string;
  /** Formate une valeur de série pour l'infobulle. */
  formatValeur: (v: number) => string;
  /** Formate une graduation de l'axe Y. Par défaut, le même que l'infobulle. */
  formatAxeY?: (v: number) => string;
}) {
  const formatY = formatAxeY ?? formatValeur;

  if (series.length > MAX_SERIES) {
    throw new Error(
      `SerieTemporelle : ${series.length} séries demandées, ${MAX_SERIES} au maximum. ` +
        "Au-delà, il faut regrouper le reste ou séparer en plusieurs graphes — pas " +
        "inventer une couleur.",
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={donnees as unknown as Record<string, unknown>[]} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        {/* Grille horizontale SEULE, trait plein : une grille en pointillés se lit
            comme un seuil ou une projection alors qu'elle n'est qu'un repère. */}
        <CartesianGrid stroke={GRILLE} strokeDasharray="0" vertical={false} />
        <XAxis
          dataKey={cleX}
          tickFormatter={(v: string) => formatX(String(v))}
          tick={{ fill: ENCRE_AXE, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: GRILLE }}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(v: number) => formatY(Number(v))}
          tick={{ fill: ENCRE_AXE, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={56}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ stroke: GRILLE, strokeWidth: 1 }}
          content={(props) => (
            <Infobulle
              actif={props.active}
              payload={props.payload as never}
              label={props.label as string | number | undefined}
              formatX={formatX}
              formatValeur={formatValeur}
            />
          )}
        />
        {/* La légende est présente dès DEUX séries — l'identité ne doit jamais reposer
            sur la seule couleur. Une série unique est nommée par le titre de la carte. */}
        {series.length > 1 && (
          <Legend
            verticalAlign="top"
            align="left"
            height={28}
            iconType="plainline"
            wrapperStyle={{ fontSize: 12, color: ENCRE_AXE }}
          />
        )}
        {series.map((s, i) => (
          <Line
            key={s.cle}
            type="monotone"
            dataKey={s.cle}
            name={s.libelle}
            stroke={COULEURS[i]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * Barres HORIZONTALES pour comparer des grandeurs par catégorie.
 *
 * Horizontales parce que les libellés de catégorie sont des mots : à la verticale, ils
 * se chevauchent ou s'inclinent, et un libellé incliné ne se lit pas.
 *
 * UNE SEULE COULEUR pour toutes les barres. Teinter chaque barre selon sa hauteur
 * encoderait deux fois la même information et gaspillerait le seul canal disponible ;
 * et des statuts de commande ne sont pas des identités qui demandent des couleurs.
 */
export function BarresCategories({
  donnees,
  cleCategorie,
  cleValeur,
  libelleValeur,
  formatValeur,
}: {
  /**
   * Les points, dans l'ordre. `object` plutôt que `Record<string, unknown>` : une
   * interface aux champs connus — la forme normale d'un contrat de ce dépôt — n'a pas
   * de signature d'index et ne s'assigne donc pas à `Record`. Exiger `Record` aurait
   * poussé chaque appelant à élargir son type, c'est-à-dire à perdre la vérification
   * qui l'intéresse.
   */
  donnees: readonly object[];
  cleCategorie: string;
  cleValeur: string;
  libelleValeur: string;
  formatValeur: (v: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={donnees as unknown as Record<string, unknown>[]}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 0, left: 4 }}
      >
        <CartesianGrid stroke={GRILLE} strokeDasharray="0" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => formatValeur(Number(v))}
          tick={{ fill: ENCRE_AXE, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: GRILLE }}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey={cleCategorie}
          tick={{ fill: ENCRE_AXE, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={128}
        />
        <Tooltip
          cursor={{ fill: GRILLE, fillOpacity: 0.35 }}
          content={(props) => (
            <Infobulle
              actif={props.active}
              payload={props.payload as never}
              label={props.label as string | number | undefined}
              formatX={(v) => v}
              formatValeur={formatValeur}
            />
          )}
        />
        <Bar
          dataKey={cleValeur}
          name={libelleValeur}
          fill={COULEURS[0]}
          // Extrémité arrondie côté valeur, angle droit côté axe : la barre reste
          // ancrée à sa ligne de base, elle ne flotte pas.
          radius={[0, 4, 4, 0]}
          maxBarSize={18}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
