# =============================================================================
# Rhizomatic — Dev Environment
# =============================================================================
# Smallest viable deployment: single-AZ, spot instances, minimal sizing.
# Uses the same modules as staging/prod with different variable values.
# =============================================================================

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state in S3 — create this bucket manually or via bootstrap script
  backend "s3" {
    bucket         = "rhizomatic-terraform-state"
    key            = "dev/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "rhizomatic-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "rhizomatic"
      Environment = "dev"
      ManagedBy   = "terraform"
    }
  }
}

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "alert_email" {
  description = "Email for alarm notifications (optional)"
  type        = string
  default     = ""
}

locals {
  environment = "dev"
  project     = "rhizomatic"
  azs         = ["${var.aws_region}a"] # Single-AZ for dev
}

# -----------------------------------------------------------------------------
# Secrets (created manually in SSM Parameter Store)
# -----------------------------------------------------------------------------
# Before running terraform apply, create this parameter:
#   aws ssm put-parameter \
#     --name "/rhizomatic/dev/neo4j-auth" \
#     --value "neo4j/rhizomatic-dev" \
#     --type "SecureString"
# -----------------------------------------------------------------------------

data "aws_ssm_parameter" "neo4j_auth" {
  name = "/${local.project}/${local.environment}/neo4j-auth"
}

# =============================================================================
# Module Composition
# =============================================================================

# --- Network ---
module "network" {
  source = "../../modules/network"

  project            = local.project
  environment        = local.environment
  availability_zones = local.azs
  enable_nat_gateway = true
}

# --- ECS Cluster ---
module "ecs" {
  source = "../../modules/ecs-cluster"

  project               = local.project
  environment           = local.environment
  vpc_id                = module.network.vpc_id
  public_subnet_ids     = module.network.public_subnet_ids
  private_subnet_ids    = module.network.private_subnet_ids
  alb_security_group_id = module.network.alb_security_group_id
  app_security_group_id = module.network.app_security_group_id
}

# --- Neo4j ---
module "neo4j" {
  source = "../../modules/neo4j"

  project                        = local.project
  environment                    = local.environment
  cluster_id                     = module.ecs.cluster_id
  private_subnet_ids             = module.network.private_subnet_ids
  data_security_group_id         = module.network.data_security_group_id
  execution_role_arn             = module.ecs.execution_role_arn
  task_role_arn                  = module.ecs.task_role_arn
  service_discovery_namespace_id = module.ecs.service_discovery_namespace_id
  neo4j_password_ssm_arn         = data.aws_ssm_parameter.neo4j_auth.arn

  # Dev sizing: smallest viable
  cpu            = 1024
  memory         = 2048
  heap_size      = "512m"
  pagecache_size = "512m"
}

# --- Elasticsearch (OpenSearch) ---
module "elasticsearch" {
  source = "../../modules/elasticsearch"

  project                = local.project
  environment            = local.environment
  vpc_id                 = module.network.vpc_id
  private_subnet_ids     = module.network.private_subnet_ids
  data_security_group_id = module.network.data_security_group_id

  # Dev sizing
  instance_type  = "t3.small.search"
  instance_count = 1
  volume_size    = 20
}

# --- Redis ---
module "redis" {
  source = "../../modules/redis"

  project                = local.project
  environment            = local.environment
  private_subnet_ids     = module.network.private_subnet_ids
  data_security_group_id = module.network.data_security_group_id

  # Dev sizing
  node_type       = "cache.t4g.micro"
  num_cache_nodes = 1
}

# --- Tika ---
module "tika" {
  source = "../../modules/tika"

  project                        = local.project
  environment                    = local.environment
  cluster_id                     = module.ecs.cluster_id
  private_subnet_ids             = module.network.private_subnet_ids
  app_security_group_id          = module.network.app_security_group_id
  execution_role_arn             = module.ecs.execution_role_arn
  task_role_arn                  = module.ecs.task_role_arn
  service_discovery_namespace_id = module.ecs.service_discovery_namespace_id

  # Dev sizing
  cpu    = 512
  memory = 1024
}

# --- Application (API + Web + Worker) ---
module "app" {
  source = "../../modules/app"

  project               = local.project
  environment           = local.environment
  cluster_id            = module.ecs.cluster_id
  vpc_id                = module.network.vpc_id
  private_subnet_ids    = module.network.private_subnet_ids
  app_security_group_id = module.network.app_security_group_id
  execution_role_arn    = module.ecs.execution_role_arn
  task_role_arn         = module.ecs.task_role_arn
  alb_arn               = module.ecs.alb_arn
  http_listener_arn     = module.ecs.http_listener_arn

  # Connection strings from other modules
  neo4j_bolt_endpoint    = module.neo4j.bolt_endpoint
  elasticsearch_endpoint = module.elasticsearch.endpoint
  redis_endpoint         = module.redis.endpoint
  tika_endpoint          = module.tika.endpoint
  neo4j_password_ssm_arn = data.aws_ssm_parameter.neo4j_auth.arn

  # ECR images — update these after first push
  api_image    = "${module.ecs.ecr_api_url}:latest"
  web_image    = "${module.ecs.ecr_web_url}:latest"
  worker_image = "${module.ecs.ecr_worker_url}:latest"

  # Dev sizing
  api_cpu              = 512
  api_memory           = 1024
  web_cpu              = 256
  web_memory           = 512
  worker_cpu           = 512
  worker_memory        = 1024
  api_desired_count    = 1
  worker_desired_count = 1
}

# --- Monitoring ---
module "monitoring" {
  source = "../../modules/monitoring"

  project                = local.project
  environment            = local.environment
  cluster_name           = module.ecs.cluster_name
  opensearch_domain_name = module.elasticsearch.domain_name
  redis_cluster_id       = "${local.project}-${local.environment}"
  alert_email            = var.alert_email

  # No alarms in dev — just the dashboard
  enable_alarms = false
}

# =============================================================================
# Outputs — map to .env variables
# =============================================================================

output "neo4j_bolt_endpoint" {
  description = "NEO4J_URI"
  value       = module.neo4j.bolt_endpoint
}

output "elasticsearch_endpoint" {
  description = "ELASTICSEARCH_URL"
  value       = module.elasticsearch.endpoint
}

output "redis_endpoint" {
  description = "REDIS_URL"
  value       = module.redis.endpoint
}

output "tika_endpoint" {
  description = "TIKA_URL"
  value       = module.tika.endpoint
}

output "alb_dns_name" {
  description = "Public URL for the application"
  value       = module.ecs.alb_dns_name
}

output "dashboard_url" {
  description = "CloudWatch dashboard URL"
  value       = module.monitoring.dashboard_url
}

output "ecr_repositories" {
  description = "ECR repository URLs for image pushes"
  value = {
    api    = module.ecs.ecr_api_url
    web    = module.ecs.ecr_web_url
    worker = module.ecs.ecr_worker_url
  }
}
