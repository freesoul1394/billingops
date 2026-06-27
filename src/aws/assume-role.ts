import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import type { Credentials } from "@aws-sdk/types";

const stsClient = new STSClient({ region: "us-east-1" });

interface CachedCreds {
  credentials: Credentials;
  expiresAt: number;
}

const credsCache = new Map<string, CachedCreds>();

const CREDS_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

export type RoleType = "readonly" | "provisioning";

interface AssumeRoleParams {
  roleArn: string;
  externalId: string;
  sessionName?: string;
  durationSeconds?: number;
}

/**
 * Assumes a cross-account IAM role with ExternalId.
 * Caches credentials until they're within 5 min of expiry.
 */
export async function assumeRole(params: AssumeRoleParams): Promise<Credentials> {
  const { roleArn, externalId, sessionName, durationSeconds = 3600 } = params;
  const cacheKey = `${roleArn}:${externalId}`;

  const cached = credsCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - CREDS_BUFFER_MS) {
    return cached.credentials;
  }

  const command = new AssumeRoleCommand({
    RoleArn: roleArn,
    ExternalId: externalId,
    RoleSessionName: sessionName ?? "billops-session",
    DurationSeconds: durationSeconds,
  });

  const response = await stsClient.send(command);

  if (!response.Credentials) {
    throw new Error(`STS AssumeRole returned no credentials for ${roleArn}`);
  }

  const credentials: Credentials = {
    accessKeyId: response.Credentials.AccessKeyId!,
    secretAccessKey: response.Credentials.SecretAccessKey!,
    sessionToken: response.Credentials.SessionToken!,
    expiration: response.Credentials.Expiration,
  };

  credsCache.set(cacheKey, {
    credentials,
    expiresAt: response.Credentials.Expiration?.getTime() ?? Date.now() + durationSeconds * 1000,
  });

  return credentials;
}

/** Clear cached credentials (e.g. on deactivation) */
export function clearCredsCache(roleArn?: string, externalId?: string): void {
  if (roleArn && externalId) {
    credsCache.delete(`${roleArn}:${externalId}`);
  } else {
    credsCache.clear();
  }
}
