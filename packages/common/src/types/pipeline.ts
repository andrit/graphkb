/**
 * @rhizomatic/common — Pipeline types
 *
 * These types define the data shapes flowing through the ingestion
 * and processing pipeline. Each stage takes typed input and produces
 * typed output — pure transformations with no hidden state.
 */

import type { ContentType } from "./structural.js";

/**
 * The common output format of all ingestion adapters.
 * Regardless of input type (PDF, CSV, HTML, image), every adapter
 * produces this shape. This is the "adapter pattern" — many inputs,
 * one common output format.
 */
export interface ExtractedContent {
  readonly text: string;
  readonly contentType: ContentType;
  readonly title: string | undefined;
  readonly metadata: Record<string, unknown>;
  readonly sections: ReadonlyArray<ContentSection>;
  readonly tabularData: ReadonlyArray<TabularSheet> | undefined;
  readonly originalFileHash: string;
  readonly originalFileName: string;
}

/** A structural section within a document (heading + content) */
export interface ContentSection {
  readonly heading: string | undefined;
  readonly content: string;
  readonly level: number; // heading depth: 1 = h1, 2 = h2, etc.
  readonly position: number;
}

/** A sheet of tabular data (from CSV/XLSX) */
export interface TabularSheet {
  readonly name: string;
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
}

/**
 * An extracted entity-relationship triple from NLP processing.
 * These become nodes and edges in Neo4j.
 */
export interface ExtractedTriple {
  readonly subject: ExtractedEntity;
  readonly predicate: string; // relationship type
  readonly object: ExtractedEntity;
  readonly confidence: number;
  readonly sourceChunkId: string;
}

/** A raw extracted entity before resolution */
export interface ExtractedEntity {
  readonly surfaceForm: string; // as found in text
  readonly canonicalName: string; // normalized
  readonly kind: string;
  readonly confidence: number;
}

/**
 * Job payload sent via BullMQ from TypeScript to Python workers.
 */
export interface ProcessingJob {
  readonly id: string;
  readonly documentId: string;
  readonly content: ExtractedContent;
  readonly requestedAt: Date;
  readonly priority: number;
}

/**
 * Result returned by Python workers after processing.
 */
export interface ProcessingResult {
  readonly jobId: string;
  readonly documentId: string;
  readonly chunks: ReadonlyArray<ProcessedChunk>;
  readonly entities: ReadonlyArray<ExtractedEntity>;
  readonly triples: ReadonlyArray<ExtractedTriple>;
  readonly completedAt: Date;
}

/** A chunk with its extracted entities and embedding reference */
export interface ProcessedChunk {
  readonly content: string;
  readonly position: number;
  readonly heading: string | undefined;
  readonly entities: ReadonlyArray<ExtractedEntity>;
  readonly embeddingId: string | undefined;
}
