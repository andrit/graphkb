# ADR-008: Infrastructure as Code via Terraform

> **Status:** Accepted
> **Date:** 2026-04-15
> **Context:** As Rhizomatic adds infrastructure services (Tika, BullMQ workers), the system becomes harder to deploy, reproduce, and monitor consistently. Docker Compose handles local dev, but production/staging deployments need a repeatable, version-controlled infrastructure layer.

---

## Decision

Use **Terraform** with **AWS** as the cloud provider, organized as environment-specific root modules consuming shared service modules. State is stored remotely in S3 with DynamoDB locking.

---

## 2. Why Terraform

- **Declarative and idempotent**: describe desired state, Terraform converges. No imperative scripting.
- **Provider ecosystem**: mature AWS provider covers all services we need (ECS, OpenSearch, ElastiCache, EFS, CloudWatch).
- **Module system**: each infrastructure service is an independent module with typed inputs/outputs — mirrors the monorepo's package structure.
- **State management**: remote state in S3 enables team collaboration and CI/CD integration.
- **Plan before apply**: `terraform plan` shows exactly what will change before any mutation.

### Alternatives considered

- **Pulumi**: TypeScript-native IaC would match our stack, but smaller ecosystem and less battle-tested for AWS.
- **AWS CDK**: Tighter AWS integration but locks us to AWS; Terraform keeps the door open for multi-cloud.
- **CloudFormation**: AWS-native but verbose, no module reuse across environments, painful iteration cycle.

---

## 3. Architecture Mapping

Docker Compose services map to AWS managed services where possible:

| Docker Compose Service | AWS Resource | Terraform Module |
|------------------------|-------------|-----------------|
| `neo4j` (container) | ECS Fargate + EFS | `modules/neo4j` |
| `elasticsearch` (container) | AWS OpenSearch Service | `modules/elasticsearch` |
| `redis` (container) | AWS ElastiCache | `modules/redis` |
| `tika` (container, new) | ECS Fargate | `modules/tika` |
| API server (host) | ECS Fargate + ALB | `modules/app` |
| Web frontend (host) | ECS Fargate + ALB | `modules/app` |
| Worker (host, new) | ECS Fargate | `modules/app` |
| — | CloudWatch | `modules/monitoring` |

### Why ECS Fargate (not EKS)

At personal-to-small-team scale, Kubernetes is operational overhead without proportional benefit. Fargate eliminates node management entirely. If the system grows to need Kubernetes-level orchestration, the k8s manifests directory (`infra/k8s/`) is already scaffolded for that migration.

---

## 4. Module Structure

```
infra/terraform/
├── modules/               # Reusable, environment-agnostic
│   ├── network/           # VPC, subnets, security groups
│   ├── ecs-cluster/       # Cluster, ALB, IAM roles, ECR repos, service discovery
│   ├── neo4j/             # Task definition, EFS volume, service discovery
│   ├── elasticsearch/     # OpenSearch domain
│   ├── redis/             # ElastiCache cluster
│   ├── tika/              # Task definition, service discovery
│   ├── app/               # API + web + worker task defs, ALB rules, shared EFS
│   └── monitoring/        # CloudWatch dashboard, alarms, SNS
└── environments/          # Environment-specific root modules
    ├── dev/               # Single-AZ, spot, small instances, no alarms
    ├── staging/           # Multi-AZ, small instances, alarms on
    └── prod/              # Multi-AZ, larger instances, alarms + backups
```

### Key design: outputs chain to inputs

Module outputs feed downstream module inputs explicitly. The network module outputs VPC/subnet IDs; every other module accepts them as variables. No implicit data sources or global state.

---

## 5. Environment Differentiation

| Dimension | Dev | Staging | Prod |
|-----------|-----|---------|------|
| Availability zones | 1 | 2 | 2 |
| ECS capacity | FARGATE_SPOT | FARGATE_SPOT | FARGATE (on-demand) |
| OpenSearch instances | 1 × t3.small | 2 × t3.medium | 2 × m6g.large |
| Redis | t4g.micro | t4g.micro | t4g.small |
| Neo4j heap | 512m | 512m | 1g |
| API replicas | 1 | 1 | 2 |
| Worker replicas | 1 | 1 | 2 |
| CloudWatch alarms | off | on | on |
| Log retention | 7 days | 14 days | 30 days |

Same modules, different variable values. Adding a new environment is copying a root module and adjusting variables.

---

## 6. State Management

- **Backend**: S3 bucket + DynamoDB table for state locking.
- **Isolation**: Each environment has its own state file key (`dev/terraform.tfstate`, `prod/terraform.tfstate`).
- **Encryption**: State is encrypted at rest in S3.
- **Bootstrap**: The S3 bucket and DynamoDB table are created once manually (or via a small bootstrap script) before first `terraform init`.

---

## 7. Secrets

Sensitive values (Neo4j password, future API keys) are stored in **AWS SSM Parameter Store** as SecureString parameters. Terraform references them via `data "aws_ssm_parameter"` and passes ARNs to ECS task definitions as `secrets` blocks. The actual secret values never appear in Terraform state or logs.

---

## 8. Monitoring

The monitoring module provides:

- **CloudWatch Dashboard**: single-pane view of all services (CPU, memory, request rates, error rates, storage, Redis connections).
- **CloudWatch Alarms**: 5xx error rate, worker CPU saturation, OpenSearch storage — configurable per environment.
- **SNS Alerts**: email notifications on alarm triggers.
- **Log aggregation**: all ECS services log to CloudWatch Log Groups with configurable retention.
- **Container Insights**: enabled on the ECS cluster for detailed container-level metrics.

---

## 9. Consequences

**Positive:**
- Infrastructure is version-controlled, reviewable, and reproducible.
- Environment parity — staging mirrors prod topology, catches config drift.
- Module reuse — adding a new service is writing one module, then referencing it in each environment.
- Monitoring is deployed alongside infrastructure, not bolted on later.
- Connection strings flow from Terraform outputs to app config — no manual wiring.

**Negative:**
- Terraform state must be managed carefully (remote backend, locking).
- AWS costs (~$157/month for dev) vs. running everything on a single VPS.
- Learning curve for team members unfamiliar with Terraform.
- Two deployment paths to maintain (Docker Compose for local, Terraform for cloud).

**Mitigations:**
- Docker Compose remains the primary local dev experience — Terraform is only for deployed environments.
- Remote state with locking prevents concurrent mutation issues.
- Modules are self-documenting with typed variables and descriptions.
