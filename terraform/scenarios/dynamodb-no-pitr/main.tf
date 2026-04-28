# DynamoDB table without point-in-time recovery
# Deletion means all data is gone forever

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

# Table WITHOUT protection - dangerous
resource "aws_dynamodb_table" "unprotected" {
  name           = "recourse-test-unprotected"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "id"

  attribute {
    name = "id"
    type = "S"
  }

  # No PITR
  point_in_time_recovery {
    enabled = false
  }

  # No deletion protection
  deletion_protection_enabled = false

  tags = {
    Environment = "test"
    Purpose     = "recourse-testing"
  }
}

# Table WITH protection for comparison
resource "aws_dynamodb_table" "protected" {
  name           = "recourse-test-protected"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "id"

  attribute {
    name = "id"
    type = "S"
  }

  # PITR enabled
  point_in_time_recovery {
    enabled = true
  }

  # Deletion protection enabled
  deletion_protection_enabled = true

  tags = {
    Environment = "test"
    Purpose     = "recourse-testing"
  }
}
