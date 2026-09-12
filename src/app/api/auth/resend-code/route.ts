export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { bffResendSellerCode } from "@/lib/bff";

/**
 * Renvoi du code de vérification.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════
 * L'ORACLE D'EXISTENCE DE COMPTES EST FERMÉ. CE COMMENTAIRE DÉCRIVAIT L'ANCIEN ÉTAT.
 *
 * Il annonçait que le BFF rend `{ userId }` quand le compte existe et `{ userId: null }`
 * sinon — « laissé en l'état parce que le corriger demande une livraison client
 * couplée ». Cette livraison a eu lieu côté serveur en septembre 2026 : la réponse est
 * désormais `SellerResendResponse(Sent, RetryAfterSeconds, Message)`, constante, sans
 * aucun identifiant. Le commentaire du serveur explique pourquoi le corps neutre ne
 * suffisait pas : « que l'application affiche le même message ne change rien — c'est la
 * RÉPONSE HTTP qui est lue par celui qui énumère, pas l'écran. »
 *
 * `retryAfterSeconds` est constant à dessein : il ne dépend ni de l'existence du compte
 * ni de l'état du délai, donc il ne divulgue rien, et il suffit à l'écran pour
 * désactiver son bouton une minute. On relaie tel quel.
 * ═══════════════════════════════════════════════════════════════════════════════════
 */
export async function POST(req: Request) {
  // Frein anti-force-brute, par IP réelle. Voir `lib/rate-limit.ts` : le
  // quota du BFF est aveugle derrière ce proxy, il compte tous les vendeurs
  // comme un seul client.
  const limited = rateLimit(req as NextRequest, "auth-resend", 15);
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
