export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { bffVerifySeller } from "@/lib/bff";

/**
 * Étape 2 de l'auto-inscription : code + nom de boutique.
 *
 * Le serveur enchaîne quatre opérations — vérification du code, création de la
 * boutique, attribution du rôle, activation du compte — et n'est PAS transactionnel.
 * Un échec tardif (nom de boutique déjà pris) laisse donc un e-mail vérifié sans
 * boutique. On relaie le message tel quel : c'est le seul moyen pour l'utilisateur de
 * savoir qu'il doit simplement réessayer avec un autre nom, sans tout recommencer.
 */
export async function POST(req: Request) {
  // Frein anti-force-brute, par IP réelle. Voir `lib/rate-limit.ts` : le
  // quota du BFF est aveugle derrière ce proxy, il compte tous les vendeurs
  // comme un seul client.
  const limited = rateLimit(req as NextRequest, "auth-verify", 10);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as {
    userId?: string;
    code?: string;
    shopName?: string;
    company?: Record<string, string | null> | null;
  };

  if (!body.userId || !body.code || !body.shopName) {
    return NextResponse.json(
      { error: "Identifiant, code et nom de boutique sont requis." },
      { status: 400 },
    );
  }

  const res = await bffVerifySeller({
    userId: body.userId,
    code: body.code,
    shopName: body.shopName,
    company: body.company ?? null,
  });

  const text = await res.text();
  return new NextResponse(text || null, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
  });
}
