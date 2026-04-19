# =============================================================================
# App Module — API Server, Web Frontend, Ingestion Worker
# =============================================================================
# Three ECS services sharing the same VPC/security group:
#   - api:    Fastify + GraphQL, public via ALB
#   - web:    Next.js frontend, public via ALB
#   - worker: BullMQ ingestion worker, internal only (no ALB target)
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
  type = string
}

variable "vpc_id" {
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

variable "alb_arn" {
  type = string
}

variable "http_listener_arn" {
  type = string
}

# Connection strings from other modules
variable "neo4j_bolt_endpoint" {
  type = string
}

variable "elasticsearch_endpoint" {
  type = string
}

variable "redis_endpoint" {
  type = string
}

variable "tika_endpoint" {
  type = string
}

variable "neo4j_password_ssm_arn" {
  type = string
}

# ECR image URLs
variable "api_image" {
  type = string
}

variable "web_image" {
  type = string
}

variable "worker_image" {
  type = string
}

# Sizing
variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memory" {
  type    = number
  default = 1024
}

variable "web_cpu" {
  type    = number
  default = 256
}

variable "web_memory" {
  type    = number
  default = 512
}

variable "worker_cpu" {
  type    = number
  default = 512
}

variable "worker_memory" {
  type    = number
  default = 1024
}

variable "api_desired_count" {
  type    = number
  default = 1
}

variable "worker_desired_count" {
  type    = number
  default = 1
}

# Shared environment variables for all app containers
locals {
  shared_env = [
    { name = "NODE_ENV", value = var.environment == "prod" ? "production" : "development" },
    { name = "NEO4J_URI", value = var.neo4j_bolt_endpoint },
    { name = "NEO4J_USER", value = "neo4j" },
    { name = "ELASTICSEARCH_URL", value = var.elasticsearch_endpoint },
    { name = "REDIS_URL", value = var.redis_endpoint },
    { name = "TIKA_URL", value = var.tika_endpoint },
    { name = "TIKA_ENABLED", value = "true" },
    { name = "FILE_STORAGE_PATH", value = "/data/files" },
    { name = "LOG_LEVEL", value = var.environment == "prod" ? "info" : "debug" },
  ]

  shared_secrets = [
    { name = "NEO4J_PASSWORD", valueFrom = var.neo4j_password_ssm_arn },
  ]
}

data "aws_region" "current" {}

# -----------------------------------------------------------------------------
# Shared EFS for file storage (content-addressable blob store)
# -----------------------------------------------------------------------------

resource "aws_efs_file_system" "files" {
  creation_token = "${var.project}-${var.environment}-files"
  encrypted      = true

  tags = {
    Name        = "${var.project}-${var.environment}-file-storage"
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_efs_mount_target" "files" {
  count           = length(var.private_subnet_ids)
  file_system_id  = aws_efs_file_system.files.id
  subnet_id       = var.private_subnet_ids[count.index]
  security_groups = [var.app_security_group_id]
}

# =============================================================================
# API Service
# =============================================================================

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.project}-${var.environment}/api"
  retention_in_days = var.environment == "prod" ? 30 : 7

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.project}-${var.environment}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  volume {
    name = "file-storage"
    efs_volume_configuration {
      file_system_id = aws_efs_file_system.files.id
      root_directory = "/"
    }
  }

  container_definitions = jsonencode([{
    name  = "api"
    image = var.api_image

    portMappings = [{ containerPort = 4000, protocol = "tcp" }]

    environment = concat(local.shared_env, [
      { name = "API_PORT", value = "4000" },
    ])

    secrets = local.shared_secrets

    mountPoints = [{
      sourceVolume  = "file-storage"
      containerPath = "/data/files"
      readOnly      = false
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "api"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:4000/health || exit 1"]
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

# ALB target group for API
resource "aws_lb_target_group" "api" {
  name        = "${var.project}-${var.environment}-api"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 5
    interval            = 30
    timeout             = 5
  }

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

# Route /graphql, /upload, /health to API
resource "aws_lb_listener_rule" "api" {
  listener_arn = var.http_listener_arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = ["/graphql", "/graphiql", "/upload", "/health", "/jobs/*"]
    }
  }
}

resource "aws_ecs_service" "api" {
  name            = "api"
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [var.app_security_group_id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 4000
  }

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

# =============================================================================
# Web Frontend Service
# =============================================================================

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${var.project}-${var.environment}/web"
  retention_in_days = var.environment == "prod" ? 30 : 7

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${var.project}-${var.environment}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  container_definitions = jsonencode([{
    name  = "web"
    image = var.web_image

    portMappings = [{ containerPort = 3000, protocol = "tcp" }]

    environment = [
      { name = "WEB_PORT", value = "3000" },
      { name = "API_URL", value = "http://api.${var.project}-${var.environment}.local:4000" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.web.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "web"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:3000 || exit 1"]
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

# ALB target group for Web — catch-all (lowest priority)
resource "aws_lb_target_group" "web" {
  name        = "${var.project}-${var.environment}-web"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/"
    healthy_threshold   = 2
    unhealthy_threshold = 5
    interval            = 30
    timeout             = 5
  }

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_lb_listener_rule" "web" {
  listener_arn = var.http_listener_arn
  priority     = 200

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }

  condition {
    path_pattern {
      values = ["/*"]
    }
  }
}

resource "aws_ecs_service" "web" {
  name            = "web"
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [var.app_security_group_id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

# =============================================================================
# Worker Service (internal — no ALB)
# =============================================================================

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${var.project}-${var.environment}/worker"
  retention_in_days = var.environment == "prod" ? 30 : 7

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.project}-${var.environment}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  volume {
    name = "file-storage"
    efs_volume_configuration {
      file_system_id = aws_efs_file_system.files.id
      root_directory = "/"
    }
  }

  container_definitions = jsonencode([{
    name  = "worker"
    image = var.worker_image

    environment = concat(local.shared_env, [
      { name = "PROCESSOR_CONCURRENCY", value = "2" },
      { name = "EMBEDDING_MODEL", value = "all-MiniLM-L6-v2" },
    ])

    secrets = local.shared_secrets

    mountPoints = [{
      sourceVolume  = "file-storage"
      containerPath = "/data/files"
      readOnly      = false
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.worker.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "worker"
      }
    }
  }])

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_ecs_service" "worker" {
  name            = "worker"
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [var.app_security_group_id]
  }

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "api_url" {
  value = "http://${aws_lb_target_group.api.name}"
}

output "file_storage_efs_id" {
  value = aws_efs_file_system.files.id
}
