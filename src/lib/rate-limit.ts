import { NextRequest, NextResponse } from "next/server";

/**
 * Limitation de débit des routes d'authentification, DANS Next.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * POURQUOI ICI, ALORS QUE LE BFF EN A DÉJÀ UNE
 *
 * Le BFF limite `/seller/auth/*` à 30 requêtes par minute et par IP. Mais il ne voit
 * jamais l'IP des vendeurs : toutes les requêtes lui arrivent de CE conteneur. Les
 * milliers de vendeurs de la place de marché partagent donc une seule et même fenêtre.
 *
 * Les deux conséquences sont graves, et opposées :
 *  • un seul attaquant épuise le quota commun et BLOQUE la connexion et la
 *    réinitialisation de mot de passe de tout le monde, à trente requêtes par minute ;
 *  • le frein anti-force-brute par attaquant, lui, n'existe plus.
 *
 * On limite donc à l'endroit où l'on connaît le client. Faire remonter l'IP réelle
 * jusqu'au BFF aurait été l'autre solution, mais elle dépend de la façon dont les
 * en-têtes `X-Forwarded-For` sont chaînés entre Next, Traefik et le BFF — un réglage
 * d'infrastructure qu'on ne veut pas voir décider d'une garantie de sécurité.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE LIMITE N'EST PAS
 *
 * Un compteur en mémoire, par processus. Il tombe au redémarrage et ne se partage pas
 * entre réplicas. C'est un frein contre la force brute ordinaire, pas une défense
 * contre un adversaire distribué — celle-là se pose à la bordure (Traefik, ou un
 * service dédié). Le dire évite de croire le problème réglé.
 * ─────────────────────────────────────────────────────────────────────────────────
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/** Purge paresseuse : sans elle, la table grandit à chaque IP vue, indéfiniment. */
function sweep(now: number) {
  if (windows.size < 5_000) return;
  // `Array.from` plutôt qu'une itération directe : la cible de compilation du projet
  // n'autorise pas le parcours d'une Map par `for…of`, et copier les clés évite au
  // passage de muter la table pendant qu'on la parcourt.
  for (const key of Array.from(windows.keys())) {
    const w = windows.get(key);
    if (w && w.resetAt <= now) windows.delete(key);
  }
}

/**
 * IP du client telle que Next la voit.
 *
 * `x-forwarded-for` est posé par le proxy de bordure. On prend la PREMIÈRE entrée —
 * le client d'origine — et non la dernière, qui serait le proxy lui-même. Un client
 * peut mentir sur cet en-tête, mais il ne peut pas mentir sur celui que le proxy
 * ajoute : derrière Traefik, la première entrée est fiable.
 */
function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "inconnu";
}

/**
 * Consomme un jeton. Renvoie une réponse 429 s'il n'y en a plus, `null` sinon.
 *
 * @param bucket Nom du seau : les routes d'un même seau partagent le quota.
 */
export function rateLimit(
  req: NextRequest,
  bucket: string,
  limit = 10,
  windowMs = 60_000,
): NextResponse | null {
  const now = Date.now();
  sweep(now);

  const key = `${bucket}:${clientIp(req)}`;
  const current = windows.get(key);

  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (current.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return NextResponse.json(
      {
        // Message VOLONTAIREMENT identique quel que soit le compte visé : dire
        // « trop de tentatives pour cet e-mail » confirmerait son existence.
        error: "Trop de tentatives. Réessayez dans un instant.",
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  current.count += 1;
  return null;
}
