# ADR-006: Async Ingestion Pipeline via BullMQ

> **Status:** Proposed
> **Date:** 2026-04-15
> **Context:** The ingestion pipeline currently runs synchronously inside the `/upload` HTTP request handler. This blocks the API on large files, risks timeouts, and loses work if the client disconnects.

---

## Decision

Split the ingestion pipeline into a **fast accept phase** (HTTP handler) and a **heavy process phase** (BullMQ worker), connected by a Redis-backed job queue.

---

## 1. Problem

`runIngestionPipeline` in `packages/ingestion/src/pipeline.ts` is called directly inside the `POST /upload` route in `packages/api/src/index.ts`. The entire chain — validate → store → extract → chunk → NER → Neo4j write → ES index — runs within a single HTTP request/response cycle.

Consequences:
- Large files block the Fastify event loop.
- Client-side timeouts kill in-progress work with no recovery.
- No visibility into processing status.
- No retry on transient Neo4j/ES failures.
- Cannot scale processing independently of the API.

---

## 2. Pipeline Split Point

The natural seam is between **file storage** (Stage 2) and **text extraction** (Stage 3).

**Fast path (HTTP handler — Stages 1–2):**
1. `validateAndDetect()` — file size, extension, content type mapping.
2. `storeOriginal()` — write to content-addressable blob storage, get hash.
3. Enqueue job with file hash + metadata.
4. Return `{ jobId, status: "queued" }` immediately.

**Worker path (BullMQ consumer — Stages 3–7):**
3. `extractText()` — content-type-specific adapter.
4. `chunkText()` — section-aware paragraph chunking.
5. `extractFromChunks()` — NER + co-occurrence relationships.
6. `writeDocumentToGraph()` + `writeEntitiesToGraph()` — Neo4j writes.
7. `indexInElasticsearch()` — ES projection.

The worker retrieves the original file from `FileStorage` using the hash stored in the job payload.

---

## 3. Job Payload Type

The existing `ProcessingJob` type in `common/types/pipeline.ts` carries `ExtractedContent`, which is post-extraction. Since we split *before* extraction, we need a lighter type for the enqueue payload:

```typescript
/** Job payload for the ingestion queue (enqueued by API, consumed by worker) */
interface IngestionJob {
  readonly id: string;
  readonly documentId: string;
  readonly fileHash: string;
  readonly fileName: string;
  readonly contentType: ContentType;
  readonly enqueuedAt: Date;
  readonly priority: number;
}
```

This goes in `@rhizomatic/common` alongside the existing pipeline types.

The existing `ProcessingJob` and `ProcessingResult` types remain valid for the Phase 2 Python NLP workers (which receive *already-extracted* content from the TS orchestrator). The two job types serve different queue stages.

---

## 4. JobQueue as an Effect Layer

Following the established pattern (`GraphClient`, `SearchClient`, `FileStorage`), BullMQ is wrapped behind an Effect `Context.Tag`:

```typescript
export class JobQueue extends Context.Tag("JobQueue")<
  JobQueue,
  {
    /** Enqueue an ingestion job. Returns the job ID. */
    readonly enqueue: (job: IngestionJob) => Effect.Effect<string, QueueError>;

    /** Get the current status of a job. */
    readonly getStatus: (jobId: string) => Effect.Effect<JobStatus, QueueError>;

    /** Subscribe to job completion events. */
    readonly onCompleted: (
      handler: (result: IngestionResult) => Effect.Effect<void, never>,
    ) => Effect.Effect<void, QueueError>;

    /** Subscribe to job failure events. */
    readonly onFailed: (
      handler: (jobId: string, error: string) => Effect.Effect<void, never>,
    ) => Effect.Effect<void, QueueError>;

    /** Graceful shutdown — wait for active jobs, close connections. */
    readonly close: () => Effect.Effect<void, QueueError>;
  }
>() {}
```

The `JobQueueLive` layer takes `RedisConfig` and constructs BullMQ `Queue` / `Worker` instances internally. BullMQ types never leak beyond this boundary.

### Anti-corruption rationale

The rest of the codebase depends on the `JobQueue` interface, not on BullMQ. This means:
- Unit tests can provide a `JobQueueTest` layer (in-memory queue, instant processing).
- We could swap to a different broker (e.g., RabbitMQ, SQS) without touching callers.
- BullMQ version upgrades are isolated to one file.

---

## 5. Job Status State Machine

```
queued → processing → completed
                    → failed → (retry) → processing
                             → dead (max retries exceeded)
```

BullMQ tracks this natively. We expose it via:

```typescript
type JobStatus =
  | { readonly _tag: "queued"; readonly position: number }
  | { readonly _tag: "processing"; readonly startedAt: Date }
  | { readonly _tag: "completed"; readonly result: IngestionResult }
  | { readonly _tag: "failed"; readonly error: string; readonly retryCount: number }
  | { readonly _tag: "dead"; readonly error: string }
  | { readonly _tag: "unknown" };
```

Tagged union — consistent with the existing error types and pattern-matchable.

---

## 6. API Surface Changes

### New GraphQL query

```graphql
type Query {
  jobStatus(id: ID!): JobStatus!
}

type JobStatus {
  id: ID!
  status: String!         # queued | processing | completed | failed | dead
  result: IngestResult     # populated when completed
  error: String            # populated when failed/dead
  enqueuedAt: String!
  startedAt: String
  completedAt: String
}
```

### Modified `/upload` response

Before: returns `IngestionResult` (synchronous).
After: returns `{ jobId: string, status: "queued" }`.

The frontend switches from awaiting the upload response to polling `jobStatus(id)` on an interval (e.g., 2 seconds).

### Optional: REST endpoint

`GET /jobs/:id` as a simpler alternative for non-GraphQL consumers.

---

## 7. Worker Process

The worker is a standalone Node.js process in `packages/ingestion/src/worker.ts` with its own entry point. It:

1. Loads config via `loadConfigFromEnv()`.
2. Constructs the same Effect layers as the API (GraphClient, SearchClient, FileStorage).
3. Connects to BullMQ and listens on the `ingestion` queue.
4. For each job: retrieves the file from storage → runs Stages 3–7 → reports result/failure.

Run command: `pnpm --filter @rhizomatic/ingestion worker`

This mirrors the pattern already sketched in `services/processor/worker.py` — isolated workers behind the queue boundary.

---

## 8. Retry and Error Strategy

- **Retries:** 3 attempts with exponential backoff (1s, 4s, 16s base delays).
- **Transient vs. permanent failures:** Neo4j/ES connection errors are retryable. `ValidationError` and `ExtractionError` are permanent — fail immediately, no retry.
- **Dead letter:** After max retries, the job moves to `dead` status. A future admin UI can inspect and replay dead jobs.
- **Error channel:** The worker wraps pipeline execution in `Effect.catchAll`. The `QueueError` type (already in `common/errors`) is used for queue-level failures. Pipeline errors are serialized into the job's failure reason.

---

## 9. Idempotency

Files are content-addressed (`sha256:...` hash). Before enqueuing:

1. Check `FileStorage.exists(hash)` — file already stored?
2. Query Neo4j: `MATCH (d:Document {fileHash: $hash}) RETURN d` — already ingested?

If both are true, return the existing document ID instead of enqueuing. This prevents reprocessing on duplicate uploads. `FileStorage.exists()` is already implemented but not called in the current pipeline.

---

## 10. Future: Event-Driven Extensions

Once the queue is in place, other consumers can subscribe to job events:

- **Webhook notifications** on completion/failure.
- **Python NLP workers** (Phase 2) consume from a secondary queue, receive `ProcessingJob` payloads with `ExtractedContent`, and produce `ProcessingResult`.
- **Embedding generation** (Phase 2) as a downstream job triggered by ingestion completion.

The BullMQ `Flow` primitive supports parent-child job dependencies, enabling multi-stage pipelines without custom orchestration.

---

## 11. File Inventory

| File | Change |
|------|--------|
| `packages/common/src/types/pipeline.ts` | Add `IngestionJob`, `JobStatus` types |
| `packages/common/src/types/index.ts` | Re-export new types |
| `packages/ingestion/src/queue.ts` | New — `JobQueue` Effect Layer definition + `JobQueueLive` |
| `packages/ingestion/src/worker.ts` | New — standalone worker process entry point |
| `packages/ingestion/src/pipeline.ts` | Refactor: extract `runProcessingStages()` (Stages 3–7) as a reusable function |
| `packages/ingestion/package.json` | Add `bullmq` dependency, add `worker` script |
| `packages/api/src/index.ts` | Modify `/upload` to enqueue; add `jobStatus` query + resolver |
| `packages/web/src/app/ingest/page.tsx` | Switch to polling-based status display |
| `packages/web/src/lib/api.ts` | Add `getJobStatus()` client function |
| `infra/docker-compose.yml` | No change — Redis is already included |

---

## 12. Consequences

**Positive:**
- API never blocks on heavy processing.
- Failed ingestions are retried automatically.
- Processing can scale horizontally (multiple worker instances).
- Job status is visible to users.
- Foundation for Phase 2 multi-stage pipelines (TS → Python NLP → embeddings).

**Negative:**
- Added operational complexity (worker process to manage).
- Polling-based status requires frontend changes.
- Redis becomes a harder dependency (currently optional if queue isn't used).
- Debugging is harder when the enqueue and processing happen in different processes.

**Mitigations:**
- Worker runs alongside the API in Docker Compose — same deployment unit for dev.
- Structured logging with job IDs for cross-process tracing.
- `JobQueueTest` layer for deterministic unit testing without Redis.
