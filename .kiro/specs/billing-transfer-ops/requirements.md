# Requirements — Redington AWS Billing Transfer Ops

> Drop this into `.kiro/specs/billing-transfer-ops/requirements.md`.
> Internal tool for the Redington AWS Billing Operations team. Redington operates
> as an AWS **Distributor** with one or more **Program Management Accounts (PMAs)**
> acting as **Bill-Transfer accounts** under AWS Partner Central Channel Management.

## Glossary

| Term | Meaning |
|------|---------|
| PMA | Program/Partner Management Account — registered in Partner Central, receives transferred bills. Implemented as an AWS Organizations management account. |
| Bill-Transfer account | The account that receives and pays the transferred bill. For Redington, this is the PMA. |
| Bill-Source account | A customer's management account whose consolidated bill is transferred to the PMA. |
| Responsibility Transfer | The AWS Organizations primitive (`Type: BILLING`) that implements "Billing Transfer." This is the actual API surface. |
| Active billing | A responsibility transfer currently in effect (accepted and past its start date, not withdrawn/ended). |

## Functional requirements (EARS-style)

### R1 — Account onboarding
- R1.1 WHEN an operator onboards a **distributor PMA**, the system SHALL accept the 12-digit AWS account ID, a **country**, and a connection method.
- R1.2 The system SHALL provision **two cross-account roles** per PMA via STS: a **read-only role** (queries) and a separate **provisioning role** (CUR setup only), each with its own `ExternalId`.
- R1.3 The system MAY support a fallback **access-key** method for accounts that cannot deploy roles; if used, keys SHALL be stored encrypted at rest (KMS) and never logged.
- R1.4 WHEN onboarding completes, the system SHALL validate connectivity with a read-only test call (e.g. `ListInboundResponsibilityTransfers`) and record the result.
- R1.5 The system SHALL allow an operator to deactivate/remove an onboarded account, immediately revoking stored credentials/role references.
- R1.6 The system SHALL model the four-level hierarchy: distributor PMA → partner PMA → customer org management account → linked accounts.

### R2 — Billing transfer relationships
- R2.1 The system SHALL list all inbound responsibility transfers for a selected PMA (`organizations:ListInboundResponsibilityTransfers`, paginated to `NextToken == null`).
- R2.2 For each transfer the system SHALL display: source management account ID + email, status, start timestamp, end timestamp, transfer ID, type.
- R2.3 The system SHALL let operators filter relationships by status (e.g. ACTIVE, ACCEPTED, WITHDRAWN) and by source account ID.
- R2.4 The system SHALL distinguish **active billings** (in-effect transfers) from pending invitations and ended transfers.

### R3 — Monthly invoice lookup
- R3.1 WHEN an operator selects a PMA and a billing period (month + year), the system SHALL retrieve invoice summaries via `invoicing:ListInvoiceSummaries` filtered by `BillingPeriod`.
- R3.2 The system SHALL reject / warn on billing periods earlier than 2025-06, which AWS does not serve.
- R3.3 For each invoice the system SHALL display: invoice ID, type, account ID, bill-source accounts, issued date, due date, totals (base + payment currency with tax/fee/discount breakdown).
- R3.4 The system SHALL let an operator download an invoice PDF via `invoicing:GetInvoicePDF` (presigned S3 URL).
- R3.5 The system SHALL paginate invoice results and handle throttling with retry/backoff.

### R4 — The join view (core feature)
- R4.1 The system SHALL correlate each invoice's `BillSourceAccounts[]` with the relationship whose `Source.ManagementAccountId` matches.
- R4.2 For a selected month the system SHALL present, per bill-source account: the relationship status (is the billing currently active?), the invoice(s) generated, and the amount(s).
- R4.3 The system SHALL flag anomalies: an active relationship with no invoice for the month, or an invoice whose bill-source account has no matching/active relationship.

### R6 — Auto-attribution & Account Directory (eliminate the PDF step)
- R6.1 The system SHALL maintain an **Account Directory** mapping every AWS account ID to a role (`distributor_pma` | `partner_pma` | `end_customer`), a partner name, an end-customer name, and a friendly label.
- R6.2 The system SHALL seed directory entries automatically from the responsibility-transfer chain and from each transfer's `Name` (which Redington sets to the downstream seller/partner name at invitation time).
- R6.3 WHEN displaying any invoice, the system SHALL resolve `AccountId` and each `BillSourceAccounts[]` entry against the directory and render partner + end-customer labels WITHOUT requiring the operator to open the invoice PDF.
- R6.4 WHEN an invoice references an account ID absent from the directory, the system SHALL flag it as "needs mapping" and let an operator add the mapping once (reused for all future invoices).
- R6.5 The system SHALL support search/filter of invoices and relationships by partner name and by end-customer name (not just account ID).
- R6.6 The system SHALL auto-populate customer-org and linked-account directory entries from CUR line-item account IDs on the "My view" Billing View (these levels are not visible via the Org API in a two-level chain).

### R8 — CUR provisioning & ingestion
- R8.1 WHEN an indirect relationship first becomes active on a distributor PMA, the system SHALL ensure that PMA has a **My-view CUR 2.0 export** (create if missing) via `bcm-data-exports:CreateExport` — one CUR per PMA per view, NOT one per relationship.
- R8.2 The system SHALL ensure the S3 destination and bucket policy (grant `bcm-data-exports.amazonaws.com` `s3:PutObject` with SourceArn/SourceAccount conditions) and the `AWSServiceRoleForBCMDataExports` service-linked role, waiting for SLR propagation before creating the export.
- R8.3 The system SHALL scope the export to the "Billing Transfer – My view" Billing View and include resource/account columns needed for attribution and margin.
- R8.4 The system SHALL ingest delivered CUR Parquet (Athena/Glue) and join `usage_account_id` to the Account Directory.
- R8.5 The system SHALL monitor CUR export health (`GetExport`), surface unhealthy states, and offer a recreate action (e.g. after a "Bill owner changed" error).
- R8.6 (Phase 3) The system MAY provision Showback/chargeback CURs per Billing Conductor billing group for partner-facing chargeback.

### R7 — Cost truth & distributor margin
- R7.1 The system SHALL compute margin authoritatively from **CUR line items** (My view), aggregating by usage account × charge type, and SHALL fall back to `ce:GetCostAndUsage` for months where CUR has not yet delivered.
- R7.2 The system SHALL compute **gross customer cost** = unblended cost for usage charge types, EXCLUDING tax, credits, and refunds.
- R7.3 The system SHALL surface the **distribution discount amount** as a separate line (by charge type).
- R7.4 The system SHALL compute and display the **discount % Redington receives from AWS** per relationship/customer = |discount| ÷ gross usage cost, and SHALL roll it up the hierarchy (linked account → customer org → partner → country).
- R7.5 The system SHALL NOT hardcode discount/tax charge-type labels; it SHALL enumerate present types (`ce:GetDimensionValues RECORD_TYPE` / CUR `line_item_line_item_type`) and apply a configurable exclusion list.
- R7.6 The system SHALL present, per relationship per month: gross customer cost, net cost (what AWS bills Redington), discount amount, and discount %.

### R5 — Operations / non-functional
- R5.1 All AWS API calls SHALL use short-lived credentials where possible; long-lived keys are last resort and encrypted.
- R5.2 The system SHALL log every cross-account call (account, action, operator, timestamp) for audit, excluding secret material.
- R5.3 Invoicing + GetInvoicePDF calls SHALL target us-east-1.
- R5.4 The system SHALL cache relationship + invoice reads with a short TTL to reduce API pressure, with a manual refresh.
- R5.5 Access to the app SHALL be restricted to authenticated Billing Ops users (SSO).

## Out of scope (v1)
- Creating/accepting/withdrawing transfers (read-only first; mutation is a later phase needing `InviteOrganizationToTransferResponsibility` etc.).
- Billing Conductor billing-group / rate configuration and partner-facing chargeback CURs (Phase 3).
- My-view CUR provisioning + ingestion IS in scope (Phase 1, R8).
