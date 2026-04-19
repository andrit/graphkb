/**
 * @rhizomatic/ingestion — Post-processor registry
 *
 * Maps content types to their Tika post-processors.
 * Each post-processor is a pure function: (TikaTextResponse, TikaMetadata, fileName) → ExtractedContent.
 *
 * Adding a new Tika-backed format:
 *   1. Write a post-processor in this directory
 *   2. Register it in the TIKA_POST_PROCESSORS map below
 *   3. Add the content type to the strategy map in extractors.ts
 */

import type { ContentType } from "@rhizomatic/common";
import type { TikaPostProcessor } from "../tika-types.js";
import { postProcessPdf } from "./pdf.js";
import { postProcessDocx } from "./docx.js";
import { postProcessXlsx } from "./xlsx.js";
import { postProcessPptx } from "./pptx.js";
import { postProcessImage } from "./image.js";

export { postProcessPdf } from "./pdf.js";
export { postProcessDocx } from "./docx.js";
export { postProcessXlsx } from "./xlsx.js";
export { postProcessPptx } from "./pptx.js";
export { postProcessImage } from "./image.js";

/**
 * Registry of post-processors keyed by content type.
 * Only Tika-backed formats appear here — native formats (markdown, html, csv)
 * don't go through Tika and therefore don't need post-processors.
 */
export const TIKA_POST_PROCESSORS: Partial<Record<ContentType, TikaPostProcessor>> = {
  pdf: postProcessPdf,
  docx: postProcessDocx,
  xlsx: postProcessXlsx,
  pptx: postProcessPptx,
  image: postProcessImage,
};

/**
 * The preferred Tika Accept header for each format.
 * Some formats produce better output as HTML (preserves headings).
 */
export const TIKA_ACCEPT_HEADERS: Partial<
  Record<ContentType, "text/plain" | "text/html">
> = {
  pdf: "text/html", // Preserves font-size-based heading structure
  docx: "text/html", // Preserves Word heading styles as <h1>-<h6>
  xlsx: "text/html", // Preserves table structure
  pptx: "text/html", // Preserves slide structure
  image: "text/plain", // OCR returns plain text
};
