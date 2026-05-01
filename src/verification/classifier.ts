/**
 * Verification Category Classifier
 *
 * Classifies resource types into verification categories.
 * Uses pattern matching as fallback; designed for BitNet integration.
 */

import type { VerificationCategory } from './categories.js';

export interface ClassificationResult {
  category: VerificationCategory;
  confidence: number;  // 0-1, 1.0 for exact matches
  source: 'exact-match' | 'pattern-match' | 'bitnet';
}

export interface VerificationClassifier {
  classify(resourceType: string, attributes?: Record<string, unknown>): ClassificationResult;
}

/**
 * Exact resource type to category mappings
 * These are high-confidence, manually verified
 */
const EXACT_MAPPINGS: Record<string, VerificationCategory> = {
  // Database with snapshots - AWS
  'aws_db_instance': 'database-with-snapshots',
  'aws_rds_cluster': 'database-with-snapshots',
  'aws_rds_cluster_instance': 'database-with-snapshots',
  'aws_neptune_cluster': 'database-with-snapshots',
  'aws_neptune_cluster_instance': 'database-with-snapshots',
  'aws_docdb_cluster': 'database-with-snapshots',
  'aws_docdb_cluster_instance': 'database-with-snapshots',
  'aws_redshift_cluster': 'database-with-snapshots',
  'aws_rds_global_cluster': 'database-with-snapshots',
  'aws_aurora_cluster': 'database-with-snapshots',

  // Database with snapshots - Azure (model weakness: over-demotes these)
  'azurerm_mssql_managed_instance': 'database-with-snapshots',
  'azurerm_mssql_database': 'database-with-snapshots',
  'azurerm_postgresql_database': 'database-with-snapshots',
  'azurerm_postgresql_server': 'database-with-snapshots',
  'azurerm_postgresql_flexible_server': 'database-with-snapshots',
  'azurerm_mysql_server': 'database-with-snapshots',
  'azurerm_mysql_flexible_server': 'database-with-snapshots',
  'azurerm_mariadb_server': 'database-with-snapshots',

  // NoSQL databases - AWS
  'aws_dynamodb_table': 'nosql-database',
  'aws_dynamodb_global_table': 'nosql-database',
  'aws_keyspaces_table': 'nosql-database',
  'aws_keyspaces_keyspace': 'nosql-database',
  'aws_timestream_database': 'nosql-database',
  'aws_timestream_table': 'nosql-database',

  // NoSQL databases - GCP (model weakness: "document" not recognized as data)
  'google_firestore_document': 'nosql-database',
  'google_firestore_database': 'nosql-database',
  'google_datastore_index': 'nosql-database',

  // NoSQL databases - Azure (model weakness: "container" over-demoted)
  'azurerm_cosmosdb_account': 'nosql-database',
  'azurerm_cosmosdb_sql_database': 'nosql-database',
  'azurerm_cosmosdb_sql_container': 'nosql-database',
  'azurerm_cosmosdb_mongo_database': 'nosql-database',
  'azurerm_cosmosdb_mongo_collection': 'nosql-database',
  'azurerm_cosmosdb_gremlin_database': 'nosql-database',
  'azurerm_cosmosdb_gremlin_graph': 'nosql-database',
  'azurerm_cosmosdb_cassandra_keyspace': 'nosql-database',
  'azurerm_cosmosdb_table': 'nosql-database',

  // Block storage - AWS
  'aws_ebs_volume': 'block-storage',
  'aws_ebs_snapshot': 'block-storage',
  'aws_ebs_snapshot_copy': 'block-storage',
  'aws_ami': 'block-storage',  // AMIs contain disk images
  'aws_ami_copy': 'block-storage',
  'aws_ami_from_instance': 'block-storage',

  // Block storage - GCP (model weakness: "attached" over-demoted)
  'google_compute_disk': 'block-storage',
  'google_compute_snapshot': 'block-storage',
  'google_compute_image': 'block-storage',  // Images contain disk data
  'google_compute_attached_disk': 'block-storage',

  // Block storage - Azure
  'azurerm_managed_disk': 'block-storage',
  'azurerm_snapshot': 'block-storage',
  'azurerm_image': 'block-storage',  // Images contain disk data

  // File storage
  'aws_efs_file_system': 'file-storage',
  'aws_efs_mount_target': 'file-storage',
  'aws_fsx_lustre_file_system': 'file-storage',
  'aws_fsx_windows_file_system': 'file-storage',
  'aws_fsx_ontap_file_system': 'file-storage',
  'aws_fsx_openzfs_file_system': 'file-storage',

  // Object storage - AWS
  'aws_s3_bucket': 'object-storage',
  'aws_s3_object': 'object-storage',
  'aws_s3_bucket_object': 'object-storage',
  'aws_glacier_vault': 'object-storage',
  'aws_s3_access_point': 'object-storage',

  // Object storage - GCP
  'google_storage_bucket': 'object-storage',
  'google_storage_bucket_object': 'object-storage',

  // Object storage - Azure (model weakness: "filesystem" over-demoted)
  'azurerm_storage_account': 'object-storage',
  'azurerm_storage_container': 'object-storage',
  'azurerm_storage_blob': 'object-storage',
  'azurerm_storage_data_lake_gen2_filesystem': 'object-storage',  // ADLS Gen2 is data
  'azurerm_storage_data_lake_gen2_path': 'object-storage',

  // Cache clusters - AWS
  'aws_elasticache_cluster': 'cache-cluster',
  'aws_elasticache_replication_group': 'cache-cluster',
  'aws_elasticache_global_replication_group': 'cache-cluster',
  'aws_elasticache_serverless_cache': 'cache-cluster',  // Serverless still has data
  'aws_memorydb_cluster': 'cache-cluster',

  // Cache clusters - GCP
  'google_redis_instance': 'cache-cluster',
  'google_redis_cluster': 'cache-cluster',
  'google_memcache_instance': 'cache-cluster',

  // Cache clusters - Azure
  'azurerm_redis_cache': 'cache-cluster',
  'azurerm_redis_enterprise_cluster': 'cache-cluster',

  // Search clusters
  'aws_opensearch_domain': 'search-cluster',
  'aws_elasticsearch_domain': 'search-cluster',
  'aws_cloudsearch_domain': 'search-cluster',

  // Streaming data
  'aws_kinesis_stream': 'streaming-data',
  'aws_kinesis_firehose_delivery_stream': 'streaming-data',
  'aws_msk_cluster': 'streaming-data',
  'aws_mskconnect_connector': 'streaming-data',

  // Message queues
  'aws_sqs_queue': 'message-queue',
  'aws_sns_topic': 'message-queue',
  'aws_mq_broker': 'message-queue',

  // Container registry
  'aws_ecr_repository': 'container-registry',
  'aws_ecr_lifecycle_policy': 'container-registry',
  'aws_ecrpublic_repository': 'container-registry',

  // Secrets and keys - AWS
  'aws_secretsmanager_secret': 'secrets-and-keys',
  'aws_secretsmanager_secret_version': 'secrets-and-keys',
  'aws_kms_key': 'secrets-and-keys',
  'aws_kms_alias': 'secrets-and-keys',
  'aws_acm_certificate': 'secrets-and-keys',
  'aws_acmpca_certificate_authority': 'secrets-and-keys',

  // Secrets and keys - GCP (model weakness: "ciphertext" not recognized)
  'google_kms_key_ring': 'secrets-and-keys',
  'google_kms_crypto_key': 'secrets-and-keys',
  'google_kms_secret_ciphertext': 'secrets-and-keys',  // Contains encrypted data
  'google_secret_manager_secret': 'secrets-and-keys',
  'google_secret_manager_secret_version': 'secrets-and-keys',

  // Secrets and keys - Azure
  'azurerm_key_vault': 'secrets-and-keys',
  'azurerm_key_vault_key': 'secrets-and-keys',
  'azurerm_key_vault_secret': 'secrets-and-keys',
  'azurerm_key_vault_certificate': 'secrets-and-keys',

  // Stateful compute
  'aws_instance': 'stateful-compute',
  'aws_emr_cluster': 'stateful-compute',
  'aws_batch_compute_environment': 'stateful-compute',
  'aws_sagemaker_notebook_instance': 'stateful-compute',

  // No verification needed - networking
  'aws_vpc': 'no-verification-needed',
  'aws_subnet': 'no-verification-needed',
  'aws_route_table': 'no-verification-needed',
  'aws_route': 'no-verification-needed',
  'aws_internet_gateway': 'no-verification-needed',
  'aws_nat_gateway': 'no-verification-needed',
  'aws_security_group': 'no-verification-needed',
  'aws_security_group_rule': 'no-verification-needed',
  'aws_network_acl': 'no-verification-needed',
  'aws_vpc_peering_connection': 'no-verification-needed',
  'aws_vpn_gateway': 'no-verification-needed',
  'aws_customer_gateway': 'no-verification-needed',

  // No verification needed - IAM
  'aws_iam_role': 'no-verification-needed',
  'aws_iam_policy': 'no-verification-needed',
  'aws_iam_user': 'no-verification-needed',
  'aws_iam_group': 'no-verification-needed',
  'aws_iam_role_policy': 'no-verification-needed',
  'aws_iam_role_policy_attachment': 'no-verification-needed',
  'aws_iam_user_policy': 'no-verification-needed',
  'aws_iam_user_policy_attachment': 'no-verification-needed',
  'aws_iam_instance_profile': 'no-verification-needed',

  // No verification needed - other config
  'aws_cloudwatch_log_group': 'no-verification-needed',
  'aws_cloudwatch_metric_alarm': 'no-verification-needed',
  'aws_lambda_function': 'no-verification-needed',
  'aws_lambda_layer_version': 'no-verification-needed',
  'aws_api_gateway_rest_api': 'no-verification-needed',
  'aws_apigatewayv2_api': 'no-verification-needed',
  'aws_lb': 'no-verification-needed',
  'aws_alb': 'no-verification-needed',
  'aws_lb_target_group': 'no-verification-needed',
  'aws_lb_listener': 'no-verification-needed',
  'aws_route53_zone': 'no-verification-needed',
  'aws_route53_record': 'no-verification-needed',
  'aws_cloudfront_distribution': 'no-verification-needed',
  'aws_waf_web_acl': 'no-verification-needed',
  'aws_wafv2_web_acl': 'no-verification-needed',

  // EKS - container orchestration, not databases
  'aws_eks_cluster': 'no-verification-needed',
  'aws_eks_node_group': 'no-verification-needed',
  'aws_eks_fargate_profile': 'no-verification-needed',
  'aws_eks_addon': 'no-verification-needed',

  // ECS - container orchestration, not databases
  'aws_ecs_cluster': 'no-verification-needed',
  'aws_ecs_service': 'no-verification-needed',
  'aws_ecs_task_definition': 'no-verification-needed',
  'aws_ecs_capacity_provider': 'no-verification-needed',
};

/**
 * Pattern-based classification for unknown resource types
 * Lower confidence than exact matches
 */
interface PatternRule {
  pattern: RegExp;
  category: VerificationCategory;
  confidence: number;
}

const PATTERN_RULES: PatternRule[] = [
  // Database patterns - SPECIFIC, avoid generic _cluster which catches EKS/ECS
  { pattern: /^aws_(rds|aurora|neptune|docdb|redshift)_/, category: 'database-with-snapshots', confidence: 0.9 },
  // Only match _db_cluster or _rds_cluster, NOT generic _cluster
  { pattern: /_(db|rds|aurora|neptune|docdb)_cluster/, category: 'database-with-snapshots', confidence: 0.8 },
  { pattern: /_db_instance/, category: 'database-with-snapshots', confidence: 0.8 },
  { pattern: /database/, category: 'database-with-snapshots', confidence: 0.7 },

  // NoSQL patterns
  { pattern: /^aws_dynamodb_/, category: 'nosql-database', confidence: 0.9 },
  { pattern: /^aws_keyspaces_/, category: 'nosql-database', confidence: 0.9 },
  { pattern: /^aws_timestream_/, category: 'nosql-database', confidence: 0.9 },

  // Storage patterns
  { pattern: /^aws_ebs_/, category: 'block-storage', confidence: 0.95 },
  { pattern: /_volume$/, category: 'block-storage', confidence: 0.7 },
  { pattern: /_snapshot$/, category: 'block-storage', confidence: 0.7 },

  { pattern: /^aws_efs_/, category: 'file-storage', confidence: 0.95 },
  { pattern: /^aws_fsx_/, category: 'file-storage', confidence: 0.95 },
  { pattern: /file_system/, category: 'file-storage', confidence: 0.8 },

  { pattern: /^aws_s3_/, category: 'object-storage', confidence: 0.95 },
  { pattern: /^aws_glacier_/, category: 'object-storage', confidence: 0.95 },
  { pattern: /_bucket$/, category: 'object-storage', confidence: 0.8 },

  // Cache patterns
  { pattern: /^aws_elasticache_/, category: 'cache-cluster', confidence: 0.95 },
  { pattern: /^aws_memorydb_/, category: 'cache-cluster', confidence: 0.95 },
  { pattern: /cache/, category: 'cache-cluster', confidence: 0.6 },

  // Search patterns
  { pattern: /^aws_opensearch_/, category: 'search-cluster', confidence: 0.95 },
  { pattern: /^aws_elasticsearch_/, category: 'search-cluster', confidence: 0.95 },
  { pattern: /search/, category: 'search-cluster', confidence: 0.6 },

  // Streaming patterns
  { pattern: /^aws_kinesis_/, category: 'streaming-data', confidence: 0.95 },
  { pattern: /^aws_msk_/, category: 'streaming-data', confidence: 0.95 },
  { pattern: /stream/, category: 'streaming-data', confidence: 0.6 },

  // Message queue patterns
  { pattern: /^aws_sqs_/, category: 'message-queue', confidence: 0.95 },
  { pattern: /^aws_sns_/, category: 'message-queue', confidence: 0.95 },
  { pattern: /^aws_mq_/, category: 'message-queue', confidence: 0.95 },
  { pattern: /queue/, category: 'message-queue', confidence: 0.7 },

  // Container patterns
  { pattern: /^aws_ecr/, category: 'container-registry', confidence: 0.95 },
  { pattern: /repository/, category: 'container-registry', confidence: 0.5 },

  // Secrets patterns
  { pattern: /^aws_secretsmanager_/, category: 'secrets-and-keys', confidence: 0.95 },
  { pattern: /^aws_kms_/, category: 'secrets-and-keys', confidence: 0.95 },
  { pattern: /^aws_acm/, category: 'secrets-and-keys', confidence: 0.95 },
  { pattern: /secret/, category: 'secrets-and-keys', confidence: 0.7 },
  { pattern: /key/, category: 'secrets-and-keys', confidence: 0.5 },

  // Compute patterns
  { pattern: /^aws_instance$/, category: 'stateful-compute', confidence: 0.9 },
  { pattern: /^aws_emr_/, category: 'stateful-compute', confidence: 0.9 },
  { pattern: /^aws_sagemaker_/, category: 'stateful-compute', confidence: 0.8 },

  // No verification patterns - these should match last
  { pattern: /^aws_iam_/, category: 'no-verification-needed', confidence: 0.95 },
  { pattern: /^aws_vpc/, category: 'no-verification-needed', confidence: 0.9 },
  { pattern: /^aws_subnet/, category: 'no-verification-needed', confidence: 0.9 },
  { pattern: /^aws_route/, category: 'no-verification-needed', confidence: 0.9 },
  { pattern: /^aws_security_group/, category: 'no-verification-needed', confidence: 0.9 },
  { pattern: /^aws_lb/, category: 'no-verification-needed', confidence: 0.9 },
  { pattern: /^aws_lambda_/, category: 'no-verification-needed', confidence: 0.9 },
  { pattern: /^aws_api_gateway/, category: 'no-verification-needed', confidence: 0.9 },
  { pattern: /^aws_cloudwatch_/, category: 'no-verification-needed', confidence: 0.9 },
  { pattern: /^aws_cloudfront_/, category: 'no-verification-needed', confidence: 0.9 },
  { pattern: /_policy$/, category: 'no-verification-needed', confidence: 0.7 },
  { pattern: /_attachment$/, category: 'no-verification-needed', confidence: 0.8 },
  { pattern: /_rule$/, category: 'no-verification-needed', confidence: 0.7 },
];

/**
 * Decision tree classifier (fallback until BitNet is integrated)
 */
export class DecisionTreeClassifier implements VerificationClassifier {
  classify(resourceType: string, _attributes?: Record<string, unknown>): ClassificationResult {
    // Try exact match first
    const exactMatch = EXACT_MAPPINGS[resourceType];
    if (exactMatch) {
      return {
        category: exactMatch,
        confidence: 1.0,
        source: 'exact-match',
      };
    }

    // Try pattern matching
    // Sort by confidence descending, so higher confidence patterns win
    const matches = PATTERN_RULES
      .filter(rule => rule.pattern.test(resourceType))
      .sort((a, b) => b.confidence - a.confidence);

    if (matches.length > 0) {
      return {
        category: matches[0].category,
        confidence: matches[0].confidence,
        source: 'pattern-match',
      };
    }

    // Default: no verification needed (conservative for unknown)
    // Note: In production, might want to return 'needs-review' instead
    return {
      category: 'no-verification-needed',
      confidence: 0.3,
      source: 'pattern-match',
    };
  }
}

/**
 * BitNet classifier interface
 * To be implemented when BitNet model is available
 */
export interface BitNetClassifier extends VerificationClassifier {
  // Additional methods for BitNet
  loadModel(modelPath: string): Promise<void>;
  getEmbedding(resourceType: string): Float32Array;
}

/**
 * BitNet 1-bit Quantized Classifier
 * Uses pre-trained weights for multi-cloud resource classification
 */
export class BitNetResourceClassifier implements VerificationClassifier {
  private model: import('./bitnet.js').BitNetModel | null = null;
  private fallback = new DecisionTreeClassifier();
  private loadPromise: Promise<void> | null = null;

  /**
   * Load pre-trained weights from JSON
   */
  async loadModel(weightsJson: string): Promise<void> {
    const { deserializeModel } = await import('./bitnet.js');
    this.model = deserializeModel(weightsJson);
  }

  /**
   * Load weights from file path
   */
  async loadModelFromFile(modelPath: string): Promise<void> {
    const { readFileSync } = await import('fs');
    const weightsJson = readFileSync(modelPath, 'utf-8');
    await this.loadModel(weightsJson);
  }

  /**
   * Lazy-load the bundled pre-trained weights
   */
  private async ensureLoaded(): Promise<void> {
    if (this.model) return;
    if (this.loadPromise) {
      await this.loadPromise;
      return;
    }

    this.loadPromise = (async () => {
      try {
        // Try to load bundled weights
        const { readFileSync } = await import('fs');
        const { fileURLToPath } = await import('url');
        const { dirname, join } = await import('path');

        // Get path relative to this module
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const weightsPath = join(__dirname, 'bitnet-weights.json');

        const weightsJson = readFileSync(weightsPath, 'utf-8');
        const { deserializeModel } = await import('./bitnet.js');
        this.model = deserializeModel(weightsJson);
      } catch {
        // Weights not found, will use fallback silently
        // (This is expected when running from source without pre-trained weights)
      }
    })();

    await this.loadPromise;
  }

  classify(resourceType: string, attributes?: Record<string, unknown>): ClassificationResult {
    // Layer 1: Check exact mappings first (highest confidence, manual verification)
    const exactMatch = EXACT_MAPPINGS[resourceType];
    if (exactMatch) {
      return {
        category: exactMatch,
        confidence: 1.0,
        source: 'exact-match',
      };
    }

    // Layer 2: Use BitNet for unknown resources if model is loaded
    if (this.model) {
      const result = this.classifyWithModel(resourceType);
      return {
        category: result.category,
        confidence: result.confidence,
        source: 'bitnet',
      };
    }

    // Layer 3: Fallback to decision tree if BitNet not loaded
    // (async loading happens in background for next call)
    this.ensureLoaded().catch(() => {});
    return this.fallback.classify(resourceType, attributes);
  }

  /**
   * Internal classification using loaded model
   */
  private classifyWithModel(resourceType: string): { category: VerificationCategory; confidence: number } {
    const model = this.model!;
    const tokens = resourceType.toLowerCase().split(/[_\-.]+/).filter(t => t.length > 0);

    // Average pool embeddings
    const pooled = new Array(model.config.embedDim).fill(0);
    let validTokens = 0;
    for (let i = 0; i < Math.min(tokens.length, model.config.maxTokens); i++) {
      const token = tokens[i];
      const tokenId = model.vocabulary.get(token) ?? model.vocabulary.get('<UNK>')!;
      const embedding = model.embeddings[tokenId];
      for (let j = 0; j < model.config.embedDim; j++) {
        pooled[j] += embedding[j];
      }
      validTokens++;
    }
    if (validTokens > 0) {
      for (let j = 0; j < model.config.embedDim; j++) {
        pooled[j] /= validTokens;
      }
    }

    // Hidden layer
    const hidden = new Array(model.config.hiddenDim).fill(0);
    for (let h = 0; h < model.config.hiddenDim; h++) {
      let sum = model.hiddenBias[h];
      for (let e = 0; e < model.config.embedDim; e++) {
        sum += pooled[e] * model.hiddenWeights[e][h];
      }
      hidden[h] = Math.max(0, sum); // ReLU
    }

    // Output layer
    const categories: VerificationCategory[] = [
      'database-with-snapshots', 'nosql-database', 'block-storage', 'file-storage',
      'object-storage', 'cache-cluster', 'search-cluster', 'streaming-data',
      'message-queue', 'container-registry', 'secrets-and-keys', 'stateful-compute',
      'no-verification-needed',
    ];
    const logits = new Array(categories.length).fill(0);
    for (let c = 0; c < categories.length; c++) {
      let sum = model.outputBias[c];
      for (let h = 0; h < model.config.hiddenDim; h++) {
        sum += hidden[h] * model.outputWeights[h][c];
      }
      logits[c] = sum;
    }

    // Softmax
    const maxLogit = Math.max(...logits);
    const exps = logits.map(l => Math.exp(l - maxLogit));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map(e => e / sumExps);

    const maxIndex = probs.indexOf(Math.max(...probs));
    return {
      category: categories[maxIndex],
      confidence: probs[maxIndex],
    };
  }

  /**
   * Synchronous classification (requires model already loaded)
   */
  classifySync(resourceType: string): ClassificationResult {
    if (!this.model) {
      return this.fallback.classify(resourceType);
    }

    const { classifyWithBitNet } = require('./bitnet.js');
    const result = classifyWithBitNet(this.model, resourceType);

    return {
      category: result.category,
      confidence: result.confidence,
      source: 'bitnet',
    };
  }

  /**
   * Check if BitNet model is loaded
   */
  isLoaded(): boolean {
    return this.model !== null;
  }
}

// Legacy alias
export const BitNetClassifierPlaceholder = BitNetResourceClassifier;

// Default classifier instance
// Uses BitNet when weights are available, falls back to decision tree
export const defaultClassifier: VerificationClassifier = new BitNetResourceClassifier();

/**
 * Classify a resource type
 */
export function classifyResourceType(
  resourceType: string,
  attributes?: Record<string, unknown>,
  classifier: VerificationClassifier = defaultClassifier
): ClassificationResult {
  return classifier.classify(resourceType, attributes);
}
