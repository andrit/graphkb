/**
 * @rhizomatic/ingestion — Pipeline orchestrator
 *
 * The complete ingestion pipeline as a composable Effect chain:
 * validate → detect type → extract text → chunk → extract entities
 * → write to Neo4j → index in Elasticsearch
 *
 * Each stage is a pure function. The pipeline is a single Effect
 * that composes them with typed error handling and dependency injection.
 */

import { Effect } from "effect";
import type {
  ContentType,
  Document,
  Chunk,
  Entity,
  ExtractedContent,
  ProcessedChunk,
  ExtractedEntity,
  ExtractedTriple,
} from "@rhizomatic/common";
import {
  ExtractionError,
  GraphError,
  SearchError,
  StorageError,
  ValidationError,
  generateId,
  now,
} from "@rhizomatic/common";
import { GraphClient, queries } from "@rhizomatic/graph";
import { SearchClient, INDEXES } from "@rhizomatic/search";
import { FileStorage } from "@rhizomatic/storage";
import { extractContent } from "./extractors.js";
import { TikaClient } from "./tika-client.js";
import { chunkText } from "./chunker.js";
import { extractFromChunks } from "./entities.js";
import { detectContentType, validateFile } from "./validation.js";

// ---------------------------------------------------------------------------
// Pipeline result types
// ---------------------------------------------------------------------------

export interface IngestionResult {
  readonly documentId: string;
  readonly title: string;
  readonly chunkCount: number;
  readonly entityCount: number;
  readonly relationshipCount: number;
  readonly contentType: ContentType;
  readonly fileHash: string;
}

// ---------------------------------------------------------------------------
// Stage 1: Validate and detect content type
// ---------------------------------------------------------------------------

const validateAndDetect = (
  content: Buffer,
  fileName: string,
  contentTypeOverride?: ContentType,
) =>
  Effect.gen(function* () {
    yield* validateFile(content, fileName);
    const contentType = contentTypeOverride ?? (yield* detectContentType(fileName));
    return { content, fileName, contentType };
  });

// ---------------------------------------------------------------------------
// Stage 2: Store original file
// ---------------------------------------------------------------------------

const storeOriginal = (content: Buffer, fileName: string) =>
  Effect.gen(function* () {
    const storage = yield* FileStorage;
    const result = yield* storage.store(content, fileName);
    return result;
  });

// ---------------------------------------------------------------------------
// Stage 3: Extract text (two-tier: native or Tika)
// ---------------------------------------------------------------------------

const extractText = (
  content: Buffer,
  fileName: string,
  contentType: ContentType,
  tikaAvailable: boolean,
): Effect.Effect<ExtractedContent, ExtractionError, TikaClient> =>
  extractContent(content, fileName, contentType, tikaAvailable);

// ---------------------------------------------------------------------------
// Stage 4: Write document + chunks to Neo4j
// ---------------------------------------------------------------------------

const writeDocumentToGraph = (
  doc: Document,
  chunks: ProcessedChunk[],
) =>
  Effect.gen(function* () {
    const graph = yield* GraphClient;

    // Create Document node
    const docQuery = queries.createDocument(doc);
    yield* graph.write(docQuery.cypher, docQuery.params);

    // Create Chunk nodes with HAS_CHUNK edges
    for (const chunk of chunks) {
      const chunkNode: Chunk = {
        id: `${doc.id}_chunk_${chunk.position}`,
        content: chunk.content,
        position: chunk.position,
        heading: chunk.heading,
        charCount: chunk.content.length,
        documentId: doc.id,
      };
      const chunkQuery = queries.createChunk(chunkNode);
      yield* graph.write(chunkQuery.cypher, { ...chunkQuery.params });

      // Create NEXT_CHUNK edges for reading order
      if (chunk.position > 0) {
        const prevChunkId = `${doc.id}_chunk_${chunk.position - 1}`;
        yield* graph.write(
          `MATCH (prev:Chunk {id: $prevId}), (curr:Chunk {id: $currId})
           CREATE (prev)-[:NEXT_CHUNK]->(curr)`,
          { prevId: prevChunkId, currId: chunkNode.id },
        );
      }
    }

    // Create Source node (upload source)
    const sourceId = "source_uploads";
    yield* graph.write(
      `MERGE (s:Source {id: $id})
       ON CREATE SET s.name = "File Uploads", s.kind = "upload",
                     s.trustLevel = 0.8
       WITH s
       MATCH (d:Document {id: $docId})
       MERGE (d)-[:FROM_SOURCE {fetchedAt: datetime()}]->(s)`,
      { id: sourceId, docId: doc.id },
    );
  });

// ---------------------------------------------------------------------------
// Stage 5: Write entities + relationships to Neo4j
// ---------------------------------------------------------------------------

const writeEntitiesToGraph = (
  documentId: string,
  chunks: ProcessedChunk[],
  entities: ExtractedEntity[],
  triples: ExtractedTriple[],
) =>
  Effect.gen(function* () {
    const graph = yield* GraphClient;

    // Merge Entity nodes (create or update)
    for (const entity of entities) {
      const entityNode: Entity = {
        id: generateId("ent"),
        name: entity.canonicalName,
        aliases: [entity.surfaceForm.toLowerCase()],
        kind: entity.kind,
        description: undefined,
        firstSeen: now(),
        mentionCount: 1,
      };
      const mergeQuery = queries.mergeEntity(entityNode);
      yield* graph.write(mergeQuery.cypher, mergeQuery.params);
    }

    // Create MENTIONS edges (Chunk → Entity)
    for (const chunk of chunks) {
      const chunkId = `${documentId}_chunk_${chunk.position}`;
      for (const entity of chunk.entities) {
        const mentionQuery = queries.createMention(
          chunkId,
          entity.canonicalName,
          entity.confidence,
        );
        yield* graph.write(mentionQuery.cypher, mentionQuery.params);
      }
    }

    // Create RELATED_TO edges between co-occurring entities
    const seenPairs = new Set<string>();
    for (const triple of triples) {
      const pairKey = [triple.subject.canonicalName, triple.object.canonicalName]
        .sort()
        .join("|||");
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const relQuery = queries.relateEntities(
        triple.subject.canonicalName,
        triple.object.canonicalName,
        {
          weight: triple.confidence,
          kind: "co-occurrence",
          source: "auto",
          createdAt: now(),
        },
      );
      yield* graph.write(relQuery.cypher, relQuery.params);
    }
  });

// ---------------------------------------------------------------------------
// Stage 6: Index in Elasticsearch
// ---------------------------------------------------------------------------

const indexInElasticsearch = (
  doc: Document,
  chunks: ProcessedChunk[],
  entities: ExtractedEntity[],
) =>
  Effect.gen(function* () {
    const search = yield* SearchClient;

    // Index the document
    yield* search.index(INDEXES.documents, doc.id, {
      id: doc.id,
      title: doc.title,
      contentType: doc.contentType,
      summary: doc.summary,
      ingestedAt: doc.ingestedAt.toISOString(),
    });

    // Index each chunk
    for (const chunk of chunks) {
      const chunkId = `${doc.id}_chunk_${chunk.position}`;
      yield* search.index(INDEXES.chunks, chunkId, {
        id: chunkId,
        content: chunk.content,
        heading: chunk.heading,
        documentId: doc.id,
        position: chunk.position,
        // embedding: will be added in Phase 2
      });
    }

    // Index entities
    for (const entity of entities) {
      // Use name as ES doc ID for deduplication
      const esId = `ent_${entity.canonicalName.toLowerCase().replace(/\s+/g, "_")}`;
      yield* search.index(INDEXES.entities, esId, {
        id: esId,
        name: entity.canonicalName,
        aliases: [entity.surfaceForm],
        kind: entity.kind,
        mentionCount: 1,
      });
    }
  });

// ---------------------------------------------------------------------------
// Complete pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full ingestion pipeline for a single file.
 *
 * Flow:
 * 1. Validate file (size, type)
 * 2. Store original in blob storage
 * 3. Extract text (native for text formats, Tika for binary formats)
 * 4. Chunk text at paragraph/section boundaries
 * 5. Extract entities and relationships
 * 6. Write Document + Chunks + Entities + Relationships to Neo4j
 * 7. Index Document + Chunks + Entities in Elasticsearch
 *
 * Returns a summary of what was ingested.
 */
export const runIngestionPipeline = (
  fileContent: Buffer,
  fileName: string,
  contentTypeOverride?: ContentType,
): Effect.Effect<
  IngestionResult,
  ValidationError | ExtractionError | StorageError | GraphError | SearchError,
  FileStorage | GraphClient | SearchClient | TikaClient
> =>
  Effect.gen(function* () {
    // Stage 0: Check Tika availability (non-fatal — graceful degradation)
    const tika = yield* TikaClient;
    const tikaAvailable = yield* Effect.catchAll(
      tika.health(),
      () => Effect.succeed(false),
    );

    if (!tikaAvailable) {
      console.warn(
        "Tika unavailable — binary format extraction will use plain-text fallback",
      );
    }

    // Stage 1: Validate
    const { contentType } = yield* validateAndDetect(
      fileContent,
      fileName,
      contentTypeOverride,
    );

    // Stage 2: Store original
    const { hash: fileHash } = yield* storeOriginal(fileContent, fileName);

    // Stage 3: Extract text (native or Tika, depending on content type)
    const extracted = yield* extractText(
      fileContent,
      fileName,
      contentType,
      tikaAvailable,
    );
    const title = extracted.title ?? fileName.replace(/\.[^.]+$/, "");

    // Stage 4: Chunk
    const rawChunks = chunkText(extracted.text, extracted.sections);

    // Stage 5: Entity extraction
    const documentId = generateId("doc");
    const { enrichedChunks, allEntities, allTriples } = extractFromChunks(
      rawChunks,
      documentId,
    );

    // Build Document domain object
    const doc: Document = {
      id: documentId,
      title,
      contentType,
      fileHash,
      ingestedAt: now(),
      summary: extracted.text.slice(0, 300),
      metadata: {
        author: undefined,
        year: undefined,
        pageCount: undefined,
        language: undefined,
        ...(extracted.metadata as Record<string, unknown>),
        wordCount: extracted.text.split(/\s+/).length,
        fileName,
      },
    };

    // Stage 6: Write to Neo4j
    yield* writeDocumentToGraph(doc, enrichedChunks);
    yield* writeEntitiesToGraph(
      documentId,
      enrichedChunks,
      allEntities,
      allTriples,
    );

    // Stage 7: Index in Elasticsearch
    yield* indexInElasticsearch(doc, enrichedChunks, allEntities);

    return {
      documentId,
      title,
      chunkCount: enrichedChunks.length,
      entityCount: allEntities.length,
      relationshipCount: allTriples.length,
      contentType,
      fileHash,
    };
  });
