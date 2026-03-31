# ADR-004: Typed relationship composition as a core feature

**Status**: Accepted
**Date**: 2026-03-28

## Context

The graph contains typed relationships (PART_OF, INSTANCE_OF, RELATED_TO) that compose transitively. These compositions reveal implicit knowledge that would otherwise require manual tracing.

## Decision

Auto-compose relationships using configurable rules with weight decay. Implementation: lazy evaluation with Redis caching. Composition rules are data (ontology configuration), not code.

## Composition rules

| If A→B | And B→C | Then A→C | Weight |
|--------|---------|----------|--------|
| PART_OF | INSTANCE_OF | INSTANCE_OF | inherited |
| PART_OF | PART_OF | PART_OF | inherited |
| INSTANCE_OF | INSTANCE_OF | INSTANCE_OF | inherited |
| RELATED_TO | RELATED_TO | RELATED_TO | w1 × w2 (decay) |

## Implementation

- **Lazy with caching**: Compute via Cypher path traversal at query time, cache in Redis, invalidate when underlying edges change.
- **Not eager**: Would cause edge explosion and complex invalidation.
- **Not purely lazy**: Too expensive for interactive browsing.
- **Configurable**: Rules are data stored in `@rhizomatic/graph` ontology config. Users can add new rules as patterns emerge.
- **Max depth**: Each rule has a configurable `maxDepth` to prevent runaway inference chains.

## Consequences

- `@rhizomatic/graph` must support composition rule configuration.
- Redis cache invalidation required when underlying edges change.
- Weight decay prevents meaningless universal connectivity.
