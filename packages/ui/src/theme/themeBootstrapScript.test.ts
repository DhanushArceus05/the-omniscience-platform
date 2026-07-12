import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { themeBootstrapScript } from "./themeBootstrapScript";
import { THEME_STORAGE_KEY } from "./theme.types";

/**
 * The bootstrap script is plain inline-script source (it runs in the
 * document <head> before any bundler/JSDOM environment exists), so we
 * exercise its logic here the same way a browser would: eval it against
 * a controlled `document`/`localStorage`/`matchMedia` and assert the
 * resulting `data-theme` attribute.
 */
function runBootstrapScript(options: { stored?: string; systemPrefersDark: boolean }): string | null {
  window.localStorage.clear();
  if (options.stored !== undefined) {
    window.localStorage.setItem(THEME_STORAGE_KEY, options.stored);
  }
  document.documentElement.removeAttribute("data-theme");

  const originalMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) =>
    ({ matches: options.systemPrefersDark, media: query }) as MediaQueryList) as typeof window.matchMedia;

  try {
    // eslint-disable-next-line no-new-func -- exercising the literal inline-script source
    const run = new Function(themeBootstrapScript);
    run();
  } finally {
    window.matchMedia = originalMatchMedia;
  }

  return document.documentElement.getAttribute("data-theme");
}

describe("themeBootstrapScript", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults first-time visitors to dark even when the OS prefers light", () => {
    expect(runBootstrapScript({ systemPrefersDark: false })).toBe("dark");
  });

  it("defaults first-time visitors to dark when the OS also prefers dark", () => {
    expect(runBootstrapScript({ systemPrefersDark: true })).toBe("dark");
  });

  it("respects an explicitly saved light preference", () => {
    expect(runBootstrapScript({ stored: "light", systemPrefersDark: true })).toBe("light");
  });

  it("respects an explicitly saved dark preference", () => {
    expect(runBootstrapScript({ stored: "dark", systemPrefersDark: false })).toBe("dark");
  });

  it("respects an explicitly saved 'system' preference and follows the OS setting", () => {
    expect(runBootstrapScript({ stored: "system", systemPrefersDark: true })).toBe("dark");
    expect(runBootstrapScript({ stored: "system", systemPrefersDark: false })).toBe("light");
  });
});
