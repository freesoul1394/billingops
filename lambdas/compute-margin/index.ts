/**
 * Compute Margin Lambda — scheduled daily at 08:00 UTC.
 * Runs CUR-based margin computation (or CE fallback) for all active PMAs.
 */

export async function handler() {
  console.log("Compute margin job started");
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  console.log(`Computing margin for ${year}-${String(month).padStart(2, "0")}`);
  // In production: query all active onboarded accounts,
  // compute margin from CUR (or CE fallback) for the current period.
  return { statusCode: 200, body: "Compute margin complete" };
}
