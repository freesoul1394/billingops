/**
 * Margin service — R7.1–R7.6
 * Computes gross cost, discount, net cost, and discount % per account.
 * CUR-authoritative; falls back to Cost Explorer for months without CUR data.
 */

import prisma from "@/db";
import { assumeRole, withAudit, withBackoff } from "@/aws";
import { createCostExplorerClient } from "@/aws/clients";
import { GetCostAndUsageCommand, GetDimensionValuesCommand } from "@aws-sdk/client-cost-explorer";

// ─── Charge-type classification (R7.5: never hardcode) ───────────────────────

/** Default exclusion list — these are NOT usage charges */
const DEFAULT_EXCLUDED_CHARGE_TYPES = new Set([
  "Tax",
  "Credit",
  "Refund",
  "Enterprise Discount Program Discount", // just an example — enumerated at runtime
]);

/**
 * Get the configurable exclusion list from env or defaults.
 */
function getExcludedChargeTypes(): Set<string> {
  const envList = process.env.EXCLUDED_CHARGE_TYPES;
  if (envList) {
    return new Set(envList.split(",").map((s) => s.trim()));
  }
  return DEFAULT_EXCLUDED_CHARGE_TYPES;
}

/**
 * Classify a charge type: is it a "usage" type (contributes to gross cost)?
 * Discount types are negative and tracked separately.
 */
function isUsageChargeType(chargeType: string, excludedTypes: Set<string>): boolean {
  if (excludedTypes.has(chargeType)) return false;
  // Discount types typically contain "Discount" — track them separately
  if (chargeType.toLowerCase().includes("discount")) return false;
  return true;
}

function isDiscountChargeType(chargeType: string): boolean {
  return chargeType.toLowerCase().includes("discount");
}

// ─── CUR-based margin (authoritative) ───────────────────────────────────────

export interface MarginResult {
  usageAccountId: string;
  billingYear: number;
  billingMonth: number;
  grossUsageCost: number;
  discountAmount: number;
  netCost: number;
  discountPct: number;
  currency: string;
  chargeTypeBreakdown: Record<string, number>;
}

/**
 * Compute margin from CUR line items (authoritative source).
 */
export async function computeMarginFromCur(
  onboardedAccountId: string,
  billingYear: number,
  billingMonth: number,
): Promise<MarginResult[]> {
  const lineItems = await prisma.curLineItem.findMany({
    where: { onboardedAccountId, billingYear, billingMonth },
  });

  if (lineItems.length === 0) return [];

  const excludedTypes = getExcludedChargeTypes();

  // Aggregate by usage_account_id
  const accountAgg = new Map<
    string,
    { gross: number; discount: number; net: number; currency: string; breakdown: Record<string, number> }
  >();

  for (const item of lineItems) {
    const key = item.usageAccountId;
    if (!accountAgg.has(key)) {
      accountAgg.set(key, { gross: 0, discount: 0, net: 0, currency: item.currency, breakdown: {} });
    }
    const agg = accountAgg.get(key)!;
    const cost = Number(item.unblendedCost);

    agg.breakdown[item.chargeType] = (agg.breakdown[item.chargeType] ?? 0) + cost;

    if (isUsageChargeType(item.chargeType, excludedTypes)) {
      agg.gross += cost;
      agg.net += cost;
    } else if (isDiscountChargeType(item.chargeType)) {
      agg.discount += Math.abs(cost); // discounts are negative in CUR
      agg.net += cost; // subtract from net (cost is already negative)
    }
    // Excluded types (tax, credit, refund) don't affect gross/net margin calc
  }

  const results: MarginResult[] = [];
  for (const [usageAccountId, agg] of accountAgg.entries()) {
    const discountPct = agg.gross > 0 ? (agg.discount / agg.gross) * 100 : 0;
    results.push({
      usageAccountId,
      billingYear,
      billingMonth,
      grossUsageCost: agg.gross,
      discountAmount: agg.discount,
      netCost: agg.net,
      discountPct,
      currency: agg.currency,
      chargeTypeBreakdown: agg.breakdown,
    });
  }

  return results;
}

// ─── Cost Explorer fallback ─────────────────────────────────────────────────

/**
 * Enumerate charge-type labels from Cost Explorer (R7.5 — never hardcode).
 */
export async function enumerateChargeTypes(
  accountId: string,
  billingYear: number,
  billingMonth: number,
  operator: string,
): Promise<string[]> {
  const account = await prisma.onboardedAccount.findUnique({ where: { accountId } });
  if (!account || !account.roRoleArn || !account.externalId) {
    throw new Error("Account not found or missing credentials");
  }

  return withAudit(
    { operator, onboardedAccountId: account.id, action: "EnumerateChargeTypes" },
    async () => {
      const credentials = await assumeRole({
        roleArn: account.roRoleArn!,
        externalId: account.externalId!,
        sessionName: `ce-dims-${account.accountId}`,
      });

      const ceClient = createCostExplorerClient({ credentials });
      const startDate = `${billingYear}-${String(billingMonth).padStart(2, "0")}-01`;
      const endMonth = billingMonth === 12 ? 1 : billingMonth + 1;
      const endYear = billingMonth === 12 ? billingYear + 1 : billingYear;
      const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

      const result = await withBackoff(() =>
        ceClient.send(
          new GetDimensionValuesCommand({
            Dimension: "RECORD_TYPE",
            TimePeriod: { Start: startDate, End: endDate },
          }),
        ),
      );

      return (result.DimensionValues ?? []).map((d) => d.Value ?? "");
    },
  );
}

/**
 * Fetch margin from Cost Explorer (fallback for months without CUR).
 */
export async function computeMarginFromCostExplorer(
  accountId: string,
  billingYear: number,
  billingMonth: number,
  operator: string,
): Promise<MarginResult[]> {
  const account = await prisma.onboardedAccount.findUnique({ where: { accountId } });
  if (!account || !account.roRoleArn || !account.externalId) {
    throw new Error("Account not found or missing credentials");
  }

  return withAudit(
    { operator, onboardedAccountId: account.id, action: "ComputeMarginCE" },
    async () => {
      const credentials = await assumeRole({
        roleArn: account.roRoleArn!,
        externalId: account.externalId!,
        sessionName: `ce-margin-${account.accountId}`,
      });

      const ceClient = createCostExplorerClient({ credentials });
      const startDate = `${billingYear}-${String(billingMonth).padStart(2, "0")}-01`;
      const endMonth = billingMonth === 12 ? 1 : billingMonth + 1;
      const endYear = billingMonth === 12 ? billingYear + 1 : billingYear;
      const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

      const result = await withBackoff(() =>
        ceClient.send(
          new GetCostAndUsageCommand({
            TimePeriod: { Start: startDate, End: endDate },
            Granularity: "MONTHLY",
            Metrics: ["UnblendedCost"],
            GroupBy: [
              { Type: "DIMENSION", Key: "LINKED_ACCOUNT" },
              { Type: "DIMENSION", Key: "RECORD_TYPE" },
            ],
          }),
        ),
      );

      const excludedTypes = getExcludedChargeTypes();
      const accountAgg = new Map<
        string,
        { gross: number; discount: number; net: number; breakdown: Record<string, number> }
      >();

      for (const timePeriod of result.ResultsByTime ?? []) {
        for (const group of timePeriod.Groups ?? []) {
          const linkedAccount = group.Keys?.[0] ?? "";
          const recordType = group.Keys?.[1] ?? "";
          const amount = parseFloat(group.Metrics?.UnblendedCost?.Amount ?? "0");

          if (!accountAgg.has(linkedAccount)) {
            accountAgg.set(linkedAccount, { gross: 0, discount: 0, net: 0, breakdown: {} });
          }
          const agg = accountAgg.get(linkedAccount)!;
          agg.breakdown[recordType] = (agg.breakdown[recordType] ?? 0) + amount;

          if (isUsageChargeType(recordType, excludedTypes)) {
            agg.gross += amount;
            agg.net += amount;
          } else if (isDiscountChargeType(recordType)) {
            agg.discount += Math.abs(amount);
            agg.net += amount;
          }
        }
      }

      const results: MarginResult[] = [];
      for (const [usageAccountId, agg] of accountAgg.entries()) {
        const discountPct = agg.gross > 0 ? (agg.discount / agg.gross) * 100 : 0;
        results.push({
          usageAccountId,
          billingYear,
          billingMonth,
          grossUsageCost: agg.gross,
          discountAmount: agg.discount,
          netCost: agg.net,
          discountPct,
          currency: "USD", // CE returns USD by default
          chargeTypeBreakdown: agg.breakdown,
        });
      }

      // Cache results
      const now = new Date();
      for (const r of results) {
        await prisma.costMarginCache.upsert({
          where: {
            onboardedAccountId_sourceAccountId_billingYear_billingMonth: {
              onboardedAccountId: account.id,
              sourceAccountId: r.usageAccountId,
              billingYear,
              billingMonth,
            },
          },
          create: {
            onboardedAccountId: account.id,
            sourceAccountId: r.usageAccountId,
            billingYear,
            billingMonth,
            grossUsageCost: r.grossUsageCost,
            netCost: r.netCost,
            discountAmount: r.discountAmount,
            discountPct: r.discountPct,
            currency: r.currency,
            chargeTypeBreakdown: r.chargeTypeBreakdown,
            fetchedAt: now,
          },
          update: {
            grossUsageCost: r.grossUsageCost,
            netCost: r.netCost,
            discountAmount: r.discountAmount,
            discountPct: r.discountPct,
            chargeTypeBreakdown: r.chargeTypeBreakdown,
            fetchedAt: now,
          },
        });
      }

      return results;
    },
  );
}

/**
 * Get margin for a billing period — CUR-first, CE fallback.
 */
export async function getMargin(
  accountId: string,
  billingYear: number,
  billingMonth: number,
  operator: string,
): Promise<MarginResult[]> {
  const account = await prisma.onboardedAccount.findUnique({ where: { accountId } });
  if (!account) throw new Error(`Account ${accountId} not found`);

  // Try CUR first (authoritative)
  const curResults = await computeMarginFromCur(account.id, billingYear, billingMonth);
  if (curResults.length > 0) {
    return curResults;
  }

  // Fallback to Cost Explorer
  return computeMarginFromCostExplorer(accountId, billingYear, billingMonth, operator);
}
