/**
 * @rhizomatic/ingestion — XLSX post-processor
 *
 * Normalizes Tika's XLSX/XLS extraction output into ExtractedContent.
 *
 * Tika returns spreadsheet content as tab-separated blocks with sheet
 * name headers. This post-processor parses that into TabularSheet[]
 * matching the shape the CSV extractor already produces, plus a text
 * representation for consistent NER downstream.
 *
 * XLSX-specific quirks handled:
 * 1. Multi-sheet detection and parsing
 * 2. Tab-separated value parsing
 * 3. Text representation for NER (header: value format)
 * 4. Metadata normalization (sheet count, row/column counts)
 */

import type {
  ExtractedContent,
  TabularSheet,
} from "@rhizomatic/common";
import { hashContent } from "@rhizomatic/common";
import type { TikaTextResponse, TikaMetadata, TikaPostProcessor } from "../tika-types.js";

// ---------------------------------------------------------------------------
// Sheet parsing
// ---------------------------------------------------------------------------

/**
 * Parse Tika's spreadsheet output into TabularSheet structures.
 *
 * Tika typically returns XLSX content as tab-separated text.
 * If Tika returns HTML (with <table> tags), we parse that instead.
 */
const parseSheets = (text: string): TabularSheet[] => {
  // Check if it's HTML table output
  if (text.includes("<table") && text.includes("</table>")) {
    return parseSheetsFromHtml(text);
  }

  return parseSheetsFromTsv(text);
};

/** Parse sheets from tab-separated text */
const parseSheetsFromTsv = (text: string): TabularSheet[] => {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return [{ name: "Sheet1", headers: [], rows: [] }];
  }

  // Check for sheet name markers (Tika sometimes prefixes with "Sheet: Name")
  const sheetBlocks: { name: string; lines: string[] }[] = [];
  let currentSheet = { name: "Sheet1", lines: [] as string[] };

  for (const line of lines) {
    const sheetMatch = line.match(/^(?:Sheet|Worksheet)\s*[:=]\s*(.+)$/i);
    if (sheetMatch) {
      if (currentSheet.lines.length > 0) {
        sheetBlocks.push(currentSheet);
      }
      currentSheet = { name: sheetMatch[1]?.trim() ?? "Sheet", lines: [] };
    } else {
      currentSheet.lines.push(line);
    }
  }
  if (currentSheet.lines.length > 0) {
    sheetBlocks.push(currentSheet);
  }

  return sheetBlocks.map((block) => {
    const rows = block.lines.map((line) => line.split("\t"));
    const headers = rows.length > 0 ? rows[0]! : [];
    const dataRows = rows.slice(1);

    return {
      name: block.name,
      headers,
      rows: dataRows,
    };
  });
};

/** Parse sheets from HTML table output */
const parseSheetsFromHtml = (html: string): TabularSheet[] => {
  const sheets: TabularSheet[] = [];
  const tablePattern = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let match: RegExpExecArray | null;
  let idx = 0;

  const stripTags = (s: string): string =>
    s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();

  while ((match = tablePattern.exec(html)) !== null) {
    const tableHtml = match[1] ?? "";
    const rows: string[][] = [];
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowPattern.exec(tableHtml)) !== null) {
      const cells: string[] = [];
      const cellPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch: RegExpExecArray | null;

      while ((cellMatch = cellPattern.exec(rowMatch[1] ?? "")) !== null) {
        cells.push(stripTags(cellMatch[1] ?? ""));
      }
      if (cells.length > 0) rows.push(cells);
    }

    if (rows.length > 0) {
      sheets.push({
        name: `Sheet${idx + 1}`,
        headers: rows[0]!,
        rows: rows.slice(1),
      });
      idx++;
    }
  }

  return sheets;
};

// ---------------------------------------------------------------------------
// Text representation for NER
// ---------------------------------------------------------------------------

/** Build header: value text from tabular data (same format as CSV extractor) */
const buildTextRepresentation = (sheets: TabularSheet[]): string =>
  sheets
    .map((sheet) => {
      const header = sheets.length > 1 ? `## ${sheet.name}\n\n` : "";
      const rows = sheet.rows
        .map((row) =>
          sheet.headers.map((h, i) => `${h}: ${row[i] ?? ""}`).join(", "),
        )
        .join("\n");
      return header + rows;
    })
    .join("\n\n");

// ---------------------------------------------------------------------------
// Metadata normalization
// ---------------------------------------------------------------------------

const normalizeXlsxMetadata = (
  meta: TikaMetadata,
  sheets: TabularSheet[],
): Record<string, unknown> => {
  const getString = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const val = meta[key];
      if (typeof val === "string" && val.trim()) return val.trim();
      if (Array.isArray(val) && val[0]?.trim()) return val[0].trim();
    }
    return undefined;
  };

  const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0);
  const totalCols = sheets.reduce(
    (max, s) => Math.max(max, s.headers.length),
    0,
  );

  return {
    author: getString(["dc:creator", "meta:author"]),
    sheetCount: sheets.length,
    totalRows,
    totalColumns: totalCols,
    extractedBy: "tika",
  };
};

// ---------------------------------------------------------------------------
// Post-processor
// ---------------------------------------------------------------------------

export const postProcessXlsx: TikaPostProcessor = (
  tikaText: TikaTextResponse,
  tikaMetadata: TikaMetadata,
  fileName: string,
): ExtractedContent => {
  const sheets = parseSheets(tikaText.text);
  const textRepresentation = buildTextRepresentation(sheets);

  return {
    text: textRepresentation,
    contentType: "xlsx",
    title: fileName.replace(/\.[^.]+$/, ""),
    metadata: normalizeXlsxMetadata(tikaMetadata, sheets),
    sections: sheets.map((sheet, i) => ({
      heading: sheet.name,
      content: sheet.rows
        .map((row) =>
          sheet.headers.map((h, j) => `${h}: ${row[j] ?? ""}`).join(", "),
        )
        .join("\n"),
      level: 1,
      position: i,
    })),
    tabularData: sheets,
    originalFileHash: hashContent(Buffer.from(tikaText.text)),
    originalFileName: fileName,
  };
};
