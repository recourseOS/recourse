# RDS instance with no safety nets
# This is the nightmare scenario: skip_final_snapshot + no backups + no deletion protection

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

resource "aws_db_instance" "main" {
  identifier     = "recourse-test-db"
  engine         = "postgres"
  engine_version = "15.4"
  instance_class = "db.t3.micro"

  allocated_storage = 20
  storage_type      = "gp2"

  db_name  = "testdb"
  username = "testuser"
  password = "testpassword123!"  # Obviously don't use this for real

  # THE DANGEROUS SETTINGS
  skip_final_snapshot     = true
  deletion_protection     = false
  backup_retention_period = 0

  # No multi-AZ, no read replicas, nothing
  multi_az = false

  tags = {
    Environment = "test"
    Purpose     = "recourse-testing"
  }
}

# A second instance WITH protection for comparison
resource "aws_db_instance" "protected" {
  identifier     = "recourse-test-db-protected"
  engine         = "postgres"
  engine_version = "15.4"
  instance_class = "db.t3.micro"

  allocated_storage = 20
  storage_type      = "gp2"

  db_name  = "testdb"
  username = "testuser"
  password = "testpassword123!"

  # THE SAFE SETTINGS
  skip_final_snapshot       = false
  final_snapshot_identifier = "recourse-test-final-snapshot"
  deletion_protection       = true
  backup_retention_period   = 7

  tags = {
    Environment = "test"
    Purpose     = "recourse-testing"
  }
}
