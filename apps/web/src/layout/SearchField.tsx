import type { JSX } from "react";
import { Input } from "@omniscience/ui";

export function SearchField(): JSX.Element {
  return (
    <div style={{ maxWidth: 320, width: "100%" }}>
      <Input
        aria-label="Search"
        placeholder="Search (coming soon)"
        disabled
        startIcon={<span aria-hidden="true">🔍</span>}
      />
    </div>
  );
}
