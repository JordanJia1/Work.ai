import { NextRequest, NextResponse } from "next/server";
import { consumeOAuthState, exchangeCodeForToken, saveTokens } from "@/lib/google-auth";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const returnedState = url.searchParams.get("state");
  const storedState = await consumeOAuthState();
  const callbackUrl = storedState?.callbackUrl || "/";

  if (!storedState || !returnedState || returnedState !== storedState.value) {
    return NextResponse.redirect(new URL("/?authError=invalid_state", request.url));
  }

  if (error) {
    return NextResponse.redirect(new URL(`/?authError=${encodeURIComponent(error)}`, request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/?authError=missing_code", request.url));
  }

  try {
    const token = await exchangeCodeForToken(code);
    await saveTokens(token);

    const destination = new URL(callbackUrl, request.url);
    destination.searchParams.set("connected", "true");
    return NextResponse.redirect(destination);
  } catch {
    return NextResponse.redirect(new URL("/?authError=token_exchange_failed", request.url));
  }
}
