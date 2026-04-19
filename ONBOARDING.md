# Rhizomatic — Project Onboarding Guide

> **Audience:** A new developer (or AI assistant) picking up this project for the first time.
> Everything you need to understand the system, navigate the codebase, and start contributing.

---

## 1. What Is Rhizomatic?

Rhizomatic is a **personal knowledge base** that ingests diverse content (documents, web pages, spreadsheets, images), extracts structured knowledge from it, stores that knowledge in a **graph database**, and makes it browsable through a **wiki-style interface** with powerful search.

The name comes from Deleuze & Guattari's concept of the *rhizome* — a structure with no center and no hierarchy, where any point can connect to any other. The system's core value proposition is the **"rhizomatic moment"**: when a shared entity connects two previously unrelated documents, surfacing an unexpected cross-domain link that no keyword search would find.

**Current scope:** Personal use, with architecture designed to scale to small-team without rewrites.

**Two phases:**

- **Phase 1 (current):** Wiki-style KB with graph storage, full-text search, ingestion pipeline, entity extraction.
- **Phase 2 (future):** LLM augmentation via GraphRAG, vector search (Qdrant), graph neural networks, temporal visualization.

---

## 2. Where to Find Documentation

| Document | Location | What It Covers |
|----------|----------|----------------|
| **Design Document** (primary) | `docs/rhizomatic-design-doc.md` | Architecture, tech stack rationale, DDD ubiquitous language, graph ontology, ADRs, roadmap. **Read this first.** |
| **Architecture diagrams** | `docs/diagrams.html` | Visual representations of the system architecture. Open in a browser. |
| **ADRs** | `docs/adrs/` | Architecture Decision Records — the *why* behind major choices. |
| **Setup guides** | `docs/guides/` | Practical how-to guides. |
| **This onboarding doc** | `ONBOARDING.md` (repo root or docs/) | You are here. |
| **README** | `README.md` | Quick-start commands. |

**Recommendation:** Read `rhizomatic-design-doc.md` sections 1–6 before touching any code. It defines the ubiquitous language (Section 6.1) — every type name, variable, and module in the codebase maps to terms defined there. Reading the design doc is not optional; it *is* the specification.

---

## 3. Tech Stack At a Glance

| Layer | Technology | Why |
|-------|-----------|-----|
| Primary language | **TypeScript** | Full-stack consistency, strong types, Effect ecosystem |
| FP foundation | **Effect** (not fp-ts) | Unified `Effect<Success, Error, Requirements>` type for sync/async/DI/errors — see ADR-003 |
| Knowledge graph | **Neo4j 5.x CE** | Cypher query language, purpose-built for graph traversal |
| Search index | **Elasticsearch 8.x** | Full-text + fuzzy + faceted search; read-optimized projection of the graph |
| Message queue / cache | **Redis 7.x + BullMQ** | Job queuing between TS orchestrator and Python workers, plus caching |
| API server | **Fastify + Mercurius** (GraphQL) | GraphQL for variable-depth graph queries, REST for uploads/health |
| Frontend | **Next.js** (React) | SSR wiki pages, interactive graph explorer, file-based routing |
| NLP / embeddings (Phase 2) | **Python** (spaCy, sentence-transformers) | Dominant NLP ecosystem; isolated as worker services |
| Document extraction | **Apache Tika** | Universal binary format extraction (PDF, DOCX, XLSX, PPTX, OCR); HTTP service in Docker — see ADR-007 |
| Infrastructure (local) | **Docker Compose** | Neo4j, ES, Redis, Tika in containers; app code on host for fast dev loop |
| Infrastructure (cloud) | **Terraform** (AWS) | IaC for ECS Fargate, OpenSearch, ElastiCache, CloudWatch — see ADR-008 |

---

## 4. Monorepo Structure

```
rhizomatic/
├── packages/                         # TypeScript packages (pnpm workspaces)
│   ├── common/                       # @rhizomatic/common — shared types, errors, config, utils
│   ├── graph/                        # @rhizomatic/graph — Neo4j client, Cypher queries, ontology
│   ├── search/                       # @rhizomatic/search — Elasticsearch client, indexing
│   ├── ingestion/                    # @rhizomatic/ingestion — pipeline: validate→extract→chunk→NER→write
│   ├── storage/                      # @rhizomatic/storage — file storage abstraction
│   ├── api/                          # @rhizomatic/api — Fastify server, GraphQL resolvers, /upload
│   ├── web/                          # @rhizomatic/web — Next.js frontend (wiki, search, graph, ingest)
│   └── cli/                          # @rhizomatic/cli — admin and dev tooling
├── services/                         # Python services (Phase 2)
│   ├── processor/                    # NLP, entity extraction
│   ├── embedder/                     # Vector embedding generation
│   └── ocr/                          # Image text extraction (pytesseract)
├── infra/
│   ├── docker-compose.yml            # Local dev infrastructure
│   └── k8s/                          # Kubernetes manifests (future)
├── docs/                             # All documentation lives here
├── data/files/                       # Uploaded file storage (local filesystem)
├── turbo.json                        # Turborepo build orchestration
├── pnpm-workspace.yaml               # Workspace definition
└── package.json                      # Root scripts (infra:up, build, dev, etc.)
```

### Package Dependency Graph

```
@rhizomatic/common        ← every other package depends on this (types, errors, config)
    ↑
@rhizomatic/storage       ← file I/O abstraction
@rhizomatic/graph         ← Neo4j client + Cypher queries
@rhizomatic/search        ← Elasticsearch client + indexing
    ↑
@rhizomatic/ingestion     ← pipeline orchestrator (depends on graph, search, storage)
    ↑
@rhizomatic/api           ← HTTP layer (depends on everything above)
@rhizomatic/web           ← frontend (talks to API over HTTP, no direct package deps)
```

---

## 5. Getting Started

### Prerequisites

- **Node.js ≥ 22** and **pnpm ≥ 9**
- **Docker** (for Neo4j, Elasticsearch, Redis)

### First-Time Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Build all workspace packages (CRITICAL — resolves the dist/ imports)
pnpm -r build

# 3. Start infrastructure (Neo4j, ES, Redis in Docker)
pnpm infra:up

# 4. Wait for services to be healthy
docker compose -f infra/docker-compose.yml ps   # all should show "healthy"

# 5. Start the API server
cd packages/api && pnpm dev                      # → http://localhost:4000

# 6. Start the frontend (separate terminal)
cd packages/web && pnpm dev                      # → http://localhost:3000
```

### Known Setup Issue

The workspace packages (`@rhizomatic/common`, `@rhizomatic/graph`, etc.) export from `dist/index.js`, which only exists after building. If you skip `pnpm -r build`, you'll get:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../dist/index.js'
```

**Fix:** Always run `pnpm -r build` from the repo root before `pnpm dev`.

### Key URLs After Startup

| URL | What |
|-----|------|
| `http://localhost:3000` | Next.js frontend — wiki, search, graph explorer |
| `http://localhost:3000/ingest` | Drag-and-drop file upload page |
| `http://localhost:3000/search` | Live debounced search |
| `http://localhost:3000/graph` | SVG graph explorer |
| `http://localhost:4000/health` | API health check |
| `http://localhost:4000/graphiql` | GraphiQL interactive query UI |
| `http://localhost:7474` | Neo4j Browser (Cypher query UI) |
| `http://localhost:9200` | Elasticsearch REST API |
| `http://localhost:9998` | Apache Tika REST API (document extraction) |

---

## 6. Architecture: How Data Flows

The ingestion pipeline is the heart of the system. Here's the end-to-end flow when you upload a file:

```
User drops file on /ingest page
        │
        ▼
POST /upload (multipart) ──→ Fastify receives file buffer
        │
        ▼
┌─ INGESTION PIPELINE (single Effect chain) ─────────────────────┐
│                                                                 │
│  1. VALIDATE        validateFile() + detectContentType()        │
│        │            Checks size, extension, maps to ContentType │
│        ▼                                                        │
│  2. STORE           FileStorage.store()                         │
│        │            Writes original to data/files/, returns hash│
│        ▼                                                        │
│  3. EXTRACT TEXT    getExtractor(contentType)(buffer)            │
│        │            Adapter per type: Markdown, HTML, CSV, etc. │
│        ▼                                                        │
│  4. CHUNK           chunkText(extractedContent)                 │
│        │            Section-aware paragraph chunking             │
│        ▼                                                        │
│  5. EXTRACT ENTITIES extractFromChunks(chunks)                  │
│        │            TS-native NER: capitalized phrases, tech     │
│        │            terms, quoted terms, co-occurrence relations │
│        ▼                                                        │
│  6. WRITE NEO4J     GraphClient.write()                         │
│        │            Creates Document, Chunk, Entity, MENTIONS,  │
│        │            RELATED_TO, HAS_CHUNK nodes and edges       │
│        ▼                                                        │
│  7. INDEX ES        SearchClient.index()                        │
│        │            Indexes docs, chunks, entities for search   │
│        ▼                                                        │
│  Return IngestionResult                                         │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
Frontend shows result: title, chunk count, entity count, relationships
Wiki pages now contain the new knowledge
```

### Key Files in the Pipeline

| File | Responsibility |
|------|---------------|
| `packages/ingestion/src/validation.ts` | File validation + content type detection |
| `packages/ingestion/src/extractors.ts` | Text extraction adapters per content type |
| `packages/ingestion/src/chunker.ts` | Section-aware paragraph chunking |
| `packages/ingestion/src/entities.ts` | TypeScript-native NER (no Python dependency for Phase 1) |
| `packages/ingestion/src/pipeline.ts` | The orchestrator — composes all stages into one Effect chain |

---

## 7. Graph Data Model (Neo4j Ontology)

The graph has two layers:

**Structural layer** (system-created): `Document`, `Chunk`, `Source` — the plumbing that tracks what was ingested, how it was split, and where it came from.

**Semantic layer** (discovered + curated): `Entity`, `Topic`, `Note`, `Tag` — the emergent knowledge. Entities are the heart of the rhizome; `RELATED_TO` is the rhizomatic edge that connects them across domains.

### Core Relationships

| Relationship | From → To | Purpose |
|---|---|---|
| `HAS_CHUNK` | Document → Chunk | Document decomposition |
| `MENTIONS` | Chunk → Entity | Entity co-location (with confidence) |
| `RELATED_TO` | Entity → Entity | Cross-domain connections (with weight, kind, source) |
| `INSTANCE_OF` | Entity → Entity | Type hierarchy |
| `PART_OF` | Entity → Entity | Composition |

See the design document Section 9 for the full ontology, Cypher schema, and worked examples.

---

## 8. Design Principles to Internalize

These are not suggestions — the codebase is built around them:

1. **Effect everywhere.** All services are Effect Layers. Errors are typed tagged unions in the error channel, not thrown exceptions. Dependencies are injected via `Effect.provideService()`. If you're unfamiliar with Effect, start with the [Effect docs](https://effect.website) and ADR-003 in the design doc.

2. **Pure functions, immutable data.** Pipeline stages take typed input and return typed output. No mutation, no hidden state. Each stage produces a new value.

3. **Ubiquitous language.** The terms in Section 6.1 of the design doc are law. A `Chunk` is a `Chunk` everywhere — in types, variables, Cypher queries, GraphQL schema, UI labels. No synonyms.

4. **Anti-corruption layers.** External format quirks (Neo4j records, ES responses, messy PDFs) never leak into domain types. Each integration point has an adapter that translates to/from clean domain types.

5. **Graph is source of truth; search is a projection.** Elasticsearch can be rebuilt entirely from Neo4j at any time. Never write to ES without also writing to Neo4j.

---

## 9. Frontend Pages

| Route | Component | What It Does |
|-------|-----------|-------------|
| `/` | `page.tsx` | Home — recent documents + top entities |
| `/ingest` | `ingest/page.tsx` | Drag-and-drop file upload with progress + session history |
| `/search` | `search/page.tsx` | Live debounced search across all ES indexes |
| `/graph` | `graph/page.tsx` | SVG graph explorer — clickable nodes with detail panel |
| `/wiki/doc/[id]` | `wiki/doc/[id]/page.tsx` | Document detail — chunks with entity pills linking to entity pages |
| `/wiki/entity/[name]` | `wiki/entity/[name]/page.tsx` | Entity wiki page — related entities, mentioning documents, aliases |

The frontend communicates with the API via `packages/web/src/lib/api.ts`, which provides typed GraphQL queries and a REST upload helper.

---

## 10. What's Built vs. What's Next

### Currently Working (Phase 1 — partial)

- Infrastructure: Neo4j, ES, Redis, Apache Tika via Docker Compose
- Monorepo scaffold with typed packages and Effect service layers
- End-to-end ingestion pipeline (Markdown, HTML, CSV support natively)
- Apache Tika integration for binary formats (PDF, DOCX, XLSX, PPTX, images/OCR) with format-specific post-processors
- Two-tier extraction strategy: native extractors for text formats, Tika for binary formats, graceful degradation when Tika unavailable
- TypeScript-native NER (capitalized phrases, tech terms, co-occurrence relationships)
- GraphQL API with resolvers for documents, entities, search, graph neighborhood
- REST `/upload` endpoint with multipart file handling
- Frontend: upload page, wiki pages (doc + entity), search, graph explorer
- Terraform IaC for AWS deployment (ECS Fargate, OpenSearch, ElastiCache, CloudWatch)

### Not Yet Built (Phase 1 — remaining)

- Python NLP workers (spaCy for production-grade NER — current TS NER is a bridge)
- Wikidata/DBpedia entity enrichment
- Obsidian-style bidirectional links in Notes
- Typed relationship composition with weight decay (rules defined, implementation pending)
- Temporal properties on relationships (`createdAt`)
- Entity resolution refinement (alias merging, disambiguation)
- BullMQ job queue integration (currently pipeline runs synchronously in the API request)

### Phase 2 (after Phase 1 is stable)

- Qdrant vector database for semantic search
- Graph Neural Networks for structural embeddings
- GraphRAG for conversational knowledge retrieval
- Temporal visualization

---

## 11. Common Tasks

### Adding support for a new file type

1. Add the content type to `packages/common/src/types/` (the `ContentType` union).
2. Write an extractor function in `packages/ingestion/src/extractors.ts` that takes a `Buffer` and returns `ExtractedContent`.
3. Register it in the `getExtractor()` dispatch map in the same file.
4. The rest of the pipeline (chunking → NER → graph → ES) handles it automatically.

### Adding a new GraphQL query

1. Add the type/query to the `schema` string in `packages/api/src/index.ts`.
2. Add a resolver in the `buildResolvers` function in the same file.
3. Write the corresponding Cypher query (or use an existing one from `packages/graph/src/index.ts`).
4. Add a typed client function in `packages/web/src/lib/api.ts` for the frontend.

### Running Cypher queries directly

Open `http://localhost:7474` (Neo4j Browser) and paste Cypher. Useful examples are in the design doc Section 9.7.

### Resetting all data

```bash
pnpm infra:reset    # tears down containers AND deletes volumes
pnpm infra:up       # fresh start
```

---

## 12. Gotchas and Tips

- **Always `pnpm -r build` after pulling changes** — workspace packages export from `dist/` which must be compiled.
- **Neo4j integers** come back as `{low: number, high: number}` objects, not plain numbers. The API resolvers already handle this with `?.low ??` fallbacks — follow the same pattern.
- **Effect.runPromise** is only called at the boundary (API route handlers). Inside the pipeline, everything stays as Effect values composed with `Effect.gen`.
- **The `@rhizomatic/common` package has zero external dependencies beyond Effect.** Keep it that way — it's the shared vocabulary.
- **Turbo caches builds.** If something seems stale, run `pnpm clean && pnpm -r build`.

---

## 13. Checklist: "Is This Zip Enough?"

With the combined zip (`rhizomatic-combined.zip`) and this onboarding document, a new developer or AI assistant has:

- [x] Full monorepo source code (scaffold + ingestion pipeline overlay, merged)
- [x] Living design document with all architecture decisions, DDD, ontology, ADRs, and roadmap
- [x] Docker Compose infrastructure definitions
- [x] This onboarding guide explaining how everything fits together
- [x] Clear inventory of what's built vs. what's remaining
- [x] Instructions for setup, running, and common development tasks

**What you might still need:**

- [ ] A `.env` file (copy from `.env.example` if present, or create one with Neo4j/ES/Redis connection strings matching docker-compose defaults)
- [ ] Node.js ≥ 22 and pnpm ≥ 9 installed on the host machine
- [ ] Docker installed and running

With those prerequisites met, you should be able to `pnpm install`, `pnpm -r build`, `pnpm infra:up`, and have the system running.
