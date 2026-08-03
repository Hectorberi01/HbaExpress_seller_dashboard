// En-têtes de sécurité appliqués à toutes les routes.
//
// Repris de la console admin, à une différence près : pas de `frame-src`. L'admin
// embarque Grafana, un terminal web et une console de base de données en iframe ; la
// console vendeur n'a rien de tel, et rien ne justifie d'ouvrir cette directive « au
// cas où ». Sans elle, `frame-src` retombe sur `default-src 'self'` — c'est-à-dire
// aucune iframe tierce, ce qu'on veut.
//
// `script-src`/`style-src` tolèrent 'unsafe-inline' : Next injecte du script et du
// style inline pour l'hydratation et Tailwind, et une CSP à nonce casse le rendu
// standalone. Le risque XSS reste faible — aucun `dangerouslySetInnerHTML` ni rendu
// HTML non échappé dans l'application.
// ─────────────────────────────────────────────────────────────────────────────────
// ASSOUPLISSEMENTS RÉSERVÉS AU DÉVELOPPEMENT.
//
// `next dev` compile avec le devtool « eval » de webpack et installe le rechargement
// à chaud de React (react-refresh) : les deux évaluent du JavaScript sous forme de
// chaîne. Sans 'unsafe-eval', le navigateur bloque le runtime AVANT l'hydratation et
// la page reste blanche sur « Evaluating a string as JavaScript violates the following
// Content Security Policy directive ».
//
// `ws:` couvre le canal de rechargement à chaud. La spécification CSP 3 fait déjà
// entrer les WebSockets de même origine dans 'self', mais tous les navigateurs ne
// l'appliquent pas de la même façon ; l'ajouter en dev évite une seconde enquête.
//
// ⚠️ RIEN DE TOUT CELA N'ATTEINT LA PRODUCTION. `next build` s'exécute en
// NODE_ENV=production, `isDev` y vaut faux, et la politique reste celle d'origine.
// 'unsafe-eval' en production annulerait une bonne partie de l'intérêt de la CSP :
// c'est précisément ce qui transforme une injection de chaîne en exécution de code.
// ─────────────────────────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  // Images : n'importe quelle source HTTPS. Un vendeur renseigne l'URL de ses visuels
  // produit, qui peut pointer vers n'importe quel CDN ; restreindre à nos domaines
  // casserait tous les aperçus. `img-src` ne permet que d'AFFICHER, jamais d'exécuter.
  "img-src 'self' data: blob: https:",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // 'self' suffit : le navigateur ne parle QU'à Next (/api/bff/…), jamais au BFF
  // directement. C'est tout l'intérêt du proxy — aucun jeton ne quitte le serveur.
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "font-src 'self' data:",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Serveur Node minimal, destiné à l'image Docker du VPS.
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.hbamediacore.fr" },
      { protocol: "https", hostname: "**.r2.dev" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
