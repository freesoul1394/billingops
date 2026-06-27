/**
 * Typed AWS SDK v3 client factory.
 * Creates clients configured for us-east-1 with assumed-role credentials.
 */

import { OrganizationsClient } from "@aws-sdk/client-organizations";
import { CostExplorerClient } from "@aws-sdk/client-cost-explorer";
import { STSClient } from "@aws-sdk/client-sts";
import { IAMClient } from "@aws-sdk/client-iam";
import type { Credentials } from "@aws-sdk/types";

// Note: These imports will resolve once the SDK packages are installed.
// The invoicing and bcm-data-exports clients may be available under different names
// depending on the SDK version. We use the package names from package.json.

const REGION = "us-east-1";

interface ClientConfig {
  credentials: Credentials;
  region?: string;
}

export function createOrganizationsClient(config: ClientConfig): OrganizationsClient {
  return new OrganizationsClient({
    region: config.region ?? REGION,
    credentials: config.credentials,
  });
}

export function createCostExplorerClient(config: ClientConfig): CostExplorerClient {
  return new CostExplorerClient({
    region: config.region ?? REGION,
    credentials: config.credentials,
  });
}

export function createSTSClient(config: ClientConfig): STSClient {
  return new STSClient({
    region: config.region ?? REGION,
    credentials: config.credentials,
  });
}

export function createIAMClient(config: ClientConfig): IAMClient {
  return new IAMClient({
    region: config.region ?? REGION,
    credentials: config.credentials,
  });
}

/**
 * Generic factory — pass the client constructor and credentials.
 * Use for clients not explicitly listed above (Invoicing, BCM Data Exports, Billing).
 */
export function createAwsClient<T>(
  ClientConstructor: new (config: { region: string; credentials: Credentials }) => T,
  config: ClientConfig,
): T {
  return new ClientConstructor({
    region: config.region ?? REGION,
    credentials: config.credentials,
  });
}
