import "server-only";
import { SELLER_BFF_URL } from "./config";
import type { SellerSession } from "./session";

/** Décode (sans vérifier) le payload d'un JWT reçu de NOTRE BFF via TLS. */
function decodeJwt(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/**
 * Jetons tels que le BFF Vendeur les renvoie (`AuthTokens`, sérialisé en camelCase).
 *
 * ⚠️ Le login les emballe dans `LoginResponse { mfaRequired, tokens }`, alors que le
 * refresh renvoie l'objet À PLAT. C'est le genre d'écart qu'on ne remarque qu'en
 * production, sous la forme d'une session vide et inexplicable : les deux formes sont
 * donc traitées explicitement plus bas, pas devinées.
 */
interface AuthTokens {
  accessToken?: string;
  accessTokenExpiresOnUtc?: string;
  refreshToken?: string;
  refreshTokenExpiresOnUtc?: string;
}

/** Réponse du login vendeur : soit une demande de code MFA, soit les jetons. */
interface LoginResponseBody {
  mfaRequired?: boolean;
  tokens?: AuthTokens | null;
}

/** Construit une session à partir d'une paire de jetons du BFF. */
function sessionFromTokens(tokens: AuthTokens | null | undefined): SellerSession | null {
  if (!tokens?.accessToken || !tokens.refreshToken) return null;

  const claims = decodeJwt(tokens.accessToken);
  const given = (claims["given_name"] as string) ?? "";
  const family = (claims["family_name"] as string) ?? "";
  const email = (claims["email"] as string) ?? undefined;
  const name = `${given} ${family}`.trim() || email || "Vendeur";

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.accessTokenExpiresOnUtc ?? new Date(Date.now() + 10 * 60_000).toISOString(),
    name,
    email,
  };
}

export type LoginResult =
  | { ok: true; session: SellerSession }
  | { ok: false; mfaRequired: true }
  | { ok: false; mfaRequired?: false; status: number; message: string; code?: string };

/**
 * POST /seller/auth/login.
 *
 * Le BFF exige le rôle `Seller` dès la porte : un acheteur reçoit 401 ici, il ne
 * découvre pas son absence de droits écran par écran.
 */
export async function bffLogin(email: string, password: string, mfaCode?: string): Promise<LoginResult> {
  const res = await fetch(`${SELLER_BFF_URL}/seller/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, mfaCode: mfaCode ?? null }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as LoginResponseBody & { detail?: string; title?: string };

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      // ───────────────────────────────────────────────────────────────────────
      // LE CODE REMONTE, ET PAS SEULEMENT LE MESSAGE.
      //
      // `Results.Problem(title: code, detail: message)` met le CODE dans `title`.
      // On ne gardait que `detail` — donc la phrase, jamais l'identifiant. Or
      // « compte suspendu » et « adresse non confirmée » sortent tous deux en 403 :
      // sans le code, l'écran ne peut pas les distinguer, et il ne lui reste qu'à
      // reconnaître une phrase française — qui changera.
      //
      // C'est ce code qui permet d'orienter un vendeur non vérifié vers la saisie
      // de son code plutôt que de le laisser devant un mur.
      // ───────────────────────────────────────────────────────────────────────
      code: typeof json?.title === "string" ? json.title : undefined,
      message: json?.detail ?? json?.title ?? "Identifiants invalides.",
    };
  }
  if (json?.mfaRequired) return { ok: false, mfaRequired: true };

  const session = sessionFromTokens(json.tokens);
  if (!session) return { ok: false, status: 500, message: "Réponse d'authentification inattendue." };
  return { ok: true, session };
}

/**
 * POST /seller/auth/refresh. Renvoie la session mise à jour, ou null si le jeton a été
 * révoqué ou a expiré.
 *
 * Le BFF ROTATE le refresh token : la réponse en contient un nouveau, et l'ancien est
 * immédiatement invalide. Ne pas enregistrer le nouveau déconnecterait donc le vendeur
 * au rafraîchissement SUIVANT — panne différée de quinze minutes, particulièrement
 * pénible à relier à sa cause. `sessionFromTokens` exige les deux jetons pour cette
 * raison : une réponse incomplète vaut échec, pas session à moitié valide.
 */
export async function bffRefresh(session: SellerSession): Promise<SellerSession | null> {
  if (!session.refreshToken) return null;

  // ─────────────────────────────────────────────────────────────────────────────────
  // UN SEUL RAFRAÎCHISSEMENT À LA FOIS PAR JETON.
  //
  // Le BFF RÉVOQUE l'ancien refresh token avant d'en émettre un nouveau. Un jeton ne
  // vaut donc qu'un seul appel : le deuxième reçoit 401.
  //
  // Or les écrans lancent leurs requêtes en parallèle — la page Produits en fait
  // quatre, le Portefeuille trois. Passé les quinze minutes de validité de l'access
  // token, ces requêtes constatent toutes l'expiration EN MÊME TEMPS et déclenchaient
  // autant de rafraîchissements concurrents avec le MÊME jeton. Le premier réussissait,
  // les autres recevaient 401, effaçaient la session et renvoyaient le vendeur à la
  // connexion — au moment précis où il revenait sur la console, et de façon
  // parfaitement aléatoire selon l'ordre d'arrivée des réponses.
  //
  // On mémorise donc l'appel en cours et on le PARTAGE : les requêtes concurrentes
  // attendent le même résultat au lieu d'en réclamer chacune un.
  //
  // Limite assumée : cette mémoire vit dans le processus Node. Avec plusieurs
  // instances derrière un répartiteur, deux processus peuvent encore se concurrencer.
  // Fermer complètement la fenêtre demanderait un verrou partagé (Redis) ; cela
  // couvre le déploiement mono-conteneur actuel, et transforme un incident fréquent
  // en cas résiduel.
  // ─────────────────────────────────────────────────────────────────────────────────
  const inFlight = refreshInFlight.get(session.refreshToken);
  if (inFlight) {
    const shared = await inFlight;
    // Le nom et l'e-mail viennent de LA session de l'appelant : deux requêtes
    // concurrentes portent le même compte, mais autant ne rien supposer.
    return shared ? { ...shared, name: session.name, email: session.email } : null;
  }

  const promise = performRefresh(session.refreshToken).finally(() => {
    refreshInFlight.delete(session.refreshToken);
  });
  refreshInFlight.set(session.refreshToken, promise);

  const next = await promise;
  if (!next) return null;

  // Nom et e-mail sont bien présents dans le nouveau jeton (même générateur côté
  // serveur), mais on garde ceux de la session : ils ne changent pas d'un refresh à
  // l'autre, et l'affichage reste stable si un jeton arrivait un jour amputé.
  return { ...next, name: session.name, email: session.email };
}

/**
 * Rafraîchissements en cours, indexés par le jeton consommé.
 *
 * Volontairement au niveau du module : c'est ce qui permet à deux requêtes HTTP
 * distinctes, traitées par le même processus, de partager le même appel.
 */
const refreshInFlight = new Map<string, Promise<SellerSession | null>>();

/** Appel réel au BFF. Ne pas utiliser directement : passer par `bffRefresh`. */
async function performRefresh(refreshToken: string): Promise<SellerSession | null> {
  const res = await fetch(`${SELLER_BFF_URL}/seller/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  });
  if (!res.ok) return null;

  // Le refresh renvoie AuthTokens À PLAT (pas d'enveloppe `tokens`), contrairement au login.
  const json = (await res.json().catch(() => ({}))) as AuthTokens;
  return sessionFromTokens(json);
}

/**
 * POST /seller/auth/logout — révoque le refresh token côté serveur.
 *
 * Best-effort : si l'appel échoue, on efface quand même la session locale. Mais on
 * l'APPELLE, contrairement au tableau de bord Blazor qu'il remplace, où `LogoutAsync`
 * était implémenté et jamais invoqué — le jeton restait valide trente jours après une
 * déconnexion, y compris sur un poste partagé.
 */
export async function bffLogout(session: SellerSession): Promise<void> {
  await fetch(`${SELLER_BFF_URL}/seller/auth/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
    cache: "no-store",
  }).catch(() => undefined);
}

/**
 * POST /seller/auth/password/forgot.
 *
 * ⚠️ Ce chemin — et non `/forgot-password`. Les routes de mot de passe vivent dans
 * `SellerRegistrationEndpoints`, aux côtés de l'inscription, et c'est celles-là que
 * l'application mobile appelle déjà. La console utilise les mêmes, pour qu'une
 * correction serveur profite aux deux surfaces à la fois.
 *
 * La réponse est neutre : le compte existe ou non, le serveur répond pareil.
 */
export async function bffForgotPassword(email: string): Promise<Response> {
  return fetch(`${SELLER_BFF_URL}/seller/auth/password/forgot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
    cache: "no-store",
  });
}

/**
 * POST /seller/auth/password/reset.
 *
 * ⚠️ Le champ s'appelle `code`, PAS `token` : `SellerResetRequest(Email, Code,
 * NewPassword)`. C'est cohérent avec ce que reçoit l'utilisateur — six chiffres — et
 * envoyer `token` ferait échouer la liaison en silence, avec un mot de passe vide.
 */
export async function bffResetPassword(email: string, code: string, newPassword: string): Promise<Response> {
  return fetch(`${SELLER_BFF_URL}/seller/auth/password/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code, newPassword }),
    cache: "no-store",
  });
}

// ─────────────────────────────────────────────────────────────────────────────────
// Auto-inscription vendeur (deux étapes)
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Étape 1 — POST /seller/auth/register.
 *
 * Crée le compte s'il n'existe pas, ou identifie l'existant (un acheteur qui se lance),
 * puis envoie un code à six chiffres. Aucune boutique n'est créée à ce stade.
 *
 * ⚠️ `phoneNumber` est déclaré nullable dans le contrat du BFF, mais le validateur de
 * `RegisterUserCommand` exige `NotEmpty()` : l'omettre échoue en 400. Il est donc traité
 * comme OBLIGATOIRE par le formulaire.
 */
export async function bffRegisterSeller(body: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
}): Promise<Response> {
  return fetch(`${SELLER_BFF_URL}/seller/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

/**
 * Étape 2 — POST /seller/auth/verify.
 *
 * Valide le code, PUIS crée la boutique, attribue le rôle Seller et active le compte.
 * C'est ici que le nom de boutique est fourni : la boutique n'existe qu'une fois la
 * possession de la boîte e-mail prouvée.
 */
export async function bffVerifySeller(body: {
  /**
   * L'ADRESSE, ET NON L'IDENTIFIANT.
   *
   * `SellerVerifyRequest` prend `Email` depuis septembre 2026, et le commentaire de
   * `VerifyEmailCodeCommand` dit pourquoi : « c'est ce qui ferme l'oracle
   * d'énumération ». `/register` ne rend donc plus de `userId` — il n'y a plus rien
   * à transmettre entre les deux étapes que ce que l'utilisateur a lui-même saisi.
   *
   * Cette fonction envoyait encore `userId`. La liaison serveur trouvait `Email`
   * nul et refusait : l'étape 2 de l'inscription ne pouvait pas aboutir.
   */
  email: string;
  code: string;
  shopName: string;
  company?: Record<string, string | null> | null;
}): Promise<Response> {
  return fetch(`${SELLER_BFF_URL}/seller/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

/** Renvoi du code de vérification — POST /seller/auth/verify/resend. */
export async function bffResendSellerCode(email: string): Promise<Response> {
  return fetch(`${SELLER_BFF_URL}/seller/auth/verify/resend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
    cache: "no-store",
  });
}

/** Appel authentifié d'un endpoint du BFF avec le jeton de la session. */
export async function bffFetch(path: string, accessToken: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(`${SELLER_BFF_URL}${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

/** Le jeton d'accès est-il expiré, ou sur le point de l'être ? */
export function isExpired(session: SellerSession, skewMs = 30_000): boolean {
  const exp = new Date(session.expiresAt).getTime();
  return Number.isNaN(exp) || exp - skewMs <= Date.now();
}
