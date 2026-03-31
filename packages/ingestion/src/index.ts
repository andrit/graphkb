/**
 * @rhizomatic/ingestion
 *
 * Orchestrates the ingestion pipeline. Accepts uploaded content,
 * determines its type, stores the original, enqueues processing jobs
 * for Python workers, and writes results to the graph and search index.
 *
 * The pipeline is a composable chain of pure functions:
 * validate → detectType → store → enqueue → awaitResult → persist
 */

import { Context, Effect, Layer } from "effect";
import type {
  ExtractedContent,
  ContentType,
  ProcessingJob,
  ProcessingResult,
} from "@rhizomatic/common";
import {
  QueueError,
  ValidationError,
  generateId,
  now,
} from "@rhizomatic/common";
import { FileStorage } from "@rhizomatic/storage";

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------

export class IngestionService extends Context.Tag("IngestionService")<
  IngestionService,
  {
    /** Ingest a file: store, enqueue for processing, return document ID */
    readonly ingest: (
      content: Buffer,
      fileName: string,
      contentType: ContentType,
    ) => Effect.Effect<
      { documentId: string; jobId: string },
      ValidationError | QueueError
    >;

    /** Handle a completed processing result: persist to graph + search */
    readonly handleResult: (
      result: ProcessingResult,
    ) => Effect.Effect<void, never>;

    /** Get the status of a processing job */
    readonly jobStatus: (
      jobId: string,
    ) => Effect.Effect<
      { status: string; progress: number },
      QueueError
    >;
  }
>() {}

// ---------------------------------------------------------------------------
// Content type detection
// ---------------------------------------------------------------------------

const EXTENSION_MAP: Record<string, ContentType> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".doc": "docx",
  ".csv": "csv",
  ".xlsx": "xlsx",
  ".xls": "xlsx",
  ".html": "html",
  ".htm": "html",
  ".md": "markdown",
  ".markdown": "markdown",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
};

/** Detect content type from file extension */
export const detectContentType = (
  fileName: string,
): Effect.Effect<ContentType, ValidationError> => {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
  const contentType = EXTENSION_MAP[ext];
  if (contentType === undefined) {
    return Effect.fail(
      new ValidationError({
        message: `Unsupported file type: ${ext}`,
        field: "fileName",
        value: fileName,
      }),
    );
  }
  return Effect.succeed(contentType);
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

/** Validate that a file is acceptable for ingestion */
export const validateFile = (
  content: Buffer,
  fileName: string,
): Effect.Effect<void, ValidationError> => {
  if (content.length === 0) {
    return Effect.fail(
      new ValidationError({
        message: "File is empty",
        field: "content",
        value: fileName,
      }),
    );
  }
  if (content.length > MAX_FILE_SIZE) {
    return Effect.fail(
      new ValidationError({
        message: `File exceeds maximum size of ${MAX_FILE_SIZE} bytes`,
        field: "content",
        value: content.length,
      }),
    );
  }
  return Effect.void;
};

// ---------------------------------------------------------------------------
// Pipeline stages (pure functions)
// ---------------------------------------------------------------------------

/** Create a processing job payload */
export const createJob = (
  documentId: string,
  content: ExtractedContent,
): ProcessingJob => ({
  id: generateId("job"),
  documentId,
  content,
  requestedAt: now(),
  priority: 0,
});

// ---------------------------------------------------------------------------
// Live implementation (placeholder — BullMQ integration in next phase)
// ---------------------------------------------------------------------------

export const IngestionServiceLive: Layer.Layer<
  IngestionService,
  never,
 FileStorage
> = Layer.effect(
  IngestionService,
  Effect.gen(function* () {
  
    const storage = yield* FileStorage;

    return {
      ingest: (content, fileName, _contentType) =>
        Effect.gen(function* () {
          yield* validateFile(content, fileName);

          const { hash: _hash } = yield* storage.store(content, fileName).pipe(
            Effect.mapError(
              (e) =>
                new QueueError({
                  message: `Storage failed: ${e.message}`,
                  jobId: undefined,
                  cause: e,
                }),
            ),
          );

          const documentId = generateId("doc");
          const jobId = generateId("job");

          // TODO: Enqueue to BullMQ for Python processing
          // For now, return the IDs for the pipeline to continue

          return { documentId, jobId };
        }),

      handleResult: (_result) =>
        // TODO: Write chunks, entities, and relationships to graph + search
        Effect.void,

      jobStatus: (_jobId) =>
        // TODO: Query BullMQ for job status
        Effect.succeed({ status: "pending", progress: 0 }),
    };
  }),
);
