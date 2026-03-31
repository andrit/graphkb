/**
 * @rhizomatic/search
 *
 * Elasticsearch client wrapped in Effect Layers. Provides indexing,
 * full-text search, and vector search (dense_vector) capabilities.
 * Treated as a read-optimized projection of the Neo4j graph —
 * every graph change triggers an index update.
 */

import { Context, Effect, Layer } from "effect";
import { Client as EsClient } from "@elastic/elasticsearch";
import type { ElasticsearchConfig } from "@rhizomatic/common";
import { SearchError } from "@rhizomatic/common";

// ---------------------------------------------------------------------------
// Index definitions
// ---------------------------------------------------------------------------

/** Index names used by Rhizomatic */
export const INDEXES = {
  documents: "rhizomatic-documents",
  chunks: "rhizomatic-chunks",
  entities: "rhizomatic-entities",
  notes: "rhizomatic-notes",
} as const;

/** Mapping for the chunks index (includes dense_vector for embeddings) */
export const CHUNKS_MAPPING = {
  properties: {
    id: { type: "keyword" as const },
    content: { type: "text" as const, analyzer: "standard" },
    heading: { type: "text" as const },
    documentId: { type: "keyword" as const },
    position: { type: "integer" as const },
    embedding: {
      type: "dense_vector" as const,
      dims: 384, // all-MiniLM-L6-v2 dimensions
      index: true,
      similarity: "cosine" as const,
    },
  },
} as const;

/** Mapping for the entities index */
export const ENTITIES_MAPPING = {
  properties: {
    id: { type: "keyword" as const },
    name: { type: "text" as const, fields: { keyword: { type: "keyword" as const } } },
    aliases: { type: "text" as const },
    kind: { type: "keyword" as const },
    description: { type: "text" as const },
    mentionCount: { type: "integer" as const },
  },
} as const;

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------

export class SearchClient extends Context.Tag("SearchClient")<
  SearchClient,
  {
    /** Index a document in Elasticsearch */
    readonly index: (
      indexName: string,
      id: string,
      body: Record<string, unknown>,
    ) => Effect.Effect<void, SearchError>;

    /** Full-text search across an index */
    readonly search: (
      indexName: string,
      query: Record<string, unknown>,
      size?: number,
    ) => Effect.Effect<ReadonlyArray<Record<string, unknown>>, SearchError>;

    /** Vector (kNN) search for semantic similarity */
    readonly vectorSearch: (
      indexName: string,
      field: string,
      vector: ReadonlyArray<number>,
      k?: number,
    ) => Effect.Effect<ReadonlyArray<Record<string, unknown>>, SearchError>;

    /** Delete a document from an index */
    readonly remove: (
      indexName: string,
      id: string,
    ) => Effect.Effect<void, SearchError>;

    /** Create an index with mappings if it doesn't exist */
    readonly ensureIndex: (
      indexName: string,
      mappings: Record<string, unknown>,
    ) => Effect.Effect<void, SearchError>;

    /** Check cluster health */
    readonly health: () => Effect.Effect<string, SearchError>;
  }
>() {}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const SearchClientLive = (
  config: ElasticsearchConfig,
): Layer.Layer<SearchClient> => {
  const client = new EsClient({ node: config.url });

  return Layer.succeed(SearchClient, {
    index: (indexName, id, body) =>
      Effect.tryPromise({
        try: () => client.index({ index: indexName, id, body }),
        catch: (error) =>
          new SearchError({
            message: `Failed to index document: ${String(error)}`,
            index: indexName,
            cause: error,
          }),
      }).pipe(Effect.map(() => void 0)),

    search: (indexName, query, size = 10) =>
      Effect.tryPromise({
        try: async () => {
          const result = await client.search({
            index: indexName,
            body: { query, size },
          });
          return result.hits.hits.map((hit) => ({
            _id: hit._id,
            _score: hit._score,
            ...hit._source as Record<string, unknown>,
          }));
        },
        catch: (error) =>
          new SearchError({
            message: `Search failed: ${String(error)}`,
            index: indexName,
            cause: error,
          }),
      }),

    vectorSearch: (indexName, field, vector, k = 10) =>
      Effect.tryPromise({
        try: async () => {
          const result = await client.search({
            index: indexName,
            body: {
              knn: { field, query_vector: [...vector], k, num_candidates: k * 10 },
            },
          });
          return result.hits.hits.map((hit) => ({
            _id: hit._id,
            _score: hit._score,
            ...hit._source as Record<string, unknown>,
          }));
        },
        catch: (error) =>
          new SearchError({
            message: `Vector search failed: ${String(error)}`,
            index: indexName,
            cause: error,
          }),
      }),

    remove: (indexName, id) =>
      Effect.tryPromise({
        try: () => client.delete({ index: indexName, id }),
        catch: (error) =>
          new SearchError({
            message: `Failed to delete document: ${String(error)}`,
            index: indexName,
            cause: error,
          }),
      }).pipe(Effect.map(() => void 0)),

    ensureIndex: (indexName, mappings) =>
      Effect.tryPromise({
        try: async () => {
          const exists = await client.indices.exists({ index: indexName });
          if (!exists) {
            await client.indices.create({
              index: indexName,
              body: { mappings },
            });
          }
        },
        catch: (error) =>
          new SearchError({
            message: `Failed to create index: ${String(error)}`,
            index: indexName,
            cause: error,
          }),
      }),

    health: () =>
      Effect.tryPromise({
        try: async () => {
          const result = await client.cluster.health();
          return result.status;
        },
        catch: (error) =>
          new SearchError({
            message: `Health check failed: ${String(error)}`,
            index: undefined,
            cause: error,
          }),
      }),
  });
};

// ---------------------------------------------------------------------------
// Index initialization helper
// ---------------------------------------------------------------------------

/** Create all required indexes with their mappings */
export const initializeIndexes = Effect.gen(function* () {
  const search = yield* SearchClient;
  yield* search.ensureIndex(INDEXES.chunks, CHUNKS_MAPPING);
  yield* search.ensureIndex(INDEXES.entities, ENTITIES_MAPPING);
  yield* search.ensureIndex(INDEXES.documents, {
    properties: {
      id: { type: "keyword" },
      title: { type: "text" },
      contentType: { type: "keyword" },
      summary: { type: "text" },
      ingestedAt: { type: "date" },
    },
  });
  yield* search.ensureIndex(INDEXES.notes, {
    properties: {
      id: { type: "keyword" },
      content: { type: "text", analyzer: "standard" },
      createdAt: { type: "date" },
    },
  });
});
