/**
 * Onboarding service — R1.1–R1.6
 * Manages distributor PMA onboarding: capture account details, generate CFN templates,
 * validate connectivity, and handle the access-key fallback.
 */

import prisma from "@/db";
import { assumeRole, withAudit } from "@/aws";
import { createOrganizationsClient } from "@/aws/clients";
import { ListInboundResponsibilityTransfersCommand } from "@aws-sdk/client-organizations";
import type { ConnectionType, AccountStatus } from "@prisma/client";

export interface OnboardAccountInput {
  accountId: string; // 12-digit AWS account ID
  country: string;
  alias?: string;
  connectionType: ConnectionType;
  roRoleArn?: string;
  provisioningRoleArn?: string;
  externalId?: string;
  secretRef?: string; // KMS-encrypted reference for access-key fallback
  createdBy: string;
}

/**
 * Onboard a new distributor PMA.
 */
export async function onboardAccount(input: OnboardAccountInput) {
  // Validate 12-digit account ID
  if (!/^\d{12}$/.test(input.accountId)) {
    throw new Error("Account ID must be exactly 12 digits");
  }

  const existing = await prisma.onboardedAccount.findUnique({
    where: { accountId: input.accountId },
  });
  if (existing) {
    throw new Error(`Account ${input.accountId} is already onboarded`);
  }

  const account = await prisma.onboardedAccount.create({
    data: {
      accountId: input.accountId,
      country: input.country,
      alias: input.alias,
      connectionType: input.connectionType,
      roRoleArn: input.roRoleArn,
      provisioningRoleArn: input.provisioningRoleArn,
      externalId: input.externalId,
      secretRef: input.secretRef,
      status: "active",
      createdBy: input.createdBy,
    },
  });

  return account;
}

/**
 * Validate connectivity by calling ListInboundResponsibilityTransfers.
 */
export async function validateConnectivity(accountId: string, operator: string) {
  const account = await prisma.onboardedAccount.findUnique({
    where: { accountId },
  });
  if (!account) throw new Error(`Account ${accountId} not found`);
  if (!account.roRoleArn || !account.externalId) {
    throw new Error("Account missing role ARN or ExternalId");
  }

  return withAudit(
    { operator, onboardedAccountId: account.id, action: "ValidateConnectivity" },
    async () => {
      const credentials = await assumeRole({
        roleArn: account.roRoleArn!,
        externalId: account.externalId!,
        sessionName: `validate-${account.accountId}`,
      });

      const orgClient = createOrganizationsClient({ credentials });
      const command = new ListInboundResponsibilityTransfersCommand({ MaxResults: 5 });
      await orgClient.send(command);

      // Mark as validated
      await prisma.onboardedAccount.update({
        where: { id: account.id },
        data: { lastValidatedAt: new Date() },
      });

      return { success: true, accountId };
    },
  );
}

/**
 * Deactivate/remove an onboarded account.
 */
export async function deactivateAccount(accountId: string, operator: string) {
  const account = await prisma.onboardedAccount.findUnique({
    where: { accountId },
  });
  if (!account) throw new Error(`Account ${accountId} not found`);

  return withAudit(
    { operator, onboardedAccountId: account.id, action: "DeactivateAccount" },
    async () => {
      await prisma.onboardedAccount.update({
        where: { id: account.id },
        data: {
          status: "inactive" as AccountStatus,
          roRoleArn: null,
          provisioningRoleArn: null,
          externalId: null,
          secretRef: null,
        },
      });
      return { success: true, accountId };
    },
  );
}

/**
 * List all onboarded accounts, optionally filtered by country.
 */
export async function listAccounts(country?: string) {
  return prisma.onboardedAccount.findMany({
    where: country ? { country } : undefined,
    orderBy: [{ country: "asc" }, { alias: "asc" }],
  });
}

/**
 * Get a single onboarded account by ID.
 */
export async function getAccount(accountId: string) {
  return prisma.onboardedAccount.findUnique({ where: { accountId } });
}
