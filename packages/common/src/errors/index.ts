/**
 * @rhizomatic/common — Error types
 *
 * All errors are tagged unions (discriminated by _tag) for use with
 * Effect's typed error channel. This makes error handling explicit
 * and exhaustive — the compiler tells you if you forget a case.
 */

import { Data } from "effect";

/** Failed to parse or extract content from a file */
export class ExtractionError extends Data.TaggedError("ExtractionError")<{
  readonly message: string;
  readonly contentType: string;
  readonly cause: unknown;
}> {}

/** Failed to connect to or query Neo4j */
export class GraphError extends Data.TaggedError("GraphError")<{
  readonly message: string;
  readonly query: string | undefined;
  readonly cause: unknown;
}> {}

/** Failed to connect to or query Elasticsearch */
export class SearchError extends Data.TaggedError("SearchError")<{
  readonly message: string;
  readonly index: string | undefined;
  readonly cause: unknown;
}> {}

/** Failed to read/write files in blob storage */
export class StorageError extends Data.TaggedError("StorageError")<{
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}> {}

/** Failed to enqueue or process a job via BullMQ/Redis */
export class QueueError extends Data.TaggedError("QueueError")<{
  readonly message: string;
  readonly jobId: string | undefined;
  readonly cause: unknown;
}> {}

/** Entity resolution failed or produced ambiguous results */
export class ResolutionError extends Data.TaggedError("ResolutionError")<{
  readonly message: string;
  readonly entityName: string;
  readonly candidates: ReadonlyArray<string>;
}> {}

/** Configuration is invalid or missing required values */
export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
  readonly key: string;
}> {}

/** A validation rule was violated */
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly field: string;
  readonly value: unknown;
}> {}

/** Union of all domain errors for top-level handling */
export type RhizomaticError =
  | ExtractionError
  | GraphError
  | SearchError
  | StorageError
  | QueueError
  | ResolutionError
  | ConfigError
  | ValidationError;
