# Billops — Kiro setup, prompting & deployment

## 1. Put these files in your Kiro project

Copy the `.kiro/` folder from this bundle into the root of your **Billops** project
(the folder open in Kiro's Explorer). Final layout:

```
Billops/
└─ .kiro/
   ├─ steering/
   │  ├─ product.md
   │  ├─ tech.md
   │  └─ structure.md
   └─ specs/
      └─ billing-transfer-ops/
         ├─ requirements.md
         ├─ design.md
         └─ tasks.md
```

Steering files load automatically. The spec appears in Kiro's spec panel.

## 2. Prompt Kiro to start coding

Use **Spec** mode (the card you already have selected). Then:

**Prompt A — orient Kiro to the existing spec:**
> Use the existing spec at `.kiro/specs/billing-transfer-ops`. Read requirements.md,
> design.md, and tasks.md, plus the steering files. Don't regenerate them — confirm you
> understand the plan and list the tasks you'll execute.

**Prompt B — start building, task by task:**
> Begin executing tasks.md starting at Task 1. Do one task at a time, show me the diff,
> and wait for my approval before the next. Follow tech.md and structure.md.

Then approve each task as Kiro completes it. With **Autopilot on** (your toggle), Kiro
will chain edits within a task automatically; you still gate task-to-task.

**Useful follow-up prompts:**
- "Run the tests for the current task and fix failures before moving on."
- "Stop after Task 16 — that's the deployable MVP boundary."
- "Open Task 11 and walk me through the CUR provisioning flow before writing it."

> If Kiro offers to (re)generate requirements/design from scratch, decline — point it at
> the files already in the spec folder.

## 3. Deploy to your AWS account

Phase-1 deployment is the CDK app Kiro builds in **Task 17**. Once that task is done:

### Prerequisites (on your machine / CI)
- Node.js 20+, Docker running (Fargate image build), AWS CLI v2.
- Credentials for your **hub** AWS account (the account the app runs in — NOT a customer PMA).
- Work in **us-east-1**.

```bash
# from the repo root
npm install
npx prisma generate

# one-time per account/region
npx cdk bootstrap aws://<HUB_ACCOUNT_ID>/us-east-1

# review then deploy
npx cdk synth
npx cdk deploy --all
```

Note the stack **outputs**: the app URL, the **hub role ARN**, and the **ExternalId pattern** —
you'll need the role ARN + ExternalId when onboarding each PMA.

### Onboard your first distributor PMA
1. In the app's **Onboard** screen, enter the PMA account ID + country. It generates two
   CloudFormation templates (read-only role, provisioning role) in `onboarding-templates/`.
2. A PMA admin deploys those templates **in that distributor PMA** (they create the cross-account
   roles trusting your hub account with the ExternalId).
3. Back in the app, click **Validate** — it assumes the read-only role and lists transfers.
4. When a relationship is active, trigger **CUR provisioning** (Task 11). First CUR delivery
   can take up to ~24h; the UI shows "CUR pending" and uses Cost Explorer meanwhile.

### Smoke test
- Accounts shows the PMA as healthy (both roles).
- Relationships lists the partner PMAs.
- Invoices returns summaries for a month ≥ 2025-06, auto-labeled with partner/customer.
- Reconciliation shows gross/net/discount % once CUR (or Cost Explorer) data is in.

## 4. Validate-first items (don't skip)
- **Two-level CUR breakdown** (Task 20 spike): confirm the My-view CUR resolves to end-customer
  linked accounts, or whether you need Billing Conductor billing groups. Everything in Phase 3
  depends on this.
- **Distribution discount label:** confirm which `line_item_line_item_type` carries the
  distributor/SPP discount in your real CUR, and add it to the exclusion list.
- **Billing-view binding:** confirm how the export binds to the "My view" Billing View ARN on
  your first real `CreateExport`.

## Region reminder
Invoicing, Cost Explorer, BCM Data Exports, and Billing Conductor are us-east-1. Keep the whole
deployment there to avoid cross-region billing-API surprises.
