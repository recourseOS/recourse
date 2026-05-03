export {
  AwsSignedClient,
  type AwsCredentials,
  type AwsHttpResponse,
  type AwsRequestInput,
  type AwsTransport,
} from './client.js';

export {
  loadAwsCredentials,
} from './credentials.js';

export {
  analyzeS3BucketDeletionEvidence,
  assessS3BucketDeletionState,
  readS3BucketEvidence,
  toTrackedEvidence as toS3TrackedEvidence,
  type S3BucketEvidence,
  type S3EvidenceAnalysis,
} from './s3.js';

export {
  analyzeRdsInstanceDeletionEvidence,
  readRdsInstanceEvidence,
  type RdsEvidenceAnalysis,
  type RdsInstanceEvidence,
} from './rds.js';

export {
  analyzeDynamoDbTableDeletionEvidence,
  readDynamoDbTableEvidence,
  type DynamoDbEvidenceAnalysis,
  type DynamoDbTableEvidence,
} from './dynamodb.js';

export {
  analyzeIamRoleDeletionEvidence,
  readIamRoleEvidence,
  type IamEvidenceAnalysis,
  type IamRoleEvidence,
} from './iam.js';

export {
  analyzeKmsKeyDeletionEvidence,
  readKmsKeyEvidence,
  type KmsEvidenceAnalysis,
  type KmsKeyEvidence,
} from './kms.js';
