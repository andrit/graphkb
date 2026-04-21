# Rhizomatic — Knowledge Base System

> Understanding emerges from connections. Start anywhere.

A personal knowledge base that ingests documents, extracts structured knowledge into a graph database, and surfaces unexpected connections through a wiki-style interface.

## Quick start

### Prerequisites

- **Node.js ≥ 22** and **pnpm ≥ 9**
- **Docker** (for Neo4j, Elasticsearch, Redis, Tika)

### Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Build all workspace packages (CRITICAL — resolves dist/ imports)
pnpm -r build

# 3. Start infrastructure (Neo4j, Elasticsearch, Redis, Tika)
pnpm infra:up

# 4. Wait for services to be healthy
docker compose -f infra/docker-compose.yml ps   # all should show "healthy"

# 5. Start the API server (port 4000)
cd packages/api && pnpm dev

# 6. Start the frontend (port 3000, separate terminal)
cd packages/web && pnpm dev

# 7. Open http://localhost:3000/ingest and upload a file
```

> **If you get `ERR_MODULE_NOT_FOUND`**: you skipped step 2. Workspace packages export from `dist/` which must be compiled first. Run `pnpm -r build` from the repo root.

## Ingestion pipeline

The end-to-end pipeline that runs when you upload a file:

```
Upload → Validate → Store → Extract Text → Chunk → NER → Neo4j → Elasticsearch
```

**Stage 1 — Validate & detect type** (`@rhizomatic/ingestion/validation`)
- File size check (max 100MB), content type detection from extension
- Supports: PDF, DOCX, PPTX, CSV, XLSX, HTML, Markdown, TXT, images

**Stage 2 — Store original** (`@rhizomatic/storage`)
- Content-addressable storage (SHA-256 hash as filename)
- Deduplication: same file content → same hash → no duplicate storage

**Stage 3 — Extract text** (`@rhizomatic/ingestion/extractors`)
- Two-tier strategy: native extractors for text formats, Apache Tika for binary formats
- **Native** (in-process, no dependencies): Markdown, HTML, CSV
- **Tika** (HTTP service, format-specific post-processors): PDF, DOCX, XLSX, PPTX, images/OCR
- Graceful degradation: if Tika is unavailable, binary formats fall back to plain-text extraction
- All adapters normalize to `ExtractedContent` — downstream stages don't know which strategy was used

**Stage 4 — Chunk** (`@rhizomatic/ingestion/chunker`)
- Splits at paragraph/section boundaries (not arbitrary character positions)
- Section-aware: respects document structure from extraction
- Configurable: max/min chunk size, overlap

**Stage 5 — Entity extraction** (`@rhizomatic/ingestion/entities`)
- TypeScript-native NER (Phase 1 — no Python dependency)
- Multi-strategy: capitalized noun phrases, known tech terms, quoted terms
- Kind inference from context: person, org, technology, concept, place
- Co-occurrence relationship discovery within chunks

**Stage 6 — Write to Neo4j** (`@rhizomatic/graph`)
- Document node + Chunk nodes with HAS_CHUNK and NEXT_CHUNK edges
- Entity nodes (MERGE — deduplicates by name)
- MENTIONS edges (Chunk → Entity) with confidence scores
- RELATED_TO edges between co-occurring entities with weights
- Source provenance tracking

**Stage 7 — Index in Elasticsearch** (`@rhizomatic/search`)
- Documents, chunks, and entities indexed for full-text search
- Prepared for vector search (dense_vector mapping, Phase 2)

## API endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/upload` | POST (multipart) | Upload a file → full ingestion pipeline |
| `/graphql` | POST | GraphQL queries and mutations |
| `/graphiql` | GET | GraphiQL interactive query editor |
| `/health` | GET | Service health check (API, Neo4j, Elasticsearch, Tika) |

### Key GraphQL queries

```graphql
# Recent documents with entity counts
{ documents(limit: 10) { id title contentType entityCount } }

# Document with chunks and extracted entities
{ document(id: "doc_xxx") { title chunks { content entities { name kind } } } }

# Entity wiki page with connections and source documents
{ entity(name: "React") { name kind relatedEntities { entity { name } weight } mentioningDocuments { title } } }

# Full-text search across everything
{ search(query: "functional programming") { id title content score type } }

# Hub entities (most connected)
{ hubEntities(limit: 10) { name kind connections } }

# Cross-document bridges (shared entities)
{ documentBridges { doc1 doc2 sharedEntities } }

# Service health
{ health { api neo4j elasticsearch tika } }
```

## Architecture

```
packages/
├── common/      # Shared types, errors, config, utilities (Effect)
├── graph/       # Neo4j client, Cypher queries, ontology
├── search/      # Elasticsearch client, indexing, full-text + vector search
├── storage/     # Content-addressable file storage
├── ingestion/   # Pipeline: extractors → Tika client → chunker → NER → orchestrator
├── api/         # Fastify server: REST upload + GraphQL (Mercurius)
└── web/         # Next.js frontend: wiki, search, graph explorer, ingest UI
```

## Frontend pages

- **`/`** — Wiki home: recent documents, entity pills
- **`/ingest`** — Upload page: drag-and-drop, progress, session history
- **`/search`** — Live search across documents, chunks, entities
- **`/graph`** — SVG graph explorer with entity detail panel
- **`/wiki/doc/[id]`** — Document detail: chunks, extracted entities
- **`/wiki/entity/[name]`** — Entity page: connections, source documents

## Tech stack

- **TypeScript** — API, frontend, pipeline orchestration (Effect for FP)
- **Neo4j** — Knowledge graph (Cypher queries, graph ontology)
- **Elasticsearch** — Full-text search, vector search (Phase 2)
- **Apache Tika** — Binary document extraction (PDF, DOCX, XLSX, PPTX, OCR)
- **Redis + BullMQ** — Job queue and caching
- **Fastify + Mercurius** — API server with GraphQL
- **Next.js** — Wiki frontend with SSR
- **Docker Compose** — Local infrastructure (Neo4j, ES, Redis, Tika)
- **Terraform** — Cloud deployment (AWS ECS, OpenSearch, ElastiCache)

## Documentation

| Document | Location |
|----------|----------|
| **Onboarding guide** | `ONBOARDING.md` |
| **Design document** | `docs/rhizomatic-design-doc.md` |
| **Architecture Decision Records** | `docs/adrs/` |
| **Setup guides** | `docs/guides/` |
| **Terraform IaC** | `infra/terraform/README.md` |
