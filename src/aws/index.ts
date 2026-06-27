// AWS SDK layer — central exports
export { assumeRole, clearCredsCache } from "./assume-role";
export type { RoleType } from "./assume-role";
export { withBackoff } from "./backoff";
export { paginateAll } from "./paginator";
export {
  createOrganizationsClient,
  createCostExplorerClient,
  createSTSClient,
  createIAMClient,
  createAwsClient,
} from "./clients";
export { writeAuditLog, withAudit } from "./audit";
export type { AuditEntry } from "./audit";
