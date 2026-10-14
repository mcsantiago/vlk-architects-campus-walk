import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as cdk from 'aws-cdk-lib';
import {
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_ec2 as ec2,
  aws_ecr_assets as ecrAssets,
  aws_ecs as ecs,
  aws_ecs_patterns as patterns,
  aws_elasticloadbalancingv2 as elbv2,
  aws_iam as iam,
  aws_logs as logs,
  aws_rds as rds,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface CampusWalkStackProps extends cdk.StackProps {
  /** Shared access code checked at the edge; walkers enter it once per device. */
  accessCode: string;
  /** Bedrock model id or inference profile for the photo suggestion. */
  bedrockModel: string;
  /** Repo root: the API image is built from apps/api/Dockerfile with this context. */
  repoRoot: string;
  /** Built web app (apps/web/dist). */
  webDist: string;
}

/**
 * Everything for one environment in one stack, sized for a demo:
 *
 *   browser ──► CloudFront ──► S3 (web, private, OAC)
 *                  │  /api/*
 *                  └────────► ALB ──► Fargate (api) ──► RDS Postgres (isolated subnets)
 *                                        │                 S3 photos (presigned URLs)
 *                                        └───────────────► Bedrock (task role)
 *
 * No NAT gateway: the task runs in a public subnet with a public IP and reaches S3, Bedrock,
 * ECR and Secrets Manager over the internet (S3 via the free gateway endpoint). The ALB only
 * accepts requests carrying a header CloudFront adds, so the API is reachable through the
 * access-code gate alone. Everything is destroyable: `cdk destroy` leaves nothing behind.
 */
export class CampusWalkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CampusWalkStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    vpc.addGatewayEndpoint('S3Endpoint', { service: ec2.GatewayVpcEndpointAwsService.S3 });

    // ---- data ------------------------------------------------------------------------------
    const db = new rds.DatabaseInstance(this, 'Db', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      databaseName: 'campus_walk',
      credentials: rds.Credentials.fromGeneratedSecret('campus'),
      allocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: false,
      backupRetention: cdk.Duration.days(1),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const dbSecret = db.secret!;

    const photos = new s3.Bucket(this, 'Photos', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Presigned URLs are the authorisation; the browser PUTs and GETs them directly.
      cors: [
        {
          allowedOrigins: ['*'],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.HEAD],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ---- api -------------------------------------------------------------------------------
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });
    const api = new patterns.ApplicationLoadBalancedFargateService(this, 'Api', {
      cluster,
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: 1,
      // One task: a deploy starts the new one before stopping the old (0..200%).
      minHealthyPercent: 0,
      maxHealthyPercent: 200,
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      publicLoadBalancer: true,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
      circuitBreaker: { rollback: true },
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset(props.repoRoot, {
          file: 'apps/api/Dockerfile',
          platform: ecrAssets.Platform.LINUX_ARM64,
        }),
        containerPort: 3000,
        environment: {
          PORT: '3000',
          DB_HOST: db.dbInstanceEndpointAddress,
          DB_PORT: db.dbInstanceEndpointPort,
          DB_NAME: 'campus_walk',
          DATABASE_SSL: 'require',
          SEED_ON_EMPTY: '1',
          S3_BUCKET: photos.bucketName,
          AWS_REGION: this.region,
          BEDROCK_MODEL: props.bedrockModel,
        },
        secrets: {
          DB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
        },
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logRetention: logs.RetentionDays.ONE_WEEK }),
      },
    });
    api.targetGroup.configureHealthCheck({ path: '/health', interval: cdk.Duration.seconds(15), healthyThresholdCount: 2 });
    db.connections.allowDefaultPortFrom(api.service, 'api tasks');
    photos.grantReadWrite(api.taskDefinition.taskRole);
    api.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['arn:aws:bedrock:*::foundation-model/*', `arn:aws:bedrock:*:${this.account}:inference-profile/*`],
      }),
    );

    // Only CloudFront may use the ALB: it adds a header the listener requires. The value is
    // derived from the access code so it is stable across deploys and never stored in the repo.
    const originSecret = createHash('sha256').update(`origin:${props.accessCode}:${this.stackName}`).digest('hex').slice(0, 32);
    (api.listener.node.defaultChild as elbv2.CfnListener).defaultActions = [
      { type: 'fixed-response', fixedResponseConfig: { statusCode: '403', contentType: 'text/plain', messageBody: 'use the CloudFront URL' } },
    ];
    api.listener.addTargetGroups('FromCloudFront', {
      priority: 1,
      conditions: [elbv2.ListenerCondition.httpHeader('x-origin-verify', [originSecret])],
      targetGroups: [api.targetGroup],
    });

    // ---- web + edge ------------------------------------------------------------------------
    const web = new s3.Bucket(this, 'Web', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const gateSource = readFileSync(new URL('./edge-gate.js', import.meta.url), 'utf8').replace('__ACCESS_CODE__', props.accessCode);
    const gate = new cloudfront.Function(this, 'Gate', {
      code: cloudfront.FunctionCode.fromInline(gateSource),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'access code, /api prefix, SPA shell',
    });
    const gated = [{ function: gate, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }];

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'Campus Walk',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(web),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: gated,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.LoadBalancerV2Origin(api.loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            customHeaders: { 'x-origin-verify': originSecret },
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: gated,
        },
      },
    });

    // Hashed assets are immutable; index.html must be re-checked on every load.
    new s3deploy.BucketDeployment(this, 'WebAssets', {
      sources: [s3deploy.Source.asset(props.webDist)],
      destinationBucket: web,
      exclude: ['index.html'],
      prune: false,
      cacheControl: [s3deploy.CacheControl.maxAge(cdk.Duration.days(365)), s3deploy.CacheControl.immutable()],
    });
    new s3deploy.BucketDeployment(this, 'WebShell', {
      sources: [s3deploy.Source.asset(props.webDist)],
      destinationBucket: web,
      exclude: ['*'],
      include: ['index.html'],
      prune: false,
      cacheControl: [s3deploy.CacheControl.noCache()],
      distribution,
      distributionPaths: ['/index.html'],
    });

    new cdk.CfnOutput(this, 'Url', { value: `https://${distribution.distributionDomainName}`, description: 'Open this; enter the access code once per device' });
    new cdk.CfnOutput(this, 'ApiLoadBalancer', { value: api.loadBalancer.loadBalancerDnsName, description: 'Direct requests get 403; go through CloudFront' });
    new cdk.CfnOutput(this, 'PhotosBucket', { value: photos.bucketName });
    new cdk.CfnOutput(this, 'DbSecret', { value: dbSecret.secretName, description: 'Postgres credentials (Secrets Manager)' });
  }
}
