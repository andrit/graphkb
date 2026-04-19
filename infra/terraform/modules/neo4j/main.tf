# =============================================================================
# Neo4j Module — Graph Database on ECS Fargate
# =============================================================================
# Runs Neo4j Community Edition as an ECS Fargate task with EFS for persistent
# storage. Service discovery enables other containers to reach it by name.
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

variable "cluster_id" {
  description = "ECS cluster ID"
  type        = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "data_security_group_id" {
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

variable "neo4j_password_ssm_arn" {
  description = "SSM parameter ARN for Neo4j password"
  type        = string
}

variable "cpu" {
  description = "Fargate CPU units (1024 = 1 vCPU)"
  type        = number
  default     = 1024
}

variable "memory" {
  description = "Fargate memory in MB"
  type        = number
  default     = 2048
}

variable "heap_size" {
  description = "Neo4j JVM heap size"
  type        = string
  default     = "512m"
}

variable "pagecache_size" {
  description = "Neo4j page cache size"
  type        = string
  default     = "512m"
}

# -----------------------------------------------------------------------------
# EFS for persistent Neo4j data
# -----------------------------------------------------------------------------

resource "aws_efs_file_system" "neo4j" {
  creation_token = "${var.project}-${var.environment}-neo4j"
  encrypted      = true

  tags = {
    Name        = "${var.project}-${var.environment}-neo4j-data"
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_efs_mount_target" "neo4j" {
  count           = length(var.private_subnet_ids)
  file_system_id  = aws_efs_file_system.neo4j.id
  subnet_id       = var.private_subnet_ids[count.index]
  security_groups = [var.data_security_group_id]
}

# -----------------------------------------------------------------------------
# Service Discovery
# -----------------------------------------------------------------------------

resource "aws_service_discovery_service" "neo4j" {
  name = "neo4j"

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
# CloudWatch Log Group
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "neo4j" {
  name              = "/ecs/${var.project}-${var.environment}/neo4j"
  retention_in_days = var.environment == "prod" ? 30 : 7

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

# -----------------------------------------------------------------------------
# ECS Task Definition
# -----------------------------------------------------------------------------

resource "aws_ecs_task_definition" "neo4j" {
  family                   = "${var.project}-${var.environment}-neo4j"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  volume {
    name = "neo4j-data"
    efs_volume_configuration {
      file_system_id = aws_efs_file_system.neo4j.id
      root_directory = "/"
    }
  }

  container_definitions = jsonencode([{
    name  = "neo4j"
    image = "neo4j:5-community"

    portMappings = [
      { containerPort = 7474, protocol = "tcp" },
      { containerPort = 7687, protocol = "tcp" },
    ]

    environment = [
      { name = "NEO4J_PLUGINS", value = "[\"apoc\"]" },
      { name = "NEO4J_server_memory_heap_initial__size", value = var.heap_size },
      { name = "NEO4J_server_memory_heap_max__size", value = var.heap_size },
      { name = "NEO4J_server_memory_pagecache_size", value = var.pagecache_size },
      { name = "NEO4J_dbms_security_procedures_unrestricted", value = "apoc.*" },
      { name = "NEO4J_dbms_security_procedures_allowlist", value = "apoc.*" },
    ]

    secrets = [
      {
        name      = "NEO4J_AUTH"
        valueFrom = var.neo4j_password_ssm_arn
      },
    ]

    mountPoints = [{
      sourceVolume  = "neo4j-data"
      containerPath = "/data"
      readOnly      = false
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.neo4j.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "neo4j"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:7474 || exit 1"]
      interval    = 15
      timeout     = 5
      retries     = 5
      startPeriod = 60
    }
  }])

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

data "aws_region" "current" {}

# -----------------------------------------------------------------------------
# ECS Service
# -----------------------------------------------------------------------------

resource "aws_ecs_service" "neo4j" {
  name            = "neo4j"
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.neo4j.arn
  desired_count   = 1 # Neo4j CE is single-instance
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [var.data_security_group_id]
  }

  service_registries {
    registry_arn = aws_service_discovery_service.neo4j.arn
  }

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "bolt_endpoint" {
  description = "Neo4j Bolt endpoint for app connections"
  value       = "bolt://neo4j.${var.project}-${var.environment}.local:7687"
}

output "browser_endpoint" {
  description = "Neo4j Browser endpoint"
  value       = "http://neo4j.${var.project}-${var.environment}.local:7474"
}

output "efs_id" {
  value = aws_efs_file_system.neo4j.id
}
