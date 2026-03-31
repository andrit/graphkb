# ADR-002: Docker Compose → K3s deployment progression

**Status**: Accepted
**Date**: 2026-03-28

## Context

Need a deployment strategy that works at personal scale but can grow.

## Decision

Docker Compose for development and initial deployment. K3s (lightweight Kubernetes) when scaling is needed. Docker Swarm rejected (effectively end-of-life).

## Rationale

- Docker Compose: single `docker compose up` for local development. Minimal operational overhead.
- K3s: real Kubernetes semantics on a single node. Scales to multi-node without changing abstractions.
- Docker Swarm: deprioritized by Docker Inc., community has moved to Kubernetes.

## Consequences

- Simple local setup. Kubernetes learning happens incrementally.
- Infrastructure files designed so Compose services map cleanly to K8s Deployments.
- Volume mounts become PersistentVolumeClaims. Env vars become ConfigMaps/Secrets.
