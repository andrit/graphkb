/**
 * @rhizomatic/ingestion — Text extraction adapters
 *
 * Each adapter takes raw file content (Buffer) and produces an
 * ExtractedContent — the common intermediate representation.
 * This is the anti-corruption layer between messy external formats
 * and the clean domain types.
 *
 * Phase 1: TypeScript-native extractors for text-based formats.
 * Phase 2: Apache Tika integration for PDF, DOCX, XLSX, images.
 */

import type {
  ContentType,
  ExtractedContent,
  ContentSection,
} from "@rhizomatic/common";
import { hashContent } from "@rhizomatic/common";

// ---------------------------------------------------------------------------
// Section detection (shared across adapters)
// ---------------------------------------------------------------------------

/** Detect heading level from markdown-style markers */
const detectHeadingLevel = (line: string): number | null => {
  const match = line.match(/^(#{1,6})\s/);
  if (match?.[1]) return match[1].length;
  // Underline-style headings
  if (/^={3,}$/.test(line.trim())) return 1;
  if (/^-{3,}$/.test(line.trim())) return 2;
  return null;
};

/** Parse text into sections based on headings */
const parseSections = (text: string): ContentSection[] => {
  const lines = text.split("\n");
  const sections: ContentSection[] = [];
  let currentHeading: string | undefined;
  let currentLevel = 0;
  let currentContent: string[] = [];
  let position = 0;

  const flush = () => {
    const content = currentContent.join("\n").trim();
    if (content) {
      sections.push({
        heading: currentHeading,
        content,
        level: currentLevel,
        position: position++,
      });
    }
    currentContent = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const nextLine = lines[i + 1];
    const headingLevel = detectHeadingLevel(line);

    if (headingLevel !== null) {
      flush();
      currentHeading = line.replace(/^#{1,6}\s/, "").trim();
      currentLevel = headingLevel;
    } else if (
      nextLine !== undefined &&
      /^={3,}$/.test(nextLine.trim()) &&
      line.trim().length > 0
    ) {
      flush();
      currentHeading = line.trim();
      currentLevel = 1;
      i++;
    } else if (
      nextLine !== undefined &&
      /^-{3,}$/.test(nextLine.trim()) &&
      line.trim().length > 0
    ) {
      flush();
      currentHeading = line.trim();
      currentLevel = 2;
      i++;
    } else {
      currentContent.push(line);
    }
  }

  flush();
  return sections;
};

// ---------------------------------------------------------------------------
// Markdown extractor
// ---------------------------------------------------------------------------

/** Extract title from markdown (first h1 or first line) */
const extractMarkdownTitle = (text: string): string | undefined => {
  const h1Match = text.match(/^#\s+(.+)$/m);
  if (h1Match?.[1]) return h1Match[1].trim();
  const firstLine = text.split("\n").find((l) => l.trim().length > 0);
  return firstLine?.trim().slice(0, 100);
};

export const extractMarkdown = (
  content: Buffer,
  fileName: string,
): ExtractedContent => {
  const text = content.toString("utf-8");
  return {
    text,
    contentType: "markdown",
    title: extractMarkdownTitle(text),
    metadata: {},
    sections: parseSections(text),
    tabularData: undefined,
    originalFileHash: hashContent(content),
    originalFileName: fileName,
  };
};

// ---------------------------------------------------------------------------
// Plain text extractor (for .txt and fallback)
// ---------------------------------------------------------------------------

export const extractPlainText = (
  content: Buffer,
  fileName: string,
  contentType: ContentType = "markdown",
): ExtractedContent => {
  const text = content.toString("utf-8");
  const firstLine = text.split("\n").find((l) => l.trim().length > 0);
  return {
    text,
    contentType,
    title: firstLine?.trim().slice(0, 100),
    metadata: {},
    sections: parseSections(text),
    tabularData: undefined,
    originalFileHash: hashContent(content),
    originalFileName: fileName,
  };
};

// ---------------------------------------------------------------------------
// HTML extractor
// ---------------------------------------------------------------------------

/** Strip HTML tags and extract text content */
const stripHtml = (html: string): string => {
  // Remove script and style blocks entirely
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Convert block elements to newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");
  // Decode common entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  // Collapse whitespace
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
};

/** Extract title from HTML <title> tag */
const extractHtmlTitle = (html: string): string | undefined => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.trim();
};

/** Extract sections from HTML headings */
const parseHtmlSections = (html: string): ContentSection[] => {
  const sections: ContentSection[] = [];
  // Split on heading tags
  const parts = html.split(/(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)/gi);
  let currentHeading: string | undefined;
  let currentLevel = 0;
  let position = 0;

  for (const part of parts) {
    const headingMatch = part.match(/<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/i);
    if (headingMatch?.[1] && headingMatch[2]) {
      currentHeading = stripHtml(headingMatch[2]);
      currentLevel = parseInt(headingMatch[1], 10);
    } else {
      const content = stripHtml(part).trim();
      if (content) {
        sections.push({
          heading: currentHeading,
          content,
          level: currentLevel,
          position: position++,
        });
      }
    }
  }

  return sections;
};

export const extractHtml = (
  content: Buffer,
  fileName: string,
): ExtractedContent => {
  const html = content.toString("utf-8");
  const text = stripHtml(html);
  return {
    text,
    contentType: "html",
    title: extractHtmlTitle(html),
    metadata: {},
    sections: parseHtmlSections(html),
    tabularData: undefined,
    originalFileHash: hashContent(content),
    originalFileName: fileName,
  };
};

// ---------------------------------------------------------------------------
// CSV extractor
// ---------------------------------------------------------------------------

const parseCsvLine = (line: string): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
};

export const extractCsv = (
  content: Buffer,
  fileName: string,
): ExtractedContent => {
  const text = content.toString("utf-8");
  const lines = text.split("\n").filter((l) => l.trim());
  const headers = lines.length > 0 ? parseCsvLine(lines[0]!) : [];
  const rows = lines.slice(1).map(parseCsvLine);

  // Build a text representation for NLP processing
  const textRepresentation = rows
    .map((row) =>
      headers.map((h, i) => `${h}: ${row[i] ?? ""}`).join(", "),
    )
    .join("\n");

  return {
    text: textRepresentation,
    contentType: "csv",
    title: fileName.replace(/\.[^.]+$/, ""),
    metadata: { rowCount: rows.length, columnCount: headers.length },
    sections: [
      {
        heading: "Data",
        content: textRepresentation,
        level: 1,
        position: 0,
      },
    ],
    tabularData: [{ name: "Sheet1", headers, rows }],
    originalFileHash: hashContent(content),
    originalFileName: fileName,
  };
};

// ---------------------------------------------------------------------------
// Adapter registry — Two-tier extraction strategy
// ---------------------------------------------------------------------------
//
// Native extractors run in-process (fast, no dependencies).
// Tika-backed extractors send the buffer to Apache Tika over HTTP,
// then normalize the output via a format-specific post-processor.
//
// The pipeline receives ExtractedContent regardless of which strategy
// was used — no downstream changes needed.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import { TikaClient } from "./tika-client.js";
import { TIKA_POST_PROCESSORS, TIKA_ACCEPT_HEADERS } from "./post-processors/index.js";
import type { ExtractionError } from "@rhizomatic/common";

/** Synchronous native extractor (no external dependencies) */
type NativeExtractor = (content: Buffer, fileName: string) => ExtractedContent;

/** Strategy assignment: which formats use native vs. Tika extraction */
export type ExtractionStrategy = "native" | "tika";

export const STRATEGY_MAP: Record<ContentType, ExtractionStrategy> = {
  markdown: "native",
  html: "native",
  csv: "native",
  pdf: "tika",
  docx: "tika",
  xlsx: "tika",
  pptx: "tika",
  image: "tika",
};

/** Native extractor registry — only text-based formats */
const nativeExtractors: Partial<Record<ContentType, NativeExtractor>> = {
  markdown: extractMarkdown,
  html: extractHtml,
  csv: extractCsv,
};

/**
 * Get a synchronous native extractor for a content type.
 * Returns undefined if the content type requires Tika.
 */
export const getNativeExtractor = (
  contentType: ContentType,
): NativeExtractor | undefined => nativeExtractors[contentType];

/**
 * Get the appropriate extractor for a content type.
 *
 * For native formats, returns the in-process extractor directly.
 * For Tika-backed formats, returns a fallback plain-text extractor
 * (used when Tika is unavailable). The pipeline should prefer
 * extractWithTika() when TikaClient is available.
 *
 * @deprecated Prefer extractContent() which handles both strategies.
 */
export const getExtractor = (contentType: ContentType): NativeExtractor =>
  nativeExtractors[contentType] ??
  ((content, fileName) => extractPlainText(content, fileName, contentType));

/**
 * Extract content using the two-tier strategy.
 *
 * Native formats are extracted in-process (synchronous, no Effect).
 * Tika-backed formats call TikaClient for text + metadata, then
 * run the format-specific post-processor.
 *
 * Falls back to plain-text extraction if Tika is unavailable or
 * if no post-processor is registered for the content type.
 */
export const extractContent = (
  content: Buffer,
  fileName: string,
  contentType: ContentType,
  tikaAvailable: boolean,
): Effect.Effect<ExtractedContent, ExtractionError, TikaClient> =>
  Effect.gen(function* () {
    const strategy = STRATEGY_MAP[contentType];

    // Native path — run in-process, no Tika needed
    if (strategy === "native") {
      const extractor = nativeExtractors[contentType];
      if (extractor) {
        return extractor(content, fileName);
      }
    }

    // Tika path — call TikaClient, then post-process
    if (strategy === "tika" && tikaAvailable) {
      const postProcessor = TIKA_POST_PROCESSORS[contentType];
      if (postProcessor) {
        const tika = yield* TikaClient;
        const accept = TIKA_ACCEPT_HEADERS[contentType] ?? "text/plain";

        const [tikaText, tikaMetadata] = yield* Effect.all([
          tika.extractText(content, fileName, accept),
          tika.extractMetadata(content, fileName),
        ]);

        return postProcessor(tikaText, tikaMetadata, fileName);
      }
    }

    // Fallback — plain text (graceful degradation when Tika is down)
    return extractPlainText(content, fileName, contentType);
  });
