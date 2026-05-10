# WidgetCo Demo - Variables

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-west-2"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "demo"
}

variable "app_name" {
  description = "Application name"
  type        = string
  default     = "widgetco"
}

variable "db_password" {
  description = "Password for RDS database"
  type        = string
  sensitive   = true
  default     = "WidgetCo-Demo-2026!"
}

# Tags applied to all resources
variable "tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default = {
    Project     = "RecourseOS-Demo"
    Environment = "demo"
    ManagedBy   = "terraform"
    Purpose     = "consequence-evaluation-demo"
  }
}
