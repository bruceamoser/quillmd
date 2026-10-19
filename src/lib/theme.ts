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

// App appearance (Settings > Appearance > Mode): the chrome palette and the
// document page both follow the resolved light/dark mode. "system" tracks the
// OS preference live.
export type AppearanceMode = "system" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";

export const DEFAULT_APPEARANCE: AppearanceMode = "system";

export interface Theme {
  id: ThemeId;
  label: string;
  // The appearance this theme's palette belongs to. The document renders a
  // theme only when its mode matches the resolved app appearance; otherwise
  // the mode's default theme is used.
  mode: ResolvedAppearance;
}

export const THEMES: readonly Theme[] = [
  { id: "quill", label: "Quill", mode: "dark" },
  { id: "minimal", label: "Minimal", mode: "light" },
  { id: "serif", label: "Serif / Book", mode: "light" },
  { id: "dark", label: "Dark", mode: "dark" },
  { id: "high-contrast", label: "High Contrast", mode: "dark" },
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

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === "system" || value === "light" || value === "dark";
}

// The appearance a theme's palette belongs to.
export function themeMode(id: ThemeId): ResolvedAppearance {
  return themeById(id)?.mode ?? "dark";
}

// The document theme a mode falls back to when the configured theme belongs
// to the other appearance.
export function defaultThemeForAppearance(mode: ResolvedAppearance): ThemeId {
  return mode === "light" ? "minimal" : "quill";
}

// The concrete light/dark appearance for a mode; "system" follows the OS.
export function resolveAppearance(
  mode: AppearanceMode,
  osDark: boolean = osPrefersDark(),
): ResolvedAppearance {
  if (mode === "system") return osDark ? "dark" : "light";
  return mode;
}

// The theme the document page renders in: a theme of the matching appearance
// stays as chosen; a mismatch falls back to the mode's default so the page
// never renders a light palette inside dark chrome (or vice versa).
export function themeForAppearance(theme: ThemeId, mode: ResolvedAppearance): ThemeId {
  return themeMode(theme) === mode ? theme : defaultThemeForAppearance(mode);
}

// The theme a document renders in: its per-doc override when present,
// otherwise the app-wide default.
export function resolveTheme(appDefault: ThemeId, docOverride: ThemeId | null): ThemeId {
  return docOverride ?? appDefault;
}

// The OS dark-mode signal. Tauri's useDarkMode is the stretch path named in
// the plan; the webview exposes the same OS preference through the standard
// media query, so this keeps the behavior dependency-free. A platform that
// cannot answer keeps the app's built-in dark look.
export function osPrefersDark(): boolean {
  try {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    return media ? media.matches : true;
  } catch {
    return true;
  }
}

// The last chosen appearance, cached for the first paint (settings.json is
// read asynchronously; the cache avoids a dark flash for light-mode users).
// Not authoritative — AppSettings.appearanceMode is.
const APPEARANCE_KEY = "quillmd.appearance";

export function loadCachedAppearance(): AppearanceMode {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const value = JSON.parse(raw) as unknown;
    return isAppearanceMode(value) ? value : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveCachedAppearance(mode: AppearanceMode): void {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(mode));
  } catch {
    // localStorage may be unavailable (private mode); the cache is best-effort.
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
