/**
 * @rhizomatic/ingestion — Tika internal types
 *
 * Anti-corruption layer types for Apache Tika HTTP responses.
 * These types exist ONLY inside the ingestion package. They NEVER
 * leak into domain types — post-processors map them to ExtractedContent.
 */

// ---------------------------------------------------------------------------
// Tika text extraction responses
// ---------------------------------------------------------------------------

/** Raw text response from Tika PUT /tika */
export interface TikaTextResponse {
  /** Extracted text content */
  readonly text: string;
  /** MIME type detected by Tika */
  readonly contentType: string;
}

// ---------------------------------------------------------------------------
// Tika metadata
// ---------------------------------------------------------------------------

/**
 * Raw metadata from Tika PUT /meta endpoint.
 *
 * Keys are format-dependent and inconsistent:
 *   PDF:  "pdf:docinfo:title", "pdf:docinfo:author", "xmpTPg:NPages"
 *   DOCX: "dc:title", "meta:author", "meta:word-count"
 *   PPTX: "dc:title", "meta:slide-count"
 *   Image: "Image Width", "Image Height", "Content-Type"
 *
 * Values may be strings or string arrays (e.g., multiple authors).
 * Post-processors normalize this mess into DocumentMetadata.
 */
export interface TikaMetadata {
  readonly [key: string]: string | string[] | undefined;
}

// ---------------------------------------------------------------------------
// Combined response (from /rmeta endpoint)
// ---------------------------------------------------------------------------

/** Combined text + metadata from Tika PUT /rmeta */
export interface TikaRmetaResponse {
  readonly text: string;
  readonly metadata: TikaMetadata;
  readonly contentType: string;
}

// ---------------------------------------------------------------------------
// Post-processor interface
// ---------------------------------------------------------------------------

/**
 * A post-processor normalizes raw Tika output into ExtractedContent.
 * Each format (PDF, DOCX, XLSX, PPTX, image) has its own post-processor
 * that handles the specific quirks of that format's Tika output.
 *
 * Post-processors are pure functions: TikaTextResponse + TikaMetadata → ExtractedContent.
 * They are independently testable with fixture data — no Tika container needed.
 */
export type TikaPostProcessor = (
  text: TikaTextResponse,
  metadata: TikaMetadata,
  fileName: string,
) => import("@rhizomatic/common").ExtractedContent;
