// Theme system (plan 05 task 5.3, issue #56): the built-in document themes.
// A theme is a CSS variable sheet scoped to the document content container
// through the data-theme attribute (src/themes/*.css). Themes are the only
// sanctioned way to change the default document look: they are view-only and
// never touch the markdown, the save pipeline, or the round-trip contract.
//
// Persistence mirrors the other view preferences:
//   - per-app default  -> quillmd.theme.default (theme.ts below)
//   - per-doc override -> DocSettings.theme (docSettings.ts, per path)
// A null per-doc override means "use the app default".

export type ThemeId = "quill" | "minimal" | "serif" | "dark" | "high-contrast";

export interface Theme {
  id: ThemeId;
  label: string;
}

export const THEMES: readonly Theme[] = [
  { id: "quill", label: "Quill" },
  { id: "minimal", label: "Minimal" },
  { id: "serif", label: "Serif / Book" },
  { id: "dark", label: "Dark" },
  { id: "high-contrast", label: "High Contrast" },
];

// "quill" is the named default (plan 05); the OS-dark default is a separate
// first-run fallback in loadThemeDefault (acceptance criterion 5).
export const DEFAULT_THEME: ThemeId = "quill";

export const THEME_MENU_ID_PREFIX = "view-theme-";
export const THEME_DEFAULT_MENU_ID_PREFIX = "view-theme-default-";
export const THEME_RESET_MENU_ID = "view-theme-reset";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEMES.map((theme) => theme.id) as string[]).includes(value);
}

export function themeById(id: string): Theme | undefined {
  return THEMES.find((theme) => theme.id === id);
}

// The theme a document renders in: its per-doc override when present,
// otherwise the app-wide default.
export function resolveTheme(appDefault: ThemeId, docOverride: ThemeId | null): ThemeId {
  return docOverride ?? appDefault;
}

// The OS dark-mode signal. Tauri's useDarkMode is the stretch path named in
// the plan; the webview exposes the same OS preference through the standard
// media query, so this keeps the behavior dependency-free.
export function osPrefersDark(): boolean {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
  } catch {
    return false;
  }
}

const DEFAULT_KEY = "quillmd.theme.default";

function readStoredDefault(): ThemeId | null {
  try {
    const raw = localStorage.getItem(DEFAULT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    return isThemeId(value) ? value : null;
  } catch {
    return null;
  }
}

export function hasSavedThemeDefault(): boolean {
  return readStoredDefault() !== null;
}

// App-wide default theme. An explicit saved choice always wins; without one,
// a new install follows the OS: Dark when the OS reports dark mode, Quill
// otherwise (plan 05 acceptance criterion 5).
export function loadThemeDefault(): ThemeId {
  return readStoredDefault() ?? (osPrefersDark() ? "dark" : DEFAULT_THEME);
}

export function saveThemeDefault(theme: ThemeId): void {
  try {
    localStorage.setItem(DEFAULT_KEY, JSON.stringify(theme));
  } catch {
    // localStorage may be unavailable (private mode); the theme is best-effort.
  }
}
