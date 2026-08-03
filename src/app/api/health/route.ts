export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

/** Sonde de vivacité pour le healthcheck Docker/Traefik. Aucune dépendance externe. */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
