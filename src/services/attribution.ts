/**
 * Attribution service — R6.1–R6.6, R4.1–R4.3
 * Account directory management + invoice attribution join.
 */

import prisma from "@/db";
import type { AccountRole, DirectorySource } from "@prisma/client";

// ─── Directory Management ────────────────────────────────────────────────────

export interface DirectoryEntry {
  accountId: string;
  role: AccountRole;
  parentAccountId?: string;
  country?: string;
  partnerName?: string;
  customerName?: string;
  friendlyLabel?: string;
  source: DirectorySource;
  mappedBy?: string;
}

/**
 * Add or update a directory entry.
 */
export async function upsertDirectoryEntry(entry: DirectoryEntry) {
  return prisma.accountDirectory.upsert({
    where: { accountId: entry.accountId },
    create: {
      accountId: entry.accountId,
      role: entry.role,
      parentAccountId: entry.parentAccountId,
      country: entry.country,
      partnerName: entry.partnerName,
      customerName: entry.customerName,
      friendlyLabel: entry.friendlyLabel,
      source: entry.source,
      mappedBy: entry.mappedBy,
      mappedAt: new Date(),
      needsReview: false,
    },
    update: {
      role: entry.role,
      parentAccountId: entry.parentAccountId,
      country: entry.country,
      partnerName: entry.partnerName,
      customerName: entry.customerName,
      friendlyLabel: entry.friendlyLabel,
      source: entry.source,
      mappedBy: entry.mappedBy,
      mappedAt: new Date(),
      needsReview: false,
    },
  });
}

/**
 * Seed directory from relationship transfer names (auto_chain source).
 * Called after syncing relationships.
 */
export async function seedDirectoryFromTransfers(onboardedAccountId: string) {
  const account = await prisma.onboardedAccount.findUnique({
    where: { id: onboardedAccountId },
  });
  if (!account) return;

  const relationships = await prisma.relationshipCache.findMany({
    where: { onboardedAccountId },
  });

  for (const rel of relationships) {
    // Seed the partner PMA entry
    await prisma.accountDirectory.upsert({
      where: { accountId: rel.sourceAccountId },
      create: {
        accountId: rel.sourceAccountId,
        role: "partner_pma",
        parentAccountId: account.accountId,
        country: account.country,
        partnerName: rel.transferName ?? undefined,
        friendlyLabel: rel.transferName ?? `Partner ${rel.sourceAccountId}`,
        source: "auto_chain",
        mappedAt: new Date(),
        needsReview: !rel.transferName, // flag if no name
      },
      update: {
        partnerName: rel.transferName ?? undefined,
        friendlyLabel: rel.transferName ?? `Partner ${rel.sourceAccountId}`,
        source: "auto_chain",
        mappedAt: new Date(),
      },
    });
  }

  // Also ensure the distributor PMA itself is in the directory
  await prisma.accountDirectory.upsert({
    where: { accountId: account.accountId },
    create: {
      accountId: account.accountId,
      role: "distributor_pma",
      country: account.country,
      friendlyLabel: account.alias ?? `PMA ${account.accountId}`,
      source: "auto_chain",
      mappedAt: new Date(),
      needsReview: false,
    },
    update: {
      country: account.country,
      friendlyLabel: account.alias ?? `PMA ${account.accountId}`,
    },
  });
}

/**
 * Resolve an account ID to its directory labels.
 * Returns null if not found (needs mapping).
 */
export async function resolveAccountLabel(accountId: string) {
  return prisma.accountDirectory.findUnique({
    where: { accountId },
  });
}

/**
 * Resolve multiple account IDs at once (batch lookup).
 */
export async function resolveAccountLabels(accountIds: string[]) {
  const entries = await prisma.accountDirectory.findMany({
    where: { accountId: { in: accountIds } },
  });

  const map = new Map(entries.map((e) => [e.accountId, e]));
  return accountIds.map((id) => map.get(id) ?? null);
}

/**
 * Get all directory entries needing review.
 */
export async function getNeedsMappingQueue() {
  return prisma.accountDirectory.findMany({
    where: { needsReview: true },
    orderBy: { mappedAt: "desc" },
  });
}

/**
 * Flag an account as needing mapping (when seen on an invoice but not in directory).
 */
export async function flagNeedsMapping(accountId: string) {
  const existing = await prisma.accountDirectory.findUnique({ where: { accountId } });
  if (!existing) {
    await prisma.accountDirectory.create({
      data: {
        accountId,
        role: "linked_account", // default — operator will correct
        source: "manual",
        needsReview: true,
        mappedAt: new Date(),
      },
    });
  }
}

/**
 * Search directory by partner or customer name.
 */
export async function searchDirectory(query: string) {
  return prisma.accountDirectory.findMany({
    where: {
      OR: [
        { partnerName: { contains: query, mode: "insensitive" } },
        { customerName: { contains: query, mode: "insensitive" } },
        { friendlyLabel: { contains: query, mode: "insensitive" } },
        { accountId: { contains: query } },
      ],
    },
    orderBy: { partnerName: "asc" },
    take: 50,
  });
}

// ─── Attribution Join (R4) ───────────────────────────────────────────────────

export interface AttributedInvoice {
  invoiceId: string;
  accountId: string;
  billSourceAccounts: string[];
  attributions: Array<{
    accountId: string;
    relationship: { transferId: string; status: string; isActive: boolean } | null;
    directory: { partnerName?: string; customerName?: string; role: string } | null;
    anomaly?: string;
  }>;
}

/**
 * Build the join view for a billing period.
 * Correlates invoices ↔ relationships ↔ directory.
 * Flags anomalies per R4.3.
 */
export async function buildAttributionJoin(
  onboardedAccountId: string,
  billingYear: number,
  billingMonth: number,
): Promise<AttributedInvoice[]> {
  // Get all invoices for the period
  const invoices = await prisma.invoiceCache.findMany({
    where: { onboardedAccountId, billingYear, billingMonth },
  });

  // Get all relationships for this PMA
  const relationships = await prisma.relationshipCache.findMany({
    where: { onboardedAccountId },
  });

  // Build relationship lookup
  const relMap = new Map(relationships.map((r) => [r.sourceAccountId, r]));

  // Collect all account IDs we need to resolve
  const allAccountIds = new Set<string>();
  for (const inv of invoices) {
    allAccountIds.add(inv.accountId);
    const sources = inv.billSourceAccounts as string[];
    sources.forEach((id) => allAccountIds.add(id));
  }

  // Batch resolve directory
  const directoryEntries = await prisma.accountDirectory.findMany({
    where: { accountId: { in: Array.from(allAccountIds) } },
  });
  const dirMap = new Map(directoryEntries.map((d) => [d.accountId, d]));

  // Track which active relationships have invoices
  const activeRelsWithInvoices = new Set<string>();

  const results: AttributedInvoice[] = invoices.map((inv) => {
    const sources = inv.billSourceAccounts as string[];

    const attributions = sources.map((sourceId) => {
      const rel = relMap.get(sourceId);
      const dir = dirMap.get(sourceId);
      const now = new Date();
      const isActive =
        rel &&
        ["ACTIVE", "ACCEPTED"].includes(rel.status.toUpperCase()) &&
        (rel.startTs ? now >= rel.startTs : false) &&
        (!rel.endTs || now < rel.endTs);

      if (isActive) {
        activeRelsWithInvoices.add(sourceId);
      }

      let anomaly: string | undefined;
      if (!rel) {
        anomaly = "No matching relationship for this bill-source account";
      } else if (!isActive) {
        anomaly = "Relationship exists but is not currently active";
      }

      // Flag for directory mapping if missing
      if (!dir) {
        flagNeedsMapping(sourceId); // fire-and-forget
      }

      return {
        accountId: sourceId,
        relationship: rel
          ? { transferId: rel.transferId, status: rel.status, isActive: !!isActive }
          : null,
        directory: dir
          ? { partnerName: dir.partnerName ?? undefined, customerName: dir.customerName ?? undefined, role: dir.role }
          : null,
        anomaly,
      };
    });

    return {
      invoiceId: inv.invoiceId,
      accountId: inv.accountId,
      billSourceAccounts: sources,
      attributions,
    };
  });

  // Check for active relationships with no invoice (anomaly R4.3)
  for (const [sourceId, rel] of relMap.entries()) {
    const now = new Date();
    const isActive =
      ["ACTIVE", "ACCEPTED"].includes(rel.status.toUpperCase()) &&
      (rel.startTs ? now >= rel.startTs : false) &&
      (!rel.endTs || now < rel.endTs);

    if (isActive && !activeRelsWithInvoices.has(sourceId)) {
      // This active relationship has no invoice for the period
      results.push({
        invoiceId: `ANOMALY-NO-INVOICE-${sourceId}`,
        accountId: sourceId,
        billSourceAccounts: [sourceId],
        attributions: [
          {
            accountId: sourceId,
            relationship: { transferId: rel.transferId, status: rel.status, isActive: true },
            directory: dirMap.get(sourceId)
              ? {
                  partnerName: dirMap.get(sourceId)!.partnerName ?? undefined,
                  customerName: dirMap.get(sourceId)!.customerName ?? undefined,
                  role: dirMap.get(sourceId)!.role,
                }
              : null,
            anomaly: "Active relationship with no invoice for this billing period",
          },
        ],
      });
    }
  }

  return results;
}
