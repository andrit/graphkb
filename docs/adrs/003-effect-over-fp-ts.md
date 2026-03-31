# ADR-003: Effect over fp-ts for functional programming foundation

**Status**: Accepted
**Date**: 2026-03-28

## Context

Need a functional programming foundation for Result types, pipe/flow composition, typed error handling, and dependency injection.

## Options evaluated

- **fp-ts**: Haskell-inspired, mature, small footprint. Separate types for sync/async/DI (Either, TaskEither, ReaderTaskEither). Strong ecosystem (io-ts, monocle-ts).
- **Effect**: Unified runtime. Single type `Effect<Success, Error, Requirements>`. Built-in Layer system for dependency injection. Generator syntax for readable async code. Growing ecosystem (Schema, HTTP, SQL).

## Decision

Effect.

## Rationale

- Eliminates "type juggling" between Either/TaskEither/ReaderTaskEither.
- Layer system maps naturally to our architecture: Neo4j, ES, Redis, FileStorage as injectable services.
- Generator syntax (`Effect.gen`) is approachable for learning FP; pipe style available when ready.
- Schema module replaces separate validation libraries.
- Active development and growing ecosystem.

## Learning strategy

Keep fp-ts as a reference companion. The Haskell-derived concepts (algebraic data types, monads, functors, referential transparency) transfer directly. Understanding fp-ts deepens understanding of *why* Effect's unified type exists.

## Consequences

- All packages use Effect as the primary abstraction.
- Error types modeled as tagged unions via `Data.TaggedError`.
- Services defined as Effect Layers.
- `@rhizomatic/common` re-exports core Effect utilities for consistency.
