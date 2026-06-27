# Tech — Billops

## Stack (use these unless a task says otherwise)
- **Language:** TypeScript everywhere. Node.js 20+.
- **Frontend:** Next.js 14 (App Router) + React + Tailwind CSS. Server Components where sensible.
- **Sync API:** Next.js route handlers (`app/api/**`).
- **Async/scheduled jobs:** AWS Lambda (TypeScript) + EventBridge schedules; S3-event triggers for CUR ingestion.
- **DB:** Aurora PostgreSQL Serverless v2, accessed via **Prisma** ORM.
- **AWS SDK:** AWS SDK for JavaScript **v3** (modular clients).
- **Auth:** Amazon Cognito user pool; support SAML/OIDC federation for Redington SSO.
- **Data lake:** S3 (CUR Parquet) → AWS Glue Data Catalog → Amazon Athena.
- **Secrets:** AWS Secrets Manager + a dedicated KMS key (for the access-key fallback only).
- **IaC:** AWS **CDK v2** (TypeScript) in `infra/`.
- **Hosting:** ECS Fargate behind an Application Load Balancer (`ApplicationLoadBalancedFargateService`), container built from the Next.js app. (App Runner is an acceptable lighter alternative.)
- **Region:** `us-east-1` for everything (billing APIs are us-east-1).

## Cross-account access pattern (core)
- The app runs in Redington's **hub** AWS account.
- Each distributor PMA is onboarded with **two roles** assumed via STS:
  - read-only role → Organizations, Invoicing, Cost Explorer reads.
  - provisioning role → BCM Data Exports (CUR), and (Phase 3) Billing Conductor.
- Always use a per-onboarding `ExternalId`. Assume role per request; cache creds ≤ their TTL.
- Access-key fallback: encrypt with KMS, decrypt in memory only, never log.

## AWS APIs by capability
- Relationships: `organizations:ListInboundResponsibilityTransfers`, `DescribeResponsibilityTransfer`.
- Invoices: `invoicing:ListInvoiceSummaries`, `invoicing:GetInvoicePDF` (data floor 2025-06-01).
- Margin (live): `ce:GetCostAndUsage`, `ce:GetDimensionValues` (enumerate `RECORD_TYPE`).
- CUR: `billing:ListBillingViews`, `bcm-data-exports:CreateExport`/`GetExport` (+ `cur:PutReportDefinition`).
- Chargeback (Phase 3): `billingconductor:CreatePricingRule`/`CreatePricingPlan`/`AssociatePricingRules`/`CreateBillingGroup`/`AssociateAccounts`.

## Conventions
- All external calls wrapped with exponential backoff + jitter; handle throttling.
- Paginate every `List*` until `NextToken` is null — Org List ops can return empty pages with a token; never stop on an empty page.
- Deterministic resource names derived from IDs; treat name-conflict exceptions as "already provisioned" (idempotent).
- Pass `ClientToken` on every create that supports it.
- No secrets in logs. Structured audit log for every cross-account call.
- Tests: Vitest unit tests for services; mock AWS clients with `aws-sdk-client-mock`.
