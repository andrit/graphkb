# =============================================================================
# Monitoring Module — CloudWatch Dashboards, Alarms, SNS Alerts
# =============================================================================
# Centralized monitoring for all Rhizomatic services.
# Dashboard gives a single-pane view; alarms notify on degradation.
# =============================================================================

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "project" {
  type    = string
  default = "rhizomatic"
}

variable "environment" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "opensearch_domain_name" {
  type = string
}

variable "redis_cluster_id" {
  type = string
}

variable "alert_email" {
  description = "Email for alarm notifications (empty to skip)"
  type        = string
  default     = ""
}

variable "enable_alarms" {
  description = "Enable CloudWatch alarms (disable for dev to save cost)"
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# SNS Topic for Alerts
# -----------------------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  count = var.alert_email != "" ? 1 : 0
  name  = "${var.project}-${var.environment}-alerts"

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts[0].arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# -----------------------------------------------------------------------------
# CloudWatch Dashboard
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.project}-${var.environment}"

  dashboard_body = jsonencode({
    widgets = [
      # Row 1: ECS Service Health
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "ECS Service CPU Utilization"
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", var.cluster_name, "ServiceName", "api"],
            ["...", "web"],
            ["...", "worker"],
            ["...", "neo4j"],
            ["...", "tika"],
          ]
          period = 300
          stat   = "Average"
          view   = "timeSeries"
          region = data.aws_region.current.name
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "ECS Service Memory Utilization"
          metrics = [
            ["AWS/ECS", "MemoryUtilization", "ClusterName", var.cluster_name, "ServiceName", "api"],
            ["...", "web"],
            ["...", "worker"],
            ["...", "neo4j"],
            ["...", "tika"],
          ]
          period = 300
          stat   = "Average"
          view   = "timeSeries"
          region = data.aws_region.current.name
        }
      },
      # Row 2: Data Store Health
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 8
        height = 6
        properties = {
          title   = "OpenSearch Cluster Health"
          metrics = [
            ["AWS/ES", "ClusterStatus.green", "DomainName", var.opensearch_domain_name],
            [".", "ClusterStatus.yellow", ".", "."],
            [".", "ClusterStatus.red", ".", "."],
          ]
          period = 300
          stat   = "Maximum"
          view   = "timeSeries"
          region = data.aws_region.current.name
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 6
        width  = 8
        height = 6
        properties = {
          title   = "OpenSearch Storage & Indexing"
          metrics = [
            ["AWS/ES", "FreeStorageSpace", "DomainName", var.opensearch_domain_name],
            [".", "IndexingRate", ".", "."],
            [".", "SearchRate", ".", "."],
          ]
          period = 300
          stat   = "Average"
          view   = "timeSeries"
          region = data.aws_region.current.name
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 6
        width  = 8
        height = 6
        properties = {
          title   = "Redis (ElastiCache)"
          metrics = [
            ["AWS/ElastiCache", "CPUUtilization", "CacheClusterId", var.redis_cluster_id],
            [".", "CurrConnections", ".", "."],
            [".", "DatabaseMemoryUsagePercentage", ".", "."],
          ]
          period = 300
          stat   = "Average"
          view   = "timeSeries"
          region = data.aws_region.current.name
        }
      },
      # Row 3: Application Metrics (ALB)
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 12
        height = 6
        properties = {
          title   = "ALB Request Count & Latency"
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", "${var.project}-${var.environment}-alb"],
            [".", "TargetResponseTime", ".", "."],
          ]
          period = 60
          stat   = "Sum"
          view   = "timeSeries"
          region = data.aws_region.current.name
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 12
        width  = 12
        height = 6
        properties = {
          title   = "ALB Error Rates"
          metrics = [
            ["AWS/ApplicationELB", "HTTPCode_Target_4XX_Count", "LoadBalancer", "${var.project}-${var.environment}-alb"],
            [".", "HTTPCode_Target_5XX_Count", ".", "."],
            [".", "HTTPCode_ELB_5XX_Count", ".", "."],
          ]
          period = 60
          stat   = "Sum"
          view   = "timeSeries"
          region = data.aws_region.current.name
        }
      },
      # Row 4: Log Insights
      {
        type   = "log"
        x      = 0
        y      = 18
        width  = 24
        height = 6
        properties = {
          title  = "Recent Errors (all services)"
          region = data.aws_region.current.name
          query  = <<-EOQ
            fields @timestamp, @message, @logStream
            | filter @message like /(?i)(error|exception|fail)/
            | sort @timestamp desc
            | limit 50
          EOQ
          source = [
            "/ecs/${var.project}-${var.environment}/api",
            "/ecs/${var.project}-${var.environment}/web",
            "/ecs/${var.project}-${var.environment}/worker",
            "/ecs/${var.project}-${var.environment}/neo4j",
            "/ecs/${var.project}-${var.environment}/tika",
          ]
          view = "table"
        }
      },
    ]
  })
}

data "aws_region" "current" {}

# -----------------------------------------------------------------------------
# Alarms (enabled per-environment)
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  count               = var.enable_alarms ? 1 : 0
  alarm_name          = "${var.project}-${var.environment}-api-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "API returning 5xx errors"
  alarm_actions       = var.alert_email != "" ? [aws_sns_topic.alerts[0].arn] : []

  dimensions = {
    LoadBalancer = "${var.project}-${var.environment}-alb"
  }

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_cpu" {
  count               = var.enable_alarms ? 1 : 0
  alarm_name          = "${var.project}-${var.environment}-worker-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  alarm_description   = "Worker CPU sustained above 85% — may need scaling"
  alarm_actions       = var.alert_email != "" ? [aws_sns_topic.alerts[0].arn] : []

  dimensions = {
    ClusterName = var.cluster_name
    ServiceName = "worker"
  }

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_cloudwatch_metric_alarm" "opensearch_storage" {
  count               = var.enable_alarms ? 1 : 0
  alarm_name          = "${var.project}-${var.environment}-es-storage"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/ES"
  period              = 300
  statistic           = "Minimum"
  threshold           = 2000 # 2GB free
  alarm_description   = "OpenSearch storage running low"
  alarm_actions       = var.alert_email != "" ? [aws_sns_topic.alerts[0].arn] : []

  dimensions = {
    DomainName = var.opensearch_domain_name
  }

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "dashboard_url" {
  value = "https://${data.aws_region.current.name}.console.aws.amazon.com/cloudwatch/home#dashboards:name=${var.project}-${var.environment}"
}

output "sns_topic_arn" {
  value = length(aws_sns_topic.alerts) > 0 ? aws_sns_topic.alerts[0].arn : null
}
