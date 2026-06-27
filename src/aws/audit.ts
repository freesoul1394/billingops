/**
 * Centralized audit-log writer.
 * Logs every cross-account AWS call — never logs secret material.
 */

import prisma from "@/db";

export interface AuditEntry {
  operator: string;
  onboardedAccountId?: string;
  action: string;
  requestId?: string;
  outcome?: string;
}

/**
 * Write an audit log entry. Fire-and-forget (non-blocking) in prod;
 * awaited in tests.
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      operator: entry.operator,
      onboardedAccountId: entry.onboardedAccountId ?? null,
      action: entry.action,
      requestId: entry.requestId ?? null,
      outcome: entry.outcome ?? null,
    },
  });
}

/**
 * Higher-order wrapper: executes an AWS call, logs the result.
 */
export async function withAudit<T>(
  entry: Omit<AuditEntry, "outcome">,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const result = await fn();
    await writeAuditLog({ ...entry, outcome: "success" });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await writeAuditLog({ ...entry, outcome: `error: ${message}` });
    throw error;
  }
}
