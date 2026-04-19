# =============================================================================
# Tika Module — Apache Tika on ECS Fargate
# =============================================================================
# Runs Tika as an internal service accessible via service discovery.
# No public endpoint — only the app services communicate with Tika.
# =============================================================================

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "project" {
  type    = string
  default = "rhizomatic"
}

variable "environment" {
  type = string
}

variable "cluster_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "app_security_group_id" {
  type = string
}

variable "execution_role_arn" {
  type = string
}

variable "task_role_arn" {
  type = string
}

variable "service_discovery_namespace_id" {
  type = string
}

variable "cpu" {
  type    = number
  default = 512
}

variable "memory" {
  type    = number
  default = 1024
}

# -----------------------------------------------------------------------------
# Service Discovery
# -----------------------------------------------------------------------------

resource "aws_service_discovery_service" "tika" {
  name = "tika"

  dns_config {
    namespace_id = var.service_discovery_namespace_id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

# -----------------------------------------------------------------------------
# Log Group
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "tika" {
  name              = "/ecs/${var.project}-${var.environment}/tika"
  retention_in_days = var.environment == "prod" ? 14 : 3

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

# -----------------------------------------------------------------------------
# Task Definition + Service
# -----------------------------------------------------------------------------

resource "aws_ecs_task_definition" "tika" {
  family                   = "${var.project}-${var.environment}-tika"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  container_definitions = jsonencode([{
    name  = "tika"
    image = "apache/tika:latest"

    portMappings = [{ containerPort = 9998, protocol = "tcp" }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.tika.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "tika"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:9998/tika || exit 1"]
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

data "aws_region" "current" {}

resource "aws_ecs_service" "tika" {
  name            = "tika"
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.tika.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [var.app_security_group_id]
  }

  service_registries {
    registry_arn = aws_service_discovery_service.tika.arn
  }

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "endpoint" {
  description = "Tika endpoint for app connections"
  value       = "http://tika.${var.project}-${var.environment}.local:9998"
}
