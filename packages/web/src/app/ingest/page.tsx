"use client";

import { useCallback, useRef, useState } from "react";
import { uploadFile } from "../../lib/api";
import type { IngestionResult } from "../../lib/api";

type UploadState =
  | { tag: "idle" }
  | { tag: "uploading"; fileName: string }
  | { tag: "done"; result: IngestionResult }
  | { tag: "error"; message: string };

export default function IngestPage() {
  const [state, setState] = useState<UploadState>({ tag: "idle" });
  const [history, setHistory] = useState<IngestionResult[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setState({ tag: "uploading", fileName: file.name });
    try {
      const result = await uploadFile(file);
      setState({ tag: "done", result });
      setHistory((prev) => [result, ...prev]);
    } catch (err: unknown) {
      setState({
        tag: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div>
      <h1 style={{ fontSize: "26px", fontWeight: 600, marginBottom: "6px" }}>
        Ingest content
      </h1>
      <p style={{ color: "#777", fontSize: "14px", marginBottom: "24px" }}>
        Upload files to extract knowledge and populate the graph.
      </p>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: "2px dashed #ccc",
          borderRadius: "12px",
          padding: "48px 24px",
          textAlign: "center",
          color: "#888",
          fontSize: "14px",
          cursor: "pointer",
          backgroundColor: state.tag === "uploading" ? "#f0f7ff" : "#fff",
          transition: "background-color 0.2s",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleInputChange}
          accept=".pdf,.docx,.doc,.csv,.xlsx,.xls,.html,.htm,.md,.markdown,.txt,.png,.jpg,.jpeg,.gif,.webp"
          style={{ display: "none" }}
        />

        {state.tag === "idle" && (
          <>
            <p style={{ fontSize: "16px", marginBottom: "6px", color: "#555" }}>
              Drop a file here or click to browse
            </p>
            <p style={{ fontSize: "12px", color: "#aaa" }}>
              PDF, DOCX, CSV, XLSX, HTML, Markdown, TXT, Images
            </p>
          </>
        )}

        {state.tag === "uploading" && (
          <p style={{ color: "#4a7dbd" }}>
            Ingesting <strong>{state.fileName}</strong>…
            <br />
            <span style={{ fontSize: "12px" }}>
              Extracting → Chunking → NER → Writing to graph → Indexing
            </span>
          </p>
        )}

        {state.tag === "error" && (
          <p style={{ color: "#c44" }}>
            Error: {state.message}
            <br />
            <span style={{ fontSize: "12px", color: "#999" }}>Click to try another file</span>
          </p>
        )}

        {state.tag === "done" && (
          <div style={{ color: "#2a7d4f" }}>
            <p style={{ fontSize: "16px", marginBottom: "8px" }}>✓ Ingested successfully</p>
            <p style={{ fontSize: "13px", color: "#555" }}>
              <strong>{state.result.title}</strong>
            </p>
            <p style={{ fontSize: "12px", color: "#888", marginTop: "4px" }}>
              {state.result.chunkCount} chunks · {state.result.entityCount} entities · {state.result.relationshipCount} relationships
            </p>
            <a
              href={`/wiki/doc/${state.result.documentId}`}
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "inline-block",
                marginTop: "12px",
                padding: "6px 16px",
                background: "#4a7dbd",
                color: "#fff",
                borderRadius: "6px",
                fontSize: "13px",
                textDecoration: "none",
              }}
            >
              View document →
            </a>
            <br />
            <span
              style={{ fontSize: "12px", color: "#999", marginTop: "8px", display: "inline-block", cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); setState({ tag: "idle" }); }}
            >
              Upload another
            </span>
          </div>
        )}
      </div>

      {/* Ingestion history */}
      {history.length > 0 && (
        <div style={{ marginTop: "32px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 600, marginBottom: "12px", color: "#444" }}>
            Session history
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {history.map((r, i) => (
              <a
                key={i}
                href={`/wiki/doc/${r.documentId}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  background: "#fff",
                  borderRadius: "6px",
                  border: "1px solid #eee",
                  textDecoration: "none",
                  color: "#1a1a1a",
                  fontSize: "13px",
                }}
              >
                <span style={{ fontWeight: 500 }}>{r.title}</span>
                <span style={{ color: "#999", fontSize: "12px" }}>
                  {r.entityCount} entities · {r.chunkCount} chunks
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
