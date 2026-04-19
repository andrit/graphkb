"use client";

import { useCallback, useRef, useState } from "react";
import { searchAll } from "../../lib/api";
import type { SearchResult } from "../../lib/api";

const typeColors: Record<string, string> = {
  document: "#d5e8f5",
  chunk: "#f0f0f0",
  entity: "#d5f5e0",
};

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const r = await searchAll(q, 20);
      setResults(r);
      setSearched(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(value), 300);
    },
    [doSearch],
  );

  const linkForResult = (r: SearchResult): string => {
    if (r.type === "document") return `/wiki/doc/${r.id}`;
    if (r.type === "entity") return `/wiki/entity/${encodeURIComponent(r.title ?? r.content)}`;
    // chunk — link to parent doc (extract docId from chunk id)
    const docId = r.id.replace(/_chunk_\d+$/, "");
    return `/wiki/doc/${docId}`;
  };

  return (
    <div>
      <h1 style={{ fontSize: "26px", fontWeight: 600, marginBottom: "6px" }}>
        Search
      </h1>
      <p style={{ color: "#777", fontSize: "13px", marginBottom: "20px" }}>
        Full-text search across documents, chunks, and entities.
      </p>

      <input
        type="text"
        value={query}
        onChange={handleChange}
        placeholder="Search documents, entities, topics…"
        autoFocus
        style={{
          width: "100%",
          padding: "12px 16px",
          fontSize: "15px",
          border: "1px solid #ddd",
          borderRadius: "8px",
          outline: "none",
          boxSizing: "border-box",
          backgroundColor: "#fff",
        }}
      />

      {loading && (
        <p style={{ color: "#999", fontSize: "13px", marginTop: "12px" }}>
          Searching…
        </p>
      )}

      {searched && results.length === 0 && !loading && (
        <p style={{ color: "#999", fontSize: "13px", marginTop: "16px" }}>
          No results found for &ldquo;{query}&rdquo;
        </p>
      )}

      {results.length > 0 && (
        <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
          {results.map((r) => (
            <a
              key={`${r.type}-${r.id}`}
              href={linkForResult(r)}
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
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "2px 7px",
                    borderRadius: "6px",
                    fontSize: "10px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    backgroundColor: typeColors[r.type] ?? "#eee",
                    color: "#555",
                  }}
                >
                  {r.type}
                </span>
                {r.title && (
                  <span style={{ fontWeight: 500, fontSize: "14px" }}>{r.title}</span>
                )}
                <span style={{ fontSize: "11px", color: "#bbb", marginLeft: "auto" }}>
                  {r.score.toFixed(2)}
                </span>
              </div>
              <p style={{ fontSize: "12px", color: "#777", lineHeight: "1.4", marginTop: "4px" }}>
                {r.content.slice(0, 200)}{r.content.length > 200 ? "…" : ""}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
