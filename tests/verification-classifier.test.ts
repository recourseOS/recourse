import { describe, it, expect } from 'vitest';
import { classifyResourceType, DecisionTreeClassifier } from '../src/verification/classifier.js';
import type { VerificationCategory } from '../src/verification/categories.js';

describe('Verification Classifier', () => {
  const classifier = new DecisionTreeClassifier();

  describe('Exact mappings', () => {
    const exactMappings: [string, VerificationCategory][] = [
      // Database with snapshots
      ['aws_db_instance', 'database-with-snapshots'],
      ['aws_rds_cluster', 'database-with-snapshots'],
      ['aws_neptune_cluster', 'database-with-snapshots'],
      ['aws_docdb_cluster', 'database-with-snapshots'],
      ['aws_redshift_cluster', 'database-with-snapshots'],

      // NoSQL
      ['aws_dynamodb_table', 'nosql-database'],
      ['aws_keyspaces_table', 'nosql-database'],

      // Block storage
      ['aws_ebs_volume', 'block-storage'],
      ['aws_ebs_snapshot', 'block-storage'],

      // File storage
      ['aws_efs_file_system', 'file-storage'],
      ['aws_fsx_lustre_file_system', 'file-storage'],

      // Object storage
      ['aws_s3_bucket', 'object-storage'],
      ['aws_glacier_vault', 'object-storage'],

      // Cache
      ['aws_elasticache_cluster', 'cache-cluster'],
      ['aws_memorydb_cluster', 'cache-cluster'],

      // Search
      ['aws_opensearch_domain', 'search-cluster'],

      // Streaming
      ['aws_kinesis_stream', 'streaming-data'],
      ['aws_msk_cluster', 'streaming-data'],

      // Message queue
      ['aws_sqs_queue', 'message-queue'],
      ['aws_mq_broker', 'message-queue'],

      // Container registry
      ['aws_ecr_repository', 'container-registry'],

      // Secrets
      ['aws_secretsmanager_secret', 'secrets-and-keys'],
      ['aws_kms_key', 'secrets-and-keys'],

      // Stateful compute
      ['aws_instance', 'stateful-compute'],
      ['aws_emr_cluster', 'stateful-compute'],

      // No verification needed
      ['aws_iam_role', 'no-verification-needed'],
      ['aws_vpc', 'no-verification-needed'],
      ['aws_security_group', 'no-verification-needed'],
      ['aws_lambda_function', 'no-verification-needed'],
    ];

    for (const [resourceType, expectedCategory] of exactMappings) {
      it(`classifies ${resourceType} as ${expectedCategory} with exact match`, () => {
        const result = classifier.classify(resourceType);
        expect(result.category).toBe(expectedCategory);
        expect(result.source).toBe('exact-match');
        expect(result.confidence).toBe(1.0);
      });
    }
  });

  describe('Pattern matching - POSITIVE cases', () => {
    // These resources SHOULD match their respective patterns
    const positivePatterns: [string, VerificationCategory, number][] = [
      // Database patterns - use resources NOT in exact mappings
      ['aws_rds_proxy', 'database-with-snapshots', 0.9],
      ['aws_rds_cluster_parameter_group', 'database-with-snapshots', 0.9],

      // Storage patterns - use resources NOT in exact mappings
      ['aws_ebs_volume_attachment', 'block-storage', 0.7],
      ['aws_fsx_ontap_volume', 'file-storage', 0.95],
      ['aws_s3_bucket_policy', 'object-storage', 0.95],

      // Cache patterns
      ['aws_elasticache_subnet_group', 'cache-cluster', 0.95],

      // Streaming patterns
      ['aws_kinesis_analytics_application', 'streaming-data', 0.95],

      // IAM patterns (no verification)
      ['aws_iam_policy_attachment', 'no-verification-needed', 0.7],
      ['aws_iam_user_group_membership', 'no-verification-needed', 0.7],
    ];

    for (const [resourceType, expectedCategory, minConfidence] of positivePatterns) {
      it(`pattern-matches ${resourceType} as ${expectedCategory}`, () => {
        const result = classifier.classify(resourceType);
        expect(result.category).toBe(expectedCategory);
        expect(result.source).toBe('pattern-match');
        expect(result.confidence).toBeGreaterThanOrEqual(minConfidence);
      });
    }
  });

  describe('Pattern matching - NEGATIVE cases (must NOT match wrong categories)', () => {
    // These are the critical regression tests
    // Resources that might match database patterns but SHOULD NOT
    const negativePatterns: [string, VerificationCategory][] = [
      // EKS cluster is NOT a database
      ['aws_eks_cluster', 'database-with-snapshots'],
      ['aws_eks_node_group', 'database-with-snapshots'],

      // ECS cluster is NOT a database
      ['aws_ecs_cluster', 'database-with-snapshots'],
      ['aws_ecs_service', 'database-with-snapshots'],

      // MSK is streaming, NOT database (verify exact mapping works)
      ['aws_msk_cluster', 'database-with-snapshots'],

      // ElastiCache is cache, NOT database
      ['aws_elasticache_cluster', 'database-with-snapshots'],
      ['aws_elasticache_replication_group', 'database-with-snapshots'],

      // CloudWatch is NOT storage
      ['aws_cloudwatch_log_group', 'block-storage'],
      ['aws_cloudwatch_log_group', 'object-storage'],

      // Lambda is NOT stateful compute
      ['aws_lambda_function', 'stateful-compute'],
      ['aws_lambda_layer_version', 'stateful-compute'],

      // API Gateway is NOT a database
      ['aws_api_gateway_rest_api', 'database-with-snapshots'],

      // Load balancers are NOT databases
      ['aws_lb', 'database-with-snapshots'],
      ['aws_alb', 'database-with-snapshots'],
      ['aws_lb_target_group', 'database-with-snapshots'],

      // VPC resources are NOT databases
      ['aws_vpc', 'database-with-snapshots'],
      ['aws_subnet', 'database-with-snapshots'],

      // Route53 is NOT a database
      ['aws_route53_zone', 'database-with-snapshots'],
      ['aws_route53_record', 'database-with-snapshots'],
    ];

    for (const [resourceType, wrongCategory] of negativePatterns) {
      it(`${resourceType} must NOT be classified as ${wrongCategory}`, () => {
        const result = classifier.classify(resourceType);
        expect(result.category).not.toBe(wrongCategory);
      });
    }
  });

  describe('Pattern specificity - more specific patterns win', () => {
    it('aws_msk_cluster matches streaming-data exactly, not database pattern', () => {
      const result = classifier.classify('aws_msk_cluster');
      expect(result.category).toBe('streaming-data');
      expect(result.source).toBe('exact-match');
    });

    it('aws_elasticache_cluster matches cache-cluster exactly, not database pattern', () => {
      const result = classifier.classify('aws_elasticache_cluster');
      expect(result.category).toBe('cache-cluster');
      expect(result.source).toBe('exact-match');
    });

    it('aws_emr_cluster matches stateful-compute exactly, not database pattern', () => {
      const result = classifier.classify('aws_emr_cluster');
      expect(result.category).toBe('stateful-compute');
      expect(result.source).toBe('exact-match');
    });
  });

  describe('Confidence thresholds', () => {
    it('exact matches have confidence 1.0', () => {
      const result = classifier.classify('aws_db_instance');
      expect(result.confidence).toBe(1.0);
    });

    it('strong pattern matches have confidence >= 0.9', () => {
      const result = classifier.classify('aws_rds_global_cluster');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('weak pattern matches have confidence < 0.7', () => {
      // Generic cluster pattern
      const result = classifier.classify('aws_some_unknown_cluster');
      expect(result.confidence).toBeLessThan(0.7);
    });

    it('unknown resources have low confidence', () => {
      const result = classifier.classify('aws_completely_unknown_thing');
      expect(result.confidence).toBeLessThanOrEqual(0.5);
    });
  });

  describe('classifyResourceType function', () => {
    it('works with default classifier', () => {
      const result = classifyResourceType('aws_s3_bucket');
      expect(result.category).toBe('object-storage');
    });

    it('accepts custom classifier', () => {
      const customClassifier = new DecisionTreeClassifier();
      const result = classifyResourceType('aws_s3_bucket', {}, customClassifier);
      expect(result.category).toBe('object-storage');
    });
  });
});
