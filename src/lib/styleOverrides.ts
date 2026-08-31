// Style overrides (plan 05 task 5.4, issue #57): Word's "Modify Style"
// semantics — the per-style look of a built-in style (font family/size,
// color, weight, italic, spacing) as user style overrides.
//
// Storage is machine-local by design (plan 05 §3): a JSON file in the Tauri
// app config dir (~/.config/quillmd/style-overrides.json) written through the
// Rust read_style_overrides / write_style_overrides commands, which keeps
// config-dir access in the Rust layer. In browser dev there is no Rust layer,
// so the same payload falls back to localStorage (the dev-only posture the
// file-input open path already uses).
//
// The overrides are view-only: they render as CSS scoped to the WYSIWYG and
// preview content containers. The save pipeline and the round-trip contract
// never see them, so a modified style can never change a byte of a document
// (plan 05 AC6).
//
// Keys are markdown types, not style names: the registry maps several names
// to one markdown construct (Title and Heading 1 are both H1, Subtitle and
// Heading 2 are both H2, Normal and No Spacing are both plain paragraphs),
// so an override follows the markdown the style really is — the same honest
// mapping the gallery documents. Modifying "Subtitle" restyles every H2.

import { invoke, isTauri } from "@tauri-apps/api/core";

// The markdown construct a style override restyles. One per distinct DOM
// shape the WYSIWYG/preview surfaces render (see KEY_SELECTOR below).
export type OverrideKey =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "blockquote"
  | "intenseQuote"
  | "listItem"
  | "codeBlock"
  | "inlineCode"
  | "em"
  | "strong";

export const STYLE_OVERRIDE_KEYS: readonly OverrideKey[] = [
  "paragraph",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "intenseQuote",
  "listItem",
  "codeBlock",
  "inlineCode",
  "em",
  "strong",
];

// Block keys own spacing (margins); mark keys render inside a paragraph and
// have none of their own.
export const BLOCK_OVERRIDE_KEYS: readonly OverrideKey[] = [
  "paragraph",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "intenseQuote",
  "listItem",
  "codeBlock",
];

export function isOverrideKey(value: unknown): value is OverrideKey {
  return typeof value === "string" && (STYLE_OVERRIDE_KEYS as readonly string[]).includes(value);
}

export type OverrideSpacing = "compact" | "relaxed";

// The fields the Modify Style dialog offers (plan 05 §3: family/size/color/
// weight/italic/spacing). Every field is optional — absence means "use the
// theme default" — so resetting a style is deleting its record.
export interface StyleOverride {
  fontFamily?: string; // e.g. "Georgia" (validated free text)
  fontSize?: string; // e.g. "18pt" (from OVERRIDE_FONT_SIZES)
  color?: string; // e.g. "#3c3c3c" (#rrggbb)
  fontWeight?: "normal" | "bold";
  fontStyle?: "italic";
  spacing?: OverrideSpacing; // block keys only
}

export type StyleOverrides = Partial<Record<OverrideKey, StyleOverride>>;

// The Modify Style dialog's menu id (plan 05 §2.3: Format > Styles >
// "Modify…"). It is checked before the format-style-<id> prefix branch in
// App.tsx so it is not swallowed by the style-picker resolver.
export const MODIFY_STYLE_MENU_ID = "format-style-modify";

// The style registry id -> markdown key map. The keys are exactly the
// BUILT_IN_STYLES ids (the vitest suite asserts the sync); several ids share
// a key because they alias the same markdown construct.
const STYLE_ID_OVERRIDE_KEYS: Record<string, OverrideKey> = {
  normal: "paragraph",
  "no-spacing": "paragraph",
  title: "h1",
  heading1: "h1",
  heading2: "h2",
  subtitle: "h2",
  heading3: "h3",
  heading4: "h4",
  heading5: "h5",
  heading6: "h6",
  quote: "blockquote",
  "intense-quote": "intenseQuote",
  "list-paragraph": "listItem",
  "source-code": "codeBlock",
  code: "inlineCode",
  emphasis: "em",
  strong: "strong",
};

export function styleKeyForStyleId(styleId: string): OverrideKey | null {
  return STYLE_ID_OVERRIDE_KEYS[styleId] ?? null;
}

// The selector the override's declarations attach to, relative to the scope
// (the WYSIWYG content container, the preview content, or the dialog's
// preview pane). inlineCode excludes code inside fenced blocks (pre > code),
// which belong to the codeBlock key.
const KEY_SELECTOR: Record<OverrideKey, string> = {
  paragraph: "p",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  blockquote: "blockquote",
  intenseQuote: "blockquote strong",
  listItem: "li",
  codeBlock: "pre",
  inlineCode: ":not(pre) > code",
  em: "em",
  strong: "strong",
};

// The pt sizes the dialog offers (plan 05 AC3's "18pt" is the headline pick).
// A fixed set keeps the stored value a closed enum — no free-text CSS can
// reach the injected stylesheet.
export const OVERRIDE_FONT_SIZES: readonly string[] = [
  "8pt",
  "9pt",
  "10pt",
  "11pt",
  "12pt",
  "14pt",
  "16pt",
  "18pt",
  "20pt",
  "22pt",
  "24pt",
  "26pt",
  "28pt",
  "32pt",
  "36pt",
  "40pt",
  "48pt",
];

// Font family free text: one or more comma-separated family names, each a
// quoted name ("Times New Roman") or a bare name (letters, digits, spaces,
// dots, dashes, underscores). Anything else is rejected so a stored payload
// can never inject CSS (e.g. "x; } body { color:").
const FAMILY_PART_RE = /^("[^"]{1,60}"|'[^']{1,60}'|[A-Za-z][A-Za-z0-9 ._ -]{0,60})$/;

export function normalizeFontFamily(value: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  if (v.length > 120) return null;
  const parts = v.split(",").map((p) => p.trim());
  if (parts.some((p) => p === "")) return null;
  if (parts.some((p) => !FAMILY_PART_RE.test(p))) return null;
  return v;
}

// Merge a possibly-partial or corrupted stored record onto an empty override
// so a bad payload can never take down the app (same posture as
// docSettings.ts / editorFont.ts). Unknown keys, unknown fields, and invalid
// values are dropped silently.
export function normalizeOverride(key: OverrideKey, raw: unknown): StyleOverride {
  const out: StyleOverride = {};
  if (typeof raw !== "object" || raw === null) return out;
  const record = raw as Record<string, unknown>;
  const family = normalizeFontFamily(String(record.fontFamily ?? ""));
  if (family !== null) out.fontFamily = family;
  if (typeof record.fontSize === "string" && (OVERRIDE_FONT_SIZES as readonly string[]).includes(record.fontSize)) {
    out.fontSize = record.fontSize;
  }
  if (typeof record.color === "string" && /^#[0-9a-fA-F]{6}$/.test(record.color)) {
    out.color = record.color.toLowerCase();
  }
  if (record.fontWeight === "normal" || record.fontWeight === "bold") {
    out.fontWeight = record.fontWeight;
  }
  if (record.fontStyle === "italic") out.fontStyle = "italic";
  if (record.spacing === "compact" || record.spacing === "relaxed") {
    out.spacing = record.spacing;
  }
  if (!BLOCK_OVERRIDE_KEYS.includes(key)) delete out.spacing;
  return out;
}

export function normalizeOverrides(raw: unknown): StyleOverrides {
  const out: StyleOverrides = {};
  if (typeof raw !== "object" || raw === null) return out;
  const record = raw as Record<string, unknown>;
  for (const key of STYLE_OVERRIDE_KEYS) {
    if (!(key in record)) continue;
    const normalized = normalizeOverride(key, record[key]);
    if (Object.keys(normalized).length > 0) out[key] = normalized;
  }
  return out;
}

function overrideDeclarations(o: StyleOverride): string[] {
  const decls: string[] = [];
  if (o.fontFamily) decls.push(`font-family: ${o.fontFamily};`);
  if (o.fontSize) decls.push(`font-size: ${o.fontSize};`);
  if (o.color) decls.push(`color: ${o.color};`);
  if (o.fontWeight) decls.push(`font-weight: ${o.fontWeight};`);
  if (o.fontStyle) decls.push(`font-style: ${o.fontStyle};`);
  if (o.spacing) {
    decls.push(
      o.spacing === "compact"
        ? "margin-top: 0.1em; margin-bottom: 0.1em;"
        : "margin-top: 1.2em; margin-bottom: 1.2em;",
    );
  }
  return decls;
}

// The CSS the overrides render as. `scopes` are the content containers the
// rule applies to (App injects it once with the WYSIWYG + preview scopes;
// the Modify Style dialog previews with its own pane's scope). The output is
// view-only markup for a <style> tag — it never reaches the serializer.
export function overridesToCss(overrides: StyleOverrides, scopes: readonly string[]): string {
  let css = "";
  for (const key of STYLE_OVERRIDE_KEYS) {
    const o = overrides[key];
    if (!o) continue;
    const decls = overrideDeclarations(o);
    if (decls.length === 0) continue;
    const selectors = scopes.map((s) => `${s} ${KEY_SELECTOR[key]}`).join(", ");
    css += `/* quillmd style override: ${key} */\n${selectors} { ${decls.join(" ")} }\n`;
  }
  return css;
}

// The markdown construct name the dialog shows under the style picker
// (the honest mapping: "Subtitle is H2 — this restyles every H2").
export const OVERRIDE_KEY_LABELS: Record<OverrideKey, string> = {
  paragraph: "Plain paragraph",
  h1: "H1",
  h2: "H2",
  h3: "H3",
  h4: "H4",
  h5: "H5",
  h6: "H6",
  blockquote: "Blockquote",
  intenseQuote: "Blockquote (bold run)",
  listItem: "List item",
  codeBlock: "Fenced code block",
  inlineCode: "Inline code",
  em: "Italic run",
  strong: "Bold run",
};

// --- storage (plan 05 §3: Rust commands, app config dir) -------------------

const OVERRIDES_STORAGE_KEY = "quillmd.styleOverrides";

// The Tauri commands' file lives in the app config dir; this mirrors it for
// the browser-dev fallback so dev and Tauri share one payload shape.
export async function loadStyleOverrides(): Promise<StyleOverrides> {
  if (isTauri()) {
    try {
      const raw = await invoke<string>("read_style_overrides");
      return normalizeOverrides(JSON.parse(raw || "{}"));
    } catch {
      return {};
    }
  }
  try {
    const raw = localStorage.getItem(OVERRIDES_STORAGE_KEY);
    if (!raw) return {};
    return normalizeOverrides(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function saveStyleOverrides(overrides: StyleOverrides): Promise<void> {
  const payload = JSON.stringify(overrides);
  if (isTauri()) {
    await invoke("write_style_overrides", { json: payload });
    return;
  }
  try {
    localStorage.setItem(OVERRIDES_STORAGE_KEY, payload);
  } catch {
    // localStorage may be unavailable (private mode); overrides are best-effort.
  }
}
