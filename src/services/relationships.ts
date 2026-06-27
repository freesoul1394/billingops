/**
 * Relationships service — R2.1–R2.4
 * Syncs and queries inbound responsibility transfers (= partner PMAs).
 */

import prisma from "@/db";
import { assumeRole, paginateAll, withAudit } from "@/aws";
import { createOrganizationsClient } from "@/aws/clients";
import {
  ListInboundResponsibilityTransfersCommand,
  DescribeResponsibilityTransferCommand,
} from "@aws-sdk/client-organizations";

export interface TransferRecord {
  transferId: string;
  sourceAccountId: string;
  sourceAccountEmail?: string;
  transferName?: string;
  status: string;
  startTs?: Date;
  endTs?: Date;
  type: string;
  isActiveBilling: boolean;
}

/**
 * Determine if a transfer is "active billing" per the design:
 * status is ACTIVE/ACCEPTED AND now >= startTs AND (no endTs OR now < endTs).
 */
export function isActiveBilling(transfer: {
  status: string;
  startTs?: Date | null;
  endTs?: Date | null;
}): boolean {
  const now = new Date();
  const statusOk = ["ACTIVE", "ACCEPTED"].includes(transfer.status.toUpperCase());
  const started = transfer.startTs ? now >= transfer.startTs : false;
  const notEnded = !transfer.endTs || now < transfer.endTs;
  return statusOk && started && notEnded;
}

/**
 * Sync all inbound responsibility transfers for a distributor PMA.
 * Persists to relationship_cache.
 */
export async function syncRelationships(accountId: string, operator: string) {
  const account = await prisma.onboardedAccount.findUnique({ where: { accountId } });
  if (!account) throw new Error(`Account ${accountId} not found`);
  if (!account.roRoleArn || !account.externalId) {
    throw new Error("Account missing role ARN or ExternalId");
  }

  return withAudit(
    { operator, onboardedAccountId: account.id, action: "SyncRelationships" },
    async () => {
      const credentials = await assumeRole({
        roleArn: account.roRoleArn!,
        externalId: account.externalId!,
        sessionName: `sync-rel-${account.accountId}`,
      });

      const orgClient = createOrganizationsClient({ credentials });

      // Paginate — never stop on empty pages
      const transfers = await paginateAll({
        send: (input) => orgClient.send(new ListInboundResponsibilityTransfersCommand(input)),
        input: { MaxResults: 20 },
        getItems: (output) => output.ResponsibilityTransfers,
      });

      const now = new Date();

      // Upsert each transfer
      for (const t of transfers) {
        await prisma.relationshipCache.upsert({
          where: {
            onboardedAccountId_transferId: {
              onboardedAccountId: account.id,
              transferId: t.Id ?? "",
            },
          },
          create: {
            onboardedAccountId: account.id,
            transferId: t.Id ?? "",
            sourceAccountId: t.Source?.ManagementAccountId ?? "",
            sourceAccountEmail: t.Source?.ManagementAccountEmail,
            transferName: t.Name,
            status: t.Status ?? "UNKNOWN",
            startTs: t.StartTimestamp,
            endTs: t.EndTimestamp,
            type: t.Type ?? "BILLING",
            fetchedAt: now,
          },
          update: {
            sourceAccountEmail: t.Source?.ManagementAccountEmail,
            transferName: t.Name,
            status: t.Status ?? "UNKNOWN",
            startTs: t.StartTimestamp,
            endTs: t.EndTimestamp,
            fetchedAt: now,
          },
        });
      }

      return { synced: transfers.length };
    },
  );
}

/**
 * List cached relationships for a PMA, with optional filters.
 */
export async function listRelationships(
  accountId: string,
  filters?: { status?: string; sourceAccountId?: string },
) {
  const account = await prisma.onboardedAccount.findUnique({ where: { accountId } });
  if (!account) throw new Error(`Account ${accountId} not found`);

  const where: Record<string, unknown> = { onboardedAccountId: account.id };
  if (filters?.status) where.status = filters.status;
  if (filters?.sourceAccountId) where.sourceAccountId = filters.sourceAccountId;

  const relationships = await prisma.relationshipCache.findMany({
    where,
    orderBy: { startTs: "desc" },
  });

  return relationships.map((r) => ({
    ...r,
    isActiveBilling: isActiveBilling(r),
  }));
}
