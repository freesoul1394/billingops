/**
 * CloudFormation template generator for PMA onboarding.
 * Generates the two cross-account roles (read-only + provisioning).
 */

interface CfnTemplateParams {
  hubAccountId: string;
  externalIdReadOnly: string;
  externalIdProvisioning: string;
  readOnlyRoleName?: string;
  provisioningRoleName?: string;
}

/**
 * Generate the read-only role CFN template.
 */
export function generateReadOnlyRoleTemplate(params: CfnTemplateParams): object {
  const { hubAccountId, externalIdReadOnly, readOnlyRoleName = "BillopsReadOnlyRole" } = params;

  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: "Billops read-only cross-account role for billing transfer visibility",
    Resources: {
      BillopsReadOnlyRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: readOnlyRoleName,
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { AWS: `arn:aws:iam::${hubAccountId}:root` },
                Action: "sts:AssumeRole",
                Condition: {
                  StringEquals: { "sts:ExternalId": externalIdReadOnly },
                },
              },
            ],
          },
          Policies: [
            {
              PolicyName: "BillingTransferReadOnly",
              PolicyDocument: {
                Version: "2012-10-17",
                Statement: [
                  {
                    Sid: "BillingTransferReadOnly",
                    Effect: "Allow",
                    Action: [
                      "organizations:DescribeResponsibilityTransfer",
                      "organizations:ListInboundResponsibilityTransfers",
                      "organizations:ListOutboundResponsibilityTransfers",
                      "organizations:ListHandshakesForOrganization",
                      "invoicing:ListInvoiceSummaries",
                      "invoicing:GetInvoicePDF",
                      "ce:GetCostAndUsage",
                      "ce:GetDimensionValues",
                    ],
                    Resource: "*",
                  },
                ],
              },
            },
          ],
        },
      },
    },
    Outputs: {
      RoleArn: {
        Value: { "Fn::GetAtt": ["BillopsReadOnlyRole", "Arn"] },
        Description: "ARN of the Billops read-only role",
      },
    },
  };
}

/**
 * Generate the provisioning role CFN template.
 */
export function generateProvisioningRoleTemplate(params: CfnTemplateParams): object {
  const {
    hubAccountId,
    externalIdProvisioning,
    provisioningRoleName = "BillopsProvisioningRole",
  } = params;

  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: "Billops provisioning cross-account role for CUR setup",
    Resources: {
      BillopsProvisioningRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: provisioningRoleName,
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { AWS: `arn:aws:iam::${hubAccountId}:root` },
                Action: "sts:AssumeRole",
                Condition: {
                  StringEquals: { "sts:ExternalId": externalIdProvisioning },
                },
              },
            ],
          },
          Policies: [
            {
              PolicyName: "CurProvisioning",
              PolicyDocument: {
                Version: "2012-10-17",
                Statement: [
                  {
                    Sid: "CurProvisioning",
                    Effect: "Allow",
                    Action: [
                      "bcm-data-exports:CreateExport",
                      "bcm-data-exports:GetExport",
                      "bcm-data-exports:ListExports",
                      "bcm-data-exports:UpdateExport",
                      "cur:PutReportDefinition",
                      "cur:DescribeReportDefinitions",
                      "billing:ListBillingViews",
                      "billing:GetBillingView",
                      "iam:CreateServiceLinkedRole",
                    ],
                    Resource: "*",
                  },
                ],
              },
            },
          ],
        },
      },
    },
    Outputs: {
      RoleArn: {
        Value: { "Fn::GetAtt": ["BillopsProvisioningRole", "Arn"] },
        Description: "ARN of the Billops provisioning role",
      },
    },
  };
}
