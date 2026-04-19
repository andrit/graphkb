/**
 * @rhizomatic/ingestion — Image post-processor (OCR)
 *
 * Normalizes Tika's OCR output (via Tesseract) into ExtractedContent.
 *
 * OCR text is inherently noisy, so this post-processor:
 * 1. Cleans up common OCR artifacts
 * 2. Flags the document with low extraction confidence
 * 3. Uses flat chunking (no structural headings in OCR output)
 * 4. Extracts image metadata (dimensions, format)
 */

import type { ExtractedContent } from "@rhizomatic/common";
import { hashContent } from "@rhizomatic/common";
import type { TikaTextResponse, TikaMetadata, TikaPostProcessor } from "../tika-types.js";

// ---------------------------------------------------------------------------
// OCR text cleanup
// ---------------------------------------------------------------------------

/**
 * Clean common OCR artifacts from Tesseract output.
 * This is intentionally conservative — better to keep noise than lose content.
 */
const cleanOcrText = (text: string): string => {
  let cleaned = text;

  // Remove isolated single characters (common OCR noise)
  cleaned = cleaned.replace(/(?<=\s)[^\w\s](?=\s)/g, "");

  // Collapse excessive whitespace
  cleaned = cleaned.replace(/[ \t]{3,}/g, "  ");
  cleaned = cleaned.replace(/\n{4,}/g, "\n\n\n");

  // Remove lines that are just punctuation/noise
  cleaned = cleaned
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return true; // keep blank lines
      // Filter lines that are almost entirely non-alphanumeric
      const alphaRatio =
        (trimmed.match(/[a-zA-Z0-9]/g)?.length ?? 0) / trimmed.length;
      return alphaRatio > 0.3;
    })
    .join("\n");

  return cleaned.trim();
};

// ---------------------------------------------------------------------------
// Metadata normalization
// ---------------------------------------------------------------------------

const normalizeImageMetadata = (
  meta: TikaMetadata,
): Record<string, unknown> => {
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
    imageWidth: getNumber(["tiff:ImageWidth", "Image Width", "width"]),
    imageHeight: getNumber(["tiff:ImageLength", "Image Height", "height"]),
    imageFormat: getString(["Content-Type", "dc:format"]),
    ocrLanguage: getString(["X-TIKA:Parsed-By-Full-Set"]) ? "en" : undefined,
    extractedBy: "tika-ocr",
    extractionConfidence: "low",
  };
};

// ---------------------------------------------------------------------------
// Post-processor
// ---------------------------------------------------------------------------

export const postProcessImage: TikaPostProcessor = (
  tikaText: TikaTextResponse,
  tikaMetadata: TikaMetadata,
  fileName: string,
): ExtractedContent => {
  const cleanedText = cleanOcrText(tikaText.text);

  // OCR output has no structural headings — single flat section
  const sections =
    cleanedText.length > 0
      ? [
          {
            heading: undefined,
            content: cleanedText,
            level: 0,
            position: 0,
          },
        ]
      : [];

  return {
    text: cleanedText,
    contentType: "image",
    title: fileName.replace(/\.[^.]+$/, ""),
    metadata: normalizeImageMetadata(tikaMetadata),
    sections,
    tabularData: undefined,
    originalFileHash: hashContent(Buffer.from(tikaText.text || fileName)),
    originalFileName: fileName,
  };
};
