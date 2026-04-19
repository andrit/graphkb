/**
 * @rhizomatic/ingestion — TikaClient Effect Layer
 *
 * Thin HTTP wrapper around Apache Tika's REST API.
 * This client does NOT normalize output — that's the post-processor's job.
 * Keeping the client thin makes the post-processors independently testable.
 *
 * Tika endpoints used:
 *   PUT /tika           → extracted text (Accept: text/plain or text/html)
 *   PUT /meta           → document metadata (Accept: application/json)
 *   PUT /detect/stream  → MIME type detection
 *
 * The client is an Effect Context.Tag, following the same pattern as
 * GraphClient, SearchClient, and FileStorage.
 */

import { Context, Effect, Layer } from "effect";
import type { TikaConfig } from "@rhizomatic/common";
import { ExtractionError } from "@rhizomatic/common";
import type { TikaTextResponse, TikaMetadata } from "./tika-types.js";

// ---------------------------------------------------------------------------
// MIME type mapping for Content-Type header
// ---------------------------------------------------------------------------

const EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".tiff": "image/tiff",
  ".bmp": "image/bmp",
  ".rtf": "application/rtf",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".epub": "application/epub+zip",
};

const getMimeType = (fileName: string): string => {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
  return EXTENSION_TO_MIME[ext] ?? "application/octet-stream";
};

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------

export class TikaClient extends Context.Tag("TikaClient")<
  TikaClient,
  {
    /**
     * Extract text from a binary document.
     * @param accept - "text/plain" for raw text, "text/html" for structural HTML
     */
    readonly extractText: (
      content: Buffer,
      fileName: string,
      accept?: "text/plain" | "text/html",
    ) => Effect.Effect<TikaTextResponse, ExtractionError>;

    /** Extract document metadata as key-value pairs */
    readonly extractMetadata: (
      content: Buffer,
      fileName: string,
    ) => Effect.Effect<TikaMetadata, ExtractionError>;

    /** Detect MIME type from content bytes */
    readonly detect: (
      content: Buffer,
    ) => Effect.Effect<string, ExtractionError>;

    /** Check if Tika is reachable */
    readonly health: () => Effect.Effect<boolean, ExtractionError>;
  }
>() {}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const TikaClientLive = (config: TikaConfig): Layer.Layer<TikaClient> =>
  Layer.succeed(TikaClient, {
    extractText: (content, fileName, accept = "text/plain") =>
      Effect.tryPromise({
        try: async () => {
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(),
            config.timeoutMs,
          );

          try {
            const response = await fetch(`${config.url}/tika`, {
              method: "PUT",
              headers: {
                "Content-Type": getMimeType(fileName),
                "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
                Accept: accept,
              },
              body: content,
              signal: controller.signal,
            });

            if (!response.ok) {
              throw new Error(
                `Tika responded with ${response.status}: ${response.statusText}`,
              );
            }

            const text = await response.text();
            const detectedType =
              response.headers.get("X-TIKA:content_type") ??
              getMimeType(fileName);

            return { text, contentType: detectedType };
          } finally {
            clearTimeout(timeout);
          }
        },
        catch: (error) =>
          new ExtractionError({
            message: `Tika text extraction failed: ${String(error)}`,
            contentType: getMimeType(fileName),
            cause: error,
          }),
      }),

    extractMetadata: (content, fileName) =>
      Effect.tryPromise({
        try: async () => {
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(),
            config.timeoutMs,
          );

          try {
            const response = await fetch(`${config.url}/meta`, {
              method: "PUT",
              headers: {
                "Content-Type": getMimeType(fileName),
                "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
                Accept: "application/json",
              },
              body: content,
              signal: controller.signal,
            });

            if (!response.ok) {
              throw new Error(
                `Tika metadata extraction failed with ${response.status}`,
              );
            }

            return (await response.json()) as TikaMetadata;
          } finally {
            clearTimeout(timeout);
          }
        },
        catch: (error) =>
          new ExtractionError({
            message: `Tika metadata extraction failed: ${String(error)}`,
            contentType: getMimeType(fileName),
            cause: error,
          }),
      }),

    detect: (content) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(`${config.url}/detect/stream`, {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: content,
          });

          if (!response.ok) {
            throw new Error(
              `Tika detection failed with ${response.status}`,
            );
          }

          return (await response.text()).trim();
        },
        catch: (error) =>
          new ExtractionError({
            message: `Tika MIME detection failed: ${String(error)}`,
            contentType: "unknown",
            cause: error,
          }),
      }),

    health: () =>
      Effect.tryPromise({
        try: async () => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          try {
            const response = await fetch(`${config.url}/tika`, {
              method: "GET",
              signal: controller.signal,
            });
            return response.ok;
          } finally {
            clearTimeout(timeout);
          }
        },
        catch: () =>
          new ExtractionError({
            message: "Tika health check failed — service unreachable",
            contentType: "none",
            cause: undefined,
          }),
      }),
  });

// ---------------------------------------------------------------------------
// Test implementation (in-memory, no network)
// ---------------------------------------------------------------------------

/**
 * Test implementation that returns canned responses.
 * Used for unit testing the pipeline without a Tika container.
 */
export const TikaClientTest = (
  responses: {
    text?: string;
    metadata?: TikaMetadata;
    mimeType?: string;
    healthy?: boolean;
  } = {},
): Layer.Layer<TikaClient> =>
  Layer.succeed(TikaClient, {
    extractText: (_content, _fileName, _accept) =>
      Effect.succeed({
        text: responses.text ?? "",
        contentType: responses.mimeType ?? "application/octet-stream",
      }),

    extractMetadata: (_content, _fileName) =>
      Effect.succeed(responses.metadata ?? {}),

    detect: (_content) =>
      Effect.succeed(responses.mimeType ?? "application/octet-stream"),

    health: () => Effect.succeed(responses.healthy ?? true),
  });
