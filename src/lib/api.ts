/** Client d'API côté navigateur : n'appelle QUE l'origine Next (/api/*). */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /**
     * Code métier du serveur (`identity.auth.email_not_verified`, …), quand il est
     * connu. Il vit dans le `title` d'un ProblemDetails ASP.NET.
     *
     * Facultatif à dessein : la très grande majorité des appels n'a besoin que du
     * message. Il n'est lu que là où deux refus partagent le même statut HTTP et
     * appellent deux conduites différentes.
     */
    public code?: string,
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

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * `message` AVANT `error` : LE CODE MACHINE NE DOIT PAS PASSER DEVANT LA PHRASE.
 *
 * Les refus métier du BFF sortent en `application/problem+json` et portent `detail`.
 * Mais les refus posés à la main par le BFF vendeur ont une autre forme :
 *
 *     ShopNotAllowed → { error: "shop_not_allowed", status, message: DenialReason(...) }
 *     NotASeller     → { error: "not_a_seller", hint: "..." }
 *
 * La chaîne s'arrêtait sur `error` et le bandeau affichait « shop_not_allowed » — le
 * `message`, seul champ rédigé pour un humain, et la raison même d'exister de
 * `SellerRights.DenialReason`, n'était jamais lu. L'app mobile, elle, lit bien
 * `data['message']` : la console était la seule des deux à perdre le motif.
 *
 * `error` reste en dernier recours : d'autres routes y mettent une phrase complète
 * (« Au moins une image est requise. »). On le garde donc, mais derrière `message`.
 *
 * On refuse aussi les valeurs non textuelles : `error` peut être un objet de
 * validation, et « [object Object] » dans un bandeau ne vaut pas mieux qu'un code.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
function messageDErreur(data: unknown, status: number): string {
  const repli = `Erreur ${status}`;
  if (!data || typeof data !== "object") {
    return typeof data === "string" && data.trim() ? data : repli;
  }
  const champs = data as Record<string, unknown>;
  for (const cle of ["detail", "title", "message", "error"]) {
    const v = champs[cle];
    if (typeof v === "string" && v.trim()) return v;
  }
  return repli;
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
    throw new ApiError(res.status, messageDErreur(data, res.status));
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

    throw new ApiError(res.status, messageDErreur(data, res.status));
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
    code?: string;
  };
  if (res.status === 401 && data?.mfaRequired) return { mfaRequired: true };
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "Connexion impossible.", data?.code);
  return data;
}

export async function apiLogout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

/**
 * Réaligne l'identité d'AFFICHAGE de la session (nom du bandeau latéral) sur le
 * profil réellement enregistré.
 *
 * Ce nom est posé dans le cookie de session à la CONNEXION, pas relu à chaque écran :
 * ni l'invalidation d'une clé React Query ni un `router.refresh()` seul ne le
 * changent. Voir la note du handler `POST /api/auth/session`.
 *
 * Aucun corps : c'est le serveur qui relit le compte.
 *
 * RENVOIE `false` QUAND LE NOM N'A PAS PU ÊTRE RÉALIGNÉ. Un échec silencieux ramenait
 * le défaut d'origine à l'identique : enregistrement réussi, bandeau périmé, aucun
 * signe — et aucun moyen de réessayer, puisque « Enregistrer » redevient inactif dès
 * que le formulaire est à jour. L'appelant doit donc le dire. Ce n'est PAS un échec
 * d'enregistrement : le profil, lui, est bien écrit.
 */
export async function refreshSessionIdentity(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/session", { method: "POST", cache: "no-store" });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { resynchronise?: boolean } | null;
    return data?.resynchronise === true;
  } catch {
    // Réseau indisponible : on laisse le nom précédent, et on le signale.
    return false;
  }
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
