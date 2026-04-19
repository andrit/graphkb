# ADR-007: Binary Document Extraction via Apache Tika

> **Status:** Proposed
> **Date:** 2026-04-15
> **Context:** The ingestion pipeline has working TypeScript-native extractors for Markdown, HTML, and CSV, but PDF, DOCX, XLSX, PPTX, and image formats fall back to `extractPlainText`, which calls `content.toString("utf-8")` on binary buffers — producing garbage output. Real document ingestion requires a proper binary extraction layer.

---

## Decision

Integrate Apache Tika as a containerized HTTP service for binary format extraction, wrapped in an Effect Layer behind an anti-corruption boundary, with format-specific post-processors that normalize Tika output into the existing `ExtractedContent` domain type.

---

## 1. Problem

The extractor dispatch in `packages/ingestion/src/extractors.ts` maps all binary formats to a plain-text fallback:

```typescript
pdf: (content, fileName) => extractPlainText(content, fileName, "pdf"),
docx: (content, fileName) => extractPlainText(content, fileName, "docx"),
xlsx: (content, fileName) => extractPlainText(content, fileName, "xlsx"),
image: (content, fileName) => extractPlainText(content, fileName, "image"),
```

This means the knowledge base cannot meaningfully ingest the most common document formats. PDFs and DOCX files are the primary input for any personal knowledge base — without real extraction, the system is limited to Markdown and HTML.

---

## 2. Why Tika

Apache Tika is a universal format detector and text extractor supporting 1400+ file formats behind a single API. It handles PDF, DOCX, PPTX, XLSX, RTF, EPUB, images (via Tesseract OCR), and more.

**Why a container, not a library:**
- Tika is Java-based. Embedding it in-process would require a JVM alongside Node.js, coupling the API server's lifecycle and memory profile to Java.
- The `apache/tika` Docker image provides a ready-made HTTP server (`tika-server`) with REST endpoints.
- This follows the same pattern as every other infrastructure dependency (Neo4j, ES, Redis) — behind an HTTP boundary, configured via environment variables, managed by Docker Compose.

**Tika HTTP endpoints used:**
| Endpoint | Method | Accept Header | Returns |
|----------|--------|---------------|---------|
| `/tika` | PUT | `text/plain` | Extracted plain text |
| `/tika` | PUT | `text/html` | Extracted text with structural HTML |
| `/meta` | PUT | `application/json` | Document metadata (author, title, page count, etc.) |
| `/rmeta` | PUT | `application/json` | Combined: text + metadata per embedded document |
| `/detect/stream` | PUT | — | MIME type detection |

---

## 3. Architecture: Two-Tier Extraction Strategy

Not all formats should go through Tika. Markdown, HTML, and CSV already have high-quality TypeScript-native extractors with section-aware parsing. Routing them through Tika would add latency and lose structural fidelity.

The dispatch becomes a two-tier strategy:

```typescript
type ExtractionStrategy =
  | { readonly _tag: "native"; readonly extract: NativeExtractor }
  | { readonly _tag: "tika"; readonly postProcess: TikaPostProcessor };

type NativeExtractor = (content: Buffer, fileName: string) => ExtractedContent;
type TikaPostProcessor = (response: TikaResponse, fileName: string) => ExtractedContent;
```

### Strategy assignment

| ContentType | Strategy | Rationale |
|-------------|----------|-----------|
| `markdown` | native | Existing extractor with heading-aware section parsing |
| `html` | native | Existing extractor with HTML heading/section parsing |
| `csv` | native | Existing extractor with tabular data preservation |
| `pdf` | tika | Binary format; Tika handles layout, fonts, embedded images |
| `docx` | tika | Binary format; Tika preserves Word heading styles |
| `xlsx` | tika | Binary format; Tika extracts sheet structure |
| `pptx` | tika (new) | Binary format; Tika extracts slide text and notes |
| `image` | tika | Tika delegates to Tesseract for OCR |

### Adding new formats

- New text-based format → write a `NativeExtractor`, register in the strategy map.
- New binary format → write a `TikaPostProcessor`, register in the strategy map.
- The pipeline receives `ExtractedContent` regardless of strategy — no downstream changes.

---

## 4. TikaClient Effect Layer

Following the established service pattern (`GraphClient`, `SearchClient`, `FileStorage`):

```typescript
export class TikaClient extends Context.Tag("TikaClient")<
  TikaClient,
  {
    /** Extract text from a binary document */
    readonly extractText: (
      content: Buffer,
      fileName: string,
      accept?: "text/plain" | "text/html",
    ) => Effect.Effect<TikaTextResponse, ExtractionError>;

    /** Extract document metadata */
    readonly extractMetadata: (
      content: Buffer,
      fileName: string,
    ) => Effect.Effect<TikaMetadata, ExtractionError>;

    /** Detect MIME type from content bytes */
    readonly detect: (
      content: Buffer,
    ) => Effect.Effect<string, ExtractionError>;

    /** Health check */
    readonly health: () => Effect.Effect<boolean, ExtractionError>;
  }
>() {}
```

### Internal types (never exported to domain)

```typescript
/** Raw text response from Tika */
interface TikaTextResponse {
  readonly text: string;
  readonly contentType: string;
}

/** Raw metadata from Tika /meta endpoint */
interface TikaMetadata {
  readonly [key: string]: string | string[] | undefined;
  // Keys vary by format: "dc:title", "pdf:docinfo:title",
  // "meta:author", "xmpTPg:NPages", etc.
}
```

### Anti-corruption boundary

`TikaClient` is a **thin HTTP wrapper**. It sends the buffer, receives the response, and returns raw Tika types. It does NOT normalize the output — that's the post-processor's job. This separation is critical for testability (see Section 7).

### `TikaClientLive` implementation

A simple `fetch`-based client:
- Sets `Content-Type` from the detected MIME type or file extension.
- Sets `Accept` header to control output format (plain text vs. HTML).
- Includes `Content-Disposition` with the filename for Tika's format detection.
- Timeout from `TikaConfig.timeoutMs` (default: 30s for large PDFs).
- Maps HTTP errors to `ExtractionError`.

---

## 5. Format-Specific Post-Processors

Each post-processor is a **pure function**: `TikaResponse → ExtractedContent`. They handle the per-format quirks that make Tika output messy.

### PDF post-processor

**Quirks handled:**
- **Hard line wraps:** PDF text often has line breaks at column boundaries, not paragraph boundaries. Re-flow paragraphs by joining lines that don't end with sentence-ending punctuation.
- **Headers/footers:** Repeated text at page boundaries (page numbers, running headers). Detect and filter by frequency analysis across page breaks.
- **Multi-column layout:** Columns come back interleaved. Heuristic: detect sudden mid-sentence topic changes and attempt re-ordering (best-effort — flag low confidence).
- **Section detection:** Request `text/html` from Tika (preserves some heading structure from font sizes) and pipe through the existing `parseHtmlSections()` function.
- **Metadata normalization:** Map `pdf:docinfo:title` → `title`, `pdf:docinfo:author` → `author`, `xmpTPg:NPages` → `pageCount`.

### DOCX post-processor

**Quirks handled:**
- **Heading preservation:** Request `text/html` output from Tika — it maps Word styles (`Heading 1`, `Heading 2`) to `<h1>`, `<h2>` tags. Pipe through existing `parseHtmlSections()`.
- **Table handling:** Tika renders Word tables as HTML `<table>` elements. Extract into `TabularSheet` structures.
- **Metadata normalization:** Map `dc:title` → `title`, `meta:author` → `author`, `meta:word-count` → `wordCount`.

### XLSX post-processor

**Quirks handled:**
- **Sheet structure:** Tika returns sheets as tab-separated blocks with sheet name headers. Parse into `TabularSheet[]` matching the shape `extractCsv` already produces.
- **Text representation:** Build the same `"header: value"` text format used by the CSV extractor, enabling consistent NER downstream.
- **Metadata:** Map `meta:sheet-count`, column/row counts.

### PPTX post-processor (new content type)

**Quirks handled:**
- **Slide-as-section:** Each slide becomes a `ContentSection` with the slide title as heading.
- **Speaker notes:** Include as additional content within each section (valuable for knowledge extraction).
- **Metadata:** Slide count, author, title.

### Image post-processor (OCR)

**Quirks handled:**
- **OCR noise:** Tesseract output is noisy. Flag the entire document with low extraction confidence.
- **No sections:** OCR text has no structural markup — falls into flat chunking.
- **Metadata:** Image dimensions, format, OCR language.

---

## 6. Configuration

Add to `@rhizomatic/common` config:

```typescript
export const TikaConfig = Schema.Struct({
  url: Schema.String.pipe(Schema.nonEmptyString()),
  timeoutMs: Schema.Number.pipe(Schema.int(), Schema.positive()),
  enabled: Schema.Boolean,
});
export type TikaConfig = typeof TikaConfig.Type;
```

Defaults: `url: "http://localhost:9998"`, `timeoutMs: 30000`, `enabled: true`.

Added to `RhizomaticConfig` and `docker-compose.yml`.

### Strategy map as configuration

The format→strategy mapping is data, not hardcoded logic:

```typescript
const DEFAULT_STRATEGY_MAP: Record<ContentType, "native" | "tika"> = {
  markdown: "native",
  html: "native",
  csv: "native",
  pdf: "tika",
  docx: "tika",
  xlsx: "tika",
  pptx: "tika",
  image: "tika",
};
```

This can be overridden in config, allowing a user to force native extraction for a format (e.g., during testing) or disable Tika-backed formats entirely.

---

## 7. Testability

Three testing layers, each testable independently:

### Layer 1: TikaClient (mocked via Effect Layer)

`TikaClientTest` returns canned `TikaTextResponse` / `TikaMetadata` from fixture files. No network, no container. Used in integration tests for the full pipeline.

### Layer 2: Post-processors (pure functions — no mocking needed)

Each post-processor takes `TikaResponse` and returns `ExtractedContent`. Test with fixture data captured from real Tika responses. This is where most format-specific logic lives, so this is where most tests should be.

Example test structure:
```
packages/ingestion/src/__tests__/
  fixtures/
    sample.pdf.tika-text.txt       # captured Tika text output for a sample PDF
    sample.pdf.tika-meta.json      # captured Tika metadata for the same PDF
    sample.docx.tika-html.html     # captured Tika HTML output for a sample DOCX
  post-processors/
    pdf.test.ts
    docx.test.ts
    xlsx.test.ts
```

### Layer 3: Integration tests (real Tika container)

Run against actual PDF/DOCX/XLSX files with a real Tika container (same Docker Compose setup). These are slow and run separately from the unit test suite (e.g., `pnpm test:integration`).

### Critical pitfall avoided

**Normalization logic is NOT inside `TikaClientLive`.** If post-processing were baked into the HTTP client, testing format normalization would require mocking HTTP responses. By keeping TikaClient as a thin wrapper, the pure post-processors are tested independently with simple function calls.

---

## 8. Graceful Degradation

When Tika is unavailable (container not running, health check fails):

1. At startup, the API logs a warning: `"Tika unavailable — binary format extraction disabled"`.
2. The strategy map falls back: all `"tika"` strategies become `"native"` (plain-text fallback).
3. Files still get ingested — poorly — but the system doesn't crash.
4. The health endpoint reports `tika: false` so the frontend can show a warning.

This matches current behavior (fallback extractors exist) while making the degradation explicit.

---

## 9. Docker Compose Addition

```yaml
tika:
  image: apache/tika:latest
  ports:
    - "9998:9998"
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:9998/tika"]
    interval: 10s
    timeout: 5s
    retries: 5
  deploy:
    resources:
      limits:
        memory: 1G    # Tika/JVM needs headroom
```

---

## 10. File Inventory

| File | Change |
|------|--------|
| `packages/common/src/config/index.ts` | Add `TikaConfig` schema, add to `RhizomaticConfig` |
| `packages/common/src/types/structural.ts` | Add `"pptx"` to `ContentType` union |
| `packages/ingestion/src/tika-client.ts` | New — `TikaClient` Effect Layer + `TikaClientLive` |
| `packages/ingestion/src/tika-types.ts` | New — internal Tika response types (anti-corruption) |
| `packages/ingestion/src/post-processors/` | New directory — `pdf.ts`, `docx.ts`, `xlsx.ts`, `pptx.ts`, `image.ts` |
| `packages/ingestion/src/extractors.ts` | Refactor: two-tier strategy dispatch, integrate Tika path |
| `packages/ingestion/src/validation.ts` | Add `.pptx` to `EXTENSION_MAP` |
| `packages/ingestion/package.json` | No new deps (Tika is HTTP-only, use `fetch`) |
| `packages/api/src/index.ts` | Add Tika health to `HealthStatus` |
| `infra/docker-compose.yml` | Add `tika` service |
| `packages/ingestion/src/__tests__/` | Post-processor unit tests + fixture data |

---

## 11. Pitfalls to Avoid (Summary)

1. **Don't embed Tika in-process.** Container behind HTTP, like every other infra dependency.
2. **Don't route everything through Tika.** Native extractors (Markdown, HTML, CSV) stay native — they're faster and produce better structure.
3. **Don't put normalization in the HTTP client.** `TikaClient` is thin; post-processors are pure functions.
4. **Don't make tests depend on a running container.** Effect Layer for mocking, pure post-processors for unit tests.
5. **Don't treat all Tika output the same.** Each format has specific quirks requiring dedicated post-processing.
6. **Don't crash when Tika is down.** Graceful fallback with warning.
7. **Don't let Tika types leak into the domain.** `TikaTextResponse` and `TikaMetadata` are internal — the pipeline only sees `ExtractedContent`.

---

## 12. Consequences

**Positive:**
- Unlocks ingestion of PDF, DOCX, XLSX, PPTX, and images — the primary input formats.
- Extensible to 1400+ formats Tika supports without code changes.
- Post-processors are independently testable pure functions.
- Graceful degradation preserves current behavior when Tika is unavailable.
- Reuses existing code (`parseHtmlSections`, `TabularSheet` types).

**Negative:**
- Adds a JVM-based container to the infrastructure (memory overhead ~512MB–1GB).
- Tika output quality varies by format — some PDFs will produce poor results regardless.
- OCR quality depends on input image quality and Tesseract's capabilities.
- Additional integration test infrastructure needed for real-file testing.
