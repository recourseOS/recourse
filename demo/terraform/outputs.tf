# WidgetCo Demo - Outputs

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "production_db_endpoint" {
  description = "Production database endpoint (DANGEROUS)"
  value       = aws_db_instance.production.endpoint
}

output "protected_db_endpoint" {
  description = "Protected database endpoint (SAFE)"
  value       = aws_db_instance.protected.endpoint
}

output "uploads_bucket" {
  description = "Uploads bucket name (DANGEROUS - no versioning)"
  value       = aws_s3_bucket.uploads.id
}

output "audit_logs_bucket" {
  description = "Audit logs bucket name (SAFE - versioned)"
  value       = aws_s3_bucket.audit_logs.id
}

output "sessions_table" {
  description = "DynamoDB sessions table (DANGEROUS - no PITR)"
  value       = aws_dynamodb_table.sessions.name
}

output "app_role_arn" {
  description = "IAM app role ARN (used by Lambda and EC2)"
  value       = aws_iam_role.app_role.arn
}

output "kms_key_id" {
  description = "KMS key ID (encrypts everything)"
  value       = aws_kms_key.app_key.key_id
}

output "lambda_functions" {
  description = "Lambda function names"
  value = [
    aws_lambda_function.api_handler.function_name,
    aws_lambda_function.background_worker.function_name,
    aws_lambda_function.event_processor.function_name,
  ]
}

output "ec2_instances" {
  description = "EC2 instance IDs"
  value = [
    aws_instance.web_server_1.id,
    aws_instance.web_server_2.id,
  ]
}

output "danger_summary" {
  description = "Summary of dangerous resources for demo"
  value = {
    rds_unprotected = {
      id                  = aws_db_instance.production.identifier
      deletion_protection = aws_db_instance.production.deletion_protection
      skip_final_snapshot = aws_db_instance.production.skip_final_snapshot
      backup_retention    = aws_db_instance.production.backup_retention_period
    }
    s3_no_versioning = {
      bucket = aws_s3_bucket.uploads.id
    }
    dynamodb_no_pitr = {
      table = aws_dynamodb_table.sessions.name
    }
    iam_role_dependencies = {
      role      = aws_iam_role.app_role.name
      lambdas   = 3
      ec2       = 2
    }
  }
}
