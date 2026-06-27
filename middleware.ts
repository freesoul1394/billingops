import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next.js middleware — gates all /dashboard and /api routes.
 * Redirects unauthenticated users to the Cognito hosted UI.
 *
 * In production: validates the session cookie / JWT.
 * For local dev: passes through if NEXT_PUBLIC_AUTH_DISABLED=true.
 */
export function middleware(request: NextRequest) {
  // Skip auth in local dev when explicitly disabled
  if (process.env.NEXT_PUBLIC_AUTH_DISABLED === "true") {
    return NextResponse.next();
  }

  // Check for session cookie (set after Cognito login callback)
  const session = request.cookies.get("billops-session");
  if (!session?.value) {
    // Redirect to Cognito hosted UI
    const cognitoDomain = process.env.COGNITO_DOMAIN;
    const clientId = process.env.COGNITO_CLIENT_ID;
    const redirectUri = `${request.nextUrl.origin}/api/auth/callback`;

    if (cognitoDomain && clientId) {
      const loginUrl = `https://${cognitoDomain}/login?client_id=${clientId}&response_type=code&scope=openid+email+profile&redirect_uri=${encodeURIComponent(redirectUri)}`;
      return NextResponse.redirect(loginUrl);
    }

    // No Cognito config — return 401
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/(dashboard)(.*)", "/api/((?!auth).*)"],
};
