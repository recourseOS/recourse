# WidgetCo Demo Infrastructure
# A realistic 3-tier app with intentionally dangerous configurations
# for demonstrating RecourseOS consequence evaluation

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = var.tags
  }
}

locals {
  name_prefix = "${var.app_name}-${var.environment}"
}

# =============================================================================
# VPC - The Network Foundation
# =============================================================================

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${local.name_prefix}-vpc"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-igw"
  }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = {
    Name = "${local.name_prefix}-public-subnet"
    Tier = "public"
  }
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "${var.aws_region}a"

  tags = {
    Name = "${local.name_prefix}-private-subnet-a"
    Tier = "private"
  }
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.3.0/24"
  availability_zone = "${var.aws_region}b"

  tags = {
    Name = "${local.name_prefix}-private-subnet-b"
    Tier = "private"
  }
}

resource "aws_eip" "nat" {
  domain = "vpc"

  tags = {
    Name = "${local.name_prefix}-nat-eip"
  }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public.id

  tags = {
    Name = "${local.name_prefix}-nat-gw"
  }

  depends_on = [aws_internet_gateway.main]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${local.name_prefix}-public-rt"
  }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }

  tags = {
    Name = "${local.name_prefix}-private-rt"
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private_a" {
  subnet_id      = aws_subnet.private_a.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "private_b" {
  subnet_id      = aws_subnet.private_b.id
  route_table_id = aws_route_table.private.id
}

# =============================================================================
# Security Groups
# =============================================================================

resource "aws_security_group" "web" {
  name        = "${local.name_prefix}-web-sg"
  description = "Security group for web tier"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-web-sg"
  }
}

resource "aws_security_group" "database" {
  name        = "${local.name_prefix}-db-sg"
  description = "Security group for database tier"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.web.id, aws_security_group.lambda.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-db-sg"
  }
}

resource "aws_security_group" "lambda" {
  name        = "${local.name_prefix}-lambda-sg"
  description = "Security group for Lambda functions"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-lambda-sg"
  }
}

# =============================================================================
# KMS Key - Encrypts Everything
# =============================================================================

resource "aws_kms_key" "app_key" {
  description             = "KMS key for ${local.name_prefix} encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = {
    Name = "${local.name_prefix}-kms-key"
  }
}

resource "aws_kms_alias" "app_key" {
  name          = "alias/${local.name_prefix}-key"
  target_key_id = aws_kms_key.app_key.key_id
}

# =============================================================================
# IAM Role - Used by Lambda and EC2
# =============================================================================

data "aws_iam_policy_document" "app_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com", "ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app_role" {
  name               = "${local.name_prefix}-app-role"
  assume_role_policy = data.aws_iam_policy_document.app_assume_role.json

  tags = {
    Name = "${local.name_prefix}-app-role"
  }
}

data "aws_iam_policy_document" "app_policy" {
  statement {
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.uploads.arn,
      "${aws_s3_bucket.uploads.arn}/*",
      aws_s3_bucket.audit_logs.arn,
      "${aws_s3_bucket.audit_logs.arn}/*",
    ]
  }

  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
    ]
    resources = [aws_dynamodb_table.sessions.arn]
  }

  statement {
    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey",
    ]
    resources = [aws_kms_key.app_key.arn]
  }

  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:*:*:*"]
  }

  statement {
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "app_policy" {
  name   = "${local.name_prefix}-app-policy"
  role   = aws_iam_role.app_role.id
  policy = data.aws_iam_policy_document.app_policy.json
}

resource "aws_iam_instance_profile" "app_profile" {
  name = "${local.name_prefix}-app-profile"
  role = aws_iam_role.app_role.name
}

# =============================================================================
# S3 Buckets
# =============================================================================

# DANGEROUS: No versioning, contains user data
resource "aws_s3_bucket" "uploads" {
  bucket        = "${local.name_prefix}-uploads-${data.aws_caller_identity.current.account_id}"
  force_destroy = true

  tags = {
    Name   = "${local.name_prefix}-uploads"
    DANGER = "no-versioning"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.app_key.arn
      sse_algorithm     = "aws:kms"
    }
  }
}

# SAFE: Versioning enabled (audit logs)
resource "aws_s3_bucket" "audit_logs" {
  bucket        = "${local.name_prefix}-audit-logs-${data.aws_caller_identity.current.account_id}"
  force_destroy = true

  tags = {
    Name = "${local.name_prefix}-audit-logs"
    SAFE = "versioning-enabled"
  }
}

resource "aws_s3_bucket_versioning" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.app_key.arn
      sse_algorithm     = "aws:kms"
    }
  }
}

# SAFE: Versioning enabled (backups)
resource "aws_s3_bucket" "backups" {
  bucket        = "${local.name_prefix}-backups-${data.aws_caller_identity.current.account_id}"
  force_destroy = true

  tags = {
    Name = "${local.name_prefix}-backups"
    SAFE = "versioning-enabled"
  }
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

# =============================================================================
# DynamoDB - Sessions Table
# =============================================================================

# DANGEROUS: No PITR, contains active sessions
resource "aws_dynamodb_table" "sessions" {
  name           = "${local.name_prefix}-sessions"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "session_id"

  attribute {
    name = "session_id"
    type = "S"
  }

  # DANGER: PITR is NOT enabled
  point_in_time_recovery {
    enabled = false
  }

  tags = {
    Name   = "${local.name_prefix}-sessions"
    DANGER = "no-pitr"
  }
}

# =============================================================================
# RDS - PostgreSQL Database
# =============================================================================

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db-subnet-group"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]

  tags = {
    Name = "${local.name_prefix}-db-subnet-group"
  }
}

# DANGEROUS: No protection, no backups, skip final snapshot
resource "aws_db_instance" "production" {
  identifier     = "${local.name_prefix}-production-db"
  engine         = "postgres"
  engine_version = "15.4"
  instance_class = "db.t3.micro"

  allocated_storage = 20
  storage_type      = "gp2"
  storage_encrypted = true
  kms_key_id        = aws_kms_key.app_key.arn

  db_name  = "widgetco"
  username = "widgetco_admin"
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]

  # DANGER: All protection disabled
  deletion_protection       = false
  skip_final_snapshot       = true
  backup_retention_period   = 0
  delete_automated_backups  = true

  tags = {
    Name   = "${local.name_prefix}-production-db"
    DANGER = "unprotected"
  }
}

# SAFE: Deletion protection enabled
resource "aws_db_instance" "protected" {
  identifier     = "${local.name_prefix}-protected-db"
  engine         = "postgres"
  engine_version = "15.4"
  instance_class = "db.t3.micro"

  allocated_storage = 20
  storage_type      = "gp2"
  storage_encrypted = true
  kms_key_id        = aws_kms_key.app_key.arn

  db_name  = "widgetco_replica"
  username = "widgetco_admin"
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]

  # SAFE: Protection enabled
  deletion_protection     = true
  skip_final_snapshot     = false
  backup_retention_period = 7

  tags = {
    Name = "${local.name_prefix}-protected-db"
    SAFE = "deletion-protection-enabled"
  }
}

# =============================================================================
# Lambda Functions
# =============================================================================

data "archive_file" "lambda_placeholder" {
  type        = "zip"
  output_path = "${path.module}/.terraform/lambda_placeholder.zip"

  source {
    content  = <<-EOF
      exports.handler = async (event) => {
        return { statusCode: 200, body: JSON.stringify({ message: 'WidgetCo API' }) };
      };
    EOF
    filename = "index.js"
  }
}

resource "aws_lambda_function" "api_handler" {
  function_name = "${local.name_prefix}-api-handler"
  role          = aws_iam_role.app_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"

  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      DB_HOST        = aws_db_instance.production.endpoint
      SESSIONS_TABLE = aws_dynamodb_table.sessions.name
      UPLOADS_BUCKET = aws_s3_bucket.uploads.id
    }
  }

  tags = {
    Name = "${local.name_prefix}-api-handler"
  }
}

resource "aws_lambda_function" "background_worker" {
  function_name = "${local.name_prefix}-background-worker"
  role          = aws_iam_role.app_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"

  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  tags = {
    Name = "${local.name_prefix}-background-worker"
  }
}

resource "aws_lambda_function" "event_processor" {
  function_name = "${local.name_prefix}-event-processor"
  role          = aws_iam_role.app_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"

  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256

  tags = {
    Name = "${local.name_prefix}-event-processor"
  }
}

# =============================================================================
# EC2 Instances
# =============================================================================

data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_instance" "web_server_1" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]
  iam_instance_profile   = aws_iam_instance_profile.app_profile.name

  tags = {
    Name = "${local.name_prefix}-web-server-1"
  }
}

resource "aws_instance" "web_server_2" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = "t3.micro"
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]
  iam_instance_profile   = aws_iam_instance_profile.app_profile.name

  tags = {
    Name = "${local.name_prefix}-web-server-2"
  }
}

# =============================================================================
# Data Sources
# =============================================================================

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
