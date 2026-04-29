# Resource Coverage

This document is generated from the public resource handler registry. Do not hand-edit the resource lists; run `npm run docs:coverage` after adding or removing handlers.

Total deterministic resource types: 119

Known resource handlers are authoritative. Unknown resource types can still be evaluated with `--classifier`, which uses provider-neutral semantic safety signals and returns `needs-review` when evidence is weak.

```bash
recourse resources
recourse plan plan.json --classifier
recourse evaluate terraform plan.json --classifier
```

## AWS

Supported deterministic types: 70

### Databases

- `aws_db_cluster_snapshot`
- `aws_db_instance`
- `aws_db_snapshot`
- `aws_dynamodb_global_table`
- `aws_dynamodb_table`
- `aws_dynamodb_table_item`
- `aws_rds_cluster`
- `aws_rds_cluster_instance`

### Storage and Backups

- `aws_ami`
- `aws_ami_copy`
- `aws_ebs_snapshot`
- `aws_ebs_snapshot_copy`
- `aws_ebs_volume`
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

Supported deterministic types: 24

### Storage

- `google_storage_bucket`
- `google_storage_bucket_iam_binding`
- `google_storage_bucket_iam_member`
- `google_storage_bucket_iam_policy`
- `google_storage_bucket_object`

### Databases

- `google_sql_database`
- `google_sql_database_instance`
- `google_sql_user`

### Identity and Access

- `google_kms_crypto_key_iam_binding`
- `google_kms_crypto_key_iam_member`
- `google_project_iam_binding`
- `google_project_iam_member`
- `google_project_iam_policy`
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

Supported deterministic types: 22

### Storage

- `azurerm_storage_account`
- `azurerm_storage_blob`
- `azurerm_storage_container`
- `azurerm_storage_queue`
- `azurerm_storage_share`
- `azurerm_storage_table`

### Databases

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
- `azurerm_key_vault_key`
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
