/**
 * @rhizomatic/ingestion
 *
 * Orchestrates the ingestion pipeline. Accepts uploaded content,
 * determines its type, stores the original, extracts text, chunks,
 * extracts entities, writes to Neo4j, and indexes in Elasticsearch.
 *
 * The pipeline is a composable chain of pure functions:
 * validate → detectType → extract → chunk → NER → persist → index
 *
 * Text extraction uses a two-tier strategy:
 *   - Native extractors (Markdown, HTML, CSV) run in-process
 *   - Tika-backed extractors (PDF, DOCX, XLSX, PPTX, images) delegate
 *     to Apache Tika over HTTP, then normalize via post-processors
 */

// Validation and content type detection
export { detectContentType, validateFile } from "./validation.js";

// Text extraction adapters
export {
  getExtractor,
  extractContent,
  extractMarkdown,
  extractHtml,
  extractCsv,
  extractPlainText,
  getNativeExtractor,
  STRATEGY_MAP,
} from "./extractors.js";
export type { ExtractionStrategy } from "./extractors.js";

// Tika client (Effect Layer)
export { TikaClient, TikaClientLive, TikaClientTest } from "./tika-client.js";

// Tika post-processors
export {
  postProcessPdf,
  postProcessDocx,
  postProcessXlsx,
  postProcessPptx,
  postProcessImage,
  TIKA_POST_PROCESSORS,
  TIKA_ACCEPT_HEADERS,
} from "./post-processors/index.js";

// Internal Tika types (exported for testing only)
export type {
  TikaTextResponse,
  TikaMetadata,
  TikaPostProcessor,
} from "./tika-types.js";

// Chunking
export { chunkText, estimateChunkCount, DEFAULT_CHUNKER_CONFIG } from "./chunker.js";
export type { ChunkerConfig } from "./chunker.js";

// Entity extraction
export { extractEntities, extractRelationships, extractFromChunks } from "./entities.js";

// Complete pipeline
export { runIngestionPipeline } from "./pipeline.js";
export type { IngestionResult } from "./pipeline.js";
