/**
 * Held-out test data for BitNet classifier evaluation
 *
 * These resources are intentionally NOT in training-data.ts
 * Used to measure true generalization, not memorization
 */

import type { VerificationCategory } from './categories.js';

export interface TestExample {
  resourceType: string;
  category: VerificationCategory;
  notes?: string;
}

export const HELD_OUT_TEST_DATA: TestExample[] = [
  // ============================================
  // DATABASE WITH SNAPSHOTS - variations not in training
  // ============================================
  { resourceType: 'aws_rds_cluster_endpoint', category: 'database-with-snapshots', notes: 'RDS cluster component - still part of cluster' },
  { resourceType: 'aws_neptune_cluster_snapshot', category: 'database-with-snapshots', notes: 'Neptune snapshot - contains data' },
  { resourceType: 'aws_docdb_cluster_snapshot', category: 'database-with-snapshots', notes: 'DocumentDB snapshot - contains data' },
  { resourceType: 'azurerm_postgresql_database', category: 'database-with-snapshots', notes: 'Azure PG database' },
  { resourceType: 'azurerm_mssql_managed_instance', category: 'database-with-snapshots', notes: 'Azure SQL MI' },
  { resourceType: 'oci_database_autonomous_container_database', category: 'database-with-snapshots', notes: 'OCI autonomous container' },
  { resourceType: 'oci_database_data_guard_association', category: 'database-with-snapshots', notes: 'Data Guard association' },

  // ============================================
  // NOSQL DATABASE - variations not in training
  // ============================================
  { resourceType: 'aws_dynamodb_table_item', category: 'nosql-database', notes: 'DynamoDB item - contains data' },
  { resourceType: 'google_firestore_document', category: 'nosql-database', notes: 'Firestore document - contains data' },
  { resourceType: 'google_firestore_index', category: 'nosql-database', notes: 'Firestore index - part of database' },
  { resourceType: 'azurerm_cosmosdb_gremlin_database', category: 'nosql-database', notes: 'CosmosDB Gremlin' },
  { resourceType: 'azurerm_cosmosdb_sql_container', category: 'nosql-database', notes: 'CosmosDB container' },

  // ============================================
  // BLOCK STORAGE - variations not in training
  // ============================================
  { resourceType: 'aws_ebs_volume_attachment', category: 'block-storage', notes: 'EBS volume attachment - still references volume data' },
  { resourceType: 'google_compute_attached_disk', category: 'block-storage', notes: 'GCP attached disk' },
  { resourceType: 'azurerm_disk_access', category: 'block-storage', notes: 'Azure disk access' },
  { resourceType: 'oci_core_volume_attachment', category: 'block-storage', notes: 'OCI volume attachment' },
  { resourceType: 'oci_core_volume_group', category: 'block-storage', notes: 'OCI volume group - groups volumes together' },

  // ============================================
  // FILE STORAGE - variations not in training
  // ============================================
  { resourceType: 'aws_fsx_backup', category: 'file-storage', notes: 'FSx backup - contains data' },
  { resourceType: 'google_filestore_snapshot', category: 'file-storage', notes: 'Filestore snapshot - contains data' },
  { resourceType: 'azurerm_storage_share_file', category: 'file-storage', notes: 'Azure file share file' },
  { resourceType: 'oci_file_storage_snapshot', category: 'file-storage', notes: 'OCI file snapshot - contains data' },

  // ============================================
  // OBJECT STORAGE - variations not in training
  // ============================================
  { resourceType: 'aws_s3_bucket_versioning', category: 'object-storage', notes: 'S3 versioning - affects bucket behavior' },
  { resourceType: 'aws_s3_bucket_inventory', category: 'object-storage', notes: 'S3 inventory - generates object lists' },
  { resourceType: 'azurerm_storage_data_lake_gen2_filesystem', category: 'object-storage', notes: 'ADLS Gen2 filesystem - data container' },
  { resourceType: 'oci_objectstorage_namespace_metadata', category: 'object-storage', notes: 'Namespace metadata' },

  // ============================================
  // CACHE CLUSTER - variations not in training
  // ============================================
  { resourceType: 'aws_elasticache_serverless_cache', category: 'cache-cluster', notes: 'ElastiCache serverless' },
  { resourceType: 'aws_elasticache_snapshot', category: 'cache-cluster', notes: 'ElastiCache snapshot - contains data' },
  { resourceType: 'google_redis_cluster', category: 'cache-cluster', notes: 'Redis cluster' },
  { resourceType: 'azurerm_redis_linked_server', category: 'cache-cluster', notes: 'Redis linked server' },

  // ============================================
  // SEARCH CLUSTER - variations not in training
  // ============================================
  { resourceType: 'aws_opensearch_domain_saml_options', category: 'search-cluster', notes: 'OpenSearch SAML' },
  { resourceType: 'azurerm_search_service', category: 'search-cluster', notes: 'Azure Search service' },

  // ============================================
  // STREAMING DATA - variations not in training
  // ============================================
  { resourceType: 'aws_kinesis_stream_consumer', category: 'streaming-data', notes: 'Kinesis consumer' },
  { resourceType: 'aws_kinesis_video_stream', category: 'streaming-data', notes: 'Kinesis video stream - stores video' },
  { resourceType: 'google_pubsub_lite_topic', category: 'streaming-data', notes: 'Pub/Sub Lite topic' },
  { resourceType: 'google_pubsub_lite_subscription', category: 'streaming-data', notes: 'Pub/Sub Lite subscription - persists messages' },
  { resourceType: 'google_pubsub_lite_reservation', category: 'streaming-data', notes: 'Pub/Sub Lite reservation' },
  { resourceType: 'azurerm_eventhub_capture', category: 'streaming-data', notes: 'EventHub capture - stores data' },

  // ============================================
  // MESSAGE QUEUE - variations not in training
  // ============================================
  { resourceType: 'aws_sns_topic_subscription', category: 'message-queue', notes: 'SNS subscription' },
  { resourceType: 'google_cloud_tasks_queue', category: 'message-queue', notes: 'Cloud Tasks queue' },
  { resourceType: 'azurerm_servicebus_subscription', category: 'message-queue', notes: 'ServiceBus subscription' },

  // ============================================
  // CONTAINER REGISTRY - variations not in training
  // ============================================
  { resourceType: 'aws_ecr_image', category: 'container-registry', notes: 'ECR image - contains layers' },
  { resourceType: 'aws_ecr_replication_configuration', category: 'container-registry', notes: 'ECR replication config' },
  { resourceType: 'google_artifact_registry_docker_image', category: 'container-registry', notes: 'Artifact docker image' },
  { resourceType: 'azurerm_container_registry_scope_map', category: 'container-registry', notes: 'ACR scope map' },

  // ============================================
  // SECRETS AND KEYS - variations not in training
  // ============================================
  { resourceType: 'aws_kms_external_key', category: 'secrets-and-keys', notes: 'External KMS key' },
  { resourceType: 'aws_kms_replica_key', category: 'secrets-and-keys', notes: 'KMS replica key' },
  { resourceType: 'google_kms_crypto_key_version', category: 'secrets-and-keys', notes: 'KMS key version' },
  { resourceType: 'google_kms_secret_ciphertext', category: 'secrets-and-keys', notes: 'Encrypted secret data' },
  { resourceType: 'azurerm_key_vault_secret', category: 'secrets-and-keys', notes: 'Key Vault secret' },
  { resourceType: 'oci_kms_key_version', category: 'secrets-and-keys', notes: 'OCI KMS version' },

  // ============================================
  // STATEFUL COMPUTE - variations not in training
  // ============================================
  { resourceType: 'aws_spot_instance_request', category: 'stateful-compute', notes: 'Spot instance request' },
  { resourceType: 'aws_emr_instance_fleet', category: 'stateful-compute', notes: 'EMR instance fleet' },
  { resourceType: 'google_compute_instance_group_manager', category: 'stateful-compute', notes: 'GCE instance group manager' },
  { resourceType: 'google_workstations_workstation', category: 'stateful-compute', notes: 'Workstation with local data' },
  { resourceType: 'azurerm_virtual_machine_scale_set', category: 'stateful-compute', notes: 'VMSS' },
  { resourceType: 'oci_core_dedicated_vm_host', category: 'stateful-compute', notes: 'OCI dedicated VM host' },

  // ============================================
  // NO VERIFICATION NEEDED - variations not in training
  // ============================================
  { resourceType: 'aws_vpc_endpoint', category: 'no-verification-needed', notes: 'VPC endpoint' },
  { resourceType: 'aws_eip', category: 'no-verification-needed', notes: 'Elastic IP' },
  { resourceType: 'aws_flow_log', category: 'no-verification-needed', notes: 'Flow log' },
  { resourceType: 'aws_iam_access_key', category: 'no-verification-needed', notes: 'IAM access key' },
  { resourceType: 'aws_lambda_permission', category: 'no-verification-needed', notes: 'Lambda permission' },
  { resourceType: 'aws_api_gateway_stage', category: 'no-verification-needed', notes: 'API Gateway stage' },
  { resourceType: 'aws_eks_addon', category: 'no-verification-needed', notes: 'EKS addon' },
  { resourceType: 'aws_ecs_capacity_provider', category: 'no-verification-needed', notes: 'ECS capacity' },
  { resourceType: 'google_compute_firewall_policy', category: 'no-verification-needed', notes: 'Firewall policy' },
  { resourceType: 'google_compute_health_check', category: 'no-verification-needed', notes: 'Health check' },
  { resourceType: 'google_project_service', category: 'no-verification-needed', notes: 'Project service API' },
  { resourceType: 'google_cloud_run_service_iam_member', category: 'no-verification-needed', notes: 'Cloud Run IAM' },
  { resourceType: 'google_container_cluster_node_pool', category: 'no-verification-needed', notes: 'GKE node pool' },
  { resourceType: 'azurerm_network_interface_security_group_association', category: 'no-verification-needed', notes: 'NIC-NSG association' },
  { resourceType: 'azurerm_private_endpoint', category: 'no-verification-needed', notes: 'Private endpoint' },
  { resourceType: 'azurerm_app_service_plan', category: 'no-verification-needed', notes: 'App Service plan' },
  { resourceType: 'azurerm_logic_app_workflow', category: 'no-verification-needed', notes: 'Logic App' },
  { resourceType: 'oci_core_drg', category: 'no-verification-needed', notes: 'DRG' },
  { resourceType: 'oci_core_service_gateway', category: 'no-verification-needed', notes: 'Service gateway' },
  { resourceType: 'oci_identity_authentication_policy', category: 'no-verification-needed', notes: 'Auth policy' },
  // Config-only resources (not in training data)
  { resourceType: 'aws_ebs_encryption_by_default', category: 'no-verification-needed', notes: 'Account-level setting' },
  { resourceType: 'aws_efs_backup_policy', category: 'no-verification-needed', notes: 'Backup policy is config' },
  { resourceType: 'aws_msk_configuration', category: 'no-verification-needed', notes: 'MSK config' },
  { resourceType: 'google_bigtable_gc_policy', category: 'no-verification-needed', notes: 'GC policy is config' },
  { resourceType: 'google_datastream_connection_profile', category: 'no-verification-needed', notes: 'Connection profile is config' },
  { resourceType: 'google_compute_disk_resource_policy_attachment', category: 'no-verification-needed', notes: 'Policy attachment is config' },
  { resourceType: 'azurerm_mssql_firewall_rule', category: 'no-verification-needed', notes: 'Firewall rule is config' },
  { resourceType: 'google_sql_ssl_cert', category: 'no-verification-needed', notes: 'SSL cert is config' },
  { resourceType: 'aws_elasticache_user_group', category: 'no-verification-needed', notes: 'User group is config' },
  { resourceType: 'google_redis_cluster_node', category: 'no-verification-needed', notes: 'Node config - not the cluster itself' },
  { resourceType: 'azurerm_storage_management_policy', category: 'no-verification-needed', notes: 'Storage policy is config' },
  { resourceType: 'aws_s3_bucket_lifecycle_configuration', category: 'no-verification-needed', notes: 'Lifecycle config' },
  { resourceType: 'aws_s3_bucket_replication_configuration', category: 'no-verification-needed', notes: 'Replication config' },
  { resourceType: 'oci_objectstorage_preauthrequest', category: 'no-verification-needed', notes: 'Preauth is access config' },
  { resourceType: 'aws_opensearch_domain_policy', category: 'no-verification-needed', notes: 'Domain policy is config' },
  { resourceType: 'aws_elasticsearch_domain_policy', category: 'no-verification-needed', notes: 'Domain policy is config' },
  { resourceType: 'aws_sqs_queue_redrive_policy', category: 'no-verification-needed', notes: 'Redrive policy is config' },
  { resourceType: 'aws_secretsmanager_secret_policy', category: 'no-verification-needed', notes: 'Secret policy is config' },
  { resourceType: 'aws_s3_bucket_intelligent_tiering_configuration', category: 'no-verification-needed', notes: 'Tiering config' },
  { resourceType: 'google_storage_notification', category: 'no-verification-needed', notes: 'Bucket notification is config' },
  { resourceType: 'aws_opensearch_outbound_connection', category: 'no-verification-needed', notes: 'Cross-cluster connection is config' },
  { resourceType: 'aws_sqs_queue_redrive_allow_policy', category: 'no-verification-needed', notes: 'Redrive allow policy is config' },
  { resourceType: 'azurerm_mssql_database_extended_auditing_policy', category: 'no-verification-needed', notes: 'Auditing policy is config' },
  { resourceType: 'aws_fsx_data_repository_association', category: 'no-verification-needed', notes: 'Data repo association is config' },

  // ============================================
  // TRICKY EDGE CASES - test the model's reasoning
  // ============================================

  // These look like compute but have special handling (not in training)
  { resourceType: 'aws_launch_template', category: 'no-verification-needed', notes: 'Launch template is stateless config' },
  { resourceType: 'aws_ami', category: 'block-storage', notes: 'AMI contains disk images' },
  { resourceType: 'google_compute_image', category: 'block-storage', notes: 'Compute image contains disk data' },
  { resourceType: 'azurerm_image', category: 'block-storage', notes: 'Azure image contains disk data' },
  { resourceType: 'aws_ami_copy', category: 'block-storage', notes: 'AMI copy also contains disk data' },
  { resourceType: 'aws_ami_launch_permission', category: 'no-verification-needed', notes: 'Permission is just config' },

  // Cross-cloud generalization (providers NOT in training)
  { resourceType: 'scaleway_instance_server', category: 'stateful-compute', notes: 'Scaleway VM' },
  { resourceType: 'scaleway_rdb_instance', category: 'database-with-snapshots', notes: 'Scaleway database' },
  { resourceType: 'scaleway_object_bucket', category: 'object-storage', notes: 'Scaleway object storage' },
  { resourceType: 'scaleway_instance_volume', category: 'block-storage', notes: 'Scaleway block volume' },
  { resourceType: 'upcloud_server', category: 'stateful-compute', notes: 'UpCloud VM' },
  { resourceType: 'upcloud_managed_database_mysql', category: 'database-with-snapshots', notes: 'UpCloud MySQL' },
  { resourceType: 'upcloud_storage', category: 'block-storage', notes: 'UpCloud storage' },
  { resourceType: 'exoscale_compute_instance', category: 'stateful-compute', notes: 'Exoscale VM' },
  { resourceType: 'exoscale_database', category: 'database-with-snapshots', notes: 'Exoscale database' },
  { resourceType: 'exoscale_sks_cluster', category: 'no-verification-needed', notes: 'Exoscale Kubernetes' },
];

/**
 * Get test data distribution
 */
export function getTestDistribution(): Record<string, number> {
  const distribution: Record<string, number> = {};
  for (const example of HELD_OUT_TEST_DATA) {
    distribution[example.category] = (distribution[example.category] || 0) + 1;
  }
  return distribution;
}
