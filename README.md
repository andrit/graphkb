# Rhizomatic

A rhizomatic knowledge base — understanding emerges from connections.

Rhizomatic ingests diverse content (documents, spreadsheets, images, web pages), extracts structured knowledge into a graph database, and surfaces unexpected connections through wiki-style browsing, powerful search, and interactive graph exploration.

Named after Deleuze and Guattari's concept of the *rhizome* — a structure with no fixed center, no hierarchy, where any point can connect to any other.

## Architecture

```
Ingest → Extract → Model → Store → Index → Surface
```

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Ingestion | TypeScript + Apache Tika | Accept diverse content, normalize to common format |
| Processing | Python (spaCy, sentence-transformers) | NLP, entity extraction, embeddings |
| Graph | Neo4j | Knowledge graph with typed composition |
| Search | Elasticsearch | Full-text, faceted, and vector search |
| Queue | Redis + BullMQ | Async job processing between TS and Python |
| API | Fastify + GraphQL | Unified gateway |
| Frontend | Next.js | Wiki browser, search, graph explorer |

## Prerequisites

- **Node.js** >= 22
- **pnpm** >= 9
- **Python** >= 3.12
- **Docker** and **Docker Compose**

## Quick start

```bash
# 1. Clone and install
git clone <repo-url> rhizomatic
cd rhizomatic
pnpm install

# 2. Start infrastructure (Neo4j, Elasticsearch, Redis)
pnpm infra:up

# 3. Copy environment config
cp .env.example .env

# 4. Initialize database schemas
pnpm --filter @rhizomatic/cli dev -- init

# 5. Start the API and frontend in development mode
pnpm dev
```

### Infrastructure commands

```bash
pnpm infra:up       # Start Neo4j, Elasticsearch, Redis in Docker
pnpm infra:down     # Stop containers (data preserved)
pnpm infra:reset    # Stop and delete all data (fresh start)
pnpm infra:logs     # Follow container logs
```

### Service URLs (local development)

| Service | URL |
|---------|-----|
| Web UI | http://localhost:3000 |
| API | http://localhost:4000 |
| GraphQL Playground | http://localhost:4000/graphiql |
| Neo4j Browser | http://localhost:7474 |
| Elasticsearch | http://localhost:9200 |

## Project structure

```
rhizomatic/
├── packages/                    # TypeScript packages (pnpm workspaces)
│   ├── common/                  # Shared types, errors, config, utilities
│   ├── graph/                   # Neo4j client, Cypher queries, ontology
│   ├── search/                  # Elasticsearch client, indexing, vector search
│   ├── ingestion/               # Job queue, pipeline orchestration
│   ├── api/                     # Fastify + GraphQL server
│   ├── web/                     # Next.js frontend
│   ├── storage/                 # File storage abstraction
│   └── cli/                     # Admin and development CLI
├── services/                    # Python processing services
│   ├── processor/               # NLP, chunking, entity extraction (spaCy)
│   ├── embedder/                # Vector embedding generation
│   └── ocr/                     # Image text extraction (pytesseract)
├── infra/                       # Docker Compose, K8s manifests
├── docs/                        # Design doc, ADRs, guides
└── data/                        # Local file storage (gitignored)
```

## Key design decisions

- **TypeScript + Effect** for the main application — typed errors, dependency injection via Layers, generator syntax for readable async pipelines
- **Python** for NLP/ML — spaCy, sentence-transformers, pytesseract
- **Neo4j** for the knowledge graph — Cypher queries, typed relationship composition
- **Elasticsearch** for search — full-text, faceted, and dense_vector for semantic similarity
- **Functional programming** throughout — pure functions, Result types, composable pipelines, immutable data

See `docs/design.md` for the full design document including architecture decisions, graph ontology, and technology roadmap.

## Graph ontology

Two layers: **structural** (system-created from ingestion) and **semantic** (discovered by NLP and curated by you).

**Node types:** Document, Chunk, Source, Entity, Topic, Note, Tag

**Key relationship:** `RELATED_TO` between Entities — carries weight, kind, and source. Typed relationship composition auto-infers transitive connections with weight decay.

## Technology roadmap

**Phase 1 (current):** Core ingestion pipeline, graph storage, search, wiki interface, Apache Tika, Wikidata linkage, temporal properties, relationship composition.

**Phase 2:** Qdrant vector database, Graph Neural Networks for structural embeddings, GraphRAG for LLM-powered conversational queries, temporal visualization.

## License

TBD
