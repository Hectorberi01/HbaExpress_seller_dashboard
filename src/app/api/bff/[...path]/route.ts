export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { bffFetch, bffRefresh, isExpired } from "@/lib/bff";
import { clearSession, getSession, setSession } from "@/lib/session";

/**
 * Proxy authentifié vers le BFF Vendeur. Le navigateur appelle /api/bff/<chemin>
 * (même origine que l'app) ; Next y attache le Bearer de la session, rafraîchit
 * le jeton au besoin (proactivement + sur 401), puis relaie la réponse telle quelle.
 * Aucun jeton ne transite par le JavaScript client.
 */
/** Méthodes qui changent l'état : on y exige une origine same-site (anti-CSRF). */
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Voir la note dans le handler : 25 Mo, marge comprise sur les 20 Mo de photos. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

/**
 * ═════════════════════════════════════════════════════════════════════════════════
 * CE PROXY NE BORNAIT PAS SON CHEMIN, ET `encodeURIComponent` NE LE BORNAIT PAS NON
 * PLUS.
 *
 * Le chemin était reconstruit en `"/" + params.path.map(encodeURIComponent).join("/")`,
 * ce qui a l'air d'une garde et n'en est pas une : le point n'est pas un caractère
 * réservé, donc `encodeURIComponent("..")` vaut `".."`. Un segment de remontée
 * traversait l'encodage intact.
 *
 * PORTÉE RÉELLE MESURÉE, ET ELLE EST NULLE AUJOURD'HUI. L'hôte du BFF Vendeur ne monte
 * que `/seller/*` et les sondes anonymes ; il n'y a rien d'autre à atteindre. Ce qui se
 * ferme ici n'est donc pas une fuite constatée, c'est une garde absente — celle qui
 * décide de ce qui se passe le jour où une route est montée à la racine de cet hôte.
 * Ce jour-là, elle deviendrait joignable par tout vendeur authentifié, avec un jeton
 * valide, et personne n'aurait touché à ce fichier.
 *
 * ON REFUSE PAR LISTE BLANCHE, pas en cherchant des motifs dangereux : la liste des
 * façons d'écrire une remontée est ouverte, celle des préfixes légitimes tient en un
 * mot. Les sondes ne passent pas par ici — elles sont anonymes et n'ont pas besoin du
 * jeton de session que ce proxy attache.
 * ═════════════════════════════════════════════════════════════════════════════════
 */
const ALLOWED_PREFIX = "seller";

function pathRefuse(segments: string[]): boolean {
  if (segments.length === 0) return true;

  // C'EST CETTE LIGNE QUI FAIT TOUT LE TRAVAIL. Le préfixe est la seule garantie qui
  // ne dépende d'aucune subtilité d'encodage : quoi qu'on écrive ensuite, on reste
  // sous /seller.
  if (segments[0] !== ALLOWED_PREFIX) return true;

  // Le reste est une ceinture. Un segment vide vient d'un double slash ; « . » et
  // « .. » sont des remontées ; le backslash est traité comme un séparateur par
  // certains serveurs et pas par d'autres. Le test porte sur le segment ENTIER après
  // décodage par Next, donc un « ..%2f.. » n'y répond pas — il reste inoffensif
  // uniquement parce que `encodeURIComponent` ré-échappe la barre oblique plus bas.
  return segments.some((seg) => seg === "" || seg === "." || seg === ".." || seg.includes("\\"));
}

async function handler(req: NextRequest, ctx: { params: { path: string[] } }) {
  // Défense anti-CSRF en profondeur : en plus de SameSite=Lax sur le cookie de
  // session, on rejette toute requête MUTANTE dont l'Origin n'est pas la nôtre.
  // Les navigateurs envoient toujours `Origin` sur les requêtes non-GET ; une
  // absence d'Origin (clients non-navigateur) est tolérée.
  //
  // ⚠️ On compare l'HÔTE, pas `req.nextUrl.origin` : derrière un reverse proxy
  // (Traefik), `nextUrl` porte l'URL INTERNE du conteneur (http://localhost:3000),
  // jamais le domaine public. Comparer les deux rejetait donc TOUTES les requêtes
  // légitimes en 403. L'en-tête `x-forwarded-host` (posé par le proxy) — sinon
  // `host` — donne l'hôte réellement demandé par le navigateur.
  if (MUTATING.has(req.method)) {
    // ─────────────────────────────────────────────────────────────────────────────
    // ORIGIN OBLIGATOIRE, ET HÔTE ATTENDU OBLIGATOIRE AUSSI.
    //
    // La version précédente tolérait une requête SANS `Origin`, au motif que les
    // clients non-navigateur n'en envoient pas. Le raisonnement se retourne : un
    // client non-navigateur ne détient pas le cookie httpOnly de session, il n'a donc
    // rien à faire ici. La tolérance ne servait personne et retirait la garantie.
    //
    // Elle acceptait aussi le cas où l'hôte attendu était introuvable — un `if`
    // imbriqué où l'absence d'information valait autorisation. On refuse désormais
    // par défaut : c'est le seul sens acceptable pour un contrôle anti-CSRF.
    // ─────────────────────────────────────────────────────────────────────────────
    const origin = req.headers.get("origin");
    const expectedHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");

    let originHost: string | null = null;
    if (origin) {
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
    }

    if (!originHost || !expectedHost || originHost !== expectedHost) {
      return NextResponse.json({ error: "Origine non autorisée." }, { status: 403 });
    }
  }

  // Avant la session : un chemin hors périmètre n'a aucune raison de faire
  // rafraîchir un jeton, ni d'apprendre si la session est valide.
  if (pathRefuse(ctx.params.path ?? [])) {
    return NextResponse.json({ error: "Chemin non autorisé." }, { status: 404 });
  }

  let session = getSession();
  if (!session) {
    // `sessionExpired` distingue NOTRE 401 (plus de session côté Next) de celui que le
    // BFF renvoie pour une erreur MÉTIER — mot de passe faux, code 2FA invalide. Sans
    // ce marqueur, le client traitait les deux pareil et déconnectait le vendeur à la
    // moindre faute de frappe. Voir `bff()` dans src/lib/api.ts.
    return NextResponse.json({ error: "Non authentifié.", sessionExpired: true }, { status: 401 });
  }

  if (isExpired(session)) {
    const next = await bffRefresh(session);
    if (!next) {
      clearSession();
      return NextResponse.json({ error: "Session expirée.", sessionExpired: true }, { status: 401 });
    }
    setSession(next);
    session = next;
  }

  const path = "/" + ctx.params.path.map(encodeURIComponent).join("/");
  const search = req.nextUrl.search;
  const method = req.method;
  const hasBody = method !== "GET" && method !== "HEAD";

  // ───────────────────────────────────────────────────────────────────────────────
  // PLAFOND DE CORPS — LES ROUTE HANDLERS N'EN ONT AUCUN.
  //
  // Contrairement aux API routes du Pages Router, un route handler de l'App Router
  // accepte un corps de taille illimitée. `arrayBuffer()` le charge INTÉGRALEMENT en
  // mémoire, puis `Buffer.from` en fait une seconde copie : deux fois la taille reçue,
  // dans le processus Next, pour chaque requête concurrente.
  //
  // L'auto-inscription vendeur étant ouverte, un compte suffisait à faire tomber la
  // console par épuisement mémoire en quelques requêtes. Le plafond est aligné sur le
  // plus gros envoi légitime — la création de produit multipart, bornée côté client à
  // 20 Mo de photos — avec la marge des frontières multipart et des champs texte.
  // ───────────────────────────────────────────────────────────────────────────────
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (hasBody && Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Envoi trop volumineux. Réduisez le nombre ou le poids des fichiers." },
      { status: 413 },
    );
  }

  const bodyBuf = hasBody ? await req.arrayBuffer() : undefined;

  // `Content-Length` est déclaratif : on revérifie sur les octets RÉELLEMENT reçus.
  // Un en-tête absent ou menteur ne doit pas contourner le plafond.
  if (bodyBuf && bodyBuf.byteLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Envoi trop volumineux. Réduisez le nombre ou le poids des fichiers." },
      { status: 413 },
    );
  }
  const contentType = req.headers.get("content-type") ?? undefined;

  const call = (token: string) =>
    bffFetch(`${path}${search}`, token, {
      method,
      body: bodyBuf ? Buffer.from(bodyBuf) : undefined,
      headers: contentType ? { "Content-Type": contentType } : undefined,
    });

  let res = await call(session.accessToken);

  // Le jeton a pu être révoqué : une tentative de refresh + rejeu.
  if (res.status === 401) {
    const next = await bffRefresh(session);
    if (!next) {
      clearSession();
      return NextResponse.json({ error: "Session expirée.", sessionExpired: true }, { status: 401 });
    }
    setSession(next);
    session = next;
    res = await call(session.accessToken);
  }

  // 204/205/304 n'ont, par spec, aucun corps : construire une Response avec un
  // body (même vide) sur ces statuts fait lever undici (« Invalid response status
  // code »). On relaie donc un corps null pour ces cas.
  if (res.status === 204 || res.status === 205 || res.status === 304) {
    return new NextResponse(null, { status: res.status });
  }

  const buf = await res.arrayBuffer();
  return new NextResponse(buf, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
  });
}

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
};
