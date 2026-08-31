// Per-app editor-chrome font (plan 04 task 4.5, issue #51): the font the
// WYSIWYG editor uses to render document text. Unlike the per-doc view
// settings (docSettings.ts) this is a single app-wide preference, persisted
// under its own localStorage key. It is purely cosmetic — rendered as CSS
// variables on the editor content DOM — and never touches the markdown, the
// save pipeline, or the round-trip contract.

export type EditorFontFamily = "sans-serif" | "serif" | "monospace";

export const EDITOR_FONT_FAMILIES: readonly EditorFontFamily[] = [
  "sans-serif",
  "serif",
  "monospace",
];

// The CSS font stack each pick renders as. Sans and monospace reuse the app's
// existing stacks (App.css --font-text / --font-mono) so the default look is
// unchanged and themes keep control; serif gets an explicit classic stack.
export const EDITOR_FONT_FAMILY_CSS: Record<EditorFontFamily, string> = {
  "sans-serif": "var(--font-text)",
  serif:
    '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, Cambria, "Times New Roman", Times, serif',
  monospace: "var(--font-mono)",
};

// Screen sizes in px for the editor content (the base is 15px, App.css).
export const EDITOR_FONT_SIZES: readonly number[] = [12, 13, 14, 15, 16, 18, 20, 24];

export const EDITOR_FONT_DEFAULT_SIZE = 15;

export interface EditorFontSettings {
  family: EditorFontFamily;
  size: number;
}

// "sans-serif" at 15px is the app's current editor look, so the default is a
// no-op for existing users.
export const DEFAULT_EDITOR_FONT: EditorFontSettings = {
  family: "sans-serif",
  size: EDITOR_FONT_DEFAULT_SIZE,
};

export function isEditorFontFamily(value: unknown): value is EditorFontFamily {
  return typeof value === "string" && (EDITOR_FONT_FAMILIES as readonly string[]).includes(value);
}

export function isEditorFontSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && (EDITOR_FONT_SIZES as readonly number[]).includes(value);
}

const FONT_KEY = "quillmd.editorFont";

// Merge a possibly-partial or corrupted stored record onto the defaults so a
// bad localStorage payload can never take down the app (same posture as
// docSettings.ts).
function normalize(raw: unknown): EditorFontSettings {
  const out: EditorFontSettings = { ...DEFAULT_EDITOR_FONT };
  if (typeof raw !== "object" || raw === null) return out;
  const record = raw as Record<string, unknown>;
  if (isEditorFontFamily(record.family)) out.family = record.family;
  if (typeof record.size === "number" && Number.isFinite(record.size)) {
    out.size = Math.min(EDITOR_FONT_SIZES[EDITOR_FONT_SIZES.length - 1], Math.max(EDITOR_FONT_SIZES[0], Math.round(record.size)));
  }
  return out;
}

export function loadEditorFont(): EditorFontSettings {
  try {
    const raw = localStorage.getItem(FONT_KEY);
    if (!raw) return { ...DEFAULT_EDITOR_FONT };
    return normalize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_EDITOR_FONT };
  }
}

export function saveEditorFont(settings: EditorFontSettings): void {
  try {
    localStorage.setItem(FONT_KEY, JSON.stringify(settings));
  } catch {
    // localStorage may be unavailable (private mode); the font is best-effort.
  }
}
