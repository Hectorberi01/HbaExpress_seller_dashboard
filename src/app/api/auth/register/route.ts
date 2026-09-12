export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { bffRegisterSeller } from "@/lib/bff";

/** Relaie la réponse du BFF, message d'erreur compris. */
async function relay(res: Response) {
  const text = await res.text();
  return new NextResponse(text || null, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
  });
}

/**
 * Étape 1 de l'auto-inscription vendeur (public).
 *
 * ⚠️ Contrairement à `forgot-password`, on RELAIE le statut et le message : à ce stade
 * l'utilisateur doit savoir pourquoi ça bloque — mot de passe trop court, e-mail déjà
 * rattaché à une boutique (409). Il n'y a pas d'existence de compte à protéger, puisque
 * c'est précisément ce compte qu'il essaie de créer.
 */
export async function POST(req: Request) {
  // Frein anti-force-brute, par IP réelle. Voir `lib/rate-limit.ts` : le
  // quota du BFF est aveugle derrière ce proxy, il compte tous les vendeurs
  // comme un seul client.
  const limited = rateLimit(req as NextRequest, "auth-register", 15);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    phoneNumber?: string;
  };

  if (!body.email || !body.password || !body.firstName || !body.lastName || !body.phoneNumber) {
    return NextResponse.json(
      { error: "E-mail, mot de passe, nom, prénom et téléphone sont requis." },
      { status: 400 },
    );
  }

  return relay(
    await bffRegisterSeller({
      email: body.email,
      password: body.password,
      firstName: body.firstName,
      lastName: body.lastName,
      phoneNumber: body.phoneNumber,
    }),
  );
}
