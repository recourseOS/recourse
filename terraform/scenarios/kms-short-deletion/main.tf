# KMS keys with short deletion windows
# Deleting a KMS key makes all data encrypted with it permanently inaccessible

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

# KMS key with minimum deletion window - dangerous
resource "aws_kms_key" "short_window" {
  description             = "Recourse test key - short deletion window"
  deletion_window_in_days = 7  # Minimum allowed
  enable_key_rotation     = false

  tags = {
    Environment = "test"
    Purpose     = "recourse-testing"
  }
}

resource "aws_kms_alias" "short_window" {
  name          = "alias/recourse-test-short"
  target_key_id = aws_kms_key.short_window.key_id
}

# KMS key with long deletion window - safer
resource "aws_kms_key" "long_window" {
  description             = "Recourse test key - long deletion window"
  deletion_window_in_days = 30  # Maximum allowed
  enable_key_rotation     = true

  tags = {
    Environment = "test"
    Purpose     = "recourse-testing"
  }
}

resource "aws_kms_alias" "long_window" {
  name          = "alias/recourse-test-long"
  target_key_id = aws_kms_key.long_window.key_id
}

# S3 bucket encrypted with the short-window key
# If the key is deleted, this data becomes unreadable
resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "encrypted" {
  bucket = "recourse-test-encrypted-${random_id.bucket_suffix.hex}"

  tags = {
    Environment = "test"
    Purpose     = "recourse-testing"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "encrypted" {
  bucket = aws_s3_bucket.encrypted.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.short_window.arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_object" "encrypted_data" {
  bucket  = aws_s3_bucket.encrypted.id
  key     = "sensitive/secrets.json"
  content = jsonencode({
    api_keys = ["fake-key-1", "fake-key-2"]
  })

  # This object becomes permanently inaccessible if the KMS key is deleted
}

# RDS instance encrypted with the short-window key
resource "aws_db_instance" "encrypted" {
  identifier     = "recourse-test-encrypted"
  engine         = "postgres"
  engine_version = "15.4"
  instance_class = "db.t3.micro"

  allocated_storage = 20
  storage_type      = "gp2"
  storage_encrypted = true
  kms_key_id        = aws_kms_key.short_window.arn

  db_name  = "testdb"
  username = "testuser"
  password = "testpassword123!"

  skip_final_snapshot = true

  tags = {
    Environment = "test"
    Purpose     = "recourse-testing"
  }
}
