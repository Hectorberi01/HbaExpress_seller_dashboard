export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { bffForgotPassword } from "@/lib/bff";

/**
 * Demande d'un code de réinitialisation (public).
 *
 * Réponse TOUJOURS neutre, quel que soit le sort de l'appel au BFF. Distinguer les cas
 * ferait de cette route un annuaire des boutiques : une adresse acceptée = un vendeur
 * inscrit. Le BFF applique la même règle de son côté (204 systématique) ; on ne la
 * défait pas ici en relayant son statut.
 */
export async function POST(req: Request) {
  // Frein anti-force-brute, par IP réelle. Voir `lib/rate-limit.ts` : le
  // quota du BFF est aveugle derrière ce proxy, il compte tous les vendeurs
  // comme un seul client.
  const limited = rateLimit(req as NextRequest, "auth-forgot", 3);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { email?: string };

  if (!body.email) {
    return NextResponse.json({ error: "E-mail requis." }, { status: 400 });
  }

  await bffForgotPassword(body.email).catch(() => null);

  return NextResponse.json({ ok: true });
}
