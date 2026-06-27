#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { NetworkStack } from "../lib/network-stack";
import { DataStack } from "../lib/data-stack";
import { AppStack } from "../lib/app-stack";
import { JobsStack } from "../lib/jobs-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: "us-east-1",
};

const network = new NetworkStack(app, "BillopsNetwork", { env });
const data = new DataStack(app, "BillopsData", { env, vpc: network.vpc });
const appStack = new AppStack(app, "BillopsApp", {
  env,
  vpc: network.vpc,
  database: data.database,
  kmsKey: data.kmsKey,
  curBucket: data.curBucket,
});
new JobsStack(app, "BillopsJobs", {
  env,
  vpc: network.vpc,
  database: data.database,
  curBucket: data.curBucket,
  athenaWorkgroup: data.athenaWorkgroup,
});

app.synth();
