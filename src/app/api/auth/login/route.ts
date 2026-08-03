export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { bffLogin } from "@/lib/bff";
import { setSession } from "@/lib/session";

export async function POST(req: Request) {
  // Frein anti-force-brute, par IP réelle. Voir `lib/rate-limit.ts` : le
  // quota du BFF est aveugle derrière ce proxy, il compte tous les vendeurs
  // comme un seul client.
  const limited = rateLimit(req as NextRequest, "auth-login", 10);
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    mfaCode?: string;
  };

  if (!body.email || !body.password) {
    return NextResponse.json({ error: "E-mail et mot de passe requis." }, { status: 400 });
  }

  const result = await bffLogin(body.email, body.password, body.mfaCode);

  if (!result.ok) {
    if (result.mfaRequired) {
      return NextResponse.json({ mfaRequired: true }, { status: 401 });
    }
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  // Les jetons entrent dans le cookie chiffré et n'en ressortent jamais : la réponse
  // au navigateur ne contient que de quoi afficher un nom.
  setSession(result.session);
  return NextResponse.json({ name: result.session.name, email: result.session.email });
}
