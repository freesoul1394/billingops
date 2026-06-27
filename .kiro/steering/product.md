# Product — Billops (Redington AWS Billing Transfer Ops)

Internal web app for the **Redington AWS Billing Operations** team. Redington is an
**AWS Distributor** operating one or more **Program Management Accounts (PMAs)** per
country, acting as **Bill-Transfer accounts** under AWS Partner Central Channel Management.

## Who uses it
Redington Billing Ops analysts. Authenticated via SSO. Not customer-facing.

## Problems it solves
1. **Attribution without PDFs.** Today Ops opens each invoice PDF to map account IDs →
   partner → end customer. The app resolves this structurally from APIs + a maintained
   directory, so nobody opens a PDF to attribute an invoice.
2. **Cost truth & margin.** AWS invoices Redington at distributor-discounted rates. The
   app surfaces the customer's gross cost, Redington's net cost, and the **AWS discount %**
   per relationship, rolled up the hierarchy.
3. **CUR provisioning.** When an indirect relationship becomes active, the app provisions
   the My-view CUR the deeper attribution and margin depend on.

## Account hierarchy (4 levels per country)
Country → Distributor PMA (onboarded) → Partner PMA (Redington's direct transfer) →
Customer Org mgmt account → Linked/member accounts.

Org API on a distributor PMA only reveals the **partner PMA** level. Customer-org and
linked-account levels come from the **My-view CUR** — it is the backbone of attribution.

## Non-negotiables
- Least-privilege, short-lived credentials (STS AssumeRole). No standing power over
  customer accounts. Access keys only as an encrypted fallback.
- Billing APIs (Invoicing, Cost Explorer, BCM Data Exports) run in **us-east-1**.
- Never hardcode charge-type labels; enumerate them.
- Treat the two-level CUR breakdown and Billing-Conductor dependency as validate-first.
