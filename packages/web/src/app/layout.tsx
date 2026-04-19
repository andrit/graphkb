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
      <body
        style={{
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          padding: 0,
          backgroundColor: "#fafafa",
          color: "#1a1a1a",
        }}
      >
        <nav
          style={{
            borderBottom: "1px solid #e5e5e5",
            padding: "0 24px",
            display: "flex",
            gap: "0",
            alignItems: "stretch",
            backgroundColor: "#fff",
            height: "48px",
          }}
        >
          <a
            href="/"
            style={{
              fontWeight: 600,
              fontSize: "16px",
              color: "#1a1a1a",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              paddingRight: "24px",
              marginRight: "8px",
              letterSpacing: "-0.01em",
            }}
          >
            ◇ Rhizomatic
          </a>
          {[
            { href: "/", label: "Wiki" },
            { href: "/search", label: "Search" },
            { href: "/graph", label: "Graph" },
            { href: "/ingest", label: "Ingest" },
          ].map((link) => (
            <a
              key={link.href}
              href={link.href}
              style={{
                color: "#555",
                textDecoration: "none",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                padding: "0 14px",
                borderBottom: "2px solid transparent",
                transition: "color 0.15s",
              }}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <main style={{ padding: "28px 24px", maxWidth: "960px", margin: "0 auto" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
