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
 * ═════════════════════════════════════════════════════════════════════════════════
 * ON LIT LA DERNIÈRE ENTRÉE. LA PREMIÈRE EST CELLE QUE LE CLIENT A ÉCRITE LUI-MÊME.
 *
 * Ce code prenait la première, avec le raisonnement suivant : « le client peut mentir
 * sur cet en-tête, mais pas sur celui que le proxy ajoute ; derrière Traefik, la
 * première entrée est fiable ». La conclusion ne suit pas de la prémisse — elle
 * l'inverse. Un proxy inverse AJOUTE l'adresse de son pair EN FIN de chaîne. Ce qui
 * précède vient donc du client, en entier, et la première entrée est exactement la
 * seule valeur qu'il contrôle.
 *
 * Le backend documente le même proxy et lit dans l'autre sens (ForwardedHeadersSetup,
 * `ForwardLimit = 1`, « ASP.NET ne lit que la DERNIÈRE entrée — celle écrite par le
 * proxy, pas celle fournie par le client »). Les deux moitiés de la plateforme
 * démontaient la même chaîne par des bouts opposés ; c'est le backend qui a raison.
 *
 * CE QUE CELA VALAIT EN PRATIQUE, ET IL FAUT ÊTRE EXACT : sur CE déploiement, la
 * faille n'est pas démontrée. Traefik est le seul saut devant la console
 * (`deploy/docker-compose.prod.yml`), aucun `trustedIPs` n'est déclaré, et son
 * middleware supprime par défaut les `X-Forwarded-*` reçus d'un pair non fiable avant
 * de poser les siens : l'en-tête arrivant ici ne porterait alors qu'une entrée, et
 * première == dernière.
 *
 * LE CORRECTIF RESTE JUSTE, POUR UNE AUTRE RAISON. Le raisonnement d'origine était
 * faux, et il tenait tout seul : rien dans ce fichier ne dépend de la configuration de
 * Traefik, qu'un changement d'infrastructure ou un second proxy peut modifier sans que
 * personne relise ce code. Lire comme le backend (`ForwardLimit = 1`, dernière entrée)
 * met les deux moitiés de la plateforme d'accord et rend la garantie indépendante d'un
 * réglage qu'on ne voit pas d'ici.
 *
 * SI L'EN-TÊTE EST ABSENT, ON NE DEVINE PAS. `x-real-ip` sert de repli — Traefik le
 * supprime quand il vient du client, mais ne le pose pas forcément lui-même, donc ce
 * repli sera probablement mort en production. En son absence, la clé vaut « inconnu »
 * et tout le monde partage un seul seau. C'est volontairement inconfortable : un
 * déploiement sans proxy de confiance devant Next ne peut pas avoir de limite par IP
 * digne de ce nom, et mieux vaut que cela se voie qu'une garantie qui n'en est pas une.
 * ═════════════════════════════════════════════════════════════════════════════════
 */
function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    const last = parts[parts.length - 1]?.trim();
    if (last) return last;
  }
  return req.headers.get("x-real-ip")?.trim() || "inconnu";
}

/**
 * Consomme un jeton. Renvoie une réponse 429 s'il n'y en a plus, `null` sinon.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * LES SEUILS ONT ÉTÉ RELEVÉS EN MÊME TEMPS QUE LA LECTURE DE L'EN-TÊTE, ET C'EST
 * INSÉPARABLE.
 *
 * Les chiffres étaient posés comme on les pose en Europe. Le backend
 * explique pourquoi ils ne valent pas ici (AuthRateLimiter) : au Bénin, les opérateurs
 * mobiles partagent une même adresse publique entre des milliers d'abonnés. Une limite
 * « par IP » n'y est pas une limite par personne, c'est une limite PAR QUARTIER. Le
 * backend est passé de 10 à 30 pour cette raison ; la console avait réintroduit 10, et
 * descendait à 3 sur « mot de passe oublié » — quatre vendeurs du même opérateur dans
 * la même minute, et le quatrième était refusé sans avoir rien fait.
 *
 * 30 ne protège pas moins que 10 : une attaque réelle envoie des milliers de requêtes,
 * et les deux la freinent identiquement. La différence est entièrement du côté des
 * utilisateurs de bonne foi.
 *
 * CE QUE CELA NE PROTÈGE TOUJOURS PAS : un compte précis contre une attaque lente et
 * distribuée. La parade est un verrouillage PAR COMPTE après N échecs ; elle n'existe
 * pas plus ici que côté backend, qui le dit aussi.
 * ─────────────────────────────────────────────────────────────────────────────────
 *
 * @param bucket Nom du seau : les routes d'un même seau partagent le quota.
 */
export function rateLimit(
  req: NextRequest,
  bucket: string,
  limit = 30,
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
