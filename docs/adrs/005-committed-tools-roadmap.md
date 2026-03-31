# ADR-005: Committed tools roadmap

**Status**: Accepted
**Date**: 2026-03-28

## Context

Multiple tools were evaluated that deepen Rhizomatic's ability to surface connections and meaning across knowledge domains.

## Decision

All tools committed. Phased implementation.

## Phase 1 (core system)

| Tool | Purpose | Integration |
|------|---------|-------------|
| Apache Tika | Multi-format extraction via single API | `services/processor` |
| Bidirectional links | Auto-create MENTIONS from Note text | `@rhizomatic/api` |
| Temporal properties | `createdAt` on all relationships | `@rhizomatic/graph` |
| Wikidata/DBpedia | Enrich entities with external KG data | `services/processor` |
| Relationship composition | Auto-compose with configurable rules | `@rhizomatic/graph` |

## Phase 2 (after core is stable)

| Tool | Purpose | Integration |
|------|---------|-------------|
| Qdrant | Dedicated vector search (HNSW) | `@rhizomatic/vector` |
| Graph Neural Networks | Structural embeddings from topology | `services/embedder` |
| GraphRAG | Community summaries for LLM context | `@rhizomatic/rag` |
| Temporal visualization | Timeline of knowledge evolution | `@rhizomatic/web` |

## Consequences

- Phase 1 scope is larger but each tool integrates at a well-defined point.
- Phase 2 adds new packages (`@rhizomatic/vector`, `@rhizomatic/rag`).
- Docker Compose will include Qdrant in Phase 2.
