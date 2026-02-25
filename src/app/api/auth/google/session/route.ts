import { NextResponse } from "next/server";
import { getValidAccessToken, readTokens } from "@/lib/google-auth";

export async function GET() {
  const raw = await readTokens();
  if (!raw) {
    return NextResponse.json({ connected: false });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    expiresAt: raw.expiresAt,
    hasRefreshToken: Boolean(raw.refreshToken),
  });
}
