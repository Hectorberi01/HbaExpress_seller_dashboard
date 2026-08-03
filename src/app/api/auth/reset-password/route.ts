export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { bffResetPassword } from "@/lib/bff";

/**
 * Réinitialisation du mot de passe (public, non authentifié).
 *
 * Le jeton à usage unique vient de l'e-mail ; il n'est ni stocké ni journalisé ici.
 * Contrairement à `forgot-password`, cette route RELAIE l'erreur : à ce stade
 * l'utilisateur détient déjà un jeton, il n'y a plus d'existence de compte à protéger,
 * et il a besoin de savoir si son lien a expiré.
 */
export async function POST(req: Request) {
  // Frein anti-force-brute, par IP réelle. Voir `lib/rate-limit.ts` : le
  // quota du BFF est aveugle derrière ce proxy, il compte tous les vendeurs
  // comme un seul client.
  const limited = rateLimit(req as NextRequest, "auth-reset", 10);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    token?: string;
    newPassword?: string;
  };

  if (!body.email || !body.token || !body.newPassword) {
    return NextResponse.json({ error: "E-mail, jeton et nouveau mot de passe requis." }, { status: 400 });
  }

  const res = await bffResetPassword(body.email, body.token, body.newPassword);

  if (!res.ok) {
    let msg = "Réinitialisation impossible. Le lien a peut-être expiré.";
    try {
      const j = (await res.json()) as Record<string, string>;
      msg = j.detail ?? j.title ?? j.error ?? msg;
    } catch {
      /* réponse non-JSON : on garde le message par défaut */
    }
    return NextResponse.json({ error: msg }, { status: res.status });
  }

  return NextResponse.json({ ok: true });
}
