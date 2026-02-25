import { NextResponse } from "next/server";
import { getValidAccessToken, readTokens } from "@/lib/google-auth";

export async function GET() {
  const stored = await readTokens();
  if (!stored) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ error: "Token expired" }, { status: 401 });
  }

  return NextResponse.json({
    accessToken,
    expiresAt: stored.expiresAt,
    scope: stored.scope,
  });
}
