import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as athena from "aws-cdk-lib/aws-athena";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

interface DataStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class DataStack extends cdk.Stack {
  public readonly database: rds.IDatabaseCluster;
  public readonly kmsKey: kms.IKey;
  public readonly curBucket: s3.IBucket;
  public readonly athenaWorkgroup: athena.CfnWorkGroup;
  public readonly dbSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    // KMS key for encrypting access-key fallback secrets
    this.kmsKey = new kms.Key(this, "BillopsKmsKey", {
      alias: "billops/secrets",
      enableKeyRotation: true,
      description: "Billops encryption key for access-key fallback secrets",
    });

    // Aurora PostgreSQL Serverless v2
    const dbCluster = new rds.DatabaseCluster(this, "BillopsDb", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_4,
      }),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 4,
      writer: rds.ClusterInstance.serverlessV2("writer"),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      defaultDatabaseName: "billops",
      storageEncrypted: true,
      storageEncryptionKey: this.kmsKey,
    });
    this.database = dbCluster;
    this.dbSecret = dbCluster.secret!;

    // S3 bucket for CUR delivery
    this.curBucket = new s3.Bucket(this, "CurBucket", {
      bucketName: `billops-cur-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        { expiration: cdk.Duration.days(365), id: "expire-old-cur" },
      ],
      eventBridgeEnabled: true, // for Lambda trigger
    });

    // Bucket policy for BCM Data Exports
    this.curBucket.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
        sid: "AllowBcmDataExports",
        principals: [new cdk.aws_iam.ServicePrincipal("bcm-data-exports.amazonaws.com")],
        actions: ["s3:PutObject"],
        resources: [`${this.curBucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            "aws:SourceAccount": this.account,
          },
        },
      }),
    );

    // Athena workgroup
    this.athenaWorkgroup = new athena.CfnWorkGroup(this, "BillopsAthena", {
      name: "billops",
      state: "ENABLED",
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${this.curBucket.bucketName}/athena-results/`,
        },
        enforceWorkGroupConfiguration: true,
        engineVersion: { selectedEngineVersion: "Athena engine version 3" },
      },
    });

    // Outputs
    new cdk.CfnOutput(this, "DatabaseEndpoint", {
      value: dbCluster.clusterEndpoint.hostname,
    });
    new cdk.CfnOutput(this, "DatabaseSecretArn", {
      value: dbCluster.secret?.secretArn ?? "N/A",
    });
    new cdk.CfnOutput(this, "CurBucketName", {
      value: this.curBucket.bucketName,
    });
  }
}
