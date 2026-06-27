# Design — Redington AWS Billing Transfer Ops

> Drop this into `.kiro/specs/billing-transfer-ops/design.md`.

## 1. Architecture overview

```
Operator (SSO) ──► Web UI (React/Next.js)
                        │  HTTPS
                        ▼
                  App Backend (API)
                  ├─ Onboarding service
                  ├─ Relationships service
                  ├─ Invoices service
                  ├─ Attribution service (directory)
                  ├─ Margin service
                  └─ CUR provisioning service        per-request STS AssumeRole:
                        │                              ├─ read-only role  ─► query
                        │                              └─ provisioning role ─► create CUR
                        ▼                                       │
                  App data store                                ▼
                  (Postgres + KMS)         ┌───────────────────────────────────────┐
                        ▲                   │  Distributor PMA (one per country, N)  │
                        │                   │  - AWS Organizations API               │
                  CUR ingestion             │  - AWS Invoicing API                   │
                  (Athena/Glue) ◄───────────┤  - Cost Explorer (My view)             │
                        ▲                   │  - BCM Data Exports (CUR 2.0, My view) │
                        │                   └───────────────────┬───────────────────┘
                  S3 (CUR Parquet) ◄────────  daily delivery  ──┘
```

**Account hierarchy the app models (4 identity levels under each country):**
```
Country (UAE / KSA / India / …)
└─ Distributor PMA            ← onboarded into app; has role + My-view CUR
   └─ Partner PMA             ← Redington's DIRECT inbound transfer (bill source to distributor)
      └─ Customer Org mgmt acct   ← bill source to the PARTNER PMA (not visible via Redington's Org API)
         └─ Linked / member accts ← actual usage; seen only via My-view CUR line items
```
- Org API on a distributor PMA reveals **only the partner-PMA level** (direct inbound transfers). The customer-org and linked-account levels come from the **My-view CUR**, which is therefore the backbone of attribution — not an enhancement.

- The backend holds **no standing AWS power over customer accounts.** Per request it assumes a scoped IAM role in the target PMA via `sts:AssumeRole` (~15–60 min creds), acts, discards.
- App's own AWS account ID + a per-onboarding `ExternalId` form the trust boundary.
- **Two roles per PMA:** a read-only role for queries, and a separate, more-privileged **provisioning role** used only for one-time CUR setup (separation of duty).

## 2. Connection / onboarding model (preferred: cross-account role)

Onboarding wizard generates a CloudFormation template the PMA admin deploys. It creates a role like:

**Trust policy (in the PMA account):**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": "arn:aws:iam::<APP_ACCOUNT_ID>:root" },
    "Action": "sts:AssumeRole",
    "Condition": { "StringEquals": { "sts:ExternalId": "<PER_ONBOARDING_EXTERNAL_ID>" } }
  }]
}
```

**Permission policy (read-only, least privilege):**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "BillingTransferReadOnly",
    "Effect": "Allow",
    "Action": [
      "organizations:DescribeResponsibilityTransfer",
      "organizations:ListInboundResponsibilityTransfers",
      "organizations:ListOutboundResponsibilityTransfers",
      "organizations:ListHandshakesForOrganization",
      "invoicing:ListInvoiceSummaries",
      "invoicing:GetInvoicePDF",
      "ce:GetCostAndUsage",
      "ce:GetDimensionValues"
    ],
    "Resource": "*"
  }]
}
```
> The `organizations:*ResponsibilityTransfer*` set mirrors the read-only role AWS Partner Central uses for billing-transfer visibility.

**Provisioning role (separate, write — used only for one-time CUR setup):**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "CurProvisioning",
    "Effect": "Allow",
    "Action": [
      "bcm-data-exports:CreateExport",
      "bcm-data-exports:GetExport",
      "bcm-data-exports:ListExports",
      "bcm-data-exports:UpdateExport",
      "cur:PutReportDefinition",
      "cur:DescribeReportDefinitions",
      "billing:ListBillingViews",
      "billing:GetBillingView",
      "iam:CreateServiceLinkedRole"
    ],
    "Resource": [
      "arn:aws:bcm-data-exports:*:*:table/COST_AND_USAGE_REPORT",
      "arn:aws:bcm-data-exports:*:*:export/*",
      "arn:aws:billing::*:billingview/*",
      "*"
    ]
  }]
}
```
> `CreateExport` of a CUR table also requires the `cur:PutReportDefinition` permission. The S3 destination needs a bucket policy granting `bcm-data-exports.amazonaws.com` `s3:PutObject` (see §4 CUR provisioning). Trust policy is identical to the read-only role but should use a distinct `ExternalId` and ideally a separate role name so the write capability is auditable and revocable on its own.

**Fallback (access keys):** store `aws_access_key_id` / `aws_secret_access_key` encrypted with a per-record KMS data key; decrypt only in memory at call time; never log; support rotation + revoke.

## 3. Data model (app store)

```
onboarded_account          -- one row per DISTRIBUTOR PMA
  id (uuid)            account_id (char12)       alias    country
  connection_type (role|keys)
  ro_role_arn   provisioning_role_arn   external_id
  secret_ref (nullable, KMS-encrypted)
  status (active|inactive)  last_validated_at  created_by

relationship_cache         -- snapshot of inbound responsibility transfers (= partner PMAs)
  onboarded_account_id (fk)  transfer_id (rt-...)
  source_account_id          source_account_email
  transfer_name              -- Redington sets this to the partner name
  status                     start_ts   end_ts   type (BILLING)
  fetched_at

invoice_cache              -- snapshot of ListInvoiceSummaries per period
  onboarded_account_id (fk)  invoice_id   invoice_type
  account_id                 bill_source_accounts (json array)
  billing_year   billing_month
  issued_date    due_date
  total_base_amount  base_currency
  total_payment_amount  payment_currency
  amount_breakdown (json: taxes/fees/discounts)
  fetched_at

audit_log
  operator  onboarded_account_id  action  request_id  ts  outcome

account_directory          -- HIERARCHICAL tree; replaces opening PDFs
  account_id (char12) PK    role (distributor_pma|partner_pma|customer_org|linked_account)
  parent_account_id (fk → account_directory)   country
  partner_name              customer_name        friendly_label
  source (auto_chain|auto_cur|manual)
  mapped_by   mapped_at     needs_review (bool)

cur_export                 -- registry of CURs the app created, one per distributor PMA per view
  onboarded_account_id (fk)  export_arn   export_name   billing_view (my|showback)
  billing_view_arn           s3_bucket    s3_prefix    region (us-east-1)
  health (healthy|unhealthy|pending)   last_delivery_at   created_at

cur_line_item              -- ingested from CUR Parquet via Athena (or materialized rollup)
  onboarded_account_id (fk)  billing_year  billing_month
  bill_payer_account_id      usage_account_id        -- maps to directory.account_id
  charge_type (line_item_line_item_type)
  unblended_cost             currency
  -- aggregations drive gross cost / discount / margin per account/customer/partner
```

> **Margin source of truth = `cur_line_item`** (per-account, charge-type granular). `cost_margin_cache` below is a faster, lower-fidelity live view from Cost Explorer for months where CUR hasn't landed yet.

```
cost_margin_cache          -- quick live view from Cost Explorer "My view"
  onboarded_account_id (fk) source_account_id   billing_year  billing_month
  gross_usage_cost          net_cost            discount_amount   discount_pct
  currency                  charge_type_breakdown (json)
  fetched_at
```

## 4. AWS API mapping (what each service calls)

### Relationships service → AWS Organizations (region: us-east-1 / aws-global)
- `ListInboundResponsibilityTransfers` — loop until `NextToken` is null (AWS may return empty pages with a token; keep going).
- `DescribeResponsibilityTransfer { Id }` → returns `ResponsibilityTransfer { Id, Status, StartTimestamp, EndTimestamp, Source{ManagementAccountId, ManagementAccountEmail}, Target{...}, Type }`.
- "Active billing" derivation: `Status == ACCEPTED/ACTIVE` AND `now >= StartTimestamp` AND (`EndTimestamp` absent OR `now < EndTimestamp`).

### Invoices service → AWS Invoicing (region: us-east-1)
- `ListInvoiceSummaries`:
  ```json
  {
    "Filter": { "BillingPeriod": { "Month": 3, "Year": 2026 } },
    "MaxResults": 100
  }
  ```
  Each `InvoiceSummary` → `{ InvoiceId, AccountId, BillSourceAccounts[], InvoiceType, IssuedDate, DueDate, BaseCurrencyAmount{...}, PaymentCurrencyAmount{...}, BillingPeriod }`.
  - Guard: `Year/Month < 2025-06` → block with a friendly "no data before June 2025" message.
- `GetInvoicePDF { InvoiceId }` → presigned S3 URL; stream/redirect to operator. us-east-1 only.

### Correlation service (in-app, no AWS call)
- Build a map `sourceAccountId -> activeRelationship`.
- For each invoice, for each `billSourceAccount`, attach the matching relationship + active flag.
- Emit anomaly flags per R4.3.

### Attribution service → Account Directory (solves the "open every PDF" problem)
Resolves every account ID on an invoice to human-readable partner + customer labels, structurally — no PDF parsing.
1. **Seed from chain:** for each inbound transfer, read `DescribeResponsibilityTransfer.Name`. Redington sets this to the partner/downstream-seller name at invitation time, so the partner level is self-labeling. Insert `partner_pma` directory rows.
2. **Two-level reality:** Redington controls names only for its *direct* (partner) transfers; the partner names their own customer-org transfers. So the customer-org and linked-account hops are NOT visible via the Org API — they are auto-populated from **CUR line items** (`usage_account_id`, `bill_payer_account_id`) on the My view, falling back to one-time manual mapping for any account the CUR doesn't resolve.
3. **Resolve at render time:** `invoice.AccountId` + `invoice.BillSourceAccounts[]` → directory lookup → `Partner X / Customer Y`. Unmapped IDs → "needs mapping" badge + one-click add.
4. **Naming hygiene action:** the app should *audit* transfer names and nudge Ops to set any blank/inconsistent `Name` values, since consistent partner names are what make search-by-partner work.

### CUR provisioning service → BCM Data Exports (region: us-east-1, uses the PROVISIONING role)
Triggered when a relationship first becomes active on a distributor PMA. Ensures (idempotently) that the PMA has a My-view CUR; does NOT create one per relationship.
1. Resolve the My-view Billing View ARN: `billing:ListBillingViews` → pick the "Billing Transfer – My view".
2. Ensure S3 destination: a bucket (per-PMA, or one central Redington data-account bucket with cross-account delivery) whose policy allows `bcm-data-exports.amazonaws.com` `s3:PutObject` with `aws:SourceArn = arn:aws:bcm-data-exports:us-east-1:<PMA>:export/*` and `aws:SourceAccount = <PMA>`.
3. Ensure the `AWSServiceRoleForBCMDataExports` SLR exists (`iam:CreateServiceLinkedRole`), then **wait for propagation** before step 4 (documented race: CreateExport fails if SLR not ready).
4. `bcm-data-exports:CreateExport` — CUR 2.0 `DataQuery` selecting at least: `bill_payer_account_id, line_item_usage_account_id, line_item_line_item_type, line_item_usage_start_date, line_item_product_code, line_item_unblended_cost`; Parquet; `TIME_GRANULARITY: MONTHLY` (or DAILY); scoped to the My-view Billing View ARN.
5. Record in `cur_export`; poll `GetExport` for health; surface unhealthy states (most common: S3 bucket policy gap, or "Bill owner changed" when org/billing-group membership shifts → recreate CUR).

> Optional Showback/chargeback CUR: a *second* export on the Showback view, per Billing Conductor billing group, for partner-facing chargeback at configured rates. Requires Billing Conductor billing-group setup first.

### Ingestion → Athena/Glue over the CUR Parquet
- Glue table over the S3 prefix; partition by billing period. Materialize a monthly rollup into `cur_line_item` / a margin rollup so the UI doesn't hit Athena per page load.
- `usage_account_id` joins to `account_directory.account_id` → auto-fills customer-org and linked-account directory rows (`source = auto_cur`).

### Margin service — prefer CUR, fall back to Cost Explorer
- **Authoritative (CUR):** aggregate `cur_line_item` by `usage_account_id` × `charge_type`. Gross = usage charge types; discount = distribution/SPP/bundled discount types (negative); discount % = |discount| / gross. Rolls up cleanly to customer-org and partner via the directory tree.
- **Live/quick (Cost Explorer "My view"), for months CUR hasn't delivered yet:**
  - `GetDimensionValues { Dimension: RECORD_TYPE, TimePeriod }` → discover actual charge-type labels (Usage, Tax, Credit, Refund, and the distribution/SPP/bundled discount label — DO NOT hardcode).
  - `GetCostAndUsage`:
  ```json
  {
    "TimePeriod": { "Start": "2026-03-01", "End": "2026-04-01" },
    "Granularity": "MONTHLY",
    "Metrics": ["UnblendedCost"],
    "GroupBy": [
      { "Type": "DIMENSION", "Key": "LINKED_ACCOUNT" },
      { "Type": "DIMENSION", "Key": "RECORD_TYPE" }
    ]
  }
  ```
  - Derive per account: gross usage, discount, net, discount %. Run against the My-view context, never the showback view.


## 5. Key UI views
1. **Accounts** — onboarded distributor PMAs grouped by **country**; connection health (both roles), CUR health, last validated.
2. **Onboard** — wizard: account ID + country → deploy read-only + provisioning roles (CFN) → validate → optionally provision My-view CUR.
3. **Relationships** — inbound transfers (= partner PMAs), status filter, partner name (from transfer `Name`).
4. **Monthly invoices** — PMA + month picker → invoice table **auto-labeled Partner / Customer** → PDF optional.
5. **Reconciliation (the join)** — drill-down tree: country → partner → customer org → linked account, each row showing relationship status, invoice, **gross cost, net cost, discount %**, with anomaly + "needs mapping" badges.
6. **Account Directory** — manage the hierarchical mapping; "needs mapping" queue; CUR-auto-filled rows flagged.
7. **CUR status** — per PMA: export health, last delivery, recreate action.

## 6. Risks / gotchas baked in
- **Two-level visibility may need Billing Conductor:** AWS docs state the bill receiver must configure a billing group in the bill-source org to view allocated bill-source costs in two-level setups. **Validate against the first real My-view CUR** whether linked-account breakdown appears or collapses at the partner PMA; if it collapses, billing-group setup is a prerequisite.
- **CUR delivery lag:** first delivery can take up to ~24h; design the UI to show "CUR pending" and rely on Cost Explorer for the current month meanwhile.
- **SLR propagation race:** create `AWSServiceRoleForBCMDataExports` and wait before `CreateExport`.
- **"Bill owner changed" CUR errors** occur when org/billing-group membership shifts — the documented fix is to recreate the CUR; surface this and offer a one-click recreate.
- Invoice data floor at 2025-06-01; `TimeInterval` supports up to a 5-year window.
- Invoicing, GetInvoicePDF, Cost Explorer, BCM Data Exports all run in us-east-1.
- Org `List*` ops can return empty pages with a non-null `NextToken` — never stop on an empty page.
- **Two-level naming:** you control only direct (partner) transfer names; deeper names are the partner's → rely on CUR/manual mapping.
- **Charge-type labels drift** — enumerate `RECORD_TYPE`; never hardcode the discount label.
- **My view vs Showback view** — margin uses My view; chargeback reports use Showback view.
- Throttling: exponential backoff; cache with short TTL + manual refresh.
- A transfer is effective only on the 1st of the month after acceptance — distinguish "accepted, not yet active" from "active."

## 7. Phasing
- **Phase 1:** onboarding (dual roles, country) + relationships + invoices + directory + **CUR provisioning on activation** + CUR ingestion + reconciliation with margin.
- **Phase 2:** mutations — invite/accept/withdraw transfers, service periods (handshake flows + management IAM policy).
- **Phase 3:** Showback/chargeback CURs per Billing Conductor billing group; partner-facing chargeback reports.
