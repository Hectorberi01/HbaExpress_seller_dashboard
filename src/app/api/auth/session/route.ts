export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { bffRefresh, isExpired } from "@/lib/bff";
import { clearSession, getSession, setSession } from "@/lib/session";

/** État de session pour le client : jamais de jeton, seulement le nécessaire à l'UI. */
export async function GET() {
  let session = getSession();
  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  if (isExpired(session)) {
    const next = await bffRefresh(session);
    if (!next) {
      clearSession();
      return NextResponse.json({ authenticated: false });
    }
    setSession(next);
    session = next;
  }

  return NextResponse.json({ authenticated: true, name: session.name, email: session.email });
}
