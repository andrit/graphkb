export default function SearchPage() {
  return (
    <div>
      <h1 style={{ fontSize: "28px", fontWeight: 500, marginBottom: "24px" }}>Search</h1>
      <input
        type="text"
        placeholder="Search documents, entities, topics..."
        style={{
          width: "100%",
          padding: "12px 16px",
          fontSize: "16px",
          border: "1px solid #ddd",
          borderRadius: "8px",
          outline: "none",
          boxSizing: "border-box" as const,
        }}
      />
      <p style={{ color: "#888", fontSize: "13px", marginTop: "12px" }}>
        Combines full-text, graph traversal, and vector similarity search.
      </p>
    </div>
  );
}
