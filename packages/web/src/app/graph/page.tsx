"use client";

import { useEffect, useState } from "react";
import { fetchEntities, fetchEntity } from "../../lib/api";
import type { EntitySummary, EntityDetail } from "../../lib/api";

const kindColors: Record<string, string> = {
  person: "#c4a0e8",
  organization: "#7db5e0",
  technology: "#6cc98f",
  concept: "#e0c76c",
  place: "#e07d7d",
};

export default function GraphPage() {
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [selected, setSelected] = useState<EntityDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchEntities(40)
      .then(setEntities)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = async (name: string) => {
    const detail = await fetchEntity(name).catch(() => null);
    setSelected(detail);
  };

  if (loading) return <p style={{ color: "#999" }}>Loading graph data…</p>;

  if (entities.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: "26px", fontWeight: 600, marginBottom: "8px" }}>Graph explorer</h1>
        <div style={{
          border: "1px dashed #ddd",
          borderRadius: "12px",
          height: "300px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#999",
          fontSize: "14px",
        }}>
          Ingest some documents to populate the graph.
        </div>
      </div>
    );
  }

  // Simple force-directed-ish layout: arrange entities in a grid/circle
  const maxR = 180;
  const nodePositions = entities.map((e, i) => {
    const angle = (2 * Math.PI * i) / entities.length;
    const r = maxR - (e.connections * 8);
    return {
      entity: e,
      x: 250 + Math.cos(angle) * Math.max(60, r),
      y: 220 + Math.sin(angle) * Math.max(60, r),
    };
  });

  return (
    <div>
      <h1 style={{ fontSize: "26px", fontWeight: 600, marginBottom: "6px" }}>Graph explorer</h1>
      <p style={{ color: "#777", fontSize: "13px", marginBottom: "20px" }}>
        Click an entity to see its connections.
      </p>

      <div style={{ display: "flex", gap: "20px" }}>
        {/* SVG graph visualization */}
        <div style={{
          flex: "1 1 0",
          background: "#fff",
          border: "1px solid #eee",
          borderRadius: "10px",
          overflow: "hidden",
          minHeight: "440px",
        }}>
          <svg viewBox="0 0 500 440" style={{ width: "100%", height: "440px" }}>
            {/* Edges for selected entity */}
            {selected && nodePositions.map((np) => {
              const isRelated = selected.relatedEntities.some(
                (r) => r.entity.name === np.entity.name,
              );
              if (!isRelated) return null;
              const selectedPos = nodePositions.find(
                (p) => p.entity.name === selected.name,
              );
              if (!selectedPos) return null;
              return (
                <line
                  key={`edge-${np.entity.name}`}
                  x1={selectedPos.x}
                  y1={selectedPos.y}
                  x2={np.x}
                  y2={np.y}
                  stroke="#ddd"
                  strokeWidth={1.5}
                />
              );
            })}

            {/* Entity nodes */}
            {nodePositions.map((np) => {
              const isSelected = selected?.name === np.entity.name;
              const isRelated = selected?.relatedEntities.some(
                (r) => r.entity.name === np.entity.name,
              );
              const radius = Math.min(20, 6 + np.entity.connections * 2);
              const opacity = selected
                ? isSelected || isRelated
                  ? 1
                  : 0.2
                : 0.8;

              return (
                <g
                  key={np.entity.name}
                  onClick={() => handleSelect(np.entity.name)}
                  style={{ cursor: "pointer" }}
                  opacity={opacity}
                >
                  <circle
                    cx={np.x}
                    cy={np.y}
                    r={radius}
                    fill={kindColors[np.entity.kind] ?? "#ccc"}
                    stroke={isSelected ? "#333" : "none"}
                    strokeWidth={isSelected ? 2 : 0}
                  />
                  <text
                    x={np.x}
                    y={np.y + radius + 12}
                    textAnchor="middle"
                    fontSize="9"
                    fill="#555"
                    fontFamily="system-ui"
                  >
                    {np.entity.name.length > 14
                      ? np.entity.name.slice(0, 13) + "…"
                      : np.entity.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{
            width: "260px",
            flexShrink: 0,
            background: "#fff",
            border: "1px solid #eee",
            borderRadius: "10px",
            padding: "16px",
            fontSize: "13px",
            alignSelf: "flex-start",
          }}>
            <h3 style={{ fontSize: "15px", fontWeight: 600, marginBottom: "4px" }}>
              {selected.name}
            </h3>
            <span
              style={{
                display: "inline-block",
                padding: "2px 8px",
                borderRadius: "8px",
                fontSize: "11px",
                fontWeight: 500,
                backgroundColor: kindColors[selected.kind] ?? "#eee",
                color: "#555",
                marginBottom: "12px",
              }}
            >
              {selected.kind}
            </span>
            <p style={{ color: "#888", fontSize: "12px", marginBottom: "12px" }}>
              {selected.mentionCount} mentions · {selected.relatedEntities.length} connections
            </p>

            {selected.relatedEntities.length > 0 && (
              <div>
                <h4 style={{ fontSize: "11px", color: "#aaa", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
                  Connected to
                </h4>
                {selected.relatedEntities.slice(0, 8).map((rel) => (
                  <div
                    key={rel.entity.name}
                    onClick={() => handleSelect(rel.entity.name)}
                    style={{
                      padding: "4px 0",
                      cursor: "pointer",
                      borderBottom: "1px solid #f5f5f5",
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{rel.entity.name}</span>
                    {rel.weight != null && (
                      <span style={{ color: "#bbb", marginLeft: "6px", fontSize: "11px" }}>
                        {Math.round(rel.weight * 100)}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <a
              href={`/wiki/entity/${encodeURIComponent(selected.name)}`}
              style={{
                display: "block",
                marginTop: "12px",
                fontSize: "12px",
                color: "#4a7dbd",
                textDecoration: "none",
              }}
            >
              View full wiki page →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
