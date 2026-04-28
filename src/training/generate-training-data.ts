/**
 * Training data generator for recoverability classifier
 *
 * Extracts decision patterns from our hardcoded handlers
 * and generates labeled training examples.
 */

type Tier = 'reversible' | 'recoverable-with-effort' | 'recoverable-from-backup' | 'unrecoverable';
type Action = 'delete' | 'update' | 'create' | 'replace';

interface TrainingExample {
  resource_type: string;
  action: Action;
  attributes: Record<string, unknown>;
  tier: Tier;
  reasoning: string;
}

const examples: TrainingExample[] = [];

// Helper to add examples
function add(
  resource_type: string,
  action: Action,
  attributes: Record<string, unknown>,
  tier: Tier,
  reasoning: string
) {
  examples.push({ resource_type, action, attributes, tier, reasoning });
}

// =============================================================================
// S3 BUCKET
// =============================================================================
// Updates are reversible
add('aws_s3_bucket', 'update', {}, 'reversible', 'Bucket configuration update can be reverted');

// Delete empty bucket
add('aws_s3_bucket', 'delete', { object_count: 0 }, 'recoverable-with-effort', 'Empty bucket can be recreated');

// Delete non-empty bucket - unrecoverable regardless of versioning
add('aws_s3_bucket', 'delete', { object_count: 100 }, 'unrecoverable', 'Bucket deletion is permanent; all objects lost');
add('aws_s3_bucket', 'delete', { object_count: 1 }, 'unrecoverable', 'Bucket deletion is permanent; all objects lost');
add('aws_s3_bucket', 'delete', { object_count: null }, 'unrecoverable', 'Bucket deletion is permanent; object count unknown');

// =============================================================================
// S3 OBJECT
// =============================================================================
add('aws_s3_object', 'update', {}, 'reversible', 'Object update can be reverted');

// Delete with versioning
add('aws_s3_object', 'delete', { bucket_versioning: true }, 'recoverable-from-backup', 'Versioned bucket preserves previous versions');
add('aws_s3_object', 'delete', { bucket_versioning: 'Enabled' }, 'recoverable-from-backup', 'Versioned bucket preserves previous versions');

// Delete without versioning
add('aws_s3_object', 'delete', { bucket_versioning: false }, 'unrecoverable', 'No versioning; object deletion is permanent');
add('aws_s3_object', 'delete', { bucket_versioning: null }, 'unrecoverable', 'No versioning; object deletion is permanent');
add('aws_s3_object', 'delete', { bucket_versioning: 'Disabled' }, 'unrecoverable', 'No versioning; object deletion is permanent');

// =============================================================================
// RDS INSTANCE
// =============================================================================
add('aws_db_instance', 'update', {}, 'reversible', 'RDS configuration update can be reverted');

// Delete with protection
add('aws_db_instance', 'delete', { deletion_protection: true }, 'reversible', 'Deletion protection enabled; delete will be blocked');

// Delete without protection, with snapshot
add('aws_db_instance', 'delete', {
  deletion_protection: false,
  skip_final_snapshot: false
}, 'recoverable-from-backup', 'Final snapshot will be created');

add('aws_db_instance', 'delete', {
  deletion_protection: false,
  skip_final_snapshot: false,
  backup_retention_period: 7
}, 'recoverable-from-backup', 'Automated backups exist');

// Delete without protection, skipping snapshot, but has backups
add('aws_db_instance', 'delete', {
  deletion_protection: false,
  skip_final_snapshot: true,
  backup_retention_period: 7
}, 'recoverable-from-backup', 'Automated backups exist even though final snapshot skipped');

// Delete without protection, skipping snapshot, no backups
add('aws_db_instance', 'delete', {
  deletion_protection: false,
  skip_final_snapshot: true,
  backup_retention_period: 0
}, 'unrecoverable', 'No final snapshot and no automated backups');

add('aws_db_instance', 'delete', {
  deletion_protection: false,
  skip_final_snapshot: true,
  backup_retention_period: null
}, 'unrecoverable', 'No final snapshot and backup retention unknown');

// =============================================================================
// RDS CLUSTER
// =============================================================================
add('aws_rds_cluster', 'update', {}, 'reversible', 'RDS cluster configuration update can be reverted');

add('aws_rds_cluster', 'delete', { deletion_protection: true }, 'reversible', 'Deletion protection enabled');

add('aws_rds_cluster', 'delete', {
  deletion_protection: false,
  skip_final_snapshot: false
}, 'recoverable-from-backup', 'Final snapshot will be created');

add('aws_rds_cluster', 'delete', {
  deletion_protection: false,
  skip_final_snapshot: true,
  backup_retention_period: 0
}, 'unrecoverable', 'No final snapshot and no automated backups');

// =============================================================================
// DYNAMODB TABLE
// =============================================================================
add('aws_dynamodb_table', 'update', {}, 'reversible', 'DynamoDB table update can be reverted');

add('aws_dynamodb_table', 'delete', { deletion_protection_enabled: true }, 'reversible', 'Deletion protection enabled');

add('aws_dynamodb_table', 'delete', {
  deletion_protection_enabled: false,
  point_in_time_recovery: { enabled: true }
}, 'recoverable-from-backup', 'PITR enabled');

add('aws_dynamodb_table', 'delete', {
  deletion_protection_enabled: false,
  point_in_time_recovery: { enabled: false }
}, 'unrecoverable', 'No deletion protection and no PITR');

add('aws_dynamodb_table', 'delete', {
  deletion_protection_enabled: false,
  point_in_time_recovery: null
}, 'unrecoverable', 'No deletion protection and PITR status unknown');

// =============================================================================
// KMS KEY
// =============================================================================
add('aws_kms_key', 'update', {}, 'reversible', 'KMS key configuration update can be reverted');

// KMS keys have deletion window
add('aws_kms_key', 'delete', { deletion_window_in_days: 30 }, 'recoverable-with-effort', '30-day deletion window; can be cancelled');
add('aws_kms_key', 'delete', { deletion_window_in_days: 7 }, 'recoverable-with-effort', '7-day deletion window; can be cancelled');
add('aws_kms_key', 'delete', { deletion_window_in_days: null }, 'recoverable-with-effort', 'Default deletion window applies');

// =============================================================================
// CLOUDWATCH LOG GROUP
// =============================================================================
add('aws_cloudwatch_log_group', 'update', {}, 'reversible', 'Log group configuration update can be reverted');

// Log groups are always unrecoverable - logs are gone
add('aws_cloudwatch_log_group', 'delete', {}, 'unrecoverable', 'Log data is permanently deleted');
add('aws_cloudwatch_log_group', 'delete', { retention_in_days: 30 }, 'unrecoverable', 'Log data is permanently deleted');
add('aws_cloudwatch_log_group', 'delete', { retention_in_days: null }, 'unrecoverable', 'Log data is permanently deleted');

// =============================================================================
// EC2 INSTANCE
// =============================================================================
add('aws_instance', 'update', {}, 'reversible', 'Instance configuration update can be reverted');

// EC2 instances can be recreated from AMI
add('aws_instance', 'delete', { ami: 'ami-12345' }, 'recoverable-with-effort', 'Can recreate from AMI');
add('aws_instance', 'delete', { ami: null }, 'recoverable-with-effort', 'Instance can be recreated');

// With attached EBS that deletes on termination
add('aws_instance', 'delete', {
  ami: 'ami-12345',
  root_block_device: [{ delete_on_termination: true }]
}, 'recoverable-with-effort', 'Instance can be recreated from AMI; root volume will be deleted');

// =============================================================================
// EBS VOLUME
// =============================================================================
add('aws_ebs_volume', 'update', {}, 'reversible', 'EBS volume configuration update can be reverted');

add('aws_ebs_volume', 'delete', { snapshot_id: 'snap-12345' }, 'recoverable-from-backup', 'Volume was created from snapshot');
add('aws_ebs_volume', 'delete', { snapshot_id: null }, 'unrecoverable', 'No snapshot; data is permanently lost');
add('aws_ebs_volume', 'delete', {}, 'unrecoverable', 'No snapshot; data is permanently lost');

// =============================================================================
// EBS SNAPSHOT
// =============================================================================
add('aws_ebs_snapshot', 'update', {}, 'reversible', 'Snapshot metadata update can be reverted');
add('aws_ebs_snapshot', 'delete', {}, 'unrecoverable', 'Snapshot deletion is permanent');

// =============================================================================
// IAM ROLE
// =============================================================================
add('aws_iam_role', 'update', {}, 'reversible', 'IAM role update can be reverted');
add('aws_iam_role', 'delete', {}, 'recoverable-with-effort', 'Role can be recreated from configuration');
add('aws_iam_role', 'create', {}, 'reversible', 'Role creation can be undone');

// =============================================================================
// IAM POLICY
// =============================================================================
add('aws_iam_policy', 'update', {}, 'reversible', 'IAM policy update can be reverted');
add('aws_iam_policy', 'delete', {}, 'recoverable-with-effort', 'Policy can be recreated from configuration');

// =============================================================================
// IAM USER
// =============================================================================
add('aws_iam_user', 'update', {}, 'reversible', 'IAM user update can be reverted');
add('aws_iam_user', 'delete', {}, 'recoverable-with-effort', 'User can be recreated; access keys will be different');

// =============================================================================
// LAMBDA FUNCTION
// =============================================================================
add('aws_lambda_function', 'update', {}, 'reversible', 'Lambda configuration update can be reverted');

add('aws_lambda_function', 'delete', { s3_bucket: 'my-bucket', s3_key: 'code.zip' }, 'recoverable-with-effort', 'Code stored in S3; can redeploy');
add('aws_lambda_function', 'delete', { image_uri: 'ecr-uri' }, 'recoverable-with-effort', 'Code in container registry; can redeploy');
add('aws_lambda_function', 'delete', { filename: 'local.zip' }, 'recoverable-with-effort', 'Assuming local code is in version control');
add('aws_lambda_function', 'delete', {}, 'recoverable-with-effort', 'Function can be redeployed from source');

// =============================================================================
// VPC
// =============================================================================
add('aws_vpc', 'update', {}, 'reversible', 'VPC configuration update can be reverted');
add('aws_vpc', 'delete', {}, 'recoverable-with-effort', 'VPC can be recreated; dependent resources affected');
add('aws_vpc', 'create', {}, 'reversible', 'VPC creation can be undone');

// =============================================================================
// SUBNET
// =============================================================================
add('aws_subnet', 'update', {}, 'reversible', 'Subnet configuration update can be reverted');
add('aws_subnet', 'delete', {}, 'recoverable-with-effort', 'Subnet can be recreated');

// =============================================================================
// SECURITY GROUP
// =============================================================================
add('aws_security_group', 'update', {}, 'reversible', 'Security group update can be reverted');
add('aws_security_group', 'delete', {}, 'recoverable-with-effort', 'Security group can be recreated; attachments need reconfiguration');

// =============================================================================
// LOAD BALANCER
// =============================================================================
add('aws_lb', 'update', {}, 'reversible', 'Load balancer configuration update can be reverted');
add('aws_lb', 'delete', {}, 'recoverable-with-effort', 'Load balancer can be recreated; DNS name will change');
add('aws_alb', 'update', {}, 'reversible', 'ALB configuration update can be reverted');
add('aws_alb', 'delete', {}, 'recoverable-with-effort', 'ALB can be recreated; DNS name will change');

// =============================================================================
// ROUTE53
// =============================================================================
add('aws_route53_zone', 'update', {}, 'reversible', 'Hosted zone update can be reverted');
add('aws_route53_zone', 'delete', {}, 'unrecoverable', 'Zone deletion removes all records; NS delegation lost');

add('aws_route53_record', 'update', {}, 'reversible', 'DNS record update can be reverted');
add('aws_route53_record', 'delete', {}, 'recoverable-with-effort', 'DNS record can be recreated');

// =============================================================================
// SNS
// =============================================================================
add('aws_sns_topic', 'update', {}, 'reversible', 'SNS topic update can be reverted');
add('aws_sns_topic', 'delete', {}, 'recoverable-with-effort', 'Topic can be recreated; subscriptions lost');

add('aws_sns_topic_subscription', 'update', {}, 'reversible', 'Subscription update can be reverted');
add('aws_sns_topic_subscription', 'delete', {}, 'recoverable-with-effort', 'Subscription can be recreated');

// =============================================================================
// SQS
// =============================================================================
add('aws_sqs_queue', 'update', {}, 'reversible', 'SQS queue update can be reverted');
add('aws_sqs_queue', 'delete', { message_count: 0 }, 'recoverable-with-effort', 'Empty queue can be recreated');
add('aws_sqs_queue', 'delete', { message_count: 100 }, 'unrecoverable', 'Messages in queue will be lost');
add('aws_sqs_queue', 'delete', { message_count: null }, 'recoverable-with-effort', 'Queue can be recreated; any messages will be lost');

// =============================================================================
// ELASTIC IP
// =============================================================================
add('aws_eip', 'update', {}, 'reversible', 'EIP configuration update can be reverted');
add('aws_eip', 'delete', {}, 'unrecoverable', 'IP address is released permanently');

// =============================================================================
// NAT GATEWAY
// =============================================================================
add('aws_nat_gateway', 'update', {}, 'reversible', 'NAT gateway update can be reverted');
add('aws_nat_gateway', 'delete', {}, 'recoverable-with-effort', 'NAT gateway can be recreated');

// =============================================================================
// INTERNET GATEWAY
// =============================================================================
add('aws_internet_gateway', 'update', {}, 'reversible', 'Internet gateway update can be reverted');
add('aws_internet_gateway', 'delete', {}, 'recoverable-with-effort', 'Internet gateway can be recreated');

// =============================================================================
// Generate output
// =============================================================================

console.log(JSON.stringify(examples, null, 2));

// Also output stats
console.error(`\nGenerated ${examples.length} training examples`);

const byTier = examples.reduce((acc, ex) => {
  acc[ex.tier] = (acc[ex.tier] || 0) + 1;
  return acc;
}, {} as Record<string, number>);

console.error('By tier:', byTier);

const byResourceType = examples.reduce((acc, ex) => {
  acc[ex.resource_type] = (acc[ex.resource_type] || 0) + 1;
  return acc;
}, {} as Record<string, number>);

console.error('By resource type:', byResourceType);
