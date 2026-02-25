import { NextRequest, NextResponse } from "next/server";
import { getGoogleOAuthConfig, saveOAuthState } from "@/lib/google-auth";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

export async function GET(request: NextRequest) {
  const { clientId, redirectUri } = getGoogleOAuthConfig();

  const url = new URL(request.url);
  const rawCallbackUrl = url.searchParams.get("callbackUrl") ?? "/";
  const requestOrigin = new URL(request.url).origin;
  let callbackUrl = "/";

  try {
    const parsed = new URL(rawCallbackUrl, request.url);
    if (parsed.origin === requestOrigin) {
      callbackUrl = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    callbackUrl = "/";
  }

  const state = crypto.randomUUID();
  await saveOAuthState(state, callbackUrl);

  const authUrl = new URL(GOOGLE_AUTH_ENDPOINT);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set(
    "scope",
    [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
    ].join(" "),
  );
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl);
}
