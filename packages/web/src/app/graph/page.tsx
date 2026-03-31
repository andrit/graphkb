export default function GraphPage() {
  return (
    <div>
      <h1 style={{ fontSize: "28px", fontWeight: 500, marginBottom: "24px" }}>Graph explorer</h1>
      <div style={{
        border: "1px dashed #ddd",
        borderRadius: "12px",
        height: "400px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#888",
        fontSize: "14px",
        textAlign: "center" as const,
      }}>
        Interactive graph visualization will render here.
        <br />
        Start from any entity and explore outward.
      </div>
    </div>
  );
}
