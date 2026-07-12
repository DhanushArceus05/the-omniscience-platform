import { THEME_STORAGE_KEY } from "./theme.types";

/**
 * Source for the inline <script> that must run in the document <head>,
 * before React mounts. It reads the persisted theme preference (or, for
 * a saved "system" preference, the OS setting) and sets `data-theme` on
 * <html> synchronously, so the correct theme is painted on the very
 * first frame — no white flash while React/ThemeProvider initializes.
 *
 * First-time visitors (nothing saved yet) always resolve to "dark" —
 * dark is the platform's default, independent of the OS setting. Once
 * a preference (light/dark/system) has been explicitly saved, it is
 * always respected, including a saved "system" preference tracking the
 * OS setting.
 *
 * Usage (in apps/web/index.html):
 *   <script>__OMNI_THEME_BOOTSTRAP__</script>
 * where __OMNI_THEME_BOOTSTRAP__ is replaced with this string, or the
 * script is written out verbatim (see index.html for the copy used).
 */
export const themeBootstrapScript = `(function () {
  try {
    var key = ${JSON.stringify(THEME_STORAGE_KEY)};
    var stored = localStorage.getItem(key);
    var resolved;
    if (stored === "light" || stored === "dark") {
      resolved = stored;
    } else if (stored === "system") {
      resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } else {
      resolved = "dark";
    }
    document.documentElement.setAttribute("data-theme", resolved);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();`;
