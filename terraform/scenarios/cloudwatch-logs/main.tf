# CloudWatch Log Groups
# Deletion destroys all logs permanently - no recovery

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

# Application logs - long retention, lots of value
resource "aws_cloudwatch_log_group" "application" {
  name              = "/recourse-test/application"
  retention_in_days = 365  # A year of logs

  tags = {
    Environment = "test"
    Purpose     = "recourse-testing"
  }
}

# Audit logs - compliance requirement
resource "aws_cloudwatch_log_group" "audit" {
  name              = "/recourse-test/audit"
  retention_in_days = 2555  # 7 years for compliance

  tags = {
    Environment = "test"
    Purpose     = "recourse-testing"
    Compliance  = "SOC2"
  }
}

# Debug logs - short retention, low value
resource "aws_cloudwatch_log_group" "debug" {
  name              = "/recourse-test/debug"
  retention_in_days = 3  # Only 3 days

  tags = {
    Environment = "test"
    Purpose     = "recourse-testing"
  }
}

# Lambda function that writes to these logs
resource "aws_lambda_function" "logger" {
  function_name = "recourse-test-logger"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"

  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256

  environment {
    variables = {
      LOG_GROUP = aws_cloudwatch_log_group.application.name
    }
  }

  tags = {
    Environment = "test"
    Purpose     = "recourse-testing"
  }
}

data "archive_file" "lambda" {
  type        = "zip"
  output_path = "${path.module}/lambda.zip"

  source {
    content  = <<EOF
exports.handler = async (event) => {
  console.log('Test log entry');
  return { statusCode: 200 };
};
EOF
    filename = "index.js"
  }
}

resource "aws_iam_role" "lambda" {
  name = "recourse-test-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
