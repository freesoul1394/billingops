import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Cognito OAuth2 callback.
 * Exchanges the authorization code for tokens and sets a session cookie.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }

  const cognitoDomain = process.env.COGNITO_DOMAIN;
  const clientId = process.env.COGNITO_CLIENT_ID;
  const clientSecret = process.env.COGNITO_CLIENT_SECRET;
  const redirectUri = `${request.nextUrl.origin}/api/auth/callback`;

  if (!cognitoDomain || !clientId) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 500 });
  }

  // Exchange code for tokens
  const tokenUrl = `https://${cognitoDomain}/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  });

  const tokenResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!tokenResponse.ok) {
    return NextResponse.json({ error: "Token exchange failed" }, { status: 401 });
  }

  const tokens = await tokenResponse.json();

  // Set session cookie with the ID token
  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set("billops-session", tokens.id_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 3600, // 1 hour
    path: "/",
  });

  return response;
}
