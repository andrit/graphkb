# =============================================================================
# Rhizomatic — Production Environment
# =============================================================================
# Multi-AZ, larger instances, alarms enabled, backups.
# Same modules as dev with production-grade variable values.
# =============================================================================

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "rhizomatic-terraform-state"
    key            = "prod/terraform.tfstate"
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
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "alert_email" {
  type = string
}

locals {
  environment = "prod"
  project     = "rhizomatic"
  azs         = ["${var.aws_region}a", "${var.aws_region}b"] # Multi-AZ
}

data "aws_ssm_parameter" "neo4j_auth" {
  name = "/${local.project}/${local.environment}/neo4j-auth"
}

# =============================================================================
# Module Composition — same modules, production sizing
# =============================================================================

module "network" {
  source = "../../modules/network"

  project            = local.project
  environment        = local.environment
  availability_zones = local.azs
  enable_nat_gateway = true
}

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

  # Prod sizing
  cpu            = 2048
  memory         = 4096
  heap_size      = "1g"
  pagecache_size = "1g"
}

module "elasticsearch" {
  source = "../../modules/elasticsearch"

  project                = local.project
  environment            = local.environment
  vpc_id                 = module.network.vpc_id
  private_subnet_ids     = module.network.private_subnet_ids
  data_security_group_id = module.network.data_security_group_id

  # Prod sizing — multi-AZ
  instance_type  = "m6g.large.search"
  instance_count = 2
  volume_size    = 100
}

module "redis" {
  source = "../../modules/redis"

  project                = local.project
  environment            = local.environment
  private_subnet_ids     = module.network.private_subnet_ids
  data_security_group_id = module.network.data_security_group_id

  # Prod sizing
  node_type       = "cache.t4g.small"
  num_cache_nodes = 1
}

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

  # Prod sizing — Tika/JVM benefits from more memory
  cpu    = 1024
  memory = 2048
}

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

  neo4j_bolt_endpoint    = module.neo4j.bolt_endpoint
  elasticsearch_endpoint = module.elasticsearch.endpoint
  redis_endpoint         = module.redis.endpoint
  tika_endpoint          = module.tika.endpoint
  neo4j_password_ssm_arn = data.aws_ssm_parameter.neo4j_auth.arn

  api_image    = "${module.ecs.ecr_api_url}:latest"
  web_image    = "${module.ecs.ecr_web_url}:latest"
  worker_image = "${module.ecs.ecr_worker_url}:latest"

  # Prod sizing
  api_cpu              = 1024
  api_memory           = 2048
  web_cpu              = 512
  web_memory           = 1024
  worker_cpu           = 1024
  worker_memory        = 2048
  api_desired_count    = 2
  worker_desired_count = 2
}

module "monitoring" {
  source = "../../modules/monitoring"

  project                = local.project
  environment            = local.environment
  cluster_name           = module.ecs.cluster_name
  opensearch_domain_name = module.elasticsearch.domain_name
  redis_cluster_id       = "${local.project}-${local.environment}"
  alert_email            = var.alert_email
  enable_alarms          = true # Alarms ON for prod
}

# =============================================================================
# Outputs
# =============================================================================

output "neo4j_bolt_endpoint" {
  value = module.neo4j.bolt_endpoint
}

output "elasticsearch_endpoint" {
  value = module.elasticsearch.endpoint
}

output "redis_endpoint" {
  value = module.redis.endpoint
}

output "tika_endpoint" {
  value = module.tika.endpoint
}

output "alb_dns_name" {
  value = module.ecs.alb_dns_name
}

output "dashboard_url" {
  value = module.monitoring.dashboard_url
}
