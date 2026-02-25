import { NextRequest, NextResponse } from "next/server";
import { clearTokens } from "@/lib/google-auth";

export async function POST(request: NextRequest) {
  await clearTokens();

  const referer = request.headers.get("referer");
  const redirectTo = referer ? new URL(referer).pathname : "/";

  return NextResponse.json({ ok: true, redirectTo });
}
