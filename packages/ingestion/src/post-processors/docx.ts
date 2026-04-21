/**
 * @rhizomatic/ingestion — DOCX post-processor
 *
 * Normalizes Tika's DOCX extraction output into ExtractedContent.
 *
 * Strategy: Request HTML output from Tika (not plain text). Tika maps
 * Word styles (Heading 1, Heading 2) to <h1>, <h2> tags, preserving
 * the document's original structure. We then parse the HTML into
 * ContentSections, reusing heading detection logic.
 *
 * DOCX-specific quirks handled:
 * 1. Heading style preservation (via HTML output)
 * 2. Table extraction into TabularSheet structures
 * 3. Metadata normalization (dc:title, meta:author, meta:word-count)
 */

import type {
  ExtractedContent,
  ContentSection,
  TabularSheet,
} from "@rhizomatic/common";
import { hashContent } from "@rhizomatic/common";
import type { TikaTextResponse, TikaMetadata, TikaPostProcessor } from "../tika-types.js";

// ---------------------------------------------------------------------------
// HTML parsing helpers (lightweight — no DOM dependency)
// ---------------------------------------------------------------------------

/** Strip HTML tags and extract plain text */
const stripHtml = (html: string): string => {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
};

/** Parse sections from HTML heading tags */
const parseHtmlSections = (html: string): ContentSection[] => {
  const sections: ContentSection[] = [];
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

/** Extract tables from HTML into TabularSheet structures */
const extractTables = (html: string): TabularSheet[] => {
  const tables: TabularSheet[] = [];
  const tablePattern = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  let tableIndex = 0;

  while ((tableMatch = tablePattern.exec(html)) !== null) {
    const tableHtml = tableMatch[1] ?? "";
    const rows: string[][] = [];
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowPattern.exec(tableHtml)) !== null) {
      const cells: string[] = [];
      const cellPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch: RegExpExecArray | null;

      while ((cellMatch = cellPattern.exec(rowMatch[1] ?? "")) !== null) {
        cells.push(stripHtml(cellMatch[1] ?? "").trim());
      }

      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    if (rows.length > 0) {
      const headers = rows[0]!;
      const dataRows = rows.slice(1);
      tables.push({
        name: `Table ${tableIndex + 1}`,
        headers,
        rows: dataRows,
      });
      tableIndex++;
    }
  }

  return tables;
};

// ---------------------------------------------------------------------------
// Metadata normalization
// ---------------------------------------------------------------------------

const normalizeDocxMetadata = (
  meta: TikaMetadata,
): {
  title: string | undefined;
  author: string | undefined;
  wordCount: number | undefined;
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
    title: getString(["dc:title", "title", "Title", "meta:title"]),
    author: getString(["dc:creator", "meta:author", "Author", "creator"]),
    wordCount: getNumber(["meta:word-count", "Word-Count"]),
    pageCount: getNumber(["meta:page-count", "Page-Count", "xmpTPg:NPages"]),
  };
};

// ---------------------------------------------------------------------------
// Post-processor
// ---------------------------------------------------------------------------

/**
 * DOCX post-processor.
 *
 * NOTE: The TikaTextResponse for DOCX should be requested with
 * accept="text/html" so that Word heading styles are preserved as HTML tags.
 * If plain text was returned (fallback), we do basic paragraph splitting.
 */
export const postProcessDocx: TikaPostProcessor = (
  tikaText: TikaTextResponse,
  tikaMetadata: TikaMetadata,
  fileName: string,
): ExtractedContent => {
  const meta = normalizeDocxMetadata(tikaMetadata);
  const isHtml = tikaText.text.includes("<") && tikaText.text.includes("</");

  let plainText: string;
  let sections: ContentSection[];
  let tabularData: TabularSheet[] | undefined;

  if (isHtml) {
    // HTML path — preserves heading structure from Word styles
    plainText = stripHtml(tikaText.text);
    sections = parseHtmlSections(tikaText.text);
    const tables = extractTables(tikaText.text);
    tabularData = tables.length > 0 ? tables : undefined;
  } else {
    // Plain text fallback — basic paragraph splitting
    plainText = tikaText.text.replace(/\n{3,}/g, "\n\n").trim();
    sections = plainText
      .split(/\n\s*\n/)
      .filter((p) => p.trim().length > 0)
      .map((content, i) => ({
        heading: undefined,
        content: content.trim(),
        level: 0,
        position: i,
      }));
    tabularData = undefined;
  }

  return {
    text: plainText,
    contentType: "docx",
    title: meta.title ?? fileName.replace(/\.[^.]+$/, ""),
    metadata: {
      author: meta.author,
      wordCount: meta.wordCount,
      pageCount: meta.pageCount,
      extractedBy: "tika",
    },
    sections,
    tabularData,
    originalFileHash: hashContent(Buffer.from(tikaText.text)),
    originalFileName: fileName,
  };
};
