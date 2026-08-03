export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { bffResendSellerCode } from "@/lib/bff";

/**
 * Renvoi du code de vérification.
 *
 * ⚠️ Le BFF renvoie `{ userId }` quand le compte existe, `{ userId: null }` sinon —
 * c'est un oracle d'existence de comptes, relevé au §2.6 de l'audit backend et laissé
 * en l'état parce que le corriger demande une livraison client couplée.
 *
 * On ne l'aggrave pas ici : `userId` est nécessaire à l'étape suivante, donc on le
 * relaie, mais l'écran affiche exactement le même message dans les deux cas.
 */
export async function POST(req: Request) {
  // Frein anti-force-brute, par IP réelle. Voir `lib/rate-limit.ts` : le
  // quota du BFF est aveugle derrière ce proxy, il compte tous les vendeurs
  // comme un seul client.
  const limited = rateLimit(req as NextRequest, "auth-resend", 3);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { email?: string };
  if (!body.email) {
    return NextResponse.json({ error: "E-mail requis." }, { status: 400 });
  }

  const res = await bffResendSellerCode(body.email);
  const text = await res.text();
  return new NextResponse(text || null, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
  });
}
