/**
 * Sync Invoices Lambda — scheduled daily at 06:00 UTC.
 * Syncs invoice summaries for the current billing period across all active PMAs.
 */

export async function handler() {
  console.log("Sync invoices job started");
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  console.log(`Syncing invoices for ${year}-${String(month).padStart(2, "0")}`);
  // In production: query all active onboarded accounts,
  // then call syncInvoices() for each with current billing period.
  return { statusCode: 200, body: "Sync invoices complete" };
}
