import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as rds from "aws-cdk-lib/aws-rds";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

interface AppStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  database: rds.IDatabaseCluster;
  kmsKey: kms.IKey;
  curBucket: s3.IBucket;
}

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    // Cognito User Pool
    const userPool = new cognito.UserPool(this, "BillopsUserPool", {
      userPoolName: "billops-users",
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
        fullname: { required: true, mutable: true },
      },
      mfa: cognito.Mfa.OPTIONAL,
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
    });

    // SAML/OIDC federation placeholder
    // Uncomment and configure when Redington SSO is ready:
    // new cognito.UserPoolIdentityProviderSaml(this, "RedingtonSAML", { ... });

    const userPoolClient = userPool.addClient("BillopsWebClient", {
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: ["http://localhost:3000/api/auth/callback"],
        logoutUrls: ["http://localhost:3000/"],
      },
    });

    const domain = userPool.addDomain("BillopsDomain", {
      cognitoDomain: { domainPrefix: `billops-${this.account}` },
    });

    // Hub IAM role — the app uses this to AssumeRole into PMA roles
    const hubRole = new iam.Role(this, "BillopsHubRole", {
      roleName: "BillopsHubRole",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "Billops hub role for assuming cross-account PMA roles",
    });

    hubRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AssumeDistributorPmaRoles",
        actions: ["sts:AssumeRole"],
        resources: ["arn:aws:iam::*:role/BillopsReadOnlyRole", "arn:aws:iam::*:role/BillopsProvisioningRole"],
      }),
    );

    // ECS Fargate service behind ALB
    const cluster = new ecs.Cluster(this, "BillopsCluster", {
      vpc: props.vpc,
      containerInsights: true,
    });

    const fargateService = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      "BillopsService",
      {
        cluster,
        cpu: 512,
        memoryLimitMiB: 1024,
        desiredCount: 2,
        taskImageOptions: {
          image: ecs.ContainerImage.fromAsset(".."), // builds from repo root Dockerfile
          containerPort: 3000,
          environment: {
            NODE_ENV: "production",
            COGNITO_USER_POOL_ID: userPool.userPoolId,
            COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
            COGNITO_DOMAIN: `billops-${this.account}.auth.us-east-1.amazoncognito.com`,
            CUR_S3_BUCKET: props.curBucket.bucketName,
            ATHENA_WORKGROUP: "billops",
            ATHENA_DATABASE: "billops_cur",
          },
          taskRole: hubRole,
        },
        publicLoadBalancer: true,
      },
    );

    // Grant DB access
    const dbSg = (props.database as rds.DatabaseCluster).connections.securityGroups[0];
    fargateService.service.connections.allowTo(dbSg, ec2.Port.tcp(5432), "App → Aurora");

    // Grant KMS
    props.kmsKey.grantDecrypt(hubRole);

    // Grant S3 read for CUR
    props.curBucket.grantRead(hubRole);

    // Outputs
    new cdk.CfnOutput(this, "AppUrl", {
      value: `http://${fargateService.loadBalancer.loadBalancerDnsName}`,
    });
    new cdk.CfnOutput(this, "HubRoleArn", { value: hubRole.roleArn });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "CognitoDomain", { value: domain.domainName });
  }
}
