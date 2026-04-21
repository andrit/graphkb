/**
 * @rhizomatic/ingestion — PDF post-processor
 *
 * Normalizes Tika's PDF extraction output into ExtractedContent.
 *
 * PDF-specific quirks handled:
 * 1. Hard line wraps from PDF layout (reflow into paragraphs)
 * 2. Repeated headers/footers at page boundaries (detect and filter)
 * 3. Section detection via Tika's HTML output (font-size → heading level)
 * 4. Metadata key normalization (pdf:docinfo:title → title)
 */

import type { ExtractedContent, ContentSection } from "@rhizomatic/common";
import { hashContent } from "@rhizomatic/common";
import type { TikaTextResponse, TikaMetadata, TikaPostProcessor } from "../tika-types.js";

// ---------------------------------------------------------------------------
// Text reflow — fix hard line wraps from PDF layout
// ---------------------------------------------------------------------------

/**
 * PDF text typically has hard line breaks at column boundaries.
 * This re-joins lines that are clearly part of the same paragraph.
 *
 * Heuristic: a line break is a "hard wrap" (not a paragraph break) if:
 * - The current line does NOT end with sentence-ending punctuation
 * - The current line is longer than a threshold (not a short heading)
 * - The next line starts with a lowercase letter
 */
const reflowText = (text: string): string => {
  const lines = text.split("\n");
  const result: string[] = [];
  let buffer = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trimEnd();
    const nextLine = i + 1 < lines.length ? lines[i + 1]?.trim() ?? "" : "";

    if (line === "") {
      // Empty line = paragraph break
      if (buffer) {
        result.push(buffer);
        buffer = "";
      }
      result.push("");
      continue;
    }

    const endsWithPunctuation = /[.!?:;]$/.test(line);
    const nextStartsLowercase = /^[a-z]/.test(nextLine);
    const isShortLine = line.length < 40;

    if (
      !endsWithPunctuation &&
      !isShortLine &&
      nextStartsLowercase &&
      nextLine !== ""
    ) {
      // Mid-paragraph hard wrap — join with space
      buffer += (buffer ? " " : "") + line;
    } else {
      // End of paragraph or natural line break
      buffer += (buffer ? " " : "") + line;
      result.push(buffer);
      buffer = "";
    }
  }

  if (buffer) {
    result.push(buffer);
  }

  return result.join("\n");
};

// ---------------------------------------------------------------------------
// Header/footer detection
// ---------------------------------------------------------------------------

/**
 * Detect repeated text that appears at page boundaries (headers/footers).
 * Simple frequency analysis: if a short line appears 3+ times, it's likely
 * a header or footer. Remove all occurrences.
 */
const removeHeadersFooters = (text: string): string => {
  const lines = text.split("\n");
  const frequency = new Map<string, number>();

  for (const line of lines) {
    const trimmed = line.trim();
    // Only consider short lines (headers/footers are typically short)
    if (trimmed.length > 0 && trimmed.length < 80) {
      // Normalize page numbers: "Page 1", "Page 2" → "Page N"
      const normalized = trimmed.replace(/\b\d+\b/g, "N");
      frequency.set(normalized, (frequency.get(normalized) ?? 0) + 1);
    }
  }

  // Lines appearing 3+ times are likely headers/footers
  const repeatedPatterns = new Set<string>();
  for (const [pattern, count] of frequency) {
    if (count >= 3) {
      repeatedPatterns.add(pattern);
    }
  }

  if (repeatedPatterns.size === 0) return text;

  return lines
    .filter((line) => {
      const normalized = line.trim().replace(/\b\d+\b/g, "N");
      return !repeatedPatterns.has(normalized);
    })
    .join("\n");
};

// ---------------------------------------------------------------------------
// Section parsing from Tika HTML output
// ---------------------------------------------------------------------------

/**
 * When Tika returns HTML for PDFs, it preserves some structural info
 * from font sizes. Parse heading-like elements into ContentSections.
 * Falls back to paragraph splitting if no headings are found.
 */
const parsePdfSections = (text: string): ContentSection[] => {
  // Split on what look like section headings:
  // - All-caps lines (common in PDF section headers)
  // - Short lines followed by a blank line (title-like)
  const lines = text.split("\n");
  const sections: ContentSection[] = [];
  let currentHeading: string | undefined;
  let currentContent: string[] = [];
  let position = 0;

  const flush = () => {
    const content = currentContent.join("\n").trim();
    if (content) {
      sections.push({
        heading: currentHeading,
        content,
        level: currentHeading ? 1 : 0,
        position: position++,
      });
    }
    currentContent = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const nextLine = lines[i + 1]?.trim() ?? "";

    // Detect heading-like lines: all caps, short, followed by content
    const isAllCaps = line.length > 3 && line.length < 80 && /^[A-Z\s\d.:]+$/.test(line);
    const isShortBold = line.length > 2 && line.length < 60 && nextLine === "";

    if (isAllCaps && nextLine !== "") {
      flush();
      currentHeading = line
        .split(" ")
        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
        .join(" ");
    } else if (isShortBold && i > 0 && lines[i - 1]?.trim() === "") {
      flush();
      currentHeading = line;
    } else {
      currentContent.push(lines[i]!);
    }
  }

  flush();
  return sections;
};

// ---------------------------------------------------------------------------
// Metadata normalization
// ---------------------------------------------------------------------------

const normalizePdfMetadata = (
  meta: TikaMetadata,
): {
  title: string | undefined;
  author: string | undefined;
  pageCount: number | undefined;
} => {
  const getString = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const val = meta[key];
      if (typeof val === "string" && val.trim()) return val.trim();
      if (Array.isArray(val) && val[0]?.trim()) return val[0].trim();
    }
    return undefined;
  };

  const getNumber = (keys: string[]): number | undefined => {
    const str = getString(keys);
    if (str === undefined) return undefined;
    const num = parseInt(str, 10);
    return isNaN(num) ? undefined : num;
  };

  return {
    title: getString([
      "dc:title",
      "pdf:docinfo:title",
      "title",
      "Title",
      "meta:title",
    ]),
    author: getString([
      "dc:creator",
      "pdf:docinfo:author",
      "meta:author",
      "Author",
      "creator",
    ]),
    pageCount: getNumber([
      "xmpTPg:NPages",
      "meta:page-count",
      "Page-Count",
    ]),
  };
};

// ---------------------------------------------------------------------------
// Post-processor
// ---------------------------------------------------------------------------

export const postProcessPdf: TikaPostProcessor = (
  tikaText: TikaTextResponse,
  tikaMetadata: TikaMetadata,
  fileName: string,
): ExtractedContent => {
  const meta = normalizePdfMetadata(tikaMetadata);

  // Clean up the raw text
  let cleanText = removeHeadersFooters(tikaText.text);
  cleanText = reflowText(cleanText);

  // Remove excessive blank lines
  cleanText = cleanText.replace(/\n{3,}/g, "\n\n").trim();

  const sections = parsePdfSections(cleanText);

  return {
    text: cleanText,
    contentType: "pdf",
    title: meta.title ?? fileName.replace(/\.[^.]+$/, ""),
    metadata: {
      author: meta.author,
      pageCount: meta.pageCount,
      extractedBy: "tika",
    },
    sections,
    tabularData: undefined,
    originalFileHash: hashContent(Buffer.from(tikaText.text)),
    originalFileName: fileName,
  };
};
