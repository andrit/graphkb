export default function IngestPage() {
  return (
    <div>
      <h1 style={{ fontSize: "28px", fontWeight: 500, marginBottom: "24px" }}>Ingest content</h1>
      <div style={{
        border: "2px dashed #ddd",
        borderRadius: "12px",
        padding: "48px",
        textAlign: "center" as const,
        color: "#888",
        fontSize: "14px",
      }}>
        <p style={{ marginBottom: "8px" }}>Drop files here or click to upload</p>
        <p style={{ fontSize: "12px" }}>PDF, DOCX, CSV, XLSX, HTML, Markdown, Images</p>
      </div>
      <div style={{ marginTop: "24px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 500, marginBottom: "12px" }}>Or ingest from URL</h2>
        <input
          type="url"
          placeholder="https://..."
          style={{
            width: "100%",
            padding: "10px 14px",
            fontSize: "14px",
            border: "1px solid #ddd",
            borderRadius: "8px",
            outline: "none",
            boxSizing: "border-box" as const,
          }}
        />
      </div>
    </div>
  );
}
