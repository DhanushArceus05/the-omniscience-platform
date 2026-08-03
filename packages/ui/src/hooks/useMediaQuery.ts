import { useEffect, useState } from "react";

/**
 * Tracks whether `query` currently matches, staying in sync with
 * resizes. Falls back to `false` in environments without `matchMedia`
 * (e.g. some test runners) so consumers always get a deterministic,
 * non-throwing result rather than needing to guard every call site.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(query);
    const handleChange = (event: MediaQueryList | MediaQueryListEvent) => setMatches(event.matches);
    handleChange(mql);

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handleChange);
      return () => mql.removeEventListener("change", handleChange);
    }
    // Safari < 14 fallback.
    mql.addListener(handleChange);
    return () => mql.removeListener(handleChange);
  }, [query]);

  return matches;
}
