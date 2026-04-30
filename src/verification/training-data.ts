/**
 * Training data for BitNet resource type classifier
 *
 * Maps resource types from AWS, GCP, Azure, OCI to verification categories
 */

import type { VerificationCategory } from './categories.js';

export interface TrainingExample {
  resourceType: string;
  category: VerificationCategory;
}

export const TRAINING_DATA: TrainingExample[] = [
  // ============================================
  // DATABASE WITH SNAPSHOTS
  // ============================================

  // AWS
  { resourceType: 'aws_db_instance', category: 'database-with-snapshots' },
  { resourceType: 'aws_rds_cluster', category: 'database-with-snapshots' },
  { resourceType: 'aws_rds_cluster_instance', category: 'database-with-snapshots' },
  { resourceType: 'aws_rds_global_cluster', category: 'database-with-snapshots' },
  { resourceType: 'aws_neptune_cluster', category: 'database-with-snapshots' },
  { resourceType: 'aws_neptune_cluster_instance', category: 'database-with-snapshots' },
  { resourceType: 'aws_docdb_cluster', category: 'database-with-snapshots' },
  { resourceType: 'aws_docdb_cluster_instance', category: 'database-with-snapshots' },
  { resourceType: 'aws_redshift_cluster', category: 'database-with-snapshots' },
  { resourceType: 'aws_aurora_cluster', category: 'database-with-snapshots' },

  // GCP
  { resourceType: 'google_sql_database_instance', category: 'database-with-snapshots' },
  { resourceType: 'google_sql_database', category: 'database-with-snapshots' },
  { resourceType: 'google_spanner_instance', category: 'database-with-snapshots' },
  { resourceType: 'google_spanner_database', category: 'database-with-snapshots' },
  { resourceType: 'google_alloydb_cluster', category: 'database-with-snapshots' },
  { resourceType: 'google_alloydb_instance', category: 'database-with-snapshots' },

  // Azure
  { resourceType: 'azurerm_postgresql_server', category: 'database-with-snapshots' },
  { resourceType: 'azurerm_postgresql_flexible_server', category: 'database-with-snapshots' },
  { resourceType: 'azurerm_mysql_server', category: 'database-with-snapshots' },
  { resourceType: 'azurerm_mysql_flexible_server', category: 'database-with-snapshots' },
  { resourceType: 'azurerm_mssql_server', category: 'database-with-snapshots' },
  { resourceType: 'azurerm_mssql_database', category: 'database-with-snapshots' },
  { resourceType: 'azurerm_mariadb_server', category: 'database-with-snapshots' },
  { resourceType: 'azurerm_sql_server', category: 'database-with-snapshots' },
  { resourceType: 'azurerm_sql_database', category: 'database-with-snapshots' },
  { resourceType: 'azurerm_synapse_workspace', category: 'database-with-snapshots' },

  // OCI
  { resourceType: 'oci_database_db_system', category: 'database-with-snapshots' },
  { resourceType: 'oci_database_autonomous_database', category: 'database-with-snapshots' },
  { resourceType: 'oci_database_db_home', category: 'database-with-snapshots' },
  { resourceType: 'oci_mysql_mysql_db_system', category: 'database-with-snapshots' },
  { resourceType: 'oci_psql_db_system', category: 'database-with-snapshots' },

  // ============================================
  // NOSQL DATABASE
  // ============================================

  // AWS
  { resourceType: 'aws_dynamodb_table', category: 'nosql-database' },
  { resourceType: 'aws_dynamodb_global_table', category: 'nosql-database' },
  { resourceType: 'aws_keyspaces_table', category: 'nosql-database' },
  { resourceType: 'aws_keyspaces_keyspace', category: 'nosql-database' },
  { resourceType: 'aws_timestream_database', category: 'nosql-database' },
  { resourceType: 'aws_timestream_table', category: 'nosql-database' },

  // GCP
  { resourceType: 'google_bigtable_instance', category: 'nosql-database' },
  { resourceType: 'google_bigtable_table', category: 'nosql-database' },
  { resourceType: 'google_firestore_database', category: 'nosql-database' },
  { resourceType: 'google_datastore_index', category: 'nosql-database' },

  // Azure
  { resourceType: 'azurerm_cosmosdb_account', category: 'nosql-database' },
  { resourceType: 'azurerm_cosmosdb_sql_database', category: 'nosql-database' },
  { resourceType: 'azurerm_cosmosdb_mongo_database', category: 'nosql-database' },
  { resourceType: 'azurerm_cosmosdb_cassandra_keyspace', category: 'nosql-database' },
  { resourceType: 'azurerm_cosmosdb_table', category: 'nosql-database' },

  // OCI
  { resourceType: 'oci_nosql_table', category: 'nosql-database' },
  { resourceType: 'oci_nosql_index', category: 'nosql-database' },

  // ============================================
  // BLOCK STORAGE
  // ============================================

  // AWS - EBS
  { resourceType: 'aws_ebs_volume', category: 'block-storage' },
  { resourceType: 'aws_ebs_snapshot', category: 'block-storage' },
  { resourceType: 'aws_ebs_snapshot_copy', category: 'block-storage' },
  { resourceType: 'aws_ebs_snapshot_import', category: 'block-storage' },

  // AWS - AMI (machine images contain disk data)
  // Note: aws_ami and aws_ami_copy are in held-out test set, use similar resources
  { resourceType: 'aws_ami_from_instance', category: 'block-storage' },
  { resourceType: 'aws_imagebuilder_image', category: 'block-storage' },
  { resourceType: 'aws_imagebuilder_image_recipe', category: 'block-storage' },

  // GCP
  { resourceType: 'google_compute_disk', category: 'block-storage' },
  { resourceType: 'google_compute_snapshot', category: 'block-storage' },
  { resourceType: 'google_compute_region_disk', category: 'block-storage' },
  { resourceType: 'google_compute_image', category: 'block-storage' },
  { resourceType: 'google_compute_machine_image', category: 'block-storage' },

  // Azure
  { resourceType: 'azurerm_managed_disk', category: 'block-storage' },
  { resourceType: 'azurerm_snapshot', category: 'block-storage' },
  { resourceType: 'azurerm_disk_encryption_set', category: 'block-storage' },
  { resourceType: 'azurerm_image', category: 'block-storage' },
  { resourceType: 'azurerm_shared_image', category: 'block-storage' },
  { resourceType: 'azurerm_shared_image_version', category: 'block-storage' },

  // OCI - volumes and volume groups
  // Note: oci_core_volume_group is in held-out test set
  { resourceType: 'oci_core_volume', category: 'block-storage' },
  { resourceType: 'oci_core_volume_backup', category: 'block-storage' },
  { resourceType: 'oci_core_volume_group_backup', category: 'block-storage' },
  { resourceType: 'oci_core_boot_volume', category: 'block-storage' },
  { resourceType: 'oci_core_boot_volume_backup', category: 'block-storage' },
  { resourceType: 'oci_core_boot_volume_replica', category: 'block-storage' },

  // ============================================
  // FILE STORAGE
  // ============================================

  // AWS
  { resourceType: 'aws_efs_file_system', category: 'file-storage' },
  { resourceType: 'aws_efs_mount_target', category: 'file-storage' },
  { resourceType: 'aws_efs_access_point', category: 'file-storage' },
  { resourceType: 'aws_fsx_lustre_file_system', category: 'file-storage' },
  { resourceType: 'aws_fsx_windows_file_system', category: 'file-storage' },
  { resourceType: 'aws_fsx_ontap_file_system', category: 'file-storage' },
  { resourceType: 'aws_fsx_openzfs_file_system', category: 'file-storage' },
  { resourceType: 'aws_fsx_backup', category: 'file-storage' },

  // GCP
  { resourceType: 'google_filestore_instance', category: 'file-storage' },
  { resourceType: 'google_filestore_backup', category: 'file-storage' },
  { resourceType: 'google_filestore_snapshot', category: 'file-storage' },

  // Azure
  { resourceType: 'azurerm_storage_share', category: 'file-storage' },
  { resourceType: 'azurerm_storage_share_file', category: 'file-storage' },
  { resourceType: 'azurerm_netapp_volume', category: 'file-storage' },
  { resourceType: 'azurerm_netapp_pool', category: 'file-storage' },
  { resourceType: 'azurerm_netapp_account', category: 'file-storage' },
  { resourceType: 'azurerm_netapp_snapshot', category: 'file-storage' },

  // OCI
  { resourceType: 'oci_file_storage_file_system', category: 'file-storage' },
  { resourceType: 'oci_file_storage_mount_target', category: 'file-storage' },
  { resourceType: 'oci_file_storage_export', category: 'file-storage' },
  { resourceType: 'oci_file_storage_snapshot', category: 'file-storage' },

  // ============================================
  // OBJECT STORAGE
  // ============================================

  // AWS
  { resourceType: 'aws_s3_bucket', category: 'object-storage' },
  { resourceType: 'aws_s3_object', category: 'object-storage' },
  { resourceType: 'aws_s3_bucket_object', category: 'object-storage' },
  { resourceType: 'aws_glacier_vault', category: 'object-storage' },
  { resourceType: 'aws_s3_access_point', category: 'object-storage' },

  // GCP
  { resourceType: 'google_storage_bucket', category: 'object-storage' },
  { resourceType: 'google_storage_bucket_object', category: 'object-storage' },
  { resourceType: 'google_storage_default_object_acl', category: 'object-storage' },

  // Azure
  { resourceType: 'azurerm_storage_account', category: 'object-storage' },
  { resourceType: 'azurerm_storage_container', category: 'object-storage' },
  { resourceType: 'azurerm_storage_blob', category: 'object-storage' },

  // OCI
  { resourceType: 'oci_objectstorage_bucket', category: 'object-storage' },
  { resourceType: 'oci_objectstorage_object', category: 'object-storage' },
  { resourceType: 'oci_objectstorage_namespace_metadata', category: 'object-storage' },

  // ============================================
  // CACHE CLUSTER
  // ============================================

  // AWS
  { resourceType: 'aws_elasticache_cluster', category: 'cache-cluster' },
  { resourceType: 'aws_elasticache_replication_group', category: 'cache-cluster' },
  { resourceType: 'aws_elasticache_global_replication_group', category: 'cache-cluster' },
  { resourceType: 'aws_elasticache_snapshot', category: 'cache-cluster' },
  { resourceType: 'aws_memorydb_cluster', category: 'cache-cluster' },
  { resourceType: 'aws_memorydb_snapshot', category: 'cache-cluster' },

  // GCP
  { resourceType: 'google_redis_instance', category: 'cache-cluster' },
  { resourceType: 'google_redis_cluster', category: 'cache-cluster' },
  { resourceType: 'google_memcache_instance', category: 'cache-cluster' },

  // Azure
  { resourceType: 'azurerm_redis_cache', category: 'cache-cluster' },
  { resourceType: 'azurerm_redis_enterprise_cluster', category: 'cache-cluster' },
  { resourceType: 'azurerm_redis_enterprise_database', category: 'cache-cluster' },

  // OCI
  { resourceType: 'oci_redis_redis_cluster', category: 'cache-cluster' },

  // ============================================
  // SEARCH CLUSTER
  // ============================================

  // AWS
  { resourceType: 'aws_opensearch_domain', category: 'search-cluster' },
  { resourceType: 'aws_elasticsearch_domain', category: 'search-cluster' },
  { resourceType: 'aws_cloudsearch_domain', category: 'search-cluster' },

  // GCP (Vertex AI Search, formerly Enterprise Search)
  { resourceType: 'google_discovery_engine_data_store', category: 'search-cluster' },

  // Azure
  { resourceType: 'azurerm_search_service', category: 'search-cluster' },

  // ============================================
  // STREAMING DATA
  // ============================================

  // AWS
  { resourceType: 'aws_kinesis_stream', category: 'streaming-data' },
  { resourceType: 'aws_kinesis_firehose_delivery_stream', category: 'streaming-data' },
  { resourceType: 'aws_msk_cluster', category: 'streaming-data' },
  { resourceType: 'aws_mskconnect_connector', category: 'streaming-data' },
  { resourceType: 'aws_kinesis_analytics_application', category: 'streaming-data' },

  // GCP
  { resourceType: 'google_pubsub_topic', category: 'streaming-data' },
  { resourceType: 'google_pubsub_subscription', category: 'streaming-data' },
  { resourceType: 'google_dataflow_job', category: 'streaming-data' },
  { resourceType: 'google_datastream_stream', category: 'streaming-data' },

  // Azure
  { resourceType: 'azurerm_eventhub', category: 'streaming-data' },
  { resourceType: 'azurerm_eventhub_namespace', category: 'streaming-data' },
  { resourceType: 'azurerm_stream_analytics_job', category: 'streaming-data' },
  { resourceType: 'azurerm_hdinsight_kafka_cluster', category: 'streaming-data' },

  // OCI
  { resourceType: 'oci_streaming_stream', category: 'streaming-data' },
  { resourceType: 'oci_streaming_stream_pool', category: 'streaming-data' },

  // ============================================
  // MESSAGE QUEUE
  // ============================================

  // AWS
  { resourceType: 'aws_sqs_queue', category: 'message-queue' },
  { resourceType: 'aws_sns_topic', category: 'message-queue' },
  { resourceType: 'aws_mq_broker', category: 'message-queue' },
  { resourceType: 'aws_mq_configuration', category: 'message-queue' },

  // GCP (Pub/Sub is in streaming, Cloud Tasks here)
  { resourceType: 'google_cloud_tasks_queue', category: 'message-queue' },

  // Azure
  { resourceType: 'azurerm_servicebus_namespace', category: 'message-queue' },
  { resourceType: 'azurerm_servicebus_queue', category: 'message-queue' },
  { resourceType: 'azurerm_servicebus_topic', category: 'message-queue' },

  // OCI
  { resourceType: 'oci_queue_queue', category: 'message-queue' },

  // ============================================
  // CONTAINER REGISTRY
  // ============================================

  // AWS
  { resourceType: 'aws_ecr_repository', category: 'container-registry' },
  { resourceType: 'aws_ecr_lifecycle_policy', category: 'container-registry' },
  { resourceType: 'aws_ecrpublic_repository', category: 'container-registry' },
  { resourceType: 'aws_ecr_image', category: 'container-registry' },
  { resourceType: 'aws_ecr_replication_configuration', category: 'container-registry' },

  // GCP
  { resourceType: 'google_artifact_registry_repository', category: 'container-registry' },
  { resourceType: 'google_container_registry', category: 'container-registry' },
  { resourceType: 'google_artifact_registry_docker_image', category: 'container-registry' },

  // Azure
  { resourceType: 'azurerm_container_registry', category: 'container-registry' },
  { resourceType: 'azurerm_container_registry_scope_map', category: 'container-registry' },

  // OCI
  { resourceType: 'oci_artifacts_container_repository', category: 'container-registry' },
  { resourceType: 'oci_artifacts_container_image', category: 'container-registry' },

  // ============================================
  // SECRETS AND KEYS
  // ============================================

  // AWS
  { resourceType: 'aws_secretsmanager_secret', category: 'secrets-and-keys' },
  { resourceType: 'aws_secretsmanager_secret_version', category: 'secrets-and-keys' },
  { resourceType: 'aws_kms_key', category: 'secrets-and-keys' },
  { resourceType: 'aws_kms_alias', category: 'secrets-and-keys' },
  { resourceType: 'aws_acm_certificate', category: 'secrets-and-keys' },
  { resourceType: 'aws_acmpca_certificate_authority', category: 'secrets-and-keys' },

  // GCP
  { resourceType: 'google_secret_manager_secret', category: 'secrets-and-keys' },
  { resourceType: 'google_secret_manager_secret_version', category: 'secrets-and-keys' },
  { resourceType: 'google_kms_key_ring', category: 'secrets-and-keys' },
  { resourceType: 'google_kms_crypto_key', category: 'secrets-and-keys' },

  // Azure
  { resourceType: 'azurerm_key_vault', category: 'secrets-and-keys' },
  { resourceType: 'azurerm_key_vault_secret', category: 'secrets-and-keys' },
  { resourceType: 'azurerm_key_vault_key', category: 'secrets-and-keys' },
  { resourceType: 'azurerm_key_vault_certificate', category: 'secrets-and-keys' },

  // OCI
  { resourceType: 'oci_vault_secret', category: 'secrets-and-keys' },
  { resourceType: 'oci_kms_key', category: 'secrets-and-keys' },
  { resourceType: 'oci_kms_vault', category: 'secrets-and-keys' },

  // ============================================
  // STATEFUL COMPUTE
  // ============================================

  // AWS
  { resourceType: 'aws_instance', category: 'stateful-compute' },
  { resourceType: 'aws_spot_instance_request', category: 'stateful-compute' },
  { resourceType: 'aws_emr_cluster', category: 'stateful-compute' },
  { resourceType: 'aws_batch_compute_environment', category: 'stateful-compute' },
  { resourceType: 'aws_sagemaker_notebook_instance', category: 'stateful-compute' },

  // GCP
  { resourceType: 'google_compute_instance', category: 'stateful-compute' },
  { resourceType: 'google_compute_instance_template', category: 'stateful-compute' },
  { resourceType: 'google_compute_instance_group_manager', category: 'stateful-compute' },
  { resourceType: 'google_dataproc_cluster', category: 'stateful-compute' },
  { resourceType: 'google_notebooks_instance', category: 'stateful-compute' },
  { resourceType: 'google_workstations_workstation', category: 'stateful-compute' },

  // Azure
  { resourceType: 'azurerm_virtual_machine', category: 'stateful-compute' },
  { resourceType: 'azurerm_linux_virtual_machine', category: 'stateful-compute' },
  { resourceType: 'azurerm_windows_virtual_machine', category: 'stateful-compute' },
  { resourceType: 'azurerm_virtual_machine_scale_set', category: 'stateful-compute' },
  { resourceType: 'azurerm_hdinsight_hadoop_cluster', category: 'stateful-compute' },
  { resourceType: 'azurerm_machine_learning_compute_instance', category: 'stateful-compute' },

  // OCI
  { resourceType: 'oci_core_instance', category: 'stateful-compute' },
  { resourceType: 'oci_core_dedicated_vm_host', category: 'stateful-compute' },
  { resourceType: 'oci_datascience_notebook_session', category: 'stateful-compute' },

  // ============================================
  // NO VERIFICATION NEEDED
  // ============================================

  // AWS - Networking
  { resourceType: 'aws_vpc', category: 'no-verification-needed' },
  { resourceType: 'aws_subnet', category: 'no-verification-needed' },
  { resourceType: 'aws_route_table', category: 'no-verification-needed' },
  { resourceType: 'aws_route', category: 'no-verification-needed' },
  { resourceType: 'aws_internet_gateway', category: 'no-verification-needed' },
  { resourceType: 'aws_nat_gateway', category: 'no-verification-needed' },
  { resourceType: 'aws_security_group', category: 'no-verification-needed' },
  { resourceType: 'aws_security_group_rule', category: 'no-verification-needed' },
  { resourceType: 'aws_network_acl', category: 'no-verification-needed' },
  { resourceType: 'aws_vpc_peering_connection', category: 'no-verification-needed' },

  // AWS - IAM
  { resourceType: 'aws_iam_role', category: 'no-verification-needed' },
  { resourceType: 'aws_iam_policy', category: 'no-verification-needed' },
  { resourceType: 'aws_iam_user', category: 'no-verification-needed' },
  { resourceType: 'aws_iam_group', category: 'no-verification-needed' },
  { resourceType: 'aws_iam_role_policy', category: 'no-verification-needed' },
  { resourceType: 'aws_iam_role_policy_attachment', category: 'no-verification-needed' },
  { resourceType: 'aws_iam_instance_profile', category: 'no-verification-needed' },

  // AWS - Serverless/Config
  { resourceType: 'aws_lambda_function', category: 'no-verification-needed' },
  { resourceType: 'aws_lambda_layer_version', category: 'no-verification-needed' },
  { resourceType: 'aws_api_gateway_rest_api', category: 'no-verification-needed' },
  { resourceType: 'aws_apigatewayv2_api', category: 'no-verification-needed' },
  { resourceType: 'aws_cloudwatch_log_group', category: 'no-verification-needed' },
  { resourceType: 'aws_cloudwatch_metric_alarm', category: 'no-verification-needed' },
  { resourceType: 'aws_lb', category: 'no-verification-needed' },
  { resourceType: 'aws_alb', category: 'no-verification-needed' },
  { resourceType: 'aws_lb_target_group', category: 'no-verification-needed' },
  { resourceType: 'aws_route53_zone', category: 'no-verification-needed' },
  { resourceType: 'aws_route53_record', category: 'no-verification-needed' },
  { resourceType: 'aws_cloudfront_distribution', category: 'no-verification-needed' },

  // AWS - Container Orchestration (not databases!)
  { resourceType: 'aws_eks_cluster', category: 'no-verification-needed' },
  { resourceType: 'aws_eks_node_group', category: 'no-verification-needed' },
  { resourceType: 'aws_eks_fargate_profile', category: 'no-verification-needed' },
  { resourceType: 'aws_ecs_cluster', category: 'no-verification-needed' },
  { resourceType: 'aws_ecs_service', category: 'no-verification-needed' },
  { resourceType: 'aws_ecs_task_definition', category: 'no-verification-needed' },

  // GCP - Networking
  { resourceType: 'google_compute_network', category: 'no-verification-needed' },
  { resourceType: 'google_compute_subnetwork', category: 'no-verification-needed' },
  { resourceType: 'google_compute_firewall', category: 'no-verification-needed' },
  { resourceType: 'google_compute_router', category: 'no-verification-needed' },
  { resourceType: 'google_compute_address', category: 'no-verification-needed' },
  { resourceType: 'google_compute_global_address', category: 'no-verification-needed' },
  { resourceType: 'google_dns_managed_zone', category: 'no-verification-needed' },
  { resourceType: 'google_dns_record_set', category: 'no-verification-needed' },

  // GCP - IAM
  { resourceType: 'google_project_iam_member', category: 'no-verification-needed' },
  { resourceType: 'google_project_iam_binding', category: 'no-verification-needed' },
  { resourceType: 'google_service_account', category: 'no-verification-needed' },
  { resourceType: 'google_service_account_key', category: 'no-verification-needed' },

  // GCP - Serverless/Config
  { resourceType: 'google_cloudfunctions_function', category: 'no-verification-needed' },
  { resourceType: 'google_cloudfunctions2_function', category: 'no-verification-needed' },
  { resourceType: 'google_cloud_run_service', category: 'no-verification-needed' },
  { resourceType: 'google_cloud_run_v2_service', category: 'no-verification-needed' },
  { resourceType: 'google_logging_metric', category: 'no-verification-needed' },
  { resourceType: 'google_monitoring_alert_policy', category: 'no-verification-needed' },
  { resourceType: 'google_compute_url_map', category: 'no-verification-needed' },
  { resourceType: 'google_compute_backend_service', category: 'no-verification-needed' },

  // GCP - Container Orchestration
  { resourceType: 'google_container_cluster', category: 'no-verification-needed' },
  { resourceType: 'google_container_node_pool', category: 'no-verification-needed' },

  // Azure - Networking
  { resourceType: 'azurerm_virtual_network', category: 'no-verification-needed' },
  { resourceType: 'azurerm_subnet', category: 'no-verification-needed' },
  { resourceType: 'azurerm_network_security_group', category: 'no-verification-needed' },
  { resourceType: 'azurerm_network_interface', category: 'no-verification-needed' },
  { resourceType: 'azurerm_public_ip', category: 'no-verification-needed' },
  { resourceType: 'azurerm_route_table', category: 'no-verification-needed' },
  { resourceType: 'azurerm_dns_zone', category: 'no-verification-needed' },
  { resourceType: 'azurerm_private_dns_zone', category: 'no-verification-needed' },
  { resourceType: 'azurerm_application_gateway', category: 'no-verification-needed' },
  { resourceType: 'azurerm_lb', category: 'no-verification-needed' },

  // Azure - IAM
  { resourceType: 'azurerm_role_assignment', category: 'no-verification-needed' },
  { resourceType: 'azurerm_role_definition', category: 'no-verification-needed' },
  { resourceType: 'azurerm_user_assigned_identity', category: 'no-verification-needed' },

  // Azure - Serverless/Config
  { resourceType: 'azurerm_function_app', category: 'no-verification-needed' },
  { resourceType: 'azurerm_linux_function_app', category: 'no-verification-needed' },
  { resourceType: 'azurerm_windows_function_app', category: 'no-verification-needed' },
  { resourceType: 'azurerm_app_service', category: 'no-verification-needed' },
  { resourceType: 'azurerm_linux_web_app', category: 'no-verification-needed' },
  { resourceType: 'azurerm_api_management', category: 'no-verification-needed' },
  { resourceType: 'azurerm_monitor_metric_alert', category: 'no-verification-needed' },
  { resourceType: 'azurerm_log_analytics_workspace', category: 'no-verification-needed' },
  { resourceType: 'azurerm_cdn_profile', category: 'no-verification-needed' },
  { resourceType: 'azurerm_cdn_endpoint', category: 'no-verification-needed' },

  // Azure - Container Orchestration
  { resourceType: 'azurerm_kubernetes_cluster', category: 'no-verification-needed' },
  { resourceType: 'azurerm_kubernetes_cluster_node_pool', category: 'no-verification-needed' },
  { resourceType: 'azurerm_container_group', category: 'no-verification-needed' },

  // OCI - Networking
  { resourceType: 'oci_core_vcn', category: 'no-verification-needed' },
  { resourceType: 'oci_core_subnet', category: 'no-verification-needed' },
  { resourceType: 'oci_core_security_list', category: 'no-verification-needed' },
  { resourceType: 'oci_core_network_security_group', category: 'no-verification-needed' },
  { resourceType: 'oci_core_route_table', category: 'no-verification-needed' },
  { resourceType: 'oci_core_internet_gateway', category: 'no-verification-needed' },
  { resourceType: 'oci_core_nat_gateway', category: 'no-verification-needed' },
  { resourceType: 'oci_dns_zone', category: 'no-verification-needed' },
  { resourceType: 'oci_load_balancer_load_balancer', category: 'no-verification-needed' },

  // OCI - IAM
  { resourceType: 'oci_identity_policy', category: 'no-verification-needed' },
  { resourceType: 'oci_identity_user', category: 'no-verification-needed' },
  { resourceType: 'oci_identity_group', category: 'no-verification-needed' },
  { resourceType: 'oci_identity_compartment', category: 'no-verification-needed' },
  { resourceType: 'oci_identity_dynamic_group', category: 'no-verification-needed' },

  // OCI - Serverless/Config
  { resourceType: 'oci_functions_function', category: 'no-verification-needed' },
  { resourceType: 'oci_functions_application', category: 'no-verification-needed' },
  { resourceType: 'oci_apigateway_gateway', category: 'no-verification-needed' },
  { resourceType: 'oci_apigateway_deployment', category: 'no-verification-needed' },
  { resourceType: 'oci_logging_log', category: 'no-verification-needed' },
  { resourceType: 'oci_monitoring_alarm', category: 'no-verification-needed' },

  // OCI - Container Orchestration
  { resourceType: 'oci_containerengine_cluster', category: 'no-verification-needed' },
  { resourceType: 'oci_containerengine_node_pool', category: 'no-verification-needed' },

  // ============================================
  // CONFIG RESOURCES - IAM members, policies, rules
  // These look like their parent but don't hold data
  // The suffix tokens (_policy, _configuration, _node, etc.) demote to config
  // ============================================

  // Database config (demoted from database-with-snapshots)
  { resourceType: 'aws_db_proxy', category: 'no-verification-needed' },
  { resourceType: 'aws_db_subnet_group', category: 'no-verification-needed' },
  { resourceType: 'aws_db_parameter_group', category: 'no-verification-needed' },
  { resourceType: 'aws_db_option_group', category: 'no-verification-needed' },
  { resourceType: 'aws_rds_cluster_parameter_group', category: 'no-verification-needed' },
  { resourceType: 'aws_neptune_subnet_group', category: 'no-verification-needed' },
  { resourceType: 'aws_neptune_parameter_group', category: 'no-verification-needed' },
  { resourceType: 'aws_docdb_subnet_group', category: 'no-verification-needed' },
  { resourceType: 'aws_docdb_cluster_parameter_group', category: 'no-verification-needed' },
  { resourceType: 'aws_redshift_parameter_group', category: 'no-verification-needed' },
  { resourceType: 'aws_redshift_subnet_group', category: 'no-verification-needed' },
  { resourceType: 'google_sql_user', category: 'no-verification-needed' },
  { resourceType: 'google_sql_database_instance_iam_member', category: 'no-verification-needed' },
  { resourceType: 'google_spanner_instance_iam_member', category: 'no-verification-needed' },
  { resourceType: 'google_spanner_database_iam_member', category: 'no-verification-needed' },
  { resourceType: 'azurerm_postgresql_configuration', category: 'no-verification-needed' },
  { resourceType: 'azurerm_postgresql_firewall_rule', category: 'no-verification-needed' },
  { resourceType: 'azurerm_mysql_configuration', category: 'no-verification-needed' },
  { resourceType: 'azurerm_mysql_firewall_rule', category: 'no-verification-needed' },
  { resourceType: 'azurerm_mssql_firewall_rule', category: 'no-verification-needed' },

  // NoSQL config (demoted from nosql-database)
  { resourceType: 'google_bigtable_instance_iam_member', category: 'no-verification-needed' },
  { resourceType: 'google_bigtable_gc_policy', category: 'no-verification-needed' },
  { resourceType: 'google_firestore_field', category: 'no-verification-needed' },
  { resourceType: 'azurerm_cosmosdb_sql_role_assignment', category: 'no-verification-needed' },
  { resourceType: 'azurerm_cosmosdb_sql_role_definition', category: 'no-verification-needed' },
  { resourceType: 'aws_dynamodb_table_replica', category: 'no-verification-needed' },
  { resourceType: 'aws_dynamodb_contributor_insights', category: 'no-verification-needed' },

  // Block storage config (demoted from block-storage)
  { resourceType: 'aws_ebs_encryption_by_default', category: 'no-verification-needed' },
  { resourceType: 'aws_ebs_default_kms_key', category: 'no-verification-needed' },
  { resourceType: 'google_compute_disk_iam_member', category: 'no-verification-needed' },
  { resourceType: 'google_compute_disk_resource_policy_attachment', category: 'no-verification-needed' },
  { resourceType: 'azurerm_disk_pool', category: 'no-verification-needed' },

  // File storage config (demoted from file-storage)
  // Note: aws_efs_backup_policy and aws_fsx_data_repository_association are in held-out test
  { resourceType: 'aws_efs_file_system_policy', category: 'no-verification-needed' },
  { resourceType: 'aws_efs_replication_configuration', category: 'no-verification-needed' },
  { resourceType: 'aws_fsx_ontap_storage_virtual_machine', category: 'no-verification-needed' },
  { resourceType: 'google_filestore_instance_iam_member', category: 'no-verification-needed' },
  { resourceType: 'azurerm_netapp_snapshot_policy', category: 'no-verification-needed' },

  // Object storage config (demoted from object-storage)
  // Note: oci_objectstorage_preauthrequest and azurerm_storage_management_policy are in held-out test
  { resourceType: 'aws_s3_bucket_policy', category: 'no-verification-needed' },
  { resourceType: 'aws_s3_bucket_acl', category: 'no-verification-needed' },
  { resourceType: 'aws_s3_bucket_cors_configuration', category: 'no-verification-needed' },
  { resourceType: 'aws_s3_bucket_logging', category: 'no-verification-needed' },
  { resourceType: 'google_storage_bucket_iam_member', category: 'no-verification-needed' },
  { resourceType: 'google_storage_bucket_access_control', category: 'no-verification-needed' },
  { resourceType: 'azurerm_storage_account_network_rules', category: 'no-verification-needed' },
  { resourceType: 'azurerm_storage_blob_inventory_policy', category: 'no-verification-needed' },
  { resourceType: 'oci_objectstorage_object_lifecycle_policy', category: 'no-verification-needed' },
  { resourceType: 'oci_objectstorage_replication_policy', category: 'no-verification-needed' },

  // Cache config (demoted from cache-cluster)
  // Note: google_redis_cluster_node is in held-out test
  { resourceType: 'aws_elasticache_subnet_group', category: 'no-verification-needed' },
  { resourceType: 'aws_elasticache_parameter_group', category: 'no-verification-needed' },
  { resourceType: 'aws_elasticache_security_group', category: 'no-verification-needed' },
  { resourceType: 'aws_dax_parameter_group', category: 'no-verification-needed' },
  { resourceType: 'aws_dax_subnet_group', category: 'no-verification-needed' },
  { resourceType: 'google_redis_instance_iam_member', category: 'no-verification-needed' },
  { resourceType: 'google_memcache_instance_iam_member', category: 'no-verification-needed' },
  { resourceType: 'azurerm_redis_firewall_rule', category: 'no-verification-needed' },

  // Streaming config (demoted from streaming-data)
  // Note: aws_msk_configuration is in held-out test
  { resourceType: 'aws_kinesis_resource_policy', category: 'no-verification-needed' },
  { resourceType: 'aws_msk_scram_secret_association', category: 'no-verification-needed' },
  { resourceType: 'aws_msk_vpc_connection', category: 'no-verification-needed' },
  { resourceType: 'google_pubsub_topic_iam_member', category: 'no-verification-needed' },
  { resourceType: 'google_pubsub_subscription_iam_member', category: 'no-verification-needed' },
  { resourceType: 'azurerm_eventhub_authorization_rule', category: 'no-verification-needed' },
  { resourceType: 'azurerm_eventhub_namespace_schema_group', category: 'no-verification-needed' },

  // Message queue config (demoted from message-queue)
  { resourceType: 'aws_sqs_queue_policy', category: 'no-verification-needed' },
  { resourceType: 'aws_sns_topic_policy', category: 'no-verification-needed' },
  { resourceType: 'google_cloud_tasks_queue_iam_member', category: 'no-verification-needed' },
  { resourceType: 'azurerm_servicebus_namespace_authorization_rule', category: 'no-verification-needed' },
  { resourceType: 'azurerm_servicebus_queue_authorization_rule', category: 'no-verification-needed' },

  // Container registry config (demoted from container-registry)
  { resourceType: 'aws_ecr_repository_policy', category: 'no-verification-needed' },
  { resourceType: 'aws_ecr_lifecycle_policy', category: 'no-verification-needed' },
  { resourceType: 'google_artifact_registry_repository_iam_member', category: 'no-verification-needed' },
  { resourceType: 'azurerm_container_registry_webhook', category: 'no-verification-needed' },

  // Secrets config (demoted from secrets-and-keys)
  { resourceType: 'aws_secretsmanager_secret_policy', category: 'no-verification-needed' },
  { resourceType: 'aws_secretsmanager_secret_rotation', category: 'no-verification-needed' },
  { resourceType: 'aws_kms_grant', category: 'no-verification-needed' },
  { resourceType: 'google_secret_manager_secret_iam_member', category: 'no-verification-needed' },
  { resourceType: 'google_kms_key_ring_iam_member', category: 'no-verification-needed' },
  { resourceType: 'google_kms_crypto_key_iam_member', category: 'no-verification-needed' },
  { resourceType: 'azurerm_key_vault_access_policy', category: 'no-verification-needed' },

  // ============================================
  // ALIBABA CLOUD
  // ============================================
  { resourceType: 'alicloud_db_instance', category: 'database-with-snapshots' },
  { resourceType: 'alicloud_db_database', category: 'database-with-snapshots' },
  { resourceType: 'alicloud_polardb_cluster', category: 'database-with-snapshots' },
  { resourceType: 'alicloud_mongodb_instance', category: 'nosql-database' },
  { resourceType: 'alicloud_kvstore_instance', category: 'cache-cluster' },
  { resourceType: 'alicloud_disk', category: 'block-storage' },
  { resourceType: 'alicloud_snapshot', category: 'block-storage' },
  { resourceType: 'alicloud_nas_file_system', category: 'file-storage' },
  { resourceType: 'alicloud_oss_bucket', category: 'object-storage' },
  { resourceType: 'alicloud_oss_bucket_object', category: 'object-storage' },
  { resourceType: 'alicloud_alikafka_instance', category: 'streaming-data' },
  { resourceType: 'alicloud_mns_queue', category: 'message-queue' },
  { resourceType: 'alicloud_cr_namespace', category: 'container-registry' },
  { resourceType: 'alicloud_cr_repo', category: 'container-registry' },
  { resourceType: 'alicloud_kms_key', category: 'secrets-and-keys' },
  { resourceType: 'alicloud_kms_secret', category: 'secrets-and-keys' },
  { resourceType: 'alicloud_instance', category: 'stateful-compute' },
  { resourceType: 'alicloud_emr_cluster', category: 'stateful-compute' },
  { resourceType: 'alicloud_vpc', category: 'no-verification-needed' },
  { resourceType: 'alicloud_vswitch', category: 'no-verification-needed' },
  { resourceType: 'alicloud_security_group', category: 'no-verification-needed' },
  { resourceType: 'alicloud_cs_kubernetes', category: 'no-verification-needed' },
  { resourceType: 'alicloud_fc_function', category: 'no-verification-needed' },
  { resourceType: 'alicloud_ram_role', category: 'no-verification-needed' },
  { resourceType: 'alicloud_ram_policy', category: 'no-verification-needed' },

  // ============================================
  // DIGITALOCEAN
  // ============================================
  { resourceType: 'digitalocean_database_cluster', category: 'database-with-snapshots' },
  { resourceType: 'digitalocean_database_db', category: 'database-with-snapshots' },
  { resourceType: 'digitalocean_database_replica', category: 'database-with-snapshots' },
  { resourceType: 'digitalocean_database_redis_config', category: 'cache-cluster' },
  { resourceType: 'digitalocean_volume', category: 'block-storage' },
  { resourceType: 'digitalocean_volume_snapshot', category: 'block-storage' },
  { resourceType: 'digitalocean_spaces_bucket', category: 'object-storage' },
  { resourceType: 'digitalocean_spaces_bucket_object', category: 'object-storage' },
  { resourceType: 'digitalocean_container_registry', category: 'container-registry' },
  { resourceType: 'digitalocean_droplet', category: 'stateful-compute' },
  { resourceType: 'digitalocean_droplet_snapshot', category: 'stateful-compute' },
  { resourceType: 'digitalocean_vpc', category: 'no-verification-needed' },
  { resourceType: 'digitalocean_firewall', category: 'no-verification-needed' },
  { resourceType: 'digitalocean_loadbalancer', category: 'no-verification-needed' },
  { resourceType: 'digitalocean_kubernetes_cluster', category: 'no-verification-needed' },
  { resourceType: 'digitalocean_app', category: 'no-verification-needed' },

  // ============================================
  // LINODE
  // ============================================
  { resourceType: 'linode_database_mysql', category: 'database-with-snapshots' },
  { resourceType: 'linode_database_postgresql', category: 'database-with-snapshots' },
  { resourceType: 'linode_volume', category: 'block-storage' },
  { resourceType: 'linode_object_storage_bucket', category: 'object-storage' },
  { resourceType: 'linode_object_storage_object', category: 'object-storage' },
  { resourceType: 'linode_instance', category: 'stateful-compute' },
  { resourceType: 'linode_image', category: 'block-storage' },
  { resourceType: 'linode_vpc', category: 'no-verification-needed' },
  { resourceType: 'linode_firewall', category: 'no-verification-needed' },
  { resourceType: 'linode_nodebalancer', category: 'no-verification-needed' },
  { resourceType: 'linode_lke_cluster', category: 'no-verification-needed' },

  // ============================================
  // VULTR
  // ============================================
  { resourceType: 'vultr_database', category: 'database-with-snapshots' },
  { resourceType: 'vultr_block_storage', category: 'block-storage' },
  { resourceType: 'vultr_object_storage', category: 'object-storage' },
  { resourceType: 'vultr_instance', category: 'stateful-compute' },
  { resourceType: 'vultr_bare_metal_server', category: 'stateful-compute' },
  { resourceType: 'vultr_snapshot', category: 'block-storage' },
  { resourceType: 'vultr_vpc', category: 'no-verification-needed' },
  { resourceType: 'vultr_firewall_group', category: 'no-verification-needed' },
  { resourceType: 'vultr_load_balancer', category: 'no-verification-needed' },
  { resourceType: 'vultr_kubernetes', category: 'no-verification-needed' },

  // ============================================
  // HETZNER
  // ============================================
  { resourceType: 'hcloud_server', category: 'stateful-compute' },
  { resourceType: 'hcloud_volume', category: 'block-storage' },
  { resourceType: 'hcloud_snapshot', category: 'block-storage' },
  { resourceType: 'hcloud_network', category: 'no-verification-needed' },
  { resourceType: 'hcloud_firewall', category: 'no-verification-needed' },
  { resourceType: 'hcloud_load_balancer', category: 'no-verification-needed' },

  // ============================================
  // SCALEWAY
  // ============================================
  { resourceType: 'scaleway_instance_server', category: 'stateful-compute' },
  { resourceType: 'scaleway_rdb_instance', category: 'database-with-snapshots' },
  { resourceType: 'scaleway_rdb_database', category: 'database-with-snapshots' },
  { resourceType: 'scaleway_object_bucket', category: 'object-storage' },
  { resourceType: 'scaleway_instance_volume', category: 'block-storage' },
  { resourceType: 'scaleway_instance_snapshot', category: 'block-storage' },
  { resourceType: 'scaleway_redis_cluster', category: 'cache-cluster' },
  { resourceType: 'scaleway_vpc', category: 'no-verification-needed' },
  { resourceType: 'scaleway_k8s_cluster', category: 'no-verification-needed' },
  { resourceType: 'scaleway_function', category: 'no-verification-needed' },

  // ============================================
  // UPCLOUD
  // ============================================
  { resourceType: 'upcloud_server', category: 'stateful-compute' },
  { resourceType: 'upcloud_managed_database_mysql', category: 'database-with-snapshots' },
  { resourceType: 'upcloud_managed_database_postgresql', category: 'database-with-snapshots' },
  { resourceType: 'upcloud_managed_database_redis', category: 'cache-cluster' },
  { resourceType: 'upcloud_storage', category: 'block-storage' },
  { resourceType: 'upcloud_object_storage', category: 'object-storage' },
  { resourceType: 'upcloud_network', category: 'no-verification-needed' },
  { resourceType: 'upcloud_firewall_rules', category: 'no-verification-needed' },
  { resourceType: 'upcloud_loadbalancer', category: 'no-verification-needed' },
  { resourceType: 'upcloud_kubernetes_cluster', category: 'no-verification-needed' },

  // ============================================
  // EXOSCALE
  // ============================================
  { resourceType: 'exoscale_compute_instance', category: 'stateful-compute' },
  { resourceType: 'exoscale_database', category: 'database-with-snapshots' },
  { resourceType: 'exoscale_block_storage_volume', category: 'block-storage' },
  { resourceType: 'exoscale_sos_bucket', category: 'object-storage' },
  { resourceType: 'exoscale_sks_cluster', category: 'no-verification-needed' },
  { resourceType: 'exoscale_nlb', category: 'no-verification-needed' },
  { resourceType: 'exoscale_security_group', category: 'no-verification-needed' },
];

/**
 * Get category distribution for validation
 */
export function getCategoryDistribution(): Record<VerificationCategory, number> {
  const distribution: Record<string, number> = {};
  for (const example of TRAINING_DATA) {
    distribution[example.category] = (distribution[example.category] || 0) + 1;
  }
  return distribution as Record<VerificationCategory, number>;
}

/**
 * Split data into train/test sets
 */
export function splitTrainTest(
  data: TrainingExample[],
  testRatio: number = 0.2
): { train: TrainingExample[]; test: TrainingExample[] } {
  const shuffled = [...data].sort(() => Math.random() - 0.5);
  const testSize = Math.floor(shuffled.length * testRatio);
  return {
    test: shuffled.slice(0, testSize),
    train: shuffled.slice(testSize),
  };
}
