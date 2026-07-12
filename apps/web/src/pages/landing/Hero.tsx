import type { JSX } from "react";
import { Link } from "react-router-dom";
import { FadeIn, Magnetic, SlideIn } from "@omniscience/ui";

export function Hero(): JSX.Element {
  return (
    <section
      className="omni-container"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: "var(--omni-space-6)",
        paddingBlock: "var(--omni-space-24) var(--omni-space-16)",
      }}
    >
      <FadeIn>
        <span
          style={{
            display: "inline-flex",
            padding: "var(--omni-space-1) var(--omni-space-4)",
            borderRadius: "var(--omni-radius-full)",
            border: "1px solid var(--omni-color-border-strong)",
            fontSize: "var(--omni-text-xs)",
            color: "var(--omni-color-text-secondary)",
          }}
        >
          One Platform. Every Intelligence.
        </span>
      </FadeIn>

      <SlideIn delayMs={80}>
        <h1
          style={{
            fontSize: "var(--omni-text-5xl)",
            maxWidth: "18ch",
            lineHeight: "var(--omni-line-height-tight)",
          }}
        >
          The full spectrum of AI, orchestrated in one platform.
        </h1>
      </SlideIn>

      <SlideIn delayMs={160}>
        <p
          style={{
            maxWidth: "56ch",
            color: "var(--omni-color-text-secondary)",
            fontSize: "var(--omni-text-lg)",
          }}
        >
          Omniscience routes every request across reasoning, retrieval, vision, voice, prediction and
          automation modules — through one coherent assistant.
        </p>
      </SlideIn>

      <SlideIn delayMs={240}>
        <div style={{ display: "flex", gap: "var(--omni-space-4)", flexWrap: "wrap", justifyContent: "center" }}>
          <Magnetic>
            <Link to="/register" className="omni-button omni-button--primary omni-button--lg">
              Get started
            </Link>
          </Magnetic>
          <Magnetic>
            <Link to="/login" className="omni-button omni-button--secondary omni-button--lg">
              Sign in
            </Link>
          </Magnetic>
        </div>
      </SlideIn>
    </section>
  );
}
