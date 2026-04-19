"use client";

import { useEffect, useState } from "react";
import { fetchDocuments, fetchEntities } from "../lib/api";
import type { DocumentSummary, EntitySummary } from "../lib/api";

const kindColors: Record<string, string> = {
  person: "#e8d5f5",
  organization: "#d5e8f5",
  technology: "#d5f5e0",
  concept: "#f5ecd5",
  place: "#f5d5d5",
};

function EntityPill({ name, kind }: { name: string; kind: string }) {
  return (
    <a
      href={`/wiki/entity/${encodeURIComponent(name)}`}
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: "12px",
        fontSize: "12px",
        fontWeight: 500,
        backgroundColor: kindColors[kind] ?? "#eee",
        color: "#333",
        textDecoration: "none",
        margin: "2px 4px 2px 0",
      }}
    >
      {name}
    </a>
  );
}

export default function HomePage() {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchDocuments(10).catch(() => []),
      fetchEntities(30).catch(() => []),
    ]).then(([d, e]) => {
      setDocs(d);
      setEntities(e);
      setLoading(false);
    }).catch((err) => {
      setError(err.message);
      setLoading(false);
    });
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: "26px", fontWeight: 600, marginBottom: "4px", letterSpacing: "-0.02em" }}>
        Knowledge base
      </h1>
      <p style={{ color: "#777", fontSize: "14px", marginBottom: "32px" }}>
        Understanding emerges from connections. Start anywhere.
      </p>

      {loading && <p style={{ color: "#999", fontSize: "14px" }}>Loading…</p>}
      {error && (
        <p style={{ color: "#c44", fontSize: "14px", padding: "12px", background: "#fff5f5", borderRadius: "8px" }}>
          Could not reach the API at localhost:4000. Is the backend running?
        </p>
      )}

      <section style={{ marginBottom: "36px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px", color: "#444" }}>
          Recent documents
        </h2>
        {docs.length === 0 && !loading ? (
          <p style={{ color: "#999", fontSize: "13px" }}>
            No documents yet. <a href="/ingest" style={{ color: "#4a7dbd" }}>Ingest content</a> to get started.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {docs.map((doc) => (
              <a
                key={doc.id}
                href={`/wiki/doc/${doc.id}`}
                style={{
                  display: "block",
                  padding: "14px 16px",
                  background: "#fff",
                  borderRadius: "8px",
                  border: "1px solid #eee",
                  textDecoration: "none",
                  color: "#1a1a1a",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontWeight: 500, fontSize: "14px" }}>{doc.title}</span>
                  <span style={{ fontSize: "11px", color: "#999", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {doc.contentType}
                  </span>
                </div>
                {doc.summary && (
                  <p style={{ fontSize: "12px", color: "#777", marginTop: "4px", lineHeight: "1.4" }}>
                    {doc.summary.slice(0, 160)}…
                  </p>
                )}
                <div style={{ fontSize: "11px", color: "#aaa", marginTop: "6px" }}>
                  {doc.entityCount} entities · ingested {new Date(doc.ingestedAt).toLocaleDateString()}
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px", color: "#444" }}>
          Entities
        </h2>
        {entities.length === 0 && !loading ? (
          <p style={{ color: "#999", fontSize: "13px" }}>
            Entities will appear here as you ingest documents.
          </p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {entities.map((e) => (
              <EntityPill key={e.name} name={e.name} kind={e.kind} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
