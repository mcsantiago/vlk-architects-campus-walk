import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { CampusWalkStack } from '../lib/campus-walk-stack.ts';

const app = new cdk.App();
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const webDist = fileURLToPath(new URL('../../apps/web/dist', import.meta.url));

// The shared access code is the only secret the stack takes; it is never written to the repo.
const accessCode: string | undefined = app.node.tryGetContext('accessCode') ?? process.env.CAMPUS_WALK_ACCESS_CODE;
if (!accessCode) throw new Error('set the access code: cdk deploy -c accessCode=<code>, or CAMPUS_WALK_ACCESS_CODE in the environment');
if (!existsSync(webDist)) throw new Error('apps/web/dist is missing: run `npm run build:web` first (or `npm run deploy` from the root)');

new CampusWalkStack(app, 'CampusWalk', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  description: 'Campus Walk: CloudFront + S3 web, Fargate API behind an ALB, RDS Postgres, S3 photos, Bedrock',
  accessCode,
  bedrockModel: app.node.tryGetContext('bedrockModel') as string,
  repoRoot,
  webDist,
});
cdk.Tags.of(app).add('project', 'campus-walk');
