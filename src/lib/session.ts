import "server-only";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { DEFAULT_INSECURE_SESSION_SECRET, SESSION_COOKIE, SESSION_COOKIE_SECURE, SESSION_SECRET } from "./config";

/**
 * Session serveur : les jetons sont détenus par Next, jamais par le navigateur.
 *
 *   - accessToken  : JWT Bearer (~15 min) envoyé au BFF pour chaque appel.
 *   - refreshToken : jeton de rafraîchissement, reçu du BFF DANS LE CORPS JSON.
 *   - expiresAt    : expiration du JWT (ISO), pour rafraîchir proactivement.
 *   - name / email : affichage uniquement.
 *
 * Le tout est chiffré (AES-256-GCM) dans un cookie httpOnly de l'origine Next.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * DIFFÉRENCE AVEC LA CONSOLE ADMIN, ET POURQUOI ELLE NE CHANGE RIEN ICI
 *
 * Le BFF Admin renvoie son refresh token dans un cookie `__Secure-admin_rt` ; le BFF
 * Vendeur le renvoie dans le corps de la réponse (`SellerAuthEndpoints.LoginAsync`).
 * C'est un écart relevé par l'audit (§2.4) et il compte pour l'app mobile, qui parle
 * au BFF directement.
 *
 * Il ne compte PAS ici : le navigateur ne voit jamais cette réponse. C'est le serveur
 * Next qui appelle le BFF, lit le jeton et le range dans ce cookie chiffré. La surface
 * exposée au JavaScript client est identique dans les deux consoles — nulle.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
export interface SellerSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  name: string;
  email?: string;
}

/**
 * Clé AES dérivée du secret, calculée PARESSEUSEMENT au premier usage (runtime), et
 * jamais à l'import : `next build` évalue les modules en NODE_ENV=production sans les
 * secrets, donc lever une exception au chargement casserait la compilation.
 *
 * ⚠️ En PRODUCTION, on REFUSE de servir si le secret est absent, trop court, ou resté
 * sur la valeur par défaut publique : sinon n'importe qui pourrait forger ou déchiffrer
 * les cookies de session, donc voler le refresh token d'un vendeur. Le crash survient
 * ici, au premier chiffrement/déchiffrement — c'est-à-dire au runtime.
 */
/**
 * Un secret est-il inexploitable en production ?
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * LE CONTRÔLE PRÉCÉDENT ATTRAPAIT LA VALEUR QU'ON N'UTILISE JAMAIS ET LAISSAIT PASSER
 * CELLE QU'ON COPIE-COLLE.
 *
 * Il testait deux choses : l'égalité avec le défaut interne, et une longueur d'au moins
 * 32 caractères. Or le fichier d'exemple livré avec le projet contient
 * « CHANGE_ME_openssl_rand_base64_32 » — qui fait EXACTEMENT 32 caractères et n'est pas
 * le défaut interne. Les deux conditions étaient donc fausses : l'application démarrait
 * en production, sans le moindre avertissement, avec un secret écrit en toutes lettres
 * dans le dépôt. Quiconque l'a lu peut déchiffrer et FORGER n'importe quel cookie de
 * session, donc récupérer le jeton de rafraîchissement — valable trente jours — de
 * n'importe quel vendeur.
 *
 * On ne se contente donc plus de compter les caractères. Une valeur d'exemple se
 * reconnaît à ce qu'elle ANNONCE ce qu'elle est ; et un secret réel, tiré au hasard,
 * ne répète pas trois fois les mêmes symboles.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
function weakSecret(secret: string): boolean {
  if (!secret || secret.length < 32) {
    return true;
  }
  if (secret === DEFAULT_INSECURE_SESSION_SECRET) {
    return true;
  }

  const lowered = secret.toLowerCase();
  // Marqueurs de valeur d'exemple. Un secret tiré de `openssl rand -base64 32` n'a
  // aucune raison de contenir ces mots ; un placeholder les contient toujours.
  const placeholders = ["change_me", "changeme", "example", "placeholder", "todo", "secret_here", "xxxx"];
  if (placeholders.some((marker) => lowered.includes(marker))) {
    return true;
  }

  // Entropie grossière : 32 octets aléatoires en base64 donnent une quarantaine de
  // symboles distincts. « aaaa…aaaa » en donne un. Le seuil est bas à dessein — il
  // s'agit d'attraper l'inattention, pas d'auditer un générateur.
  const distinct = new Set(secret).size;
  return distinct < 12;
}

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (cachedKey) {
    return cachedKey;
  }
  if (process.env.NODE_ENV === "production" && weakSecret(SESSION_SECRET)) {
    throw new Error(
      "SESSION_SECRET manquant, trop court (< 32 caractères), trop peu varié, ou laissé " +
        "sur une valeur d'exemple. Générez-en un : openssl rand -base64 32",
    );
  }
  cachedKey = crypto.createHash("sha256").update(SESSION_SECRET).digest(); // 32 octets
  return cachedKey;
}

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

function decrypt(payload: string): string | null {
  try {
    const [ivB64, tagB64, dataB64] = payload.split(".");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}

export function getSession(): SellerSession | null {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const json = decrypt(raw);
  if (!json) return null;
  try {
    return JSON.parse(json) as SellerSession;
  } catch {
    return null;
  }
}

export function setSession(session: SellerSession): void {
  cookies().set(SESSION_COOKIE, encrypt(JSON.stringify(session)), {
    httpOnly: true,
    secure: SESSION_COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 j, aligné sur la durée du refresh côté BFF
  });
}

export function clearSession(): void {
  cookies().delete(SESSION_COOKIE);
}
