import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Logout — clears session cookie and redirects to Cognito logout endpoint.
 */
export async function GET(request: NextRequest) {
  const cognitoDomain = process.env.COGNITO_DOMAIN;
  const clientId = process.env.COGNITO_CLIENT_ID;
  const logoutUri = `${request.nextUrl.origin}/`;

  const response = cognitoDomain && clientId
    ? NextResponse.redirect(
        `https://${cognitoDomain}/logout?client_id=${clientId}&logout_uri=${encodeURIComponent(logoutUri)}`,
      )
    : NextResponse.redirect(new URL("/", request.url));

  response.cookies.delete("billops-session");
  return response;
}
