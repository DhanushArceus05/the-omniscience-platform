import type { JSX } from "react";
import { AdaptiveBackground } from "@omniscience/ui";
import { Hero } from "./landing/Hero";
import { Features } from "./landing/Features";
import { ModulesPreview } from "./landing/ModulesPreview";
import { WhyOmniscience } from "./landing/WhyOmniscience";
import { CTASection } from "./landing/CTASection";
import { Footer } from "./landing/Footer";

export function LandingPage(): JSX.Element {
  return (
    <div style={{ position: "relative" }}>
      <AdaptiveBackground />
      <Hero />
      <Features />
      <ModulesPreview />
      <WhyOmniscience />
      <CTASection />
      <Footer />
    </div>
  );
}
