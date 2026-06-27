/**
 * Invoices service — R3.1–R3.5
 * Fetches invoice summaries and PDF downloads via AWS Invoicing API.
 */

import prisma from "@/db";
import { assumeRole, paginateAll, withAudit, withBackoff } from "@/aws";

const MIN_BILLING_YEAR = 2025;
const MIN_BILLING_MONTH = 6; // Data floor: June 2025

export interface InvoiceSummaryRecord {
  invoiceId: string;
  invoiceType?: string;
  accountId: string;
  billSourceAccounts: string[];
  billingYear: number;
  billingMonth: number;
  issuedDate?: Date;
  dueDate?: Date;
  totalBaseAmount?: number;
  baseCurrency?: string;
  totalPaymentAmount?: number;
  paymentCurrency?: string;
  amountBreakdown?: Record<string, unknown>;
}

/**
 * Validates billing period is not before the AWS data floor (2025-06).
 */
export function validateBillingPeriod(year: number, month: number): void {
  if (year < MIN_BILLING_YEAR || (year === MIN_BILLING_YEAR && month < MIN_BILLING_MONTH)) {
    throw new Error(
      `Billing data is not available before June 2025. Requested: ${year}-${String(month).padStart(2, "0")}`,
    );
  }
}

/**
 * Sync invoices for a PMA and billing period.
 */
export async function syncInvoices(
  accountId: string,
  billingYear: number,
  billingMonth: number,
  operator: string,
) {
  validateBillingPeriod(billingYear, billingMonth);

  const account = await prisma.onboardedAccount.findUnique({ where: { accountId } });
  if (!account) throw new Error(`Account ${accountId} not found`);
  if (!account.roRoleArn || !account.externalId) {
    throw new Error("Account missing role ARN or ExternalId");
  }

  return withAudit(
    { operator, onboardedAccountId: account.id, action: "SyncInvoices" },
    async () => {
      const credentials = await assumeRole({
        roleArn: account.roRoleArn!,
        externalId: account.externalId!,
        sessionName: `sync-inv-${account.accountId}`,
      });

      const { InvoicingClient, ListInvoiceSummariesCommand } = await import(
        "@aws-sdk/client-invoicing"
      );

      const invoicingClient = new InvoicingClient({
        region: "us-east-1",
        credentials,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoices = await paginateAll<any>({
        send: (input) => invoicingClient.send(new ListInvoiceSummariesCommand(input)),
        input: {
          Filter: { BillingPeriod: { Month: billingMonth, Year: billingYear } },
          MaxResults: 100,
        },
        getItems: (output) => output.InvoiceSummaries,
      });

      const now = new Date();

      for (const inv of invoices) {
        const invoiceId = inv.InvoiceId as string;
        const billSourceAccounts = ((inv.BillSourceAccounts as unknown[]) ?? []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (a: any) => a.AccountId ?? String(a),
        );

        await prisma.invoiceCache.upsert({
          where: {
            onboardedAccountId_invoiceId: {
              onboardedAccountId: account.id,
              invoiceId,
            },
          },
          create: {
            onboardedAccountId: account.id,
            invoiceId,
            invoiceType: inv.InvoiceType ?? undefined,
            accountId: inv.AccountId ?? accountId,
            billSourceAccounts,
            billingYear,
            billingMonth,
            issuedDate: inv.IssuedDate ? new Date(inv.IssuedDate) : undefined,
            dueDate: inv.DueDate ? new Date(inv.DueDate) : undefined,
            totalBaseAmount: inv.BaseCurrencyAmount?.Amount,
            baseCurrency: inv.BaseCurrencyAmount?.CurrencyCode,
            totalPaymentAmount: inv.PaymentCurrencyAmount?.Amount,
            paymentCurrency: inv.PaymentCurrencyAmount?.CurrencyCode,
            amountBreakdown: inv.AmountBreakdown ?? undefined,
            fetchedAt: now,
          },
          update: {
            invoiceType: inv.InvoiceType ?? undefined,
            billSourceAccounts,
            issuedDate: inv.IssuedDate ? new Date(inv.IssuedDate) : undefined,
            dueDate: inv.DueDate ? new Date(inv.DueDate) : undefined,
            totalBaseAmount: inv.BaseCurrencyAmount?.Amount,
            baseCurrency: inv.BaseCurrencyAmount?.CurrencyCode,
            totalPaymentAmount: inv.PaymentCurrencyAmount?.Amount,
            paymentCurrency: inv.PaymentCurrencyAmount?.CurrencyCode,
            amountBreakdown: inv.AmountBreakdown ?? undefined,
            fetchedAt: now,
          },
        });
      }

      return { synced: invoices.length };
    },
  );
}

/**
 * List cached invoices for a PMA and billing period.
 */
export async function listInvoices(
  accountId: string,
  billingYear: number,
  billingMonth: number,
) {
  validateBillingPeriod(billingYear, billingMonth);

  const account = await prisma.onboardedAccount.findUnique({ where: { accountId } });
  if (!account) throw new Error(`Account ${accountId} not found`);

  return prisma.invoiceCache.findMany({
    where: {
      onboardedAccountId: account.id,
      billingYear,
      billingMonth,
    },
    orderBy: { issuedDate: "desc" },
  });
}

/**
 * Get invoice PDF download URL.
 */
export async function getInvoicePdfUrl(accountId: string, invoiceId: string, operator: string) {
  const account = await prisma.onboardedAccount.findUnique({ where: { accountId } });
  if (!account) throw new Error(`Account ${accountId} not found`);
  if (!account.roRoleArn || !account.externalId) {
    throw new Error("Account missing role ARN or ExternalId");
  }

  return withAudit(
    { operator, onboardedAccountId: account.id, action: "GetInvoicePDF" },
    async () => {
      const credentials = await assumeRole({
        roleArn: account.roRoleArn!,
        externalId: account.externalId!,
        sessionName: `pdf-${account.accountId}`,
      });

      const { InvoicingClient, GetInvoicePDFCommand } = await import(
        "@aws-sdk/client-invoicing"
      );

      const invoicingClient = new InvoicingClient({
        region: "us-east-1",
        credentials,
      });

      const response = await withBackoff(() =>
        invoicingClient.send(new GetInvoicePDFCommand({ InvoiceId: invoiceId })),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { url: (response as any).Url as string };
    },
  );
}
