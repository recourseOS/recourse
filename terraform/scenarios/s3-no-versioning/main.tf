# S3 bucket without versioning
# Deletion means all objects are gone forever

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

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

# Bucket WITHOUT versioning - dangerous
resource "aws_s3_bucket" "unversioned" {
  bucket = "recourse-test-unversioned-${random_id.bucket_suffix.hex}"

  tags = {
    Environment = "test"
    Purpose     = "recourse-testing"
  }
}

# Explicitly disable versioning
resource "aws_s3_bucket_versioning" "unversioned" {
  bucket = aws_s3_bucket.unversioned.id

  versioning_configuration {
    status = "Disabled"
  }
}

# Put some objects in it so deletion is meaningful
resource "aws_s3_object" "test_data_1" {
  bucket  = aws_s3_bucket.unversioned.id
  key     = "important-data/config.json"
  content = jsonencode({
    database_url = "postgres://prod:5432/main"
    api_key      = "sk-fake-key-for-testing"
  })
}

resource "aws_s3_object" "test_data_2" {
  bucket  = aws_s3_bucket.unversioned.id
  key     = "backups/2024-01-15.sql"
  content = "-- Fake SQL dump for testing"
}

# Bucket WITH versioning for comparison
resource "aws_s3_bucket" "versioned" {
  bucket = "recourse-test-versioned-${random_id.bucket_suffix.hex}"

  tags = {
    Environment = "test"
    Purpose     = "recourse-testing"
  }
}

resource "aws_s3_bucket_versioning" "versioned" {
  bucket = aws_s3_bucket.versioned.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_object" "versioned_data" {
  bucket  = aws_s3_bucket.versioned.id
  key     = "important-data/config.json"
  content = jsonencode({
    database_url = "postgres://prod:5432/main"
  })
}
