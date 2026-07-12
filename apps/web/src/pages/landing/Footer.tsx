import type { JSX } from "react";

const COLUMNS: { title: string; links: string[] }[] = [
  { title: "Product", links: ["Modules", "Pricing", "Changelog"] },
  { title: "Company", links: ["About", "Careers", "Contact"] },
  { title: "Resources", links: ["Docs", "Status", "Support"] },
];

export function Footer(): JSX.Element {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--omni-color-border)",
        paddingBlock: "var(--omni-space-10)",
      }}
    >
      <div
        className="omni-container"
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: "var(--omni-space-10)",
        }}
      >
        <div>
          <p style={{ fontWeight: "var(--omni-font-weight-semibold)" }}>Omniscience</p>
          <p style={{ color: "var(--omni-color-text-muted)", fontSize: "var(--omni-text-sm)", marginTop: "var(--omni-space-2)" }}>
            One Platform. Every Intelligence.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <div key={column.title}>
            <p style={{ fontSize: "var(--omni-text-sm)", color: "var(--omni-color-text-secondary)" }}>{column.title}</p>
            <ul style={{ listStyle: "none", margin: "var(--omni-space-3) 0 0", padding: 0 }}>
              {column.links.map((link) => (
                <li key={link} style={{ marginBottom: "var(--omni-space-2)" }}>
                  <span
                    style={{
                      color: "var(--omni-color-text-muted)",
                      fontSize: "var(--omni-text-sm)",
                      cursor: "default",
                    }}
                  >
                    {link}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p
        className="omni-container"
        style={{
          marginTop: "var(--omni-space-10)",
          color: "var(--omni-color-text-muted)",
          fontSize: "var(--omni-text-xs)",
        }}
      >
        © {new Date().getFullYear()} The Omniscience Platform. All rights reserved.
      </p>
    </footer>
  );
}
