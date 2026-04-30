# Resource Coverage

Total deterministic resource types: 175

Known resource handlers are authoritative. Unknown resource types can still be evaluated with `--classifier`, which uses provider-neutral semantic safety signals and returns `needs-review` when evidence is weak.

```bash
recourse resources
recourse plan plan.json --classifier
recourse evaluate terraform plan.json --classifier
```

## AWS

Supported deterministic types: 97

### Databases

- `aws_db_cluster_snapshot`
- `aws_db_instance`
- `aws_db_snapshot`
- `aws_dynamodb_global_table`
- `aws_dynamodb_table`
- `aws_dynamodb_table_item`
- `aws_elasticache_cluster`
- `aws_elasticache_global_replication_group`
- `aws_elasticache_parameter_group`
- `aws_elasticache_replication_group`
- `aws_elasticache_serverless_cache`
- `aws_elasticache_snapshot`
- `aws_elasticache_subnet_group`
- `aws_elasticache_user`
- `aws_elasticache_user_group`
- `aws_elasticache_user_group_association`
- `aws_neptune_cluster`
- `aws_neptune_cluster_instance`
- `aws_neptune_cluster_parameter_group`
- `aws_neptune_cluster_snapshot`
- `aws_neptune_event_subscription`
- `aws_neptune_parameter_group`
- `aws_neptune_subnet_group`
- `aws_rds_cluster`
- `aws_rds_cluster_instance`

### Storage and Backups

- `aws_ami`
- `aws_ami_copy`
- `aws_ebs_snapshot`
- `aws_ebs_snapshot_copy`
- `aws_ebs_volume`
- `aws_efs_access_point`
- `aws_efs_backup_policy`
- `aws_efs_file_system`
- `aws_efs_file_system_policy`
- `aws_efs_mount_target`
- `aws_efs_replication_configuration`
- `aws_s3_bucket`
- `aws_s3_bucket_versioning`
- `aws_s3_object`

### Compute

- `aws_iam_instance_profile`
- `aws_instance`
- `aws_lambda_alias`
- `aws_lambda_event_source_mapping`
- `aws_lambda_function`
- `aws_lambda_layer_version`
- `aws_lambda_permission`
- `aws_spot_instance_request`

### Networking

- `aws_alb`
- `aws_eip`
- `aws_elb`
- `aws_internet_gateway`
- `aws_lb`
- `aws_lb_listener`
- `aws_lb_listener_rule`
- `aws_lb_target_group`
- `aws_lb_target_group_attachment`
- `aws_nat_gateway`
- `aws_route53_health_check`
- `aws_route53_record`
- `aws_route53_zone`
- `aws_security_group`
- `aws_security_group_rule`
- `aws_subnet`
- `aws_vpc`
- `aws_vpc_security_group_egress_rule`
- `aws_vpc_security_group_ingress_rule`

### Identity and Security

- `aws_iam_group`
- `aws_iam_policy`
- `aws_iam_role`
- `aws_iam_role_policy`
- `aws_iam_role_policy_attachment`
- `aws_iam_user`
- `aws_iam_user_policy`
- `aws_iam_user_policy_attachment`
- `aws_kms_alias`
- `aws_kms_grant`
- `aws_kms_key`
- `aws_secretsmanager_secret`
- `aws_secretsmanager_secret_policy`
- `aws_secretsmanager_secret_rotation`
- `aws_secretsmanager_secret_version`

### Messaging and Observability

- `aws_cloudwatch_dashboard`
- `aws_cloudwatch_log_group`
- `aws_cloudwatch_log_stream`
- `aws_cloudwatch_metric_alarm`
- `aws_sns_topic`
- `aws_sns_topic_policy`
- `aws_sns_topic_subscription`
- `aws_sqs_queue`
- `aws_sqs_queue_policy`

### Other

- `aws_launch_template`
- `aws_network_acl`
- `aws_network_acl_rule`
- `aws_route`
- `aws_route_table`
- `aws_route_table_association`
- `aws_volume_attachment`

## GCP

Supported deterministic types: 38

### Storage

- `google_storage_bucket`
- `google_storage_bucket_iam_binding`
- `google_storage_bucket_iam_member`
- `google_storage_bucket_iam_policy`
- `google_storage_bucket_object`

### Databases

- `google_bigquery_dataset`
- `google_bigquery_dataset_iam_binding`
- `google_bigquery_dataset_iam_member`
- `google_bigquery_dataset_iam_policy`
- `google_bigquery_routine`
- `google_bigquery_table`
- `google_bigquery_table_iam_binding`
- `google_bigquery_table_iam_member`
- `google_bigquery_table_iam_policy`
- `google_sql_database`
- `google_sql_database_instance`
- `google_sql_user`

### Identity and Access

- `google_kms_crypto_key_iam_binding`
- `google_kms_crypto_key_iam_member`
- `google_project_iam_binding`
- `google_project_iam_member`
- `google_project_iam_policy`
- `google_secret_manager_secret`
- `google_secret_manager_secret_iam_binding`
- `google_secret_manager_secret_iam_member`
- `google_secret_manager_secret_iam_policy`
- `google_secret_manager_secret_version`
- `google_service_account`
- `google_service_account_iam_binding`
- `google_service_account_iam_member`
- `google_service_account_key`

### Core Infrastructure

- `google_compute_disk`
- `google_compute_snapshot`
- `google_container_cluster`
- `google_container_node_pool`
- `google_dns_record_set`
- `google_kms_crypto_key`
- `google_kms_key_ring`

## Azure

Supported deterministic types: 37

### Storage

- `azurerm_storage_account`
- `azurerm_storage_blob`
- `azurerm_storage_container`
- `azurerm_storage_queue`
- `azurerm_storage_share`
- `azurerm_storage_table`

### Databases

- `azurerm_cosmosdb_account`
- `azurerm_cosmosdb_cassandra_keyspace`
- `azurerm_cosmosdb_cassandra_table`
- `azurerm_cosmosdb_gremlin_database`
- `azurerm_cosmosdb_gremlin_graph`
- `azurerm_cosmosdb_mongo_collection`
- `azurerm_cosmosdb_mongo_database`
- `azurerm_cosmosdb_sql_container`
- `azurerm_cosmosdb_sql_database`
- `azurerm_cosmosdb_sql_role_assignment`
- `azurerm_cosmosdb_sql_role_definition`
- `azurerm_cosmosdb_table`
- `azurerm_mariadb_server`
- `azurerm_mssql_database`
- `azurerm_mysql_flexible_server`
- `azurerm_postgresql_flexible_server`
- `azurerm_sql_database`

### Identity and Access

- `azurerm_role_assignment`
- `azurerm_role_definition`

### Core Infrastructure

- `azurerm_dns_a_record`
- `azurerm_dns_cname_record`
- `azurerm_key_vault`
- `azurerm_key_vault_access_policy`
- `azurerm_key_vault_certificate`
- `azurerm_key_vault_key`
- `azurerm_key_vault_secret`
- `azurerm_kubernetes_cluster`
- `azurerm_kubernetes_cluster_node_pool`
- `azurerm_managed_disk`
- `azurerm_private_dns_a_record`
- `azurerm_snapshot`

## Azure AD

Supported deterministic types: 3

### Identity and Credentials

- `azuread_application`
- `azuread_service_principal`
- `azuread_service_principal_password`

## Coverage Notes

- Deterministic rules classify known resource types by explicit safety signals such as deletion protection, versioning, soft delete, snapshots, backup retention, PITR, and credential material.
- `--classifier` is for unknown or long-tail resources; it builds a provider-neutral semantic profile and does not override deterministic handlers.
- Low-evidence destructive changes should resolve to `needs-review` rather than being treated as safe.
- Live cloud state is only available where explicit evidence commands exist; out-of-band backups must be supplied as evidence before Recourse can rely on them.
