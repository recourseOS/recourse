/**
 * Verification Categories
 *
 * BitNet classifies resources into these categories.
 * Each category maps to a set of verification templates.
 */

export type VerificationCategory =
  | 'database-with-snapshots'      // RDS, Aurora, Neptune, DocumentDB, Redshift
  | 'nosql-database'               // DynamoDB, Keyspaces
  | 'block-storage'                // EBS volumes
  | 'file-storage'                 // EFS, FSx
  | 'object-storage'               // S3, Glacier
  | 'cache-cluster'                // ElastiCache, MemoryDB
  | 'search-cluster'               // OpenSearch, CloudSearch
  | 'streaming-data'               // Kinesis, MSK
  | 'message-queue'                // SQS, SNS (stateful aspects)
  | 'container-registry'           // ECR
  | 'secrets-and-keys'             // Secrets Manager, KMS, ACM
  | 'stateful-compute'             // EC2 with data, EMR clusters
  | 'no-verification-needed';      // IAM, networking, config-only

/**
 * Category metadata for display and documentation
 */
export interface CategoryMetadata {
  category: VerificationCategory;
  description: string;
  riskLevel: 'high' | 'medium' | 'low';
  examples: string[];
}

export const CATEGORY_METADATA: Record<VerificationCategory, CategoryMetadata> = {
  'database-with-snapshots': {
    category: 'database-with-snapshots',
    description: 'Relational and document databases with snapshot capabilities',
    riskLevel: 'high',
    examples: ['aws_db_instance', 'aws_rds_cluster', 'aws_neptune_cluster', 'aws_docdb_cluster', 'aws_redshift_cluster'],
  },
  'nosql-database': {
    category: 'nosql-database',
    description: 'NoSQL databases with point-in-time recovery',
    riskLevel: 'high',
    examples: ['aws_dynamodb_table', 'aws_keyspaces_table'],
  },
  'block-storage': {
    category: 'block-storage',
    description: 'Block storage volumes with snapshot capabilities',
    riskLevel: 'high',
    examples: ['aws_ebs_volume', 'aws_ebs_snapshot'],
  },
  'file-storage': {
    category: 'file-storage',
    description: 'File systems with backup capabilities',
    riskLevel: 'high',
    examples: ['aws_efs_file_system', 'aws_fsx_lustre_file_system', 'aws_fsx_windows_file_system'],
  },
  'object-storage': {
    category: 'object-storage',
    description: 'Object storage with versioning and replication',
    riskLevel: 'high',
    examples: ['aws_s3_bucket', 'aws_s3_object', 'aws_glacier_vault'],
  },
  'cache-cluster': {
    category: 'cache-cluster',
    description: 'In-memory caches with snapshot capabilities',
    riskLevel: 'medium',
    examples: ['aws_elasticache_cluster', 'aws_elasticache_replication_group', 'aws_memorydb_cluster'],
  },
  'search-cluster': {
    category: 'search-cluster',
    description: 'Search engines with snapshot capabilities',
    riskLevel: 'medium',
    examples: ['aws_opensearch_domain', 'aws_elasticsearch_domain', 'aws_cloudsearch_domain'],
  },
  'streaming-data': {
    category: 'streaming-data',
    description: 'Streaming data services',
    riskLevel: 'medium',
    examples: ['aws_kinesis_stream', 'aws_msk_cluster', 'aws_kinesis_firehose_delivery_stream'],
  },
  'message-queue': {
    category: 'message-queue',
    description: 'Message queues with potential in-flight data',
    riskLevel: 'medium',
    examples: ['aws_sqs_queue', 'aws_sns_topic', 'aws_mq_broker'],
  },
  'container-registry': {
    category: 'container-registry',
    description: 'Container image registries',
    riskLevel: 'medium',
    examples: ['aws_ecr_repository'],
  },
  'secrets-and-keys': {
    category: 'secrets-and-keys',
    description: 'Secrets, keys, and certificates',
    riskLevel: 'high',
    examples: ['aws_secretsmanager_secret', 'aws_kms_key', 'aws_acm_certificate'],
  },
  'stateful-compute': {
    category: 'stateful-compute',
    description: 'Compute resources with attached state',
    riskLevel: 'medium',
    examples: ['aws_instance', 'aws_emr_cluster', 'aws_batch_compute_environment'],
  },
  'no-verification-needed': {
    category: 'no-verification-needed',
    description: 'Resources that can be recreated without backup verification',
    riskLevel: 'low',
    examples: ['aws_iam_role', 'aws_security_group', 'aws_vpc', 'aws_subnet', 'aws_route_table'],
  },
};

/**
 * Resource identifier extraction patterns per category
 */
export interface IdentifierPattern {
  // Terraform attribute names to try for the resource identifier
  identifierAttributes: string[];
  // Terraform attribute names to try for the ARN
  arnAttributes: string[];
  // How to construct ARN if not present (service, resource type pattern)
  arnPattern?: {
    service: string;
    resourceType: string;
    // e.g., "db" for RDS, "volume" for EBS
  };
}

export const IDENTIFIER_PATTERNS: Record<VerificationCategory, IdentifierPattern> = {
  'database-with-snapshots': {
    identifierAttributes: ['identifier', 'cluster_identifier', 'db_instance_identifier', 'db_cluster_identifier'],
    arnAttributes: ['arn', 'db_instance_arn', 'db_cluster_arn'],
    arnPattern: { service: 'rds', resourceType: 'db' },
  },
  'nosql-database': {
    identifierAttributes: ['name', 'table_name'],
    arnAttributes: ['arn'],
    arnPattern: { service: 'dynamodb', resourceType: 'table' },
  },
  'block-storage': {
    identifierAttributes: ['id', 'volume_id'],
    arnAttributes: ['arn'],
    arnPattern: { service: 'ec2', resourceType: 'volume' },
  },
  'file-storage': {
    identifierAttributes: ['id', 'file_system_id'],
    arnAttributes: ['arn'],
    arnPattern: { service: 'elasticfilesystem', resourceType: 'file-system' },
  },
  'object-storage': {
    identifierAttributes: ['bucket', 'id'],
    arnAttributes: ['arn'],
    arnPattern: { service: 's3', resourceType: '' },
  },
  'cache-cluster': {
    identifierAttributes: ['cluster_id', 'replication_group_id', 'id'],
    arnAttributes: ['arn'],
    arnPattern: { service: 'elasticache', resourceType: 'cluster' },
  },
  'search-cluster': {
    identifierAttributes: ['domain_name', 'name'],
    arnAttributes: ['arn'],
    arnPattern: { service: 'es', resourceType: 'domain' },
  },
  'streaming-data': {
    identifierAttributes: ['name', 'stream_name', 'cluster_name'],
    arnAttributes: ['arn'],
    arnPattern: { service: 'kinesis', resourceType: 'stream' },
  },
  'message-queue': {
    identifierAttributes: ['name', 'id'],
    arnAttributes: ['arn'],
    arnPattern: { service: 'sqs', resourceType: '' },
  },
  'container-registry': {
    identifierAttributes: ['name', 'repository_name'],
    arnAttributes: ['arn'],
    arnPattern: { service: 'ecr', resourceType: 'repository' },
  },
  'secrets-and-keys': {
    identifierAttributes: ['name', 'id', 'key_id'],
    arnAttributes: ['arn'],
    arnPattern: { service: 'secretsmanager', resourceType: 'secret' },
  },
  'stateful-compute': {
    identifierAttributes: ['id', 'instance_id'],
    arnAttributes: ['arn'],
    arnPattern: { service: 'ec2', resourceType: 'instance' },
  },
  'no-verification-needed': {
    identifierAttributes: ['id', 'name'],
    arnAttributes: ['arn'],
  },
};
