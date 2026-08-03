/**
 * Configuration serveur. Ces valeurs ne doivent JAMAIS fuiter au navigateur :
 * elles ne sont lues que dans les route handlers / le code serveur.
 */

/**
 * URL de base du BFF Vendeur. Défaut = STAGING, délibérément : un déploiement mal
 * configuré tombe ainsi sur la staging, jamais sur la production par accident. En
 * production, `SELLER_BFF_URL` DOIT être défini explicitement.
 */
export const SELLER_BFF_URL = (
  process.env.SELLER_BFF_URL ?? "https://seller.marketplace-staging.hba-marketplace.fr"
).replace(/\/$/, "");

/**
 * Secret de chiffrement du cookie de session.
 *
 * ⚠️ La valeur par défaut est un secret PUBLIC connu, tolérable UNIQUEMENT en
 * développement. Le refus de démarrer en production si le secret est absent ou trop
 * court est appliqué au RUNTIME (voir `key()` dans session.ts), et surtout PAS à
 * l'import : `next build` s'exécute en NODE_ENV=production sans les secrets, donc une
 * exception au chargement de ce module casserait la compilation.
 */
export const DEFAULT_INSECURE_SESSION_SECRET = "dev-insecure-session-secret-change-me";
export const SESSION_SECRET = process.env.SESSION_SECRET ?? DEFAULT_INSECURE_SESSION_SECRET;

/**
 * Nom du cookie de session, posé par Next sur SON origine.
 *
 * Distinct de `mp_admin_session` : les deux consoles peuvent être servies sur deux
 * sous-domaines du même domaine parent, et un nom partagé les ferait s'écraser
 * mutuellement — un administrateur qui ouvre la console vendeur perdrait sa session
 * admin, sans comprendre pourquoi.
 */
export const SESSION_COOKIE = "mp_seller_session";

/** Cookie Secure ? true hors développement, surchargeable via SESSION_COOKIE_SECURE. */
export const SESSION_COOKIE_SECURE =
  process.env.SESSION_COOKIE_SECURE != null
    ? process.env.SESSION_COOKIE_SECURE === "true"
    : process.env.NODE_ENV === "production";
