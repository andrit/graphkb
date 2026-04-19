/**
 * @rhizomatic/ingestion — Validation and content type detection
 *
 * Pure functions for file validation and content type detection.
 * Separated from the main index to avoid circular dependencies
 * with the pipeline module.
 */

import { Effect } from "effect";
import type { ContentType } from "@rhizomatic/common";
import { ValidationError } from "@rhizomatic/common";

// ---------------------------------------------------------------------------
// Content type detection
// ---------------------------------------------------------------------------

const EXTENSION_MAP: Record<string, ContentType> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".doc": "docx",
  ".pptx": "pptx",
  ".ppt": "pptx",
  ".csv": "csv",
  ".xlsx": "xlsx",
  ".xls": "xlsx",
  ".html": "html",
  ".htm": "html",
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "markdown",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
};

/** Detect content type from file extension */
export const detectContentType = (
  fileName: string,
): Effect.Effect<ContentType, ValidationError> => {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
  const contentType = EXTENSION_MAP[ext];
  if (contentType === undefined) {
    return Effect.fail(
      new ValidationError({
        message: `Unsupported file type: ${ext}`,
        field: "fileName",
        value: fileName,
      }),
    );
  }
  return Effect.succeed(contentType);
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

/** Validate that a file is acceptable for ingestion */
export const validateFile = (
  content: Buffer,
  fileName: string,
): Effect.Effect<void, ValidationError> => {
  if (content.length === 0) {
    return Effect.fail(
      new ValidationError({
        message: "File is empty",
        field: "content",
        value: fileName,
      }),
    );
  }
  if (content.length > MAX_FILE_SIZE) {
    return Effect.fail(
      new ValidationError({
        message: `File exceeds maximum size of ${MAX_FILE_SIZE} bytes`,
        field: "content",
        value: content.length,
      }),
    );
  }
  return Effect.void;
};
