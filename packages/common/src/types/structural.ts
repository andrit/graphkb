/**
 * @rhizomatic/common — Graph node types (structural layer)
 *
 * These types represent the system-created nodes in the knowledge graph.
 * They are produced by the ingestion and processing pipeline.
 */

/** Content types supported by the ingestion layer */
export type ContentType = "pdf" | "docx" | "pptx" | "csv" | "xlsx" | "html" | "image" | "markdown";

/** Source origin types */
export type SourceKind = "web" | "file" | "upload" | "api";

/**
 * :Document — An ingested source file.
 * Created when content enters the system. Links to blob storage via fileHash.
 */
export interface Document {
  readonly id: string;
  readonly title: string;
  readonly contentType: ContentType;
  readonly fileHash: string;
  readonly ingestedAt: Date;
  readonly summary: string | undefined;
  readonly metadata: DocumentMetadata;
}

export interface DocumentMetadata {
  readonly author: string | undefined;
  readonly year: number | undefined;
  readonly pageCount: number | undefined;
  readonly wordCount: number | undefined;
  readonly language: string | undefined;
  readonly [key: string]: unknown;
}

/**
 * :Chunk — A semantically coherent piece of a Document.
 * Broken at paragraph/section boundaries, not arbitrary character splits.
 */
export interface Chunk {
  readonly id: string;
  readonly content: string;
  readonly position: number;
  readonly heading: string | undefined;
  readonly charCount: number;
  readonly documentId: string;
}

/**
 * :Source — Provenance tracking.
 * Where a document came from. Multiple documents can share a source.
 */
export interface Source {
  readonly id: string;
  readonly name: string;
  readonly kind: SourceKind;
  readonly uri: string | undefined;
  readonly trustLevel: number; // 0.0 to 1.0
}
