# Billops — Redington AWS Billing Transfer Ops

Internal web app for the Redington AWS Billing Operations team. Surfaces billing-transfer relationships, invoices, cost/margin attribution, and CUR provisioning across distributor PMAs.

## Architecture

- **Frontend:** Next.js 14 (App Router) + React + Tailwind CSS
- **Backend:** Next.js API routes → service layer → AWS SDK v3 (cross-account AssumeRole)
- **Database:** Aurora PostgreSQL Serverless v2 (Prisma ORM)
- **Infra:** AWS CDK v2 (TypeScript) — ECS Fargate + ALB, S3 + Glue + Athena, Cognito, KMS
- **Async jobs:** Lambda + EventBridge schedules (sync relationships, invoices, margin)
- **Region:** us-east-1 (all billing APIs are us-east-1)

## Quick Start (Local Dev)

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Set up local database (requires PostgreSQL)
cp .env.example .env
# Edit .env with your local DB connection string
npx prisma migrate dev --name init

# Run dev server
npm run dev
```

Set `NEXT_PUBLIC_AUTH_DISABLED=true` in `.env` to bypass Cognito in local dev.

## Build & Deploy from EC2

See the **EC2 Deployment Guide** section below.

## Project Structure

```
billops/
├─ app/                       # Next.js App Router (UI + API routes)
│  ├─ (dashboard)/            # Authed pages (accounts, relationships, etc.)
│  └─ api/                    # Route handlers
├─ src/
│  ├─ services/               # Business logic (one module per capability)
│  ├─ aws/                    # STS assume-role, clients, backoff, paginator, audit
│  ├─ db/                     # Prisma client singleton
│  └─ lib/                    # Shared utils, types, cache
├─ prisma/schema.prisma       # Database schema
├─ lambdas/                   # Async jobs (EventBridge + S3 triggers)
├─ infra/                     # AWS CDK v2 stacks
├─ onboarding-templates/      # CloudFormation for PMA cross-account roles
└─ Dockerfile                 # Production container (standalone Next.js)
```

## Tests

```bash
npm test           # Run all tests (Vitest)
npm run test:watch # Watch mode
```

---

## EC2 Deployment Guide

### Prerequisites

1. An EC2 instance (Amazon Linux 2023 or Ubuntu 22.04, t3.medium or larger)
2. IAM instance profile with permissions for CDK deployment (CloudFormation, ECS, RDS, S3, KMS, Cognito, Lambda, etc.)
3. The EC2 must be in **us-east-1**

### Step 1: Provision and connect to your EC2

```bash
# From your local machine (or AWS Console)
aws ec2 run-instances \
  --image-id ami-0c02fb55956c7d316 \
  --instance-type t3.medium \
  --key-name <your-key-pair> \
  --iam-instance-profile Name=<your-deploy-profile> \
  --region us-east-1 \
  --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":30}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=billops-deploy}]'

# SSH in
ssh -i <your-key.pem> ec2-user@<instance-public-ip>
```

### Step 2: Install dependencies on the EC2

```bash
# Node.js 20 (Amazon Linux 2023)
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs git docker

# Start Docker (needed for CDK asset bundling + Fargate image build)
sudo systemctl start docker
sudo usermod -aG docker ec2-user
newgrp docker

# Verify
node --version   # v20.x
npm --version    # 10.x
docker --version # 24.x+

# AWS CLI v2 (usually pre-installed on AL2023)
aws --version
aws sts get-caller-identity  # verify IAM role
```

### Step 3: Clone and build

```bash
git clone https://github.com/<your-org>/billops.git
cd billops

# Install app dependencies
npm install

# Generate Prisma client
npx prisma generate

# Build the Next.js app
npm run build

# Install CDK dependencies
cd infra
npm install
cd ..
```

### Step 4: Bootstrap CDK (one-time per account/region)

```bash
cd infra
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/us-east-1
```

### Step 5: Deploy all stacks

```bash
cd infra
npx cdk synth     # Review the CloudFormation templates
npx cdk deploy --all --require-approval never
```

This deploys 4 stacks:
1. **BillopsNetwork** — VPC, subnets, NAT
2. **BillopsData** — Aurora PostgreSQL, KMS, S3 (CUR), Athena workgroup
3. **BillopsApp** — Cognito, ECS Fargate + ALB, hub IAM role
4. **BillopsJobs** — Lambda functions + EventBridge schedules

### Step 6: Run database migration

After deployment, get the database endpoint from stack outputs:

```bash
# Get the DB secret ARN from outputs
DB_SECRET_ARN=$(aws cloudformation describe-stacks \
  --stack-name BillopsData \
  --query 'Stacks[0].Outputs[?OutputKey==`DatabaseSecretArn`].OutputValue' \
  --output text)

# Retrieve credentials
DB_CREDS=$(aws secretsmanager get-secret-value --secret-id $DB_SECRET_ARN --query SecretString --output text)
DB_HOST=$(echo $DB_CREDS | jq -r .host)
DB_PORT=$(echo $DB_CREDS | jq -r .port)
DB_USER=$(echo $DB_CREDS | jq -r .username)
DB_PASS=$(echo $DB_CREDS | jq -r .password)

# Set DATABASE_URL and run migration
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/billops?schema=public"
npx prisma migrate deploy
```

### Step 7: Verify deployment

```bash
# Get app URL
APP_URL=$(aws cloudformation describe-stacks \
  --stack-name BillopsApp \
  --query 'Stacks[0].Outputs[?OutputKey==`AppUrl`].OutputValue' \
  --output text)

echo "App available at: $APP_URL"
curl -s $APP_URL | head -20
```

### Step 8: Onboard your first PMA

1. Open the app URL in your browser
2. Log in via Cognito (configure your SSO identity provider in the Cognito console)
3. Go to **Accounts → Onboard**
4. Enter the PMA account ID + country
5. Deploy the generated CloudFormation templates in the PMA account
6. Click **Validate** to confirm connectivity
7. When a relationship becomes active, trigger **CUR provisioning**

### Updating the deployment

```bash
cd billops
git pull
npm install
npm run build
cd infra
npm install
npx cdk deploy --all --require-approval never
```

### Tearing down

```bash
cd infra
npx cdk destroy --all
```

---

## Stack Outputs Reference

| Stack | Output | Purpose |
|-------|--------|---------|
| BillopsData | DatabaseEndpoint | Aurora cluster endpoint |
| BillopsData | DatabaseSecretArn | Secrets Manager secret for DB creds |
| BillopsData | CurBucketName | S3 bucket for CUR delivery |
| BillopsApp | AppUrl | Load balancer DNS (HTTP) |
| BillopsApp | HubRoleArn | IAM role for cross-account AssumeRole |
| BillopsApp | UserPoolId | Cognito user pool ID |
| BillopsApp | CognitoDomain | Cognito hosted UI domain |
