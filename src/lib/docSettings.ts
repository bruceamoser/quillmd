// Per-document view settings (plan 02 task 2.5, issue #34): line spacing,
// word wrap, and formatting marks. These are *view* preferences with no
// markdown representation, so they persist per path in localStorage exactly
// like the view mode (viewModes.ts) and never touch the save pipeline or the
// round-trip contract.

import { isLineSpacingValue } from "./editorCommands";
import type { LineSpacingValue } from "./editorCommands";

export interface DocSettings {
  // Word/Docs spacing preset; "single" is the default (the app's base line
  // height).
  lineSpacing: LineSpacingValue;
  // Soft-wrap long lines. WYSIWYG and source both honor it; off means
  // horizontal scroll. On by default.
  wordWrap: boolean;
  // Render pilcrows/hidden whitespace (pure CSS, no document mutation).
  showMarks: boolean;
}

export const DEFAULT_DOC_SETTINGS: DocSettings = {
  lineSpacing: "single",
  wordWrap: true,
  showMarks: false,
};

const SETTINGS_KEY = "quillmd.docSettings";

// Merge a possibly-partial or corrupted stored record onto the defaults so a
// bad localStorage payload can never take down a tab (same posture as
// loadViewMode).
function normalize(raw: unknown): DocSettings {
  const out: DocSettings = { ...DEFAULT_DOC_SETTINGS };
  if (typeof raw !== "object" || raw === null) return out;
  const record = raw as Record<string, unknown>;
  if (isLineSpacingValue(record.lineSpacing)) out.lineSpacing = record.lineSpacing;
  if (typeof record.wordWrap === "boolean") out.wordWrap = record.wordWrap;
  if (typeof record.showMarks === "boolean") out.showMarks = record.showMarks;
  return out;
}

export function loadDocSettings(path: string): DocSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_DOC_SETTINGS };
    const map = JSON.parse(raw) as Record<string, unknown>;
    return normalize(map[path]);
  } catch {
    return { ...DEFAULT_DOC_SETTINGS };
  }
}

export function saveDocSettings(path: string, settings: DocSettings): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const map: Record<string, unknown> = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    map[path] = settings;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(map));
  } catch {
    // localStorage may be unavailable (private mode); settings are best-effort.
  }
}
