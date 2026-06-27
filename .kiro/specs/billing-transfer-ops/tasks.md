# Tasks — billing-transfer-ops

> Kiro executes these top-to-bottom, one at a time, with approval. Each references
> requirements (see requirements.md) and the design (design.md). Phase 1 is a
> deployable MVP. Do NOT start Phase 3 before the two-level CUR breakdown is validated.

## Phase 0 — Foundations

- [ ] 1. Scaffold the monorepo per structure.md: Next.js 14 (App Router) + TypeScript + Tailwind, ESLint/Prettier, Vitest, `aws-sdk-client-mock`. Add root scripts (dev, build, test, lint).
  - _Requirements: R5.5_

- [ ] 2. Define the database schema in `prisma/schema.prisma` for all tables in design.md §3 (onboarded_account, relationship_cache, invoice_cache, audit_log, account_directory [hierarchical], cur_export, cur_line_item, cost_margin_cache). Generate the Prisma client and a migration.
  - _Requirements: R1, R2, R3, R6, R7, R8_

- [ ] 3. Build `src/aws/`: STS assume-role helper (read-only + provisioning roles, ExternalId, creds cached ≤ TTL), a typed client factory per service (us-east-1), exponential-backoff+jitter wrapper, and a paginator that loops until `NextToken` is null and does NOT stop on empty pages. Add the centralized audit-log writer.
  - _Requirements: R5.1, R5.2, R5.3_

- [ ] 4. Implement auth with Amazon Cognito (user pool + hosted UI; SAML/OIDC federation placeholder for Redington SSO). Gate all dashboard routes.
  - _Requirements: R5.5_

- [ ] 5. Build the app shell: nav for Accounts, Relationships, Invoices, Reconciliation, Directory, CUR. Country grouping in the layout.

## Phase 1 — Read, attribution, CUR, margin (deployable MVP)

- [ ] 6. Onboarding service + UI (R1): capture account ID + country + connection method; generate the two cross-account role CloudFormation templates into `onboarding-templates/` (read-only role, provisioning role, each with ExternalId + trust to the hub account); validate connectivity with `ListInboundResponsibilityTransfers`. Implement the encrypted access-key fallback (Secrets Manager + KMS).
  - _Requirements: R1.1–R1.6, R5.1_

- [ ] 7. Relationships service + UI (R2): sync inbound responsibility transfers via `ListInboundResponsibilityTransfers` + `DescribeResponsibilityTransfer`; persist transfer name, status, start/end. Derive "active" (status active AND now≥start AND (no end OR now<end)). Filter by status/source/partner.
  - _Requirements: R2.1–R2.4_

- [ ] 8. Invoices service + UI (R3): `ListInvoiceSummaries` by billing period (guard < 2025-06); persist AccountId, BillSourceAccounts, amounts, dates; `GetInvoicePDF` download. Paginate + backoff.
  - _Requirements: R3.1–R3.5_

- [ ] 9. Account Directory service + UI (R6): hierarchical (parent_account_id, role, country); seed partner_pma rows from transfer names; resolve invoice account IDs to Partner/Customer labels at render time; "needs mapping" queue + one-click add; search by partner/customer name.
  - _Requirements: R6.1–R6.5_

- [ ] 10. Attribution join (R4): correlate invoice BillSourceAccounts ↔ relationships ↔ directory; anomaly flags (active relationship w/ no invoice; invoice w/ no active relationship).
  - _Requirements: R4.1–R4.3_

- [ ] 11. CUR provisioning service (R8): on relationship activation, ensure the PMA's My-view CUR exists — `billing:ListBillingViews` → My view ARN; ensure S3 bucket + policy (grant `bcm-data-exports.amazonaws.com` s3:PutObject w/ SourceArn/SourceAccount); ensure `AWSServiceRoleForBCMDataExports` SLR and WAIT for propagation; `bcm-data-exports:CreateExport` (CUR 2.0, Parquet, My-view scoped, columns: bill_payer_account_id, line_item_usage_account_id, line_item_line_item_type, line_item_unblended_cost, dates, product_code). Register in cur_export; poll `GetExport` health; recreate action.
  - _Requirements: R8.1–R8.5_

- [ ] 12. CUR ingestion (R8.4): S3-event Lambda → Glue table over the CUR prefix (partition by billing period) → materialize cur_line_item + monthly margin rollups; auto-fill customer_org/linked_account directory rows (source=auto_cur).
  - _Requirements: R6.6, R8.4_

- [ ] 13. Margin service (R7): authoritative from cur_line_item (aggregate by usage_account × charge_type → gross, discount, net, discount %); fallback to `ce:GetCostAndUsage` + `ce:GetDimensionValues` for months without CUR; never hardcode charge-type labels (configurable exclusion list); roll up linked→customer→partner→country.
  - _Requirements: R7.1–R7.6_

- [ ] 14. Reconciliation UI (R4 + R7): drill-down tree country→partner→customer→linked, each row showing relationship status, invoice, gross/net cost, discount %, anomaly + needs-mapping badges. Month picker.
  - _Requirements: R4.2, R6.5, R7.6_

- [ ] 15. Cross-cutting: short-TTL caching with manual refresh; CUR-pending UI state; structured audit log surfaced in an admin view.
  - _Requirements: R5.2, R5.4_

- [ ] 16. Tests for all Phase-1 services (mocked AWS clients), incl. pagination/empty-page, charge-type classification, attribution join, and the active-billing derivation.

## Deploy (end of Phase 1)

- [ ] 17. CDK app in `infra/`: VPC; Aurora PostgreSQL Serverless v2; KMS key; Secrets Manager; S3 (CUR) + Glue + Athena workgroup; Cognito; the hub IAM role the app uses to assume PMA roles; ECS Fargate service behind ALB (container from the Next.js app); EventBridge schedules + Lambdas (sync/provision/ingest/margin). Outputs: app URL, hub role ARN, ExternalId pattern.
  - _Requirements: R5.1, R5.3, R5.5_

- [ ] 18. Deployment runbook in README: bootstrap, build, deploy, first-PMA onboarding, smoke test. (See KIRO_SETUP.md for the commands.)

## Phase 2 — Mutations (after MVP in production)

- [ ] 19. Transfer mutations: invite/accept/withdraw (`InviteOrganizationToTransferResponsibility`, handshake accept/withdraw), service periods. Needs the management IAM policy on the provisioning role.

## Phase 3 — Chargeback (validate the dependency FIRST)

- [ ] 20. SPIKE: on one real active relationship, create the My-view CUR and confirm whether line items break down to end-customer linked accounts or collapse at the partner PMA. If they collapse, Billing Conductor billing-group setup is a prerequisite — record the finding before proceeding.
- [ ] 21. Chargeback service: `CreatePricingRule` (GLOBAL markup) → `CreatePricingPlan` → `CreateBillingGroup` (ComputationPreference→plan ARN) → `AssociateAccounts`; deterministic names, treat ConflictException as already-provisioned; Showback-view CUR per billing group. Surface "contact AWS Support" path if two-level association is blocked.
