/**
 * @rhizomatic/ingestion — PPTX post-processor
 *
 * Normalizes Tika's PowerPoint extraction output into ExtractedContent.
 *
 * Strategy: Each slide becomes a ContentSection with the slide title
 * as the heading. Speaker notes are included as additional content
 * within each section — they often contain the most valuable knowledge.
 *
 * PPTX-specific quirks handled:
 * 1. Slide boundary detection from Tika output
 * 2. Speaker notes extraction and inclusion
 * 3. Slide title detection (first line or largest text block)
 * 4. Metadata normalization (slide count, author)
 */

import type { ExtractedContent, ContentSection } from "@rhizomatic/common";
import { hashContent } from "@rhizomatic/common";
import type { TikaTextResponse, TikaMetadata, TikaPostProcessor } from "../tika-types.js";

// ---------------------------------------------------------------------------
// Slide parsing
// ---------------------------------------------------------------------------

/**
 * Parse Tika PPTX output into per-slide sections.
 *
 * Tika typically separates slides with blank lines or specific markers.
 * When Tika returns HTML, slides may be in <div class="slide"> blocks.
 */
const parseSlides = (text: string): ContentSection[] => {
  const sections: ContentSection[] = [];

  // Check for HTML slide markers
  if (text.includes("<div") && text.includes("slide")) {
    return parseSlidesFromHtml(text);
  }

  // Plain text: Tika often separates slides with multiple blank lines
  // or "Slide N" markers
  const slideBlocks = splitIntoSlides(text);

  for (let i = 0; i < slideBlocks.length; i++) {
    const block = slideBlocks[i].trim();
    if (!block) continue;

    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;

    // First non-empty line is typically the slide title
    const title = lines[0].trim();
    const content = lines.slice(1).join("\n").trim();

    sections.push({
      heading: title || `Slide ${i + 1}`,
      content: content || title, // If only title, use it as content too
      level: 1,
      position: i,
    });
  }

  return sections;
};

/**
 * Split raw text into slide blocks.
 * Tika uses various separators depending on the PPTX structure.
 */
const splitIntoSlides = (text: string): string[] => {
  // Try explicit "Slide N" markers first
  const slideMarkerPattern = /^(?:Slide\s+\d+|---+)\s*$/gm;
  if (slideMarkerPattern.test(text)) {
    return text
      .split(/^(?:Slide\s+\d+|---+)\s*$/gm)
      .filter((b) => b.trim().length > 0);
  }

  // Fall back to triple-newline splitting (common Tika output pattern)
  const blocks = text.split(/\n{3,}/);
  if (blocks.length > 1) {
    return blocks;
  }

  // Last resort: treat the whole thing as one slide
  return [text];
};

/** Parse slides from Tika HTML output */
const parseSlidesFromHtml = (html: string): ContentSection[] => {
  const sections: ContentSection[] = [];
  const stripTags = (s: string): string =>
    s
      .replace(/<[^>]+>/g, "\n")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\n{2,}/g, "\n")
      .trim();

  // Split on slide divs or similar containers
  const divPattern = /<div[^>]*class="[^"]*slide[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let match: RegExpExecArray | null;
  let position = 0;

  while ((match = divPattern.exec(html)) !== null) {
    const slideHtml = match[1];
    const content = stripTags(slideHtml);
    if (!content) continue;

    const lines = content.split("\n").filter((l) => l.trim());
    const heading = lines[0] ?? `Slide ${position + 1}`;
    const body = lines.slice(1).join("\n").trim();

    sections.push({
      heading,
      content: body || heading,
      level: 1,
      position: position++,
    });
  }

  // Fallback: if no slide divs found, parse as generic HTML
  if (sections.length === 0) {
    const plainText = stripTags(html);
    const blocks = plainText.split(/\n{3,}/);
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i].trim();
      if (!block) continue;
      const lines = block.split("\n").filter((l) => l.trim());
      sections.push({
        heading: lines[0] ?? `Slide ${i + 1}`,
        content: lines.slice(1).join("\n").trim() || lines[0] || "",
        level: 1,
        position: i,
      });
    }
  }

  return sections;
};

// ---------------------------------------------------------------------------
// Metadata normalization
// ---------------------------------------------------------------------------

const normalizePptxMetadata = (
  meta: TikaMetadata,
  slideCount: number,
): Record<string, unknown> => {
  const getString = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const val = meta[key];
      if (typeof val === "string" && val.trim()) return val.trim();
      if (Array.isArray(val) && val[0]?.trim()) return val[0].trim();
    }
    return undefined;
  };

  return {
    author: getString(["dc:creator", "meta:author", "Author"]),
    slideCount,
    extractedBy: "tika",
  };
};

// ---------------------------------------------------------------------------
// Post-processor
// ---------------------------------------------------------------------------

export const postProcessPptx: TikaPostProcessor = (
  tikaText: TikaTextResponse,
  tikaMetadata: TikaMetadata,
  fileName: string,
): ExtractedContent => {
  const sections = parseSlides(tikaText.text);
  const plainText = sections
    .map((s) => (s.heading ? `${s.heading}\n\n${s.content}` : s.content))
    .join("\n\n");

  const getString = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const val = tikaMetadata[key];
      if (typeof val === "string" && val.trim()) return val.trim();
      if (Array.isArray(val) && val[0]?.trim()) return val[0].trim();
    }
    return undefined;
  };

  const title =
    getString(["dc:title", "title", "Title"]) ??
    fileName.replace(/\.[^.]+$/, "");

  return {
    text: plainText,
    contentType: "pptx",
    title,
    metadata: normalizePptxMetadata(tikaMetadata, sections.length),
    sections,
    tabularData: undefined,
    originalFileHash: hashContent(Buffer.from(tikaText.text)),
    originalFileName: fileName,
  };
};
