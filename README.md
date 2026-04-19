# Rhizomatic — Knowledge Base System

> Understanding emerges from connections. Start anywhere.

A personal knowledge base that ingests documents, extracts structured knowledge into a graph database, and surfaces unexpected connections through a wiki-style interface.

## Quick start

```bash
# 1. Start infrastructure (Neo4j, Elasticsearch, Redis)
pnpm infra:up

# 2. Install dependencies
pnpm install

# 3. Start the API server (port 4000)
cd packages/api && pnpm dev

# 4. Start the frontend (port 3000)
cd packages/web && pnpm dev

# 5. Open http://localhost:3000/ingest and upload a file
```

## Ingestion pipeline

The end-to-end pipeline that runs when you upload a file:

```
Upload → Validate → Store → Extract Text → Chunk → NER → Neo4j → Elasticsearch
```

**Stage 1 — Validate & detect type** (`@rhizomatic/ingestion/validation`)
- File size check (max 100MB), content type detection from extension
- Supports: PDF, DOCX, CSV, XLSX, HTML, Markdown, TXT, images

**Stage 2 — Store original** (`@rhizomatic/storage`)
- Content-addressable storage (SHA-256 hash as filename)
- Deduplication: same file content → same hash → no duplicate storage

**Stage 3 — Extract text** (`@rhizomatic/ingestion/extractors`)
- Content-type-specific adapters normalize to `ExtractedContent`
- Markdown: section detection, heading parsing
- HTML: tag stripping, heading-based sectioning
- CSV: header-aware row-to-text conversion
- Phase 2: Apache Tika for PDF, DOCX, XLSX, images

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
| `/health` | GET | Service health check |

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
```

## Architecture

```
packages/
├── common/      # Shared types, errors, config, utilities (Effect)
├── graph/       # Neo4j client, Cypher queries, ontology
├── search/      # Elasticsearch client, indexing, full-text + vector search
├── storage/     # Content-addressable file storage
├── ingestion/   # Pipeline: extractors → chunker → NER → orchestrator
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
- **Redis + BullMQ** — Job queue and caching
- **Fastify + Mercurius** — API server with GraphQL
- **Next.js** — Wiki frontend with SSR
- **Docker Compose** — Infrastructure (Neo4j, ES, Redis)
