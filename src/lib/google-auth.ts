import { cookies } from "next/headers";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const COOKIE_NAME = "google_oauth_tokens";
const STATE_COOKIE_NAME = "google_oauth_state";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const STATE_MAX_AGE_SECONDS = 60 * 10;
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

type StoredToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
};

type StoredState = {
  value: string;
  callbackUrl: string;
};

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
};

function getSecret(): string {
  const secret = process.env.GOOGLE_OAUTH_COOKIE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("GOOGLE_OAUTH_COOKIE_SECRET must be set and >= 32 chars");
  }
  return secret;
}

function getKey(): Buffer {
  return createHash("sha256").update(getSecret()).digest();
}

function encrypt(payload: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64url");
}

function decrypt(payload: string): string {
  const data = Buffer.from(payload, "base64url");
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);

  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are required",
    );
  }

  return { clientId, clientSecret, redirectUri };
}

export async function exchangeCodeForToken(code: string): Promise<StoredToken> {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google token exchange failed: ${err}`);
  }

  const token = (await response.json()) as GoogleTokenResponse;

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    tokenType: token.token_type,
    scope: token.scope,
  };
}

export async function refreshAccessToken(existing: StoredToken): Promise<StoredToken> {
  const { clientId, clientSecret } = getGoogleOAuthConfig();

  if (!existing.refreshToken) {
    throw new Error("No refresh token available");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: existing.refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google token refresh failed: ${err}`);
  }

  const token = (await response.json()) as GoogleTokenResponse;

  return {
    ...existing,
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    tokenType: token.token_type ?? existing.tokenType,
    scope: token.scope ?? existing.scope,
  };
}

export async function saveTokens(token: StoredToken): Promise<void> {
  const cookieStore = await cookies();
  const payload = encrypt(JSON.stringify(token));

  cookieStore.set(COOKIE_NAME, payload, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearTokens(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function saveOAuthState(value: string, callbackUrl: string): Promise<void> {
  const cookieStore = await cookies();
  const payload = encrypt(JSON.stringify({ value, callbackUrl } satisfies StoredState));
  cookieStore.set(STATE_COOKIE_NAME, payload, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_MAX_AGE_SECONDS,
  });
}

export async function consumeOAuthState(): Promise<StoredState | null> {
  const cookieStore = await cookies();
  const payload = cookieStore.get(STATE_COOKIE_NAME)?.value;
  cookieStore.delete(STATE_COOKIE_NAME);
  if (!payload) return null;

  try {
    const raw = decrypt(payload);
    return JSON.parse(raw) as StoredState;
  } catch {
    return null;
  }
}

export async function readTokens(): Promise<StoredToken | null> {
  const cookieStore = await cookies();
  const payload = cookieStore.get(COOKIE_NAME)?.value;
  if (!payload) return null;

  try {
    const raw = decrypt(payload);
    return JSON.parse(raw) as StoredToken;
  } catch {
    return null;
  }
}

export async function getValidAccessToken(): Promise<string | null> {
  const token = await readTokens();
  if (!token) return null;

  const fiveMinutes = 5 * 60 * 1000;
  if (token.expiresAt > Date.now() + fiveMinutes) {
    return token.accessToken;
  }

  try {
    const refreshed = await refreshAccessToken(token);
    await saveTokens(refreshed);
    return refreshed.accessToken;
  } catch {
    return null;
  }
}
