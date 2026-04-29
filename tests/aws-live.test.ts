import { describe, expect, it } from 'vitest';
import {
  AwsSignedClient,
  loadAwsCredentials,
  readDynamoDbTableEvidence,
  readIamRoleEvidence,
  readKmsKeyEvidence,
  readRdsInstanceEvidence,
  readS3BucketEvidence,
} from '../src/state/aws/index.js';

const runLive = process.env.RUN_AWS_LIVE_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

describeLive('live AWS account checks', () => {
  it('can call STS GetCallerIdentity with configured AWS credentials', async () => {
    const identity = await getCallerIdentity(new AwsSignedClient(loadAwsCredentials()));

    expect(identity.account).toMatch(/^\d{12}$/);
    expect(identity.arn.length).toBeGreaterThan(0);
    expect(identity.userId.length).toBeGreaterThan(0);
  }, 20_000);

  it('can collect S3 bucket evidence when AWS_LIVE_S3_BUCKET is set', async () => {
    const bucket = process.env.AWS_LIVE_S3_BUCKET;
    if (!bucket) return;

    const evidence = await readS3BucketEvidence(
      new AwsSignedClient(loadAwsCredentials()),
      bucket,
      process.env.AWS_REGION || 'us-east-1'
    );

    expect(evidence.bucket).toBe(bucket);
    expect(evidence.versioning).toMatch(/Enabled|Suspended|Off|Unknown/);
  }, 20_000);

  it('can collect RDS instance evidence when AWS_LIVE_RDS_INSTANCE is set', async () => {
    const dbInstanceIdentifier = process.env.AWS_LIVE_RDS_INSTANCE;
    if (!dbInstanceIdentifier) return;

    const evidence = await readRdsInstanceEvidence(
      new AwsSignedClient(loadAwsCredentials()),
      dbInstanceIdentifier,
      process.env.AWS_REGION || 'us-east-1'
    );

    expect(evidence.dbInstanceIdentifier).toBe(dbInstanceIdentifier);
    expect(evidence.exists).toBe(true);
  }, 20_000);

  it('can collect DynamoDB table evidence when AWS_LIVE_DYNAMODB_TABLE is set', async () => {
    const tableName = process.env.AWS_LIVE_DYNAMODB_TABLE;
    if (!tableName) return;

    const evidence = await readDynamoDbTableEvidence(
      new AwsSignedClient(loadAwsCredentials()),
      tableName,
      process.env.AWS_REGION || 'us-east-1'
    );

    expect(evidence.tableName).toBe(tableName);
    expect(evidence.exists).toBe(true);
  }, 20_000);

  it('can collect IAM role evidence when AWS_LIVE_IAM_ROLE is set', async () => {
    const roleName = process.env.AWS_LIVE_IAM_ROLE;
    if (!roleName) return;

    const evidence = await readIamRoleEvidence(
      new AwsSignedClient(loadAwsCredentials()),
      roleName
    );

    expect(evidence.roleName).toBe(roleName);
    expect(evidence.exists).toBe(true);
  }, 20_000);

  it('can collect KMS key evidence when AWS_LIVE_KMS_KEY_ID is set', async () => {
    const keyId = process.env.AWS_LIVE_KMS_KEY_ID;
    if (!keyId) return;

    const evidence = await readKmsKeyEvidence(
      new AwsSignedClient(loadAwsCredentials()),
      keyId,
      process.env.AWS_REGION || 'us-east-1'
    );

    expect(evidence.keyId).toBe(keyId);
    expect(evidence.exists).toBe(true);
  }, 20_000);
});

async function getCallerIdentity(client: AwsSignedClient): Promise<{
  account: string;
  arn: string;
  userId: string;
}> {
  const region = 'us-east-1';
  const host = 'sts.amazonaws.com';
  const body = 'Action=GetCallerIdentity&Version=2011-06-15';

  const response = await client.request({
    method: 'POST',
    service: 'sts',
    region,
    host,
    path: '/',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    },
    body,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`STS GetCallerIdentity failed with ${response.statusCode}: ${response.body}`);
  }

  return {
    account: requiredXmlValue(response.body, 'Account'),
    arn: requiredXmlValue(response.body, 'Arn'),
    userId: requiredXmlValue(response.body, 'UserId'),
  };
}

function requiredXmlValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  if (!match) throw new Error(`STS response missing ${tag}`);
  return match[1];
}
