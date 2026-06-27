# Structure — Billops

Monorepo. Suggested layout (Kiro may refine, keep the separation of concerns):

```
billops/
├─ app/                         # Next.js App Router (UI + sync API routes)
│  ├─ (dashboard)/              # authed pages
│  │  ├─ accounts/              # onboarded distributor PMAs (by country)
│  │  ├─ relationships/         # inbound transfers (partner PMAs)
│  │  ├─ invoices/              # monthly invoice lookup, auto-labeled
│  │  ├─ reconciliation/        # the join: country→partner→customer→cost→discount%
│  │  ├─ directory/             # account directory management
│  │  └─ cur/                   # CUR export status
│  └─ api/                      # route handlers (thin; call services)
├─ src/
│  ├─ services/                 # business logic, one module per capability
│  │  ├─ onboarding.ts
│  │  ├─ relationships.ts
│  │  ├─ invoices.ts
│  │  ├─ attribution.ts         # directory resolution + join
│  │  ├─ margin.ts              # CUR-first, Cost Explorer fallback
│  │  ├─ cur-provisioning.ts
│  │  ├─ ingestion.ts           # Glue/Athena over CUR
│  │  └─ chargeback.ts          # Phase 3: Billing Conductor
│  ├─ aws/                      # STS assume-role clients + SDK wrappers + backoff
│  ├─ db/                       # Prisma client + repositories
│  └─ lib/                      # shared utils, charge-type classifier, types
├─ prisma/
│  └─ schema.prisma             # tables from design.md §3
├─ lambdas/                     # async jobs
│  ├─ sync-relationships/
│  ├─ sync-invoices/
│  ├─ provision-cur/
│  ├─ ingest-cur/               # S3 event → Glue/Athena → rollups
│  └─ compute-margin/
├─ infra/                       # AWS CDK v2 (TypeScript)
│  ├─ bin/ app.ts
│  └─ lib/ *-stack.ts           # network, data, app, jobs stacks
├─ onboarding-templates/        # CloudFormation the PMA admin deploys (the 2 roles + S3)
└─ .kiro/                       # specs + steering (this folder)
```

## Rules
- Route handlers and pages stay thin; all AWS/DB logic lives in `src/services` and `src/aws`.
- One service module per capability; cross-account calls only through `src/aws` (so backoff/audit are centralized).
- DB access only through `src/db` repositories.
- IaC only in `infra/`. The cross-account roles deployed in customer PMAs live in `onboarding-templates/` (separate from hub infra).
