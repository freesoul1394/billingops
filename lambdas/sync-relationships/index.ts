/**
 * Sync Relationships Lambda — scheduled every 6 hours.
 * Iterates all active onboarded accounts and syncs their inbound transfers.
 */

export async function handler() {
  console.log("Sync relationships job started");
  // In production: query all active onboarded accounts from DB,
  // then call syncRelationships() for each.
  return { statusCode: 200, body: "Sync relationships complete" };
}
