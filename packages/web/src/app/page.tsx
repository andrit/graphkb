/**
 * Wiki home page — the default entry point.
 * Shows recent documents, top entities, and trending topics.
 * Every node is a valid starting point — there is no hierarchy.
 */

export default function HomePage() {
  return (
    <div>
      <h1 style={{ fontSize: "28px", fontWeight: 500, marginBottom: "8px" }}>
        Knowledge base
      </h1>
      <p style={{ color: "#666", fontSize: "15px", marginBottom: "32px" }}>
        Understanding emerges from connections. Start anywhere.
      </p>

      <section style={{ marginBottom: "40px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 500, marginBottom: "16px" }}>
          Recent documents
        </h2>
        <p style={{ color: "#888", fontSize: "14px" }}>
          No documents ingested yet. Use the Ingest page or CLI to add content.
        </p>
      </section>

      <section style={{ marginBottom: "40px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 500, marginBottom: "16px" }}>
          Top entities
        </h2>
        <p style={{ color: "#888", fontSize: "14px" }}>
          Entities will appear here as you ingest documents.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: "18px", fontWeight: 500, marginBottom: "16px" }}>
          Topics
        </h2>
        <p style={{ color: "#888", fontSize: "14px" }}>
          Topics emerge from entity clustering and your curation.
        </p>
      </section>
    </div>
  );
}
