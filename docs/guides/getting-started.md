# Getting started

This guide walks you through setting up Rhizomatic for local development.

## 1. Prerequisites

Install these before proceeding:

- **Node.js 22+**: [nodejs.org](https://nodejs.org) or via `nvm install 22`
- **pnpm 9+**: `npm install -g pnpm`
- **Docker Desktop** or Docker Engine with Docker Compose
- **Python 3.12+**: For processing services

Verify your setup:

```bash
node --version    # should be >= 22.0.0
pnpm --version    # should be >= 9.0.0
docker --version  # any recent version
python3 --version # should be >= 3.12
```

## 2. Install dependencies

```bash
cd rhizomatic
pnpm install
```

This installs all TypeScript dependencies across all workspace packages.

For Python services:

```bash
cd services
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[processor,embedder,ocr,dev]"
python3 -m spacy download en_core_web_sm
```

## 3. Start infrastructure

```bash
pnpm infra:up
```

This starts Neo4j, Elasticsearch, and Redis in Docker containers. Data persists across restarts via named volumes.

Verify services are running:

- Neo4j Browser: http://localhost:7474 (login: `neo4j` / `rhizomatic-dev`)
- Elasticsearch: http://localhost:9200
- Redis: `redis-cli ping` should return `PONG`

## 4. Initialize schemas

```bash
pnpm --filter @rhizomatic/cli dev -- init
```

This creates Neo4j constraints/indexes and Elasticsearch index mappings.

## 5. Start the application

In separate terminals:

```bash
# Terminal 1: API server
pnpm --filter @rhizomatic/api dev

# Terminal 2: Web frontend
pnpm --filter @rhizomatic/web dev

# Terminal 3 (optional): Python processor
cd services && source .venv/bin/activate
python -m processor.worker
```

## 6. Verify

- API: http://localhost:4000/health
- Web: http://localhost:3000
- Neo4j: http://localhost:7474 → run `MATCH (n) RETURN count(n)`

## Troubleshooting

**Elasticsearch won't start**: On Linux, you may need to increase the vm.max_map_count:
```bash
sudo sysctl -w vm.max_map_count=262144
```

**Neo4j connection refused**: Wait 30 seconds after `docker compose up` — Neo4j's JVM needs time to warm up. The health check handles this automatically.

**pnpm install fails**: Make sure you're using pnpm 9+. Delete `node_modules` and `pnpm-lock.yaml`, then retry.
