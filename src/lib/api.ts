/** Client d'API côté navigateur : n'appelle QUE l'origine Next (/api/*). */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readBody(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";

  // ───────────────────────────────────────────────────────────────────────────────
  // « json », pas « application/json ».
  //
  // Toutes les erreurs métier du BFF sortent en `application/problem+json` (ASP.NET
  // `Results.Problem` + `AddProblemDetails`). Or cette chaîne ne CONTIENT PAS
  // « application/json » : le test précédent échouait, le corps était lu comme du
  // texte, et `bff()` — qui n'exploite que les objets — retombait sur « Erreur 409 ».
  //
  // Autrement dit, tout le soin mis côté serveur à écrire des messages utiles
  // (« Vous avez 3 commandes en cours… », « Canal de reversement invalide… ») était
  // jeté à la poubelle sur CHAQUE écran de la console.
  // ───────────────────────────────────────────────────────────────────────────────
  if (ct.includes("json")) return res.json().catch(() => null);

  const text = await res.text();
  return text || null;
}

/**
 * Ramène à la connexion si — et seulement si — NOTRE proxy signale la session morte.
 *
 * Extraite de `bff()` pour être partagée avec `bffBlob()`. La duplication partielle
 * avait un coût concret : une session expirée pendant un détourage d'image passait
 * pour un simple « détourage indisponible », le vendeur continuait à remplir trois
 * étapes, et n'était éjecté qu'au moment d'enregistrer — perdant toute sa saisie.
 */
function redirectIfSessionExpired(res: Response, data: unknown): void {
  const expired =
    res.status === 401 &&
    typeof data === "object" &&
    data !== null &&
    (data as { sessionExpired?: boolean }).sessionExpired === true;

  if (!expired) return;
  if (typeof window === "undefined" || window.location.pathname.startsWith("/login")) return;

  const back = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(`/login?redirect=${back}`);
  // On lève quand même : l'appelant ne doit pas croire la requête réussie pendant
  // que la navigation s'amorce.
  throw new ApiError(401, "Session expirée. Reconnexion…");
}

/** Appel authentifié d'un endpoint du BFF vendeur, relayé par le proxy Next. */
export async function bff<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  // Ne force JSON que pour un corps texte. Pour FormData, on laisse le navigateur
  // poser lui-même le Content-Type (avec la « boundary » multipart).
  if (typeof init?.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`/api/bff${path.startsWith("/") ? path : `/${path}`}`, { ...init, headers });
  const data = await readBody(res);

  // ───────────────────────────────────────────────────────────────────────────────
  // SESSION EXPIRÉE : ON RAMÈNE À LA CONNEXION.
  //
  // Le contrôle de session n'a lieu qu'au rendu SERVEUR du layout. Une fois la console
  // ouverte, l'expiration ne se manifesterait que par des 401 sur chaque requête :
  // tableaux vides, toasts d'erreur en boucle, et rien n'indiquant qu'il suffit de se
  // reconnecter.
  //
  // ⚠️ MAIS TOUS LES 401 NE SONT PAS DES SESSIONS EXPIRÉES.
  //
  // Le BFF répond 401 sur des erreurs MÉTIER : mot de passe incorrect à la suppression
  // de compte, code 2FA invalide, mot de passe actuel erroné. Rediriger sur tout 401
  // éjectait donc le vendeur de la console à la moindre faute de frappe dans un champ
  // de confirmation — au moment précis où il essayait de prouver son identité.
  //
  // Seul NOTRE proxy pose `sessionExpired: true`. C'est le marqueur qu'on écoute.
  //
  // `replace` plutôt que `push` : la page devenue inutilisable n'a pas à rester dans
  // l'historique. Et `redirect` conserve la destination pour y revenir après la
  // reconnexion, plutôt que de tout recommencer depuis le tableau de bord.
  // ───────────────────────────────────────────────────────────────────────────────
  redirectIfSessionExpired(res, data);

  if (!res.ok) {
    const msg =
      (data &&
        typeof data === "object" &&
        ((data as Record<string, string>).detail ??
          (data as Record<string, string>).title ??
          (data as Record<string, string>).error)) ||
      `Erreur ${res.status}`;
    throw new ApiError(res.status, typeof msg === "string" ? msg : `Erreur ${res.status}`);
  }
  return data as T;
}

/**
 * Appel du BFF dont la réponse est un FICHIER, pas du JSON.
 *
 * `POST /seller/products/media/process` renvoie une image JPEG. La passer par `bff()`
 * la ferait lire comme du texte : les octets binaires seraient réinterprétés en UTF-8
 * et l'image ressortirait corrompue — l'équivalent du piège que l'app mobile évite en
 * forçant `ResponseType.bytes` sur Dio.
 *
 * Les erreurs, elles, restent en JSON : on les lit comme partout ailleurs pour que le
 * message du serveur parvienne à l'écran.
 */
export async function bffBlob(path: string, init?: RequestInit): Promise<Blob> {
  const res = await fetch(`/api/bff${path.startsWith("/") ? path : `/${path}`}`, init);

  if (!res.ok) {
    const data = await readBody(res);
    // Même traitement que `bff()` : une session morte ramène à la connexion, elle ne
    // se déguise pas en échec de traitement d'image.
    redirectIfSessionExpired(res, data);

    const msg =
      (data &&
        typeof data === "object" &&
        ((data as Record<string, string>).detail ??
          (data as Record<string, string>).title ??
          (data as Record<string, string>).error)) ||
      `Erreur ${res.status}`;
    throw new ApiError(res.status, typeof msg === "string" ? msg : `Erreur ${res.status}`);
  }

  const blob = await res.blob();
  if (blob.size === 0) {
    throw new ApiError(502, "Le serveur a renvoyé une image vide.");
  }
  return blob;
}

// ---- Authentification (proxy Next, jamais le BFF en direct) ----

export interface SessionState {
  authenticated: boolean;
  name?: string;
  email?: string;
}

export async function apiLogin(
  email: string,
  password: string,
  mfaCode?: string,
): Promise<{ name?: string; email?: string; mfaRequired?: boolean }> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, mfaCode }),
  });

  const data = (await readBody(res)) as {
    name?: string;
    email?: string;
    mfaRequired?: boolean;
    error?: string;
  };
  if (res.status === 401 && data?.mfaRequired) return { mfaRequired: true };
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "Connexion impossible.");
  return data;
}

export async function apiLogout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

export async function fetchSession(): Promise<SessionState> {
  const res = await fetch("/api/auth/session", { cache: "no-store" });
  if (!res.ok) return { authenticated: false };
  return (await res.json()) as SessionState;
}

/** Demande d'un code de réinitialisation. Ne distingue jamais compte connu ou non. */
export async function apiForgotPassword(email: string): Promise<void> {
  await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

/** Réinitialisation effective, avec le code à six chiffres reçu par e-mail. */
export async function apiResetPassword(email: string, token: string, newPassword: string): Promise<void> {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, token, newPassword }),
  });
  const data = (await readBody(res)) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "Réinitialisation impossible.");
}
