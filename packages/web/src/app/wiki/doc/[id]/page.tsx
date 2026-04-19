"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchDocument } from "../../../../lib/api";
import type { DocumentDetail } from "../../../../lib/api";

const kindColors: Record<string, string> = {
  person: "#e8d5f5",
  organization: "#d5e8f5",
  technology: "#d5f5e0",
  concept: "#f5ecd5",
  place: "#f5d5d5",
};

export default function DocumentPage() {
  const params = useParams();
  const id = params?.id as string;
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchDocument(id)
      .then(setDoc)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p style={{ color: "#999" }}>Loading…</p>;
  if (error) return <p style={{ color: "#c44" }}>Error: {error}</p>;
  if (!doc) return <p style={{ color: "#999" }}>Document not found.</p>;

  // Collect all unique entities across chunks
  const allEntities = new Map<string, { name: string; kind: string }>();
  for (const chunk of doc.chunks) {
    for (const e of chunk.entities) {
      allEntities.set(e.name, { name: e.name, kind: e.kind });
    }
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ fontSize: "12px", color: "#999", marginBottom: "12px" }}>
        <a href="/" style={{ color: "#999", textDecoration: "none" }}>Wiki</a>
        {" / "}
        <span>Documents</span>
        {" / "}
        <span style={{ color: "#555" }}>{doc.title}</span>
      </div>

      {/* Header */}
      <h1 style={{ fontSize: "24px", fontWeight: 600, marginBottom: "4px", letterSpacing: "-0.02em" }}>
        {doc.title}
      </h1>
      <div style={{ fontSize: "12px", color: "#999", marginBottom: "20px" }}>
        <span style={{
          display: "inline-block",
          padding: "2px 8px",
          background: "#f0f0f0",
          borderRadius: "4px",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginRight: "8px",
        }}>
          {doc.contentType}
        </span>
        Ingested {new Date(doc.ingestedAt).toLocaleDateString()} ·{" "}
        {doc.chunks.length} chunks · {doc.entityCount} entities
      </div>

      {/* Entities sidebar */}
      {allEntities.size > 0 && (
        <div style={{
          padding: "14px 16px",
          background: "#fff",
          borderRadius: "8px",
          border: "1px solid #eee",
          marginBottom: "24px",
        }}>
          <h3 style={{ fontSize: "12px", fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
            Discovered entities
          </h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {Array.from(allEntities.values()).map((e) => (
              <a
                key={e.name}
                href={`/wiki/entity/${encodeURIComponent(e.name)}`}
                style={{
                  display: "inline-block",
                  padding: "3px 9px",
                  borderRadius: "10px",
                  fontSize: "12px",
                  fontWeight: 500,
                  backgroundColor: kindColors[e.kind] ?? "#eee",
                  color: "#333",
                  textDecoration: "none",
                }}
              >
                {e.name}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Chunk content */}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {doc.chunks.map((chunk) => (
          <div
            key={chunk.id}
            style={{
              padding: "16px 18px",
              background: "#fff",
              borderRadius: "8px",
              border: "1px solid #eee",
            }}
          >
            {chunk.heading && (
              <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px", color: "#333" }}>
                {chunk.heading}
              </h3>
            )}
            <div style={{ fontSize: "14px", lineHeight: "1.65", color: "#333", whiteSpace: "pre-wrap" }}>
              {chunk.content}
            </div>
            {chunk.entities.length > 0 && (
              <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: "1px solid #f0f0f0" }}>
                {chunk.entities.map((e) => (
                  <a
                    key={e.name}
                    href={`/wiki/entity/${encodeURIComponent(e.name)}`}
                    style={{
                      display: "inline-block",
                      padding: "2px 7px",
                      borderRadius: "8px",
                      fontSize: "11px",
                      backgroundColor: kindColors[e.kind] ?? "#eee",
                      color: "#555",
                      textDecoration: "none",
                      margin: "2px 3px 2px 0",
                    }}
                  >
                    {e.name}
                    <span style={{ opacity: 0.5, marginLeft: "3px" }}>
                      {Math.round(e.confidence * 100)}%
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
