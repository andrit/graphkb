import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rhizomatic",
  description: "A rhizomatic knowledge base — understanding emerges from connections",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: 0 }}>
        <nav style={{
          borderBottom: "1px solid #e5e5e5",
          padding: "12px 24px",
          display: "flex",
          gap: "24px",
          alignItems: "center",
        }}>
          <strong style={{ fontSize: "18px" }}>Rhizomatic</strong>
          <a href="/" style={{ color: "#666", textDecoration: "none", fontSize: "14px" }}>Wiki</a>
          <a href="/search" style={{ color: "#666", textDecoration: "none", fontSize: "14px" }}>Search</a>
          <a href="/graph" style={{ color: "#666", textDecoration: "none", fontSize: "14px" }}>Graph</a>
          <a href="/ingest" style={{ color: "#666", textDecoration: "none", fontSize: "14px" }}>Ingest</a>
        </nav>
        <main style={{ padding: "24px", maxWidth: "960px", margin: "0 auto" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
