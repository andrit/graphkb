# ADR-001: TypeScript over Rust for primary language

**Status**: Accepted
**Date**: 2026-03-28

## Context

Need a primary language for API, frontend, and orchestration logic.

## Decision

TypeScript for the main application, with Rust as a documented future optimization path via `napi-rs`.

## Rationale

- Full-stack consistency (same language for API and React frontend).
- Strong type system catches errors at compile time.
- First-class Neo4j and Elasticsearch client libraries.
- Genuine support for functional programming via Effect.
- Rust's Neo4j/ES driver ecosystems are immature.
- Learning Rust + graph databases + search + NLP simultaneously is too much friction.

## Consequences

- Faster iteration, larger ecosystem for graph/search clients.
- Slightly lower runtime performance than Rust.
- Rust migration path preserved for performance-critical modules via `napi-rs`.
