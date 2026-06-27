import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as rds from "aws-cdk-lib/aws-rds";
import * as athena from "aws-cdk-lib/aws-athena";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as path from "path";

interface JobsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  database: rds.IDatabaseCluster;
  curBucket: s3.IBucket;
  athenaWorkgroup: athena.CfnWorkGroup;
}

export class JobsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: JobsStackProps) {
    super(scope, id, props);

    const lambdaEnv = {
      DATABASE_URL: "from-secrets", // resolved at runtime from Secrets Manager
      ATHENA_WORKGROUP: "billops",
      ATHENA_DATABASE: "billops_cur",
      ATHENA_OUTPUT_BUCKET: props.curBucket.bucketName,
      CUR_S3_BUCKET: props.curBucket.bucketName,
    };

    // ─── CUR Ingestion Lambda (S3 event trigger) ────────────────────────────

    const ingestCurFn = new lambdaNodejs.NodejsFunction(this, "IngestCurFn", {
      entry: path.join(__dirname, "../../lambdas/ingest-cur/index.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: lambdaEnv,
    });

    // S3 event notification for CUR delivery
    props.curBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(ingestCurFn),
      { prefix: "cur/", suffix: ".parquet" },
    );

    // Athena + Glue permissions
    ingestCurFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "athena:StartQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "glue:GetTable",
          "glue:GetDatabase",
          "glue:GetPartitions",
        ],
        resources: ["*"],
      }),
    );
    props.curBucket.grantReadWrite(ingestCurFn);

    // ─── Sync Relationships (scheduled) ─────────────────────────────────────

    const syncRelFn = new lambdaNodejs.NodejsFunction(this, "SyncRelationshipsFn", {
      entry: path.join(__dirname, "../../lambdas/sync-relationships/index.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: lambdaEnv,
    });

    // Run every 6 hours
    new events.Rule(this, "SyncRelSchedule", {
      schedule: events.Schedule.rate(cdk.Duration.hours(6)),
      targets: [new targets.LambdaFunction(syncRelFn)],
    });

    syncRelFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: ["arn:aws:iam::*:role/BillopsReadOnlyRole"],
      }),
    );

    // ─── Sync Invoices (scheduled) ──────────────────────────────────────────

    const syncInvFn = new lambdaNodejs.NodejsFunction(this, "SyncInvoicesFn", {
      entry: path.join(__dirname, "../../lambdas/sync-invoices/index.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: lambdaEnv,
    });

    // Run daily at 06:00 UTC
    new events.Rule(this, "SyncInvSchedule", {
      schedule: events.Schedule.cron({ hour: "6", minute: "0" }),
      targets: [new targets.LambdaFunction(syncInvFn)],
    });

    syncInvFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: ["arn:aws:iam::*:role/BillopsReadOnlyRole"],
      }),
    );

    // ─── Compute Margin (scheduled) ─────────────────────────────────────────

    const computeMarginFn = new lambdaNodejs.NodejsFunction(this, "ComputeMarginFn", {
      entry: path.join(__dirname, "../../lambdas/compute-margin/index.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(10),
      memorySize: 512,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: lambdaEnv,
    });

    // Run daily at 08:00 UTC (after invoices sync)
    new events.Rule(this, "ComputeMarginSchedule", {
      schedule: events.Schedule.cron({ hour: "8", minute: "0" }),
      targets: [new targets.LambdaFunction(computeMarginFn)],
    });

    computeMarginFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: ["arn:aws:iam::*:role/BillopsReadOnlyRole"],
      }),
    );
    props.curBucket.grantRead(computeMarginFn);

    // DB access for all lambdas
    const dbSg = (props.database as rds.DatabaseCluster).connections.securityGroups[0];
    ingestCurFn.connections.allowTo(dbSg, ec2.Port.tcp(5432));
    syncRelFn.connections.allowTo(dbSg, ec2.Port.tcp(5432));
    syncInvFn.connections.allowTo(dbSg, ec2.Port.tcp(5432));
    computeMarginFn.connections.allowTo(dbSg, ec2.Port.tcp(5432));
  }
}
