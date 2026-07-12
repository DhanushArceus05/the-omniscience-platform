import { useCallback, useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { ThemeContext } from "./ThemeContext";
import { THEME_STORAGE_KEY, type ResolvedTheme, type ThemePreference } from "./theme.types";

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  // No saved preference yet (first-time visitor): default to dark,
  // regardless of the OS setting. A saved "system" preference is
  // handled by the branch above and continues to track the OS.
  return "dark";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return systemPrefersDark() ? "dark" : "light";
  }
  return preference;
}

export interface ThemeProviderProps {
  children: ReactNode;
  /** Overrides the initial preference (mainly for tests/storybook). */
  defaultTheme?: ThemePreference;
}

/**
 * Provides theme state to the tree and keeps `data-theme` on <html>
 * in sync with it. Pairs with the inline bootstrap script (see
 * themeBootstrapScript.ts) which sets the initial attribute before
 * React mounts, so there is never a flash of the wrong theme.
 */
export function ThemeProvider({ children, defaultTheme }: ThemeProviderProps): JSX.Element {
  const [theme, setThemeState] = useState<ThemePreference>(() => defaultTheme ?? readStoredPreference());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolve(theme));

  const applyTheme = useCallback((preference: ThemePreference) => {
    const next = resolve(preference);
    setResolvedTheme(next);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", next);
    }
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (): void => {
      if (theme === "system") {
        applyTheme("system");
      }
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme, applyTheme]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
