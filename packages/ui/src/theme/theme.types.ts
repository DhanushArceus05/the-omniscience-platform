/**
 * A theme preference chosen by the user. "system" tracks the OS-level
 * color scheme and updates automatically when it changes.
 */
export type ThemePreference = "light" | "dark" | "system";

/**
 * The theme actually applied to the document, after resolving
 * ThemePreference "system" against the OS setting.
 */
export type ResolvedTheme = "light" | "dark";

export interface ThemeContextValue {
  /** The user's stored preference: "light" | "dark" | "system". */
  theme: ThemePreference;
  /** The concrete theme currently painted on screen. */
  resolvedTheme: ResolvedTheme;
  /** Persist and apply a new preference. */
  setTheme: (theme: ThemePreference) => void;
  /** Convenience toggle between light and dark (leaves "system" if not already resolved). */
  toggleTheme: () => void;
}

export const THEME_STORAGE_KEY = "omniscience-theme";
