# Rhizomatic — Knowledge Base System Design Document

> **Living document** — Updated progressively as design decisions are made.
> Last updated: 2026-03-28

---

## 1. Vision

Rhizomatic is a personal knowledge base system that ingests diverse content (documents, spreadsheets, images, web pages), extracts structured knowledge, stores it in a graph database, and makes it searchable and browsable through a wiki-style interface.

### Why "Rhizomatic"

The name draws from Deleuze and Guattari's concept of the *rhizome* — a structure with no fixed center, no hierarchy, where any point can connect to any other. Unlike a tree (which imposes top-down classification) or a flat database (which imposes tabular structure), a rhizomatic knowledge system lets understanding emerge from connections themselves.

The goal is *poiesis* — a bringing-forth of understanding through the act of ingesting, connecting, and exploring knowledge. The system doesn't just store what you know; it reveals what you didn't realize you knew by surfacing unexpected relationships between ideas, documents, and domains.

This philosophy has concrete design implications:
- **Favor emergent connections** over rigid taxonomies. The ontology should be loose enough that surprising links can form.
- **Multiple entry points**. Every node is a valid starting point for exploration — there is no "home page" that sits above everything else.
- **No single canonical hierarchy**. The same entity can belong to many contexts simultaneously without one being "primary."

**Phase 1**: Wiki-style knowledge base with graph storage and powerful search.
**Phase 2**: LLM augmentation via GraphRAG for conversational knowledge retrieval.

---

## 2. Architecture Overview

The system follows a layered pipeline architecture where data flows through pure transformations:

```
Ingest → Extract → Model → Store → Index → Surface
```

Each layer is a set of composable, pure functions that take typed input and produce typed output. Layers communicate through well-defined interfaces, not shared state.

### Layers

| Layer | Responsibility | Primary Tech |
|-------|---------------|-------------|
| Ingestion | Accept diverse content types, normalize to common format | TypeScript adapters |
| Processing | Chunk text, extract entities/relationships, generate metadata and embeddings | Python services (spaCy, sentence-transformers) |
| Storage | Persist knowledge graph, search index, and original files | Neo4j, Elasticsearch, filesystem |
| API | Mediate between frontend and storage with typed queries | GraphQL (TypeScript) |
| Interface | Wiki browsing, search, graph exploration | Next.js (React) |

---

## 3. Tech Stack

### 3.1 Primary Language: TypeScript

**Decision**: TypeScript for the main application (API, frontend, orchestration, database clients).

**Rationale**:
- Full-stack consistency — same language for API server and React frontend.
- Strong type system catches errors at compile time. When the `ExtractedContent` type changes, the compiler flags every affected location.
- Genuine support for functional programming via `fp-ts` or `Effect` (see ADR-003).
- First-class Neo4j and Elasticsearch client libraries.
- Rich async/await model well-suited to I/O-heavy graph and search operations.

**Trade-offs considered**:
- *Rust* was evaluated for its superior performance, memory safety, and built-in `Result`/`Option` types. However, the Neo4j and Elasticsearch driver ecosystems in Rust are immature, and the learning curve of Rust + graph databases + search + NLP simultaneously was judged too steep for effective learning. **Strategic note**: performance-critical modules can be rewritten in Rust later and called from Node via `napi-rs`. This is a documented migration path.
- *Python* was considered for full-stack but rejected due to weaker async story, opt-in type system, and FP patterns that feel unidiomatic.

### 3.2 Processing Language: Python

**Decision**: Python for NLP, entity extraction, OCR, and embedding generation.

**Rationale**:
- Dominant ecosystem for NLP: spaCy, Hugging Face transformers, sentence-transformers.
- pytesseract for OCR has no TypeScript equivalent of comparable quality.
- Isolated as worker services behind a message queue — no tight coupling to TypeScript.

**Key libraries**:
- `spaCy` — NLP pipeline (tokenization, NER, dependency parsing)
- `sentence-transformers` — embedding generation for semantic search
- `pytesseract` — OCR for image text extraction
- `beautifulsoup4` / `trafilatura` — web content extraction

### 3.3 Knowledge Graph: Neo4j Community Edition

**Decision**: Neo4j CE running in Docker.

**Rationale**:
- Purpose-built for graph data with the Cypher query language.
- Free Community Edition supports all needed features.
- Official JavaScript driver (`neo4j-driver`) is mature and well-maintained.
- Cypher enables expressive traversal queries like "find all documents mentioning Topic X connected to Person Y through any path."

### 3.4 Search: Elasticsearch 8.x

**Decision**: Elasticsearch 8.x running in Docker.

**Rationale**:
- Full-text search, fuzzy matching, faceted filtering — capabilities the graph alone lacks.
- Treated as a read-optimized projection of the graph. Changes in Neo4j trigger index updates in ES.
- `@elastic/elasticsearch` Node client is official and well-supported.
- Supports vector search for semantic similarity (Phase 2 preparation).

### 3.5 Message Queue: Redis + BullMQ

**Decision**: Redis as the message broker with BullMQ for TypeScript job management.

**Rationale**:
- TypeScript ingestion orchestrator enqueues jobs; Python workers consume them.
- BullMQ provides retries, backpressure, job status tracking, and priority queues.
- Redis also serves as a caching layer for frequently accessed graph queries.
- Lightweight — a single Redis instance handles both queuing and caching at personal scale.

### 3.6 Frontend: Next.js

**Decision**: Next.js for the web interface.

**Rationale**:
- Server-side rendering for wiki pages (good for SEO if ever made public).
- React for interactive components (graph explorer, search interface).
- API routes available as a lightweight backend-for-frontend layer.
- File-based routing maps naturally to wiki page structure.

### 3.7 Deployment: Docker Compose → K3s

**Decision**: Docker Compose for local development, with a migration path to K3s (lightweight Kubernetes).

**Rationale**:
- Docker Compose: single `docker compose up` spins up Neo4j, Elasticsearch, Redis. Minimal operational overhead at personal scale.
- K3s: when ready to scale, provides real Kubernetes semantics (pods, services, deployments) without full-cluster overhead. Runs on a single node initially, scales to multi-node later.
- Docker Swarm was explicitly rejected — it is effectively end-of-life and the ecosystem has moved to Kubernetes.
- Infrastructure files are designed so Docker Compose services map cleanly to K8s manifests.

---

## 4. Project Structure

Monorepo using **pnpm workspaces** with **Turborepo** for build orchestration.

```
rhizomatic/
├── packages/                    # TypeScript packages
│   ├── common/                  # @rhizomatic/common — shared types, utilities, config
│   ├── graph/                   # @rhizomatic/graph — Neo4j client, Cypher queries, ontology
│   ├── search/                  # @rhizomatic/search — Elasticsearch client, indexing, sync
│   ├── ingestion/               # @rhizomatic/ingestion — job queue, orchestration
│   ├── api/                     # @rhizomatic/api — GraphQL/REST server
│   ├── web/                     # @rhizomatic/web — Next.js frontend
│   ├── storage/                 # @rhizomatic/storage — file storage abstraction
│   └── cli/                     # @rhizomatic/cli — admin and dev tooling
├── services/                    # Python services
│   ├── processor/               # NLP, chunking, entity extraction
│   ├── embedder/                # Vector embedding generation
│   └── ocr/                     # Image text extraction
├── infra/                       # Infrastructure
│   ├── docker-compose.yml       # Local development
│   ├── docker-compose.prod.yml  # Production-like setup
│   └── k8s/                     # Kubernetes manifests (future)
├── docs/                        # Documentation
│   ├── design.md                # This document
│   ├── adrs/                    # Architecture Decision Records
│   └── guides/                  # Setup guides, tutorials
├── turbo.json                   # Turborepo config
├── pnpm-workspace.yaml          # Workspace definition
└── package.json                 # Root package.json
```

### Why monorepo?

At personal scale, a monorepo lets you change a shared type and immediately see if it breaks the API or frontend — without publishing packages or coordinating across repositories. Turborepo caches task outputs for fast incremental builds.

### Package boundaries

Each `@rhizomatic/*` package is an independent module with:
- Its own `package.json` and TypeScript config
- Explicit dependency declarations on other `@rhizomatic/*` packages
- Exported pure functions and types — no classes with hidden state
- A barrel `index.ts` that defines the public API

---

## 5. Design Principles

### 5.1 Functional Programming

- **Pure functions**: Each pipeline stage takes typed input, returns typed output. No side effects.
- **Composable pipelines**: `chunk → extractEntities → tagMetadata → generateEmbeddings`
- **Result types**: Error handling via `Result<T, E>` (from fp-ts or Effect) rather than thrown exceptions. Failures are explicit values, not invisible control flow.
- **Immutable data**: Pipeline stages never mutate their input. Each produces a new value.

### 5.2 Modularity

- **Adapter pattern for ingestion**: Each content type gets its own module (`pdf → ExtractedContent`, `csv → ExtractedContent`). New types are added by writing a new adapter.
- **Loose coupling between layers**: The ingestion layer doesn't know about Neo4j. It produces a standardized intermediate representation.
- **Substitutability**: Storage backends can be swapped (local filesystem → S3) without changing the layers above.

### 5.3 Progressive complexity

- Start simple, add complexity only when needed.
- Every decision is reversible or has a documented migration path.
- Prefer learning one technology deeply before adding the next.

---

## 6. Architecture Decision Records (ADRs)

### ADR-001: TypeScript over Rust for primary language
- **Status**: Accepted
- **Context**: Need a primary language for API, frontend, and orchestration.
- **Decision**: TypeScript now, with Rust as a documented future optimization path via napi-rs.
- **Consequences**: Faster iteration, larger ecosystem for graph/search clients. Slightly lower runtime performance. Rust migration path preserved.

### ADR-002: Docker Compose → K3s deployment progression
- **Status**: Accepted
- **Context**: Need a deployment strategy that works at personal scale but can grow.
- **Decision**: Docker Compose for development and initial deployment. K3s (lightweight Kubernetes) when scaling is needed. Docker Swarm rejected.
- **Consequences**: Simple local setup. Kubernetes learning happens incrementally. Infrastructure files designed for clean migration.

### ADR-003: Effect over fp-ts for functional programming foundation
- **Status**: Accepted
- **Context**: Need a functional programming foundation for Result types, pipe/flow composition, typed error handling, and dependency injection.
- **Options evaluated**:
  - **fp-ts**: Haskell-inspired, mature, small footprint. Provides Either, TaskEither, ReaderTaskEither as separate types. Requires manual composition between sync/async/DI contexts. Strong ecosystem (io-ts, monocle-ts).
  - **Effect**: Unified runtime. Single type `Effect<Success, Error, Requirements>` handles sync, async, errors, and dependencies. Built-in Layer system for dependency injection. Generator syntax (`Effect.gen`) for readable async code. Growing ecosystem with Schema, HTTP, SQL modules.
- **Decision**: Effect.
- **Rationale**:
  - Eliminates "type juggling" — no switching between Either/TaskEither/ReaderTaskEither.
  - Layer system maps naturally to our architecture: Neo4j, Elasticsearch, Redis, FileStorage as injectable services.
  - Generator syntax is more approachable for learning FP; pipe style available when ready.
  - Schema module replaces the need for separate validation libraries (io-ts, zod).
  - Active development and growing ecosystem vs. fp-ts which is stable but slowing.
- **Trade-offs accepted**: Larger runtime bundle, newer/less battle-tested, steeper initial setup. Mitigated by greenfield project (no migration cost) and active community.
- **Consequences**: All packages use Effect as the primary abstraction. Error types are modeled as tagged unions. Services are defined as Effect Layers. The `@rhizomatic/common` package re-exports core Effect utilities for consistency.
- **Learning strategy**: Keep fp-ts as a reference companion. Effect grew out of the fp-ts ecosystem (creator Michael Arnaldi was a major fp-ts contributor), and the Haskell-derived concepts — algebraic data types, monads, functors, referential transparency, the separation of effect description from execution — transfer directly. Understanding how `Either`, `Reader`, and `TaskEither` work in fp-ts deepens understanding of *why* Effect's unified type exists and what it collapses. Recommended reading: fp-ts documentation on Functors, Monads, and the Reader pattern alongside Effect's own guides.

### ADR-004: Typed relationship composition as a core feature
- **Status**: Accepted
- **Context**: The graph contains typed relationships (PART_OF, INSTANCE_OF, RELATED_TO) that compose transitively. These compositions reveal implicit knowledge: if A is part of B and B is an instance of C, then A is an instance of C.
- **Decision**: Auto-compose relationships using configurable rules with weight decay. Implementation: lazy evaluation with Redis caching. Composition rules are data (ontology config), not code.
- **Rationale**: This is the category-theoretic functor composition that makes the rhizomatic vision work — connections that exist implicitly in the data should be surfaceable without requiring a human to trace them manually. Weight decay on RELATED_TO prevents meaningless universal connectivity.
- **Consequences**: `@rhizomatic/graph` must support composition rule configuration. Redis cache invalidation required when underlying edges change. Max chain depth setting needed to prevent runaway inference in dense subgraphs.

### ADR-005: Committed tools roadmap (Tika, Wikidata, Qdrant, GNNs, GraphRAG)
- **Status**: Accepted
- **Context**: Multiple tools were evaluated that deepen Rhizomatic's ability to surface connections and meaning.
- **Decision**: All tools committed. Phase 1: Apache Tika (ingestion), Obsidian-style bidirectional links (wiki layer), temporal graph properties (schema), Wikidata/DBpedia linkage (enrichment), typed relationship composition (query layer). Phase 2: Qdrant (vector search), GNNs (structural embeddings), GraphRAG (LLM reasoning), temporal visualization.
- **Rationale**: Each tool adds a distinct dimension to the knowledge graph. Tika simplifies ingestion. Wikidata extends the graph beyond local knowledge. Temporal properties enable evolution tracking. GNNs and GraphRAG are Phase 2 because they require a meaningful graph to operate on.
- **Consequences**: Phase 1 scope is larger but each tool integrates at a well-defined point. Phase 2 adds new packages (`@rhizomatic/vector`, `@rhizomatic/rag`). Docker Compose will eventually include Qdrant as a service.

---

## 7. Infrastructure

### 7.1 Docker Compose (Local Development)

Single command startup: `docker compose up -d`

| Service | Image | Ports | Purpose |
|---------|-------|-------|---------|
| Neo4j 5.x CE | neo4j:5-community | 7474 (browser), 7687 (bolt) | Knowledge graph storage |
| Elasticsearch 8.x | elasticsearch:8.15.0 | 9200 (REST) | Search index + vector search |
| Redis 7.x | redis:7-alpine | 6379 | Message queue (BullMQ) + cache |

**Design choices**:
- Infrastructure in containers, application code on host — fastest development loop.
- Named volumes for data persistence across restarts.
- Health checks on all services — the app knows when infrastructure is ready.
- Neo4j APOC plugin pre-installed for advanced graph operations.
- Elasticsearch in single-node mode with security disabled (dev only).
- Redis with AOF persistence — queue jobs survive Redis restarts.
- All services on a shared bridge network (`rhizomatic-net`).

**K8s migration path**: Each Compose service maps to a Kubernetes Deployment + Service. Volume claims become PersistentVolumeClaims. Environment variables become ConfigMaps/Secrets. The translation is mechanical.

### 7.2 Configuration

Environment variables loaded from `.env` file (copied from `.env.example`). Typed config schemas in `@rhizomatic/common` validate all values at startup using Effect Schema — the app fails fast with clear messages if config is wrong.

---

## 8. Open Questions

- [ ] Graph data model / ontology design — what node types, relationship types, and properties?
- [ ] Ingestion pipeline detail — how does content flow from upload to graph?
- [ ] Search strategy — how do full-text, graph traversal, and vector search combine?
- [ ] Wiki page structure — how do graph nodes map to browsable pages?
- [ ] Effect Schema vs. Zod for runtime validation — evaluate once Effect is integrated

---

## 9. Graph Data Model (Neo4j Ontology)

### 9.1 Design philosophy

The ontology has two layers: a **structural layer** (system-created nodes for operational reality) and a **semantic layer** (discovered and curated nodes for emergent knowledge). This follows the rhizomatic principle — the plumbing is typed, the knowledge is fluid.

### 9.2 Node types

**Structural layer (system-created):**

| Label | Purpose | Created by |
|-------|---------|-----------|
| `:Document` | An ingested source file (PDF, webpage, CSV, image) | Ingestion pipeline |
| `:Chunk` | A semantically coherent piece of a Document | Processing pipeline |
| `:Source` | Provenance — where a Document came from | Ingestion pipeline |

**Semantic layer (discovered + curated):**

| Label | Purpose | Created by |
|-------|---------|-----------|
| `:Entity` | A named thing (person, concept, tech, place, org) | NLP extraction + user curation |
| `:Topic` | A cluster of related entities and chunks | Clustering algorithm + user creation |
| `:Note` | User-authored freeform text attached to any node | User |
| `:Tag` | Lightweight flat label applied to any node | User |

### 9.3 Key design decisions

**`Entity.kind` is a string, not an enum.** The system cannot predict every type of entity it will encounter across mixed knowledge domains. Freeform kind allows cooking ingredients, philosophy concepts, and programming languages to coexist. Patterns emerge over time and can be formalized if needed.

**`RELATED_TO` is the rhizomatic edge.** Carries `weight` (0-1), `kind` (co-occurrence, causal, hierarchical, analogical, user-defined), and `source` (auto, manual). This is how unexpected cross-domain connections surface.

**`Note.ANNOTATES` targets any node type.** User understanding is a first-class citizen in the graph, indexed and searchable alongside system-generated knowledge.

**Entity resolution is critical.** "TypeScript", "TS", and "typescript" must resolve to the same Entity node. The `aliases` property stores variants. Resolution happens during extraction and can be manually corrected.

### 9.4 Relationship types

| Relationship | From → To | Properties | Purpose |
|---|---|---|---|
| `HAS_CHUNK` | Document → Chunk | position: int | Document decomposition |
| `FROM_SOURCE` | Document → Source | fetchedAt: datetime | Provenance tracking |
| `REFERENCES` | Document → Document | — | Citations, links |
| `MENTIONS` | Chunk → Entity | confidence: float | Entity co-location |
| `ABOUT` | Chunk → Topic | — | Topic assignment |
| `NEXT_CHUNK` | Chunk → Chunk | — | Reading order |
| `SIMILAR_TO` | Chunk → Chunk | score: float | Embedding similarity |
| `RELATED_TO` | Entity → Entity | weight, kind, source | Rhizomatic connections |
| `INSTANCE_OF` | Entity → Entity | — | Type hierarchy |
| `PART_OF` | Entity → Entity | — | Composition |
| `CONTAINS` | Topic → Entity | — | Topic membership |
| `OVERLAPS` | Topic → Topic | sharedCount: int | Cross-domain links |
| `ANNOTATES` | Note → any node | — | User commentary |
| `TAGGED` | any node → Tag | — | User labeling |

### 9.5 Cypher schema initialization

```cypher
// Constraints (enforce uniqueness, create implicit indexes)
CREATE CONSTRAINT doc_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE;
CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT source_id IF NOT EXISTS FOR (s:Source) REQUIRE s.id IS UNIQUE;
CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE;
CREATE CONSTRAINT entity_name IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE;
CREATE CONSTRAINT topic_id IF NOT EXISTS FOR (t:Topic) REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT note_id IF NOT EXISTS FOR (n:Note) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT tag_name IF NOT EXISTS FOR (t:Tag) REQUIRE t.name IS UNIQUE;

// Indexes for common query patterns
CREATE INDEX doc_content_type IF NOT EXISTS FOR (d:Document) ON (d.contentType);
CREATE INDEX doc_ingested IF NOT EXISTS FOR (d:Document) ON (d.ingestedAt);
CREATE INDEX entity_kind IF NOT EXISTS FOR (e:Entity) ON (e.kind);
CREATE INDEX entity_mention_count IF NOT EXISTS FOR (e:Entity) ON (e.mentionCount);
CREATE INDEX chunk_position IF NOT EXISTS FOR (c:Chunk) ON (c.position);
CREATE INDEX source_kind IF NOT EXISTS FOR (s:Source) ON (s.kind);

// Full-text index for entity name search within Neo4j
CREATE FULLTEXT INDEX entity_search IF NOT EXISTS FOR (e:Entity) ON EACH [e.name, e.description];
```

### 9.6 Concrete example: ingesting a PDF

**Input**: "Why Functional Programming Matters" by John Hughes (1989, 23 pages, PDF).

**Stage 1 — Ingestion** (automatic):
- `:Document` node created with title, `contentType: "pdf"`, `fileHash`, `ingestedAt`.
- `:Source` node created or reused (e.g., "Academic papers", `kind: "file"`, `trustLevel: 0.9`).
- `FROM_SOURCE` edge connects them.
- Original PDF stored in blob storage, referenced by `fileHash`.

**Stage 2 — Processing** (automatic):
- Document split into ~15 `:Chunk` nodes at section boundaries (Introduction, Higher-order functions, Lazy evaluation, etc.).
- Chunks linked by `HAS_CHUNK` (with `position`) and `NEXT_CHUNK` (reading order).
- Embeddings generated for each chunk and stored in Elasticsearch.

**Stage 3 — Entity extraction** (automatic, refinable):
- NLP identifies entities: "John Hughes" (person), "higher-order functions" (concept), "lazy evaluation" (concept), "modularity" (concept), "Haskell" (technology), "Miranda" (technology).
- Each chunk gets `MENTIONS` edges to the entities found within it (with confidence scores).
- Entity resolution: if "higher-order functions" already exists from a previously ingested React tutorial, the existing node is reused — no duplicate created.

**Stage 4 — Relationship discovery** (automatic):
- Co-occurrence analysis: "higher-order functions" and "lazy evaluation" appear in multiple chunks together → `RELATED_TO` edge with `kind: "co-occurrence"`, `weight: 0.85`.
- `INSTANCE_OF` edges: "Haskell" `INSTANCE_OF` "Programming language" (if the parent entity exists).

**The rhizomatic moment**: The Entity "higher-order functions" now links the 1989 FP paper to a 2024 React hooks tutorial ingested weeks earlier. Browsing the "Higher-order functions" wiki page shows both documents. The graph reveals that Haskell and React hooks are two hops apart — a connection no keyword search would surface.

### 9.7 Example Cypher queries

```cypher
-- "Show me everything connected to higher-order functions"
MATCH (e:Entity {name: "Higher-order functions"})-[r]-(connected)
RETURN e, r, connected

-- "Find documents that share entities (cross-domain bridges)"
MATCH (d1:Document)-[:HAS_CHUNK]->(:Chunk)-[:MENTIONS]->(e:Entity)
      <-[:MENTIONS]-(:Chunk)<-[:HAS_CHUNK]-(d2:Document)
WHERE d1 <> d2
RETURN d1.title, d2.title, collect(DISTINCT e.name) AS sharedEntities
ORDER BY size(sharedEntities) DESC

-- "What concepts connect functional programming to React?"
MATCH path = shortestPath(
  (fp:Entity {name: "Functional programming"})-[*..4]-
  (react:Entity {name: "React"})
)
RETURN path

-- "What are the most connected entities? (hub concepts)"
MATCH (e:Entity)-[r:RELATED_TO]-()
RETURN e.name, e.kind, count(r) AS connections
ORDER BY connections DESC LIMIT 20

-- "Find Topics that overlap (cross-domain links)"
MATCH (t1:Topic)-[o:OVERLAPS]->(t2:Topic)
RETURN t1.name, t2.name, o.sharedCount
ORDER BY o.sharedCount DESC
```

### 9.8 Category theory as a design lens

Category theory (CT) provides a formal vocabulary for the kinds of structure-preserving transformations that Rhizomatic performs. While we don't need to implement CT abstractions directly (Effect already embodies many of them), thinking in CT terms sharpens the ontology design and reveals opportunities for richer semantic operations.

**Where CT concepts map to Rhizomatic:**

- **Categories as knowledge contexts.** Each "view" of the graph is a category: the raw document category (objects = documents, morphisms = REFERENCES edges), the entity category (objects = entities, morphisms = RELATED_TO edges), the topic category (objects = topics, morphisms = OVERLAPS edges). These aren't just arbitrary groupings — each has composition (if A relates to B and B relates to C, there's an implied A-to-C path) and identity (every entity relates to itself).

- **Functors as transformations between views.** The ingestion pipeline is a functor from the "document category" to the "entity category" — it maps documents to their extracted entities while preserving structural relationships. When two documents share a REFERENCES edge, their extracted entities should share RELATED_TO edges. A functor is exactly a structure-preserving map. This gives us a formal criterion for pipeline correctness: does the extraction functor actually preserve the relationships it should?

- **Natural transformations as ontology migrations.** When you refine the ontology (splitting "technology" into "language" and "framework"), that's a natural transformation between two functors — two different ways of mapping raw content to structured knowledge. CT tells you that a valid migration must commute: the result should be the same whether you re-extract with the new schema or transform the existing extractions.

- **Monads as computational context.** Effect's `Effect<A, E, R>` type is already a monad — it encodes success, failure, and dependency context. The pipeline stages compose monadically: each stage may fail, each needs dependencies (Neo4j client, ES client), and the monad handles the plumbing. This is CT in practice, even if we don't call it that.

- **Adjunctions as search-store duality.** The relationship between Neo4j (store) and Elasticsearch (search) is an adjunction: storing knowledge in the graph and retrieving it via search are formally dual operations. The sync mechanism between them must preserve this duality — every graph change must be reflected in the search index, and every search result must trace back to graph data.

**Practical implications for the semantic layer:**

1. **Typed relationship composition.** If A `PART_OF` B and B `INSTANCE_OF` C, we can infer A `INSTANCE_OF` C. This is functor composition — applying one relationship mapping after another. The system can automatically generate these transitive inferences.

2. **Coherence checks.** CT's commutative diagrams give us a way to validate graph consistency: if there are two paths from Entity A to Entity B, do they tell a consistent story? Conflicting paths might indicate entity resolution errors or contradictory sources.

3. **Multi-resolution views.** Functors between categories at different granularities (chunks → entities → topics) give us principled zoom levels. The wiki interface can offer a "zoom out" that's not just visual clustering but a genuine categorical projection — moving from the entity category to the topic category via the CONTAINS functor.

**Recommendation:** Use CT as a design thinking tool and validation framework, not as an implementation layer. The concepts inform better ontology decisions and pipeline correctness checks. Effect already provides the monadic infrastructure. Explicit CT abstractions in code (Functor typeclasses, natural transformation types) would add complexity without proportional value at this scale — but the *thinking* behind them makes the system more rigorous.

### 9.9 Typed relationship composition (core feature)

The graph auto-composes typed relationships to surface implicit knowledge. This is functor composition from category theory made concrete — if two morphisms compose in the abstract, the system materializes their composition.

**Composition rules (defined in ontology configuration):**

| If | And | Then inferred | Weight rule |
|----|-----|--------------|-------------|
| A `PART_OF` B | B `INSTANCE_OF` C | A `INSTANCE_OF` C | inherited |
| A `PART_OF` B | B `PART_OF` C | A `PART_OF` C | inherited (transitive) |
| A `INSTANCE_OF` B | B `INSTANCE_OF` C | A `INSTANCE_OF` C | inherited (transitive) |
| A `RELATED_TO` B | B `RELATED_TO` C | A `RELATED_TO` C | weight_AC = weight_AB × weight_BC (decay) |

**Weight decay on `RELATED_TO`** is critical. Without it, every node in a connected graph eventually relates to every other node with equal strength. Multiplicative decay ensures inferred connections weaken with distance — only strong transitive paths surface.

**Implementation: lazy with caching.**
- Not eager (storing inferred edges on creation) — causes edge explosion, complex invalidation.
- Not purely lazy (computing at query time only) — too expensive for interactive browsing.
- Lazy with caching: compute via Cypher path traversal at query time, cache in Redis, invalidate when underlying edges change. The stored graph stays clean (only explicit edges), composed paths are fast to retrieve.

**Composition rules are configurable data, not code** — stored in `@rhizomatic/graph` ontology config. Users can add rules as patterns emerge. Example: A `AUTHORED_BY` B, B `AFFILIATED_WITH` C → A `RELATED_TO` C with `kind: "institutional"`.

**Example Cypher:**

```cypher
-- Infer INSTANCE_OF through PART_OF chains
MATCH (a:Entity)-[:PART_OF]->(b:Entity)-[:INSTANCE_OF]->(c:Entity)
WHERE NOT (a)-[:INSTANCE_OF]->(c)
RETURN a.name AS entity, c.name AS inferredType, b.name AS via

-- Infer weighted RELATED_TO (2-hop, with decay)
MATCH (a:Entity)-[r1:RELATED_TO]->(b:Entity)-[r2:RELATED_TO]->(c:Entity)
WHERE a <> c AND NOT (a)-[:RELATED_TO]->(c)
RETURN a.name, c.name, r1.weight * r2.weight AS inferredWeight, b.name AS via
ORDER BY inferredWeight DESC
```

### 9.10 Committed tools and technologies roadmap

All tools below are committed for inclusion. Phase assignments indicate implementation targets.

**Phase 1 (core system):**

| Tool | Purpose | Integration point |
|------|---------|-------------------|
| Apache Tika | Multi-format extraction (PDF, DOCX, PPTX, EPUB, HTML, RTF) via single API. Replaces custom adapters. | `services/processor` |
| Obsidian-style bidirectional links | Auto-create `MENTIONS` edges when Notes reference Entity names. Notes become searchable graph participants. | `@rhizomatic/api` (wiki layer) |
| Temporal graph properties | `createdAt` on all relationship types. Enables "what emerged this month?" and evolution tracking. | `@rhizomatic/graph` (schema) |
| Wikidata / DBpedia linkage | Enrich entities with external knowledge graph data. `owl:sameAs`-style links for context the system didn't extract. | `services/processor` (enrichment step) |
| Typed relationship composition | Auto-compose PART_OF, INSTANCE_OF, RELATED_TO with configurable rules and weight decay. Lazy eval + Redis cache. | `@rhizomatic/graph` (query layer) |

**Phase 2 (after core is stable):**

| Tool | Purpose | Integration point |
|------|---------|-------------------|
| Qdrant (vector database) | Dedicated HNSW indexing for semantic search. Runs alongside ES. | `@rhizomatic/search` + `@rhizomatic/vector` |
| Graph Neural Networks | Structural embeddings from graph topology (PyTorch Geometric / DGL). Captures connection patterns. | `services/embedder` (second embedding type) |
| GraphRAG | Community summaries over graph clusters. Hierarchical LLM context for conversational queries. | `@rhizomatic/rag` |
| Temporal visualization | Timeline views of knowledge evolution. Built on Phase 1 temporal properties. | `@rhizomatic/web` (graph explorer) |

---

## 10. Open questions

- [ ] Ingestion pipeline detail — how does content flow from upload to graph?
- [ ] Search strategy — how do full-text, graph traversal, and vector search combine?
- [ ] Wiki page structure — how do graph nodes map to browsable pages?
- [ ] Effect Schema vs. Zod for runtime validation
- [ ] Wikidata enrichment — which entity kinds to link, disambiguation strategy, staleness handling?
- [ ] Composition rule governance — max chain depth to prevent runaway inference in dense subgraphs?
- [ ] GNN minimum data threshold — what graph size justifies structural embedding training?
- [ ] Tika vs. custom adapters — evaluate extraction quality tradeoffs during scaffolding

| Concern | Personal | Small Team | Enterprise |
|---------|----------|------------|------------|
| Auth & access | None | Basic roles | RBAC, SSO, audit |
| Graph ontology | Freeform | Light governance | Per-tenant schemas |
| Ingestion | Manual/semi-auto | Async pipeline | Queued, monitored, retried |
| Deployment | Docker Compose / single VM | Docker Compose / small cloud | Kubernetes / managed services |
| Data volume | GBs | Tens of GBs | TBs+ |
| LLM integration | Local or API | API with caching | API with rate limiting, cost controls |
| Collaboration | N/A | Edit history, basic review | Workflows, approvals, versioning |

Current scope: **Personal**, with architectural decisions that support scaling to team scope without rewrites.
