/**
 * CUR provisioning service — R8.1–R8.5
 * Ensures each distributor PMA has a My-view CUR 2.0 export.
 * Uses the PROVISIONING role (separate from read-only).
 */

import prisma from "@/db";
import { assumeRole, withAudit, withBackoff } from "@/aws";
import type { CurHealth } from "@prisma/client";

const REGION = "us-east-1";
const SLR_PROPAGATION_WAIT_MS = 10_000; // 10s wait after SLR creation

/**
 * Ensure a My-view CUR export exists for a distributor PMA.
 * Idempotent — does not create if one already exists.
 */
export async function ensureMyCurExport(accountId: string, operator: string) {
  const account = await prisma.onboardedAccount.findUnique({ where: { accountId } });
  if (!account) throw new Error(`Account ${accountId} not found`);
  if (!account.provisioningRoleArn || !account.externalId) {
    throw new Error("Account missing provisioning role ARN or ExternalId");
  }

  // Check if we already have a healthy/pending CUR for this PMA
  const existing = await prisma.curExport.findUnique({
    where: {
      onboardedAccountId_billingView: {
        onboardedAccountId: account.id,
        billingView: "my",
      },
    },
  });

  if (existing && existing.health !== "unhealthy") {
    return { status: "already_exists", exportArn: existing.exportArn };
  }

  return withAudit(
    { operator, onboardedAccountId: account.id, action: "EnsureMyCurExport" },
    async () => {
      const credentials = await assumeRole({
        roleArn: account.provisioningRoleArn!,
        externalId: account.externalId!,
        sessionName: `cur-prov-${account.accountId}`,
      });

      // Dynamic imports for SDK clients
      const { BillingClient, ListBillingViewsCommand } = await import(
        "@aws-sdk/client-billing"
      );
      const { BCMDataExportsClient, CreateExportCommand } = await import(
        "@aws-sdk/client-bcm-data-exports"
      );
      const { IAMClient, CreateServiceLinkedRoleCommand } = await import(
        "@aws-sdk/client-iam"
      );

      // Step 1: Resolve the My-view Billing View ARN
      const billingClient = new BillingClient({ region: REGION, credentials });
      const billingViews = await withBackoff(() =>
        billingClient.send(new ListBillingViewsCommand({})),
      );

      const viewsOutput = billingViews as unknown as { BillingViews?: Array<{ Name?: string; BillingViewArn?: string }> };
      const myView = viewsOutput.BillingViews?.find(
        (v) =>
          v.Name?.toLowerCase().includes("my view") ||
          v.Name?.toLowerCase().includes("my-view"),
      );

      if (!myView?.BillingViewArn) {
        throw new Error("Could not find 'My view' Billing View on this account");
      }

      // Step 2: Ensure the SLR for BCM Data Exports
      const iamClient = new IAMClient({ region: REGION, credentials });
      try {
        await iamClient.send(
          new CreateServiceLinkedRoleCommand({
            AWSServiceName: "bcm-data-exports.amazonaws.com",
          }),
        );
        // Wait for SLR propagation
        await new Promise((resolve) => setTimeout(resolve, SLR_PROPAGATION_WAIT_MS));
      } catch (err: unknown) {
        const error = err as { name?: string };
        // InvalidInput means SLR already exists — that's fine
        if (error.name !== "InvalidInputException" && error.name !== "InvalidInput") {
          throw err;
        }
      }

      // Step 3: Create the CUR 2.0 export
      const s3Bucket = process.env.CUR_S3_BUCKET ?? `billops-cur-${account.accountId}`;
      const s3Prefix = `cur/${account.accountId}/my-view/`;
      const exportName = `billops-myview-${account.accountId}`;

      const bcmClient = new BCMDataExportsClient({ region: REGION, credentials });

      let exportArn: string | undefined;
      try {
        const createResult = await withBackoff(() =>
          bcmClient.send(
            new CreateExportCommand({
              Export: {
                Name: exportName,
                DataQuery: {
                  QueryStatement: [
                    "SELECT bill_payer_account_id",
                    "line_item_usage_account_id",
                    "line_item_line_item_type",
                    "line_item_usage_start_date",
                    "line_item_product_code",
                    "line_item_unblended_cost",
                    "line_item_currency_code",
                  ].join(", "),
                  TableConfigurations: {
                    COST_AND_USAGE_REPORT: {
                      TIME_GRANULARITY: "MONTHLY",
                      INCLUDE_RESOURCES: "FALSE",
                    },
                  },
                },
                DestinationConfigurations: {
                  S3Destination: {
                    S3Bucket: s3Bucket,
                    S3Prefix: s3Prefix,
                    S3Region: REGION,
                    S3OutputConfigurations: {
                      OutputType: "CUSTOM",
                      Format: "PARQUET",
                      Compression: "PARQUET",
                      Overwrite: "OVERWRITE_REPORT",
                    },
                  },
                },
                RefreshCadence: { Frequency: "SYNCHRONOUS" },
              },
            } as never),
          ),
        );
        exportArn = (createResult as Record<string, unknown>).ExportArn as string;
      } catch (err: unknown) {
        const error = err as { name?: string; message?: string };
        // ConflictException means export already exists
        if (error.name === "ConflictException" || error.message?.includes("already exists")) {
          // Treat as success (idempotent)
          exportArn = `existing-${exportName}`;
        } else {
          throw err;
        }
      }

      // Step 4: Record in cur_export
      await prisma.curExport.upsert({
        where: {
          onboardedAccountId_billingView: {
            onboardedAccountId: account.id,
            billingView: "my",
          },
        },
        create: {
          onboardedAccountId: account.id,
          exportArn,
          exportName,
          billingView: "my",
          billingViewArn: myView.BillingViewArn,
          s3Bucket,
          s3Prefix,
          region: REGION,
          health: "pending",
        },
        update: {
          exportArn,
          exportName,
          billingViewArn: myView.BillingViewArn,
          s3Bucket,
          s3Prefix,
          health: "pending",
        },
      });

      return { status: "created", exportArn, s3Bucket, s3Prefix };
    },
  );
}

/**
 * Check CUR export health via GetExport.
 */
export async function checkCurHealth(accountId: string, operator: string) {
  const account = await prisma.onboardedAccount.findUnique({ where: { accountId } });
  if (!account) throw new Error(`Account ${accountId} not found`);

  const curExport = await prisma.curExport.findUnique({
    where: {
      onboardedAccountId_billingView: {
        onboardedAccountId: account.id,
        billingView: "my",
      },
    },
  });

  if (!curExport || !curExport.exportArn) {
    return { health: "not_provisioned" };
  }

  if (!account.provisioningRoleArn || !account.externalId) {
    throw new Error("Account missing provisioning role ARN or ExternalId");
  }

  return withAudit(
    { operator, onboardedAccountId: account.id, action: "CheckCurHealth" },
    async () => {
      const credentials = await assumeRole({
        roleArn: account.provisioningRoleArn!,
        externalId: account.externalId!,
        sessionName: `cur-health-${account.accountId}`,
      });

      const { BCMDataExportsClient, GetExportCommand } = await import(
        "@aws-sdk/client-bcm-data-exports"
      );

      const bcmClient = new BCMDataExportsClient({ region: REGION, credentials });
      const result = await withBackoff(() =>
        bcmClient.send(new GetExportCommand({ ExportArn: curExport.exportArn! })),
      );

      const exportData = (result as Record<string, unknown>).Export as Record<string, unknown>;
      const status = exportData?.Status as Record<string, unknown>;
      const statusCode = (status?.StatusCode as string)?.toUpperCase();

      let health: CurHealth = "pending";
      if (statusCode === "HEALTHY" || statusCode === "ACTIVE") {
        health = "healthy";
      } else if (statusCode === "UNHEALTHY" || statusCode === "ERROR") {
        health = "unhealthy";
      }

      await prisma.curExport.update({
        where: { id: curExport.id },
        data: {
          health,
          lastDeliveryAt: status?.LastUpdatedDate
            ? new Date(status.LastUpdatedDate as string)
            : undefined,
        },
      });

      return {
        health,
        statusCode,
        statusReason: status?.StatusReason,
        lastDelivery: curExport.lastDeliveryAt,
      };
    },
  );
}

/**
 * Recreate a CUR export (e.g., after "Bill owner changed" error).
 */
export async function recreateCurExport(accountId: string, operator: string) {
  // Delete the existing record, then re-provision
  const account = await prisma.onboardedAccount.findUnique({ where: { accountId } });
  if (!account) throw new Error(`Account ${accountId} not found`);

  await prisma.curExport.deleteMany({
    where: { onboardedAccountId: account.id, billingView: "my" },
  });

  return ensureMyCurExport(accountId, operator);
}
