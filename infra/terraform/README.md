# Rhizomatic — Terraform Infrastructure

> Infrastructure as Code for deploying Rhizomatic to AWS.

## Directory Structure

```
infra/terraform/
├── environments/          # Environment-specific configurations
│   ├── dev/               # Development (smallest instances, single-AZ)
│   ├── staging/           # Staging (mirrors prod topology, smaller instances)
│   └── prod/              # Production (multi-AZ, autoscaling, backups)
├── modules/               # Reusable infrastructure modules
│   ├── network/           # VPC, subnets, security groups
│   ├── ecs-cluster/       # ECS Fargate cluster (runs all containers)
│   ├── neo4j/             # Neo4j on ECS with EBS persistent volume
│   ├── elasticsearch/     # Elasticsearch via AWS OpenSearch Service
│   ├── redis/             # Redis via AWS ElastiCache
│   ├── tika/              # Apache Tika on ECS Fargate
│   ├── app/               # API server + web frontend + worker on ECS
│   └── monitoring/        # CloudWatch dashboards, alarms, log groups
└── README.md              # You are here
```

## Design Principles

1. **Module-per-service**: Each infrastructure service is an independent Terraform module
   with its own inputs/outputs. Modules can be tested and upgraded independently.

2. **Environment parity**: All environments use the same modules with different variable
   values. Dev is cheap (single-AZ, small instances), prod is resilient (multi-AZ, backups).

3. **No hardcoded values**: Everything is parameterized. Instance sizes, replica counts,
   retention periods — all flow from environment tfvars files.

4. **Outputs chain to inputs**: Module outputs feed into other modules' inputs.
   The network module outputs VPC/subnet IDs that every other module consumes.

5. **State isolation**: Each environment has its own Terraform state file in S3,
   preventing accidental cross-environment changes.

## Prerequisites

- [Terraform >= 1.5](https://developer.hashicorp.com/terraform/install)
- AWS CLI configured with appropriate credentials
- An S3 bucket for Terraform state (created once, manually or via bootstrap script)

## Quick Start

```bash
# 1. Navigate to the desired environment
cd infra/terraform/environments/dev

# 2. Initialize Terraform (downloads providers, configures backend)
terraform init

# 3. Preview changes
terraform plan

# 4. Apply
terraform apply

# 5. Get connection strings for your .env file
terraform output -json
```

## Environment Variables → Terraform Outputs

After `terraform apply`, the outputs map directly to `.env` values:

| Terraform Output         | .env Variable        |
|--------------------------|----------------------|
| `neo4j_bolt_endpoint`    | `NEO4J_URI`          |
| `elasticsearch_endpoint` | `ELASTICSEARCH_URL`  |
| `redis_endpoint`         | `REDIS_URL`          |
| `tika_endpoint`          | `TIKA_URL`           |
| `api_url`                | (frontend API_BASE)  |
| `web_url`                | (public URL)         |

## Cost Estimates (Dev Environment)

| Service           | AWS Resource          | Approximate Monthly Cost |
|-------------------|-----------------------|--------------------------|
| Neo4j             | ECS Fargate (1 vCPU)  | ~$30                     |
| Elasticsearch     | OpenSearch t3.small    | ~$25                     |
| Redis             | ElastiCache t4g.micro | ~$12                     |
| Tika              | ECS Fargate (0.5 vCPU)| ~$15                     |
| API + Web + Worker| ECS Fargate (1 vCPU)  | ~$30                     |
| Networking        | NAT Gateway + ALB     | ~$40                     |
| Monitoring        | CloudWatch basics     | ~$5                      |
| **Total**         |                       | **~$157/month**          |

Production adds multi-AZ redundancy, larger instances, and backups — roughly 2.5–3x dev cost.
