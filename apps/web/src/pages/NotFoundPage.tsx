import type { JSX } from "react";
import { Link } from "react-router-dom";
import { ErrorState } from "@omniscience/ui";

export function NotFoundPage(): JSX.Element {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <ErrorState
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved."
        action={
          <Link to="/" className="omni-button omni-button--primary omni-button--md">
            Back to home
          </Link>
        }
      />
    </div>
  );
}
