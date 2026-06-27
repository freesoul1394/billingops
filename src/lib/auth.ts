/**
 * Auth utilities — Amazon Cognito JWT verification.
 * In production, verifies tokens from the Cognito user pool.
 * Supports SAML/OIDC federation via Cognito hosted UI.
 */

export interface AuthUser {
  sub: string;
  email: string;
  name?: string;
  groups?: string[];
}

/**
 * Extracts and validates the user from the Authorization header.
 * In production, this verifies the Cognito JWT.
 * For now, placeholder that reads from headers (replaced with real verification in deployment).
 */
export async function getAuthUser(headers: Headers): Promise<AuthUser | null> {
  const authHeader = headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  // TODO: Replace with real Cognito JWT verification using jwks-rsa
  // For now, decode payload (INSECURE — for local dev only)
  const token = authHeader.slice(7);
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return {
      sub: payload.sub ?? "unknown",
      email: payload.email ?? "unknown@redington.co.in",
      name: payload.name,
      groups: payload["cognito:groups"],
    };
  } catch {
    return null;
  }
}

/**
 * Config for the Cognito user pool (from env vars).
 */
export function getCognitoConfig() {
  return {
    userPoolId: process.env.COGNITO_USER_POOL_ID ?? "",
    clientId: process.env.COGNITO_CLIENT_ID ?? "",
    domain: process.env.COGNITO_DOMAIN ?? "",
    region: "us-east-1",
  };
}
