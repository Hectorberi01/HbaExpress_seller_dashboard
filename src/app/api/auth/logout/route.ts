export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { bffLogout } from "@/lib/bff";
import { clearSession, getSession } from "@/lib/session";

/**
 * Déconnexion. L'ordre compte : on révoque D'ABORD côté serveur (tant qu'on détient
 * encore le refresh token), on efface le cookie ENSUITE. L'inverse laisserait un jeton
 * valide trente jours dans la nature — le défaut exact du tableau de bord Blazor,
 * où la révocation était codée mais jamais appelée.
 */
export async function POST() {
  const session = getSession();
  if (session) {
    await bffLogout(session);
  }
  clearSession();
  return NextResponse.json({ ok: true });
}
