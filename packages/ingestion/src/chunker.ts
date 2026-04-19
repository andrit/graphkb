/**
 * @rhizomatic/ingestion — Text chunker
 *
 * Splits text into semantically coherent chunks at paragraph
 * and section boundaries. Each chunk is sized to contain enough
 * context for meaningful entity extraction while staying small
 * enough for precise search indexing.
 *
 * Design: pure function, no side effects, no dependencies.
 */

import type { ContentSection, ProcessedChunk } from "@rhizomatic/common";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ChunkerConfig {
  /** Target maximum characters per chunk */
  readonly maxChunkSize: number;
  /** Minimum characters for a chunk to be kept (filters noise) */
  readonly minChunkSize: number;
  /** Overlap characters between adjacent chunks for context continuity */
  readonly overlapSize: number;
}

export const DEFAULT_CHUNKER_CONFIG: ChunkerConfig = {
  maxChunkSize: 1200,
  minChunkSize: 50,
  overlapSize: 100,
};

// ---------------------------------------------------------------------------
// Chunking strategies
// ---------------------------------------------------------------------------

/**
 * Split text into paragraphs (double newline boundaries).
 * Preserves paragraph integrity — never splits mid-paragraph.
 */
const splitParagraphs = (text: string): string[] =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

/**
 * Group paragraphs into chunks that respect the size limit.
 * Greedy: accumulates paragraphs until adding the next would exceed max.
 */
const groupParagraphs = (
  paragraphs: string[],
  maxSize: number,
): string[] => {
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxSize && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
};

// ---------------------------------------------------------------------------
// Main chunker
// ---------------------------------------------------------------------------

/**
 * Chunk text into semantically coherent pieces.
 *
 * Strategy:
 * 1. If sections are available (from heading detection), use them as
 *    natural boundaries. Each section becomes one or more chunks.
 * 2. Within each section (or for unsectioned text), split at paragraph
 *    boundaries and group to fit the size limit.
 * 3. Filter out chunks below the minimum size threshold.
 *
 * Returns ProcessedChunk shapes (without entities — those come from NER).
 */
export const chunkText = (
  text: string,
  sections: ReadonlyArray<ContentSection> = [],
  config: ChunkerConfig = DEFAULT_CHUNKER_CONFIG,
): ProcessedChunk[] => {
  const chunks: ProcessedChunk[] = [];
  let position = 0;

  if (sections.length > 0) {
    // Section-aware chunking: respect document structure
    for (const section of sections) {
      const paragraphs = splitParagraphs(section.content);
      const grouped = groupParagraphs(paragraphs, config.maxChunkSize);

      for (const content of grouped) {
        if (content.length >= config.minChunkSize) {
          chunks.push({
            content,
            position,
            heading: section.heading ?? undefined,
            entities: [],
            embeddingId: undefined,
          });
          position++;
        }
      }
    }
  } else {
    // Flat chunking: split by paragraphs only
    const paragraphs = splitParagraphs(text);
    const grouped = groupParagraphs(paragraphs, config.maxChunkSize);

    for (const content of grouped) {
      if (content.length >= config.minChunkSize) {
        chunks.push({
          content,
          position,
          heading: undefined,
          entities: [],
          embeddingId: undefined,
        });
        position++;
      }
    }
  }

  return chunks;
};

/**
 * Estimate total chunk count for a given text length.
 * Useful for progress reporting before chunking starts.
 */
export const estimateChunkCount = (
  textLength: number,
  config: ChunkerConfig = DEFAULT_CHUNKER_CONFIG,
): number => Math.max(1, Math.ceil(textLength / config.maxChunkSize));
