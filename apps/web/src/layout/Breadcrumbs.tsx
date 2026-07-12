import type { JSX } from "react";
import { Link } from "react-router-dom";

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps): JSX.Element {
  return (
    <nav aria-label="Breadcrumb">
      <ol
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--omni-space-2)",
          listStyle: "none",
          margin: 0,
          padding: 0,
          fontSize: "var(--omni-text-sm)",
          color: "var(--omni-color-text-secondary)",
        }}
      >
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${item.to ?? index}`} style={{ display: "flex", alignItems: "center", gap: "var(--omni-space-2)" }}>
              {item.to && !isLast ? (
                <Link to={item.to} style={{ color: "inherit" }}>
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined} style={isLast ? { color: "var(--omni-color-text-primary)" } : undefined}>
                  {item.label}
                </span>
              )}
              {!isLast && <span aria-hidden="true">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
