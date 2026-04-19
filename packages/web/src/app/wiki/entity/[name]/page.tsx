"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchEntity } from "../../../../lib/api";
import type { EntityDetail } from "../../../../lib/api";

const kindColors: Record<string, string> = {
  person: "#e8d5f5",
  organization: "#d5e8f5",
  technology: "#d5f5e0",
  concept: "#f5ecd5",
  place: "#f5d5d5",
};

export default function EntityPage() {
  const params = useParams();
  const rawName = params?.name as string;
  const name = decodeURIComponent(rawName ?? "");
  const [entity, setEntity] = useState<EntityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    fetchEntity(name)
      .then(setEntity)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [name]);

  if (loading) return <p style={{ color: "#999" }}>Loading…</p>;
  if (error) return <p style={{ color: "#c44" }}>Error: {error}</p>;
  if (!entity) return <p style={{ color: "#999" }}>Entity &ldquo;{name}&rdquo; not found.</p>;

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ fontSize: "12px", color: "#999", marginBottom: "12px" }}>
        <a href="/" style={{ color: "#999", textDecoration: "none" }}>Wiki</a>
        {" / "}
        <span>Entities</span>
        {" / "}
        <span style={{ color: "#555" }}>{entity.name}</span>
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "12px", marginBottom: "4px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 600, letterSpacing: "-0.02em" }}>
          {entity.name}
        </h1>
        <span
          style={{
            display: "inline-block",
            padding: "3px 10px",
            borderRadius: "10px",
            fontSize: "12px",
            fontWeight: 500,
            backgroundColor: kindColors[entity.kind] ?? "#eee",
            color: "#555",
          }}
        >
          {entity.kind}
        </span>
      </div>

      {entity.description && (
        <p style={{ fontSize: "14px", color: "#555", marginBottom: "8px", lineHeight: "1.5" }}>
          {entity.description}
        </p>
      )}

      <div style={{ fontSize: "12px", color: "#999", marginBottom: "24px" }}>
        Mentioned {entity.mentionCount} time{entity.mentionCount !== 1 ? "s" : ""} ·{" "}
        {entity.relatedEntities.length} connections ·{" "}
        {entity.mentioningDocuments.length} document{entity.mentioningDocuments.length !== 1 ? "s" : ""}
      </div>

      {entity.aliases.length > 0 && (
        <div style={{ fontSize: "12px", color: "#888", marginBottom: "20px" }}>
          Also known as: {entity.aliases.join(", ")}
        </div>
      )}

      {/* Related entities */}
      {entity.relatedEntities.length > 0 && (
        <section style={{ marginBottom: "28px" }}>
          <h2 style={{ fontSize: "14px", fontWeight: 600, color: "#444", marginBottom: "10px" }}>
            Related entities
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {entity.relatedEntities
              .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
              .map((rel) => (
                <a
                  key={rel.entity.name}
                  href={`/wiki/entity/${encodeURIComponent(rel.entity.name)}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 14px",
                    background: "#fff",
                    borderRadius: "6px",
                    border: "1px solid #eee",
                    textDecoration: "none",
                    color: "#1a1a1a",
                    fontSize: "13px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 7px",
                        borderRadius: "8px",
                        fontSize: "11px",
                        backgroundColor: kindColors[rel.entity.kind] ?? "#eee",
                        color: "#555",
                      }}
                    >
                      {rel.entity.kind}
                    </span>
                    <span style={{ fontWeight: 500 }}>{rel.entity.name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {rel.kind && (
                      <span style={{ fontSize: "11px", color: "#aaa" }}>{rel.kind}</span>
                    )}
                    {rel.weight != null && (
                      <span style={{ fontSize: "11px", color: "#bbb" }}>
                        {Math.round(rel.weight * 100)}%
                      </span>
                    )}
                  </div>
                </a>
              ))}
          </div>
        </section>
      )}

      {/* Mentioning documents — the rhizomatic connections */}
      {entity.mentioningDocuments.length > 0 && (
        <section>
          <h2 style={{ fontSize: "14px", fontWeight: 600, color: "#444", marginBottom: "10px" }}>
            Appears in
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {entity.mentioningDocuments.map((doc) => (
              <a
                key={doc.id}
                href={`/wiki/doc/${doc.id}`}
                style={{
                  display: "block",
                  padding: "12px 14px",
                  background: "#fff",
                  borderRadius: "6px",
                  border: "1px solid #eee",
                  textDecoration: "none",
                  color: "#1a1a1a",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontWeight: 500, fontSize: "13px" }}>{doc.title}</span>
                  <span style={{ fontSize: "11px", color: "#999", textTransform: "uppercase" }}>
                    {doc.contentType}
                  </span>
                </div>
                {doc.summary && (
                  <p style={{ fontSize: "12px", color: "#777", marginTop: "3px" }}>
                    {doc.summary.slice(0, 140)}…
                  </p>
                )}
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
