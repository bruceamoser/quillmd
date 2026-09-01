// Shared command registry for editor formatting. The toolbar, the slash menu,
// keyboard shortcuts, and native menu events all dispatch through the same
// command ids so each surface exercises identical behavior. Keeping the logic
// in one place is what lets App.tsx (menu events) and Toolbar.tsx reuse the
// exact same functions.

import { canInsertNode, isNodeSelection, type Editor as CoreEditor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type EditorState } from "@tiptap/pm/state";
import { CellSelection, cellAround, findCell } from "@tiptap/pm/tables";
import { FRONTMATTER_LANG } from "./pm";
import {
  mermaidCardModeAt,
  requestMermaidCardMode,
  type MermaidCardMode,
} from "./mermaidCardMode";
import { insertTableAt, type TableInsertSpec } from "./tables";
import type { DocSettings } from "./docSettings";
import { normalizeColor } from "./colors";
import {
  DEFAULT_EDITOR_FONT,
  EDITOR_FONT_FAMILIES,
  EDITOR_FONT_FAMILY_CSS,
  isEditorFontFamily,
  isEditorFontSize,
  type EditorFontSettings,
} from "./editorFont";

export type EditorCommandId =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "link"
  | "image"
  | "imageFromFile"
  | "imageEdit"
  | "imageAlt"
  | "imageReplace"
  | "imageDelete"
  | "highlight"
  | "subscript"
  | "superscript"
  | "blockquote"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "table"
  | "tableInsert"
  | "tableDialog"
  | "rowInsertAbove"
  | "rowInsertBelow"
  | "rowDelete"
  | "colInsertLeft"
  | "colInsertRight"
  | "colDelete"
  | "cellAlignLeft"
  | "cellAlignCenter"
  | "cellAlignRight"
  | "headerRowToggle"
  | "cellMerge"
  | "cellClear"
  | "tableDelete"
  | "codeBlock"
  | "diagram"
  | "diagramEdit"
  | "diagramPreview"
  | "diagramCopyCode"
  | "diagramDelete"
  | "hr"
  | "footnote"
  | "frontmatter"
  | "emoji"
  | "definitionList"
  | "underline"
  | "alignLeft"
  | "alignCenter"
  | "alignRight"
  | "indent"
  | "outdent"
  | "lineSpacing"
  | "showMarks"
  | "wordWrap"
  | "zoom"
  | "spellcheck"
  | "spelling"
  | "wordCount"
  | "pasteAsText"
  | "fontFamily"
  | "fontSize"
  | "fontColor"
  | "highlightColor"
  | "undo"
  | "redo"
  | "clearFormatting"
  | "editorFont";

// Parameters for the view-level commands that take one. `lineSpacing` takes a
// spacing preset, `zoom` takes a step (or an explicit percent), `pasteAsText`
// takes the plain-text payload (the clipboard read is owned by the caller:
// menu events, paste key handlers, tests), the font attribute commands
// (`fontFamily` / `fontSize`) take the picked value (a family name, or a
// point size as a number or "Npt" string) or `null` for "Normal" (the
// document default), the color commands (`fontColor` / `highlightColor`)
// take the picked color — a hex string for a swatch or custom color, or
// `null` for "auto" (inherit / no color) — and `editorFont` takes the full
// per-app editor-chrome font settings object. The tableInsert command
// (plan 06 task 6.3, issue #63) takes the picked size — the rows/cols/header
// spec the size-picker popover or the "Insert table…" dialog produced.
export type EditorCommandParam =
  | LineSpacingValue
  | ZoomParam
  | EditorFontSettings
  | TableInsertSpec
  | string
  | number
  | null;

export interface EditorCommand {
  id: EditorCommandId;
  label: string;
  shortcut?: string;
  run: (editor: CoreEditor, param?: EditorCommandParam) => boolean;
  active?: (editor: CoreEditor, param?: EditorCommandParam) => boolean;
}

// The starter template for a new Mermaid diagram (plan 11 task 11.1, issue
// #100): a 3-node flowchart. Insert > Diagram (and /diagram, the toolbar)
// insert a mermaidBlock whose content is exactly this text, so the saved
// file carries the fence with this body (plan 11 AC1).
export const MERMAID_STARTER_TEMPLATE =
  "graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Done]\n  B -->|No| D[Retry]";

// --- view-level command parameters -----------------------------------------

// Word/Docs line-spacing presets (plan 02 §2.4). Rendered as the
// --quillmd-line-spacing CSS variable on the editor content; no markdown
// representation (view preference).
export type LineSpacingValue = "single" | "1.15" | "1.5" | "double";

export const LINE_SPACING_VALUES: readonly LineSpacingValue[] = [
  "single",
  "1.15",
  "1.5",
  "double",
];

// "single" maps to the app's base line height (1.7, see App.css) rather than
// a literal 1.0: like Word/Docs, "Single" is this app's standard default
// spacing, so picking it keeps a document's look unchanged, while the numeric
// presets are explicit multipliers.
const LINE_SPACING_CSS: Record<LineSpacingValue, string> = {
  single: "1.7",
  "1.15": "1.15",
  "1.5": "1.5",
  double: "2",
};

const LINE_SPACING_VAR = "--quillmd-line-spacing";

export function isLineSpacingValue(value: unknown): value is LineSpacingValue {
  return typeof value === "string" && (LINE_SPACING_VALUES as readonly string[]).includes(value);
}

// Word/Docs zoom range (plan 02 §2.6): 50-200% in 10% steps, reset to 100%.
export type ZoomParam = "in" | "out" | "reset";

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 10;
export const ZOOM_DEFAULT = 100;

const ZOOM_VAR = "--quillmd-zoom";

// The formatting-marks wrapper class (plan 02 §3): pure CSS, no document
// mutation, so it can never break the round-trip.
const SHOW_MARKS_CLASS = "quillmd-show-marks";

// The word-wrap-off class (plan 02 §2.7): present means wrap is disabled and
// the content scrolls horizontally. Absent (the default) means wrap is on.
const NO_WRAP_CLASS = "quillmd-no-wrap";

// The contenteditable spellcheck attribute (plan 02 §2.8, issue #36): the
// browser engine (WebKitGTK/WebView2) does the actual checking, so the
// command only toggles the attribute on the editor DOM.
const SPELLCHECK_ATTR = "spellcheck";

// The editor-chrome font (plan 04 task 4.5, issue #51): the per-app font the
// WYSIWYG content renders in. Rendered as CSS variables on the editor DOM —
// cosmetic, like line spacing and zoom, with no markdown representation.
const EDITOR_FONT_FAMILY_VAR = "--quillmd-editor-font";
const EDITOR_FONT_SIZE_VAR = "--quillmd-editor-font-size";

// Applies a document's persisted view settings (plan 02 task 2.5, zoom per
// task 2.6) to the editor DOM: the line-spacing and zoom CSS variables plus
// the formatting-marks and no-wrap wrapper classes and the spellcheck
// attribute. The Editor calls this on mount and whenever the settings change
// so a reopened tab restores its look; the toggling commands mutate the same
// DOM state, which keeps re-application idempotent.
export function applyViewSettings(editor: CoreEditor, settings: DocSettings): void {
  const dom = editorDom(editor);
  dom.style.setProperty(LINE_SPACING_VAR, LINE_SPACING_CSS[settings.lineSpacing]);
  dom.style.setProperty(ZOOM_VAR, String(clampZoom(settings.zoom)));
  dom.classList.toggle(SHOW_MARKS_CLASS, settings.showMarks);
  dom.classList.toggle(NO_WRAP_CLASS, !settings.wordWrap);
  dom.setAttribute(SPELLCHECK_ATTR, settings.spellcheck ? "true" : "false");
}

// Applies the per-app editor-chrome font (plan 04 task 4.5, issue #51) to the
// editor DOM. The Editor calls this on mount with the persisted setting so
// every newly mounted WYSIWYG view renders in the app-wide font; the
// editorFont registry command mutates the same DOM state for live picks,
// which keeps re-application idempotent.
export function applyEditorFont(editor: CoreEditor, settings: EditorFontSettings): void {
  const dom = editorDom(editor);
  dom.style.setProperty(EDITOR_FONT_FAMILY_VAR, EDITOR_FONT_FAMILY_CSS[settings.family]);
  dom.style.setProperty(EDITOR_FONT_SIZE_VAR, `${settings.size}px`);
}

function headingCmd(level: 1 | 2 | 3 | 4 | 5 | 6): EditorCommand {
  return {
    id: `h${level}` as EditorCommandId,
    label: `Heading ${level}`,
    run: (editor) => editor.chain().focus().toggleHeading({ level }).run(),
    active: (editor) => editor.isActive("heading", { level }),
  };
}

// Next numeric footnote label in the document (1, 2, ...). Scans the inline
// reference nodes and definition blocks so an inserted footnote never collides.
export function nextFootnoteLabel(editor: CoreEditor): string {
  let max = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "footnoteRef" || node.type.name === "footnoteDef") {
      const label = node.attrs.label;
      const n = typeof label === "string" ? parseInt(label, 10) : NaN;
      if (Number.isFinite(n) && n > max) max = n;
    }
  });
  return String(max + 1);
}

// --- helpers for the view-level commands ------------------------------------

function editorDom(editor: CoreEditor): HTMLElement {
  return editor.view.dom as HTMLElement;
}

// The line-spacing preset currently applied to the editor. Unset (or a
// value this build does not recognize) reads as the "single" default.
export function lineSpacingOf(editor: CoreEditor): LineSpacingValue {
  const raw = editorDom(editor).style.getPropertyValue(LINE_SPACING_VAR).trim();
  for (const value of LINE_SPACING_VALUES) {
    if (LINE_SPACING_CSS[value] === raw) return value;
  }
  return "single";
}

// The zoom percent currently applied to the editor (50-200, plan 02 §2.6).
export function zoomPercentOf(editor: CoreEditor): number {
  const raw = parseFloat(editorDom(editor).style.getPropertyValue(ZOOM_VAR));
  if (!Number.isFinite(raw)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(raw)));
}

// The editor-chrome font currently applied to the editor (plan 04 task 4.5,
// issue #51). Unset variables (or values this build does not recognize) read
// as the defaults, matching the CSS fallbacks in App.css.
export function editorFontOf(editor: CoreEditor): EditorFontSettings {
  const dom = editorDom(editor);
  const familyRaw = dom.style.getPropertyValue(EDITOR_FONT_FAMILY_VAR).trim();
  let family: EditorFontSettings["family"] = DEFAULT_EDITOR_FONT.family;
  for (const candidate of EDITOR_FONT_FAMILIES) {
    if (EDITOR_FONT_FAMILY_CSS[candidate] === familyRaw) {
      family = candidate;
      break;
    }
  }
  const sizeRaw = parseInt(dom.style.getPropertyValue(EDITOR_FONT_SIZE_VAR), 10);
  return {
    family,
    size: Number.isFinite(sizeRaw) ? sizeRaw : DEFAULT_EDITOR_FONT.size,
  };
}

// Clamps an arbitrary percent into the 50-200 zoom range, rounding to a whole
// percent. A non-finite input falls back to the 100% default.
export function clampZoom(percent: number): number {
  if (!Number.isFinite(percent)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(percent)));
}

function setZoomPercent(editor: CoreEditor, percent: number): void {
  editorDom(editor).style.setProperty(ZOOM_VAR, String(clampZoom(percent)));
}

// Whether the contenteditable spellcheck attribute is on (plan 02 §2.8,
// issue #36). A missing attribute reads as off, matching the explicit
// "false" the editor used to hard-code.
export function spellcheckOf(editor: CoreEditor): boolean {
  return editorDom(editor).getAttribute(SPELLCHECK_ATTR) === "true";
}

// --- color command helpers (plan 04 task 4.2, issue #48) --------------------
//
// The font color and highlight color pickers share the same palette
// (colors.ts) and dispatch the fontColor / highlightColor commands below.
// These helpers read the color under the caret so a palette can mark its
// active cell; they report null for "auto" (no color / inherit).

// The font color of the mark at the selection, or null when the selection
// carries no font color (auto / inherit).
export function fontColorOf(editor: CoreEditor): string | null {
  const color = editor.getAttributes("fontColor").color;
  return typeof color === "string" && color !== "" ? color : null;
}

// The highlight color of the mark at the selection, or null when the
// selection is not highlighted or the highlight is the colorless default.
export function highlightColorOf(editor: CoreEditor): string | null {
  const color = editor.getAttributes("highlight").color;
  return typeof color === "string" && color !== "" ? color : null;
}

// --- font attribute command helpers (plan 04 task 4.3, issue #49) ---------
//
// The toolbar's family and size selects dispatch the fontFamily / fontSize
// commands below. These helpers read the attributes at the selection so a
// select can show the current value; they report null for "Normal" (the
// document default, no attribute).

// The font family of the mark at the selection, or null when the selection
// carries no font family (Normal / document default).
export function fontFamilyOf(editor: CoreEditor): string | null {
  const family = editor.getAttributes("fontFamily").fontFamily;
  return typeof family === "string" && family !== "" ? family : null;
}

// The font size of the mark at the selection in its canonical "Npt" form, or
// null when the selection carries no font size (Normal / inherit).
export function fontSizeOf(editor: CoreEditor): string | null {
  const size = editor.getAttributes("fontSize").fontSize;
  return typeof size === "string" && size !== "" ? size : null;
}

// The curated cross-platform family list (plan 04 §2.1): ~24 families that
// ship with Windows, macOS, and Linux out of the box. The select offers this
// list plus "Normal" (clear) and "Custom…" (free text).
export const FONT_FAMILIES: readonly string[] = [
  "Arial",
  "Arial Black",
  "Book Antiqua",
  "Brush Script MT",
  "Calibri",
  "Cambria",
  "Century Gothic",
  "Comic Sans MS",
  "Consolas",
  "Courier New",
  "Franklin Gothic Medium",
  "Garamond",
  "Georgia",
  "Impact",
  "Lucida Console",
  "MS Gothic",
  "MS Mincho",
  "Palatino Linotype",
  "Segoe UI",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];

// Word's standard point sizes (plan 04 §2.2), rendered as `font-size: Npt`.
export const FONT_SIZES: readonly number[] = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48,
];

// The family select's free-text option value (not a real family name).
export const FONT_FAMILY_CUSTOM = "__custom__";

// The family-name slug used in the format-font-family-<slug> menu ids
// (plan 04 task 4.4, issue #50): lowercase, every run of non-alphanumerics
// collapsed to a single "-". Must stay byte-identical to family_slug in
// src-tauri/src/menu.rs, which derives the ids from the same family list.
export function fontFamilySlug(family: string): string {
  return family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

// Format > Font submenu ids (plan 04 task 4.4, issue #50). The native menu
// carries no parameters, so every family, size, and color swatch is its own
// menu id; this maps an id back to the (registry command, param) pair the
// toolbar font cluster dispatches, so the menu, the toolbar, and the (P3)
// context menu all run the identical commands. Returns null for ids that are
// not Font submenu picks — including "format-font-family-custom" (the prompt
// is owned by the dispatching surface) and anything off the curated lists.
export function fontMenuCommand(
  id: string,
): { command: EditorCommandId; param: EditorCommandParam } | null {
  if (id === "format-font-family-normal") return { command: "fontFamily", param: null };
  if (id.startsWith("format-font-family-")) {
    const slug = id.slice("format-font-family-".length);
    const family = FONT_FAMILIES.find((f) => fontFamilySlug(f) === slug);
    return family ? { command: "fontFamily", param: family } : null;
  }
  if (id === "format-font-size-normal") return { command: "fontSize", param: null };
  if (id.startsWith("format-font-size-")) {
    const size = Number(id.slice("format-font-size-".length));
    return Number.isInteger(size) && size > 0 ? { command: "fontSize", param: size } : null;
  }
  if (id === "format-font-color-auto") return { command: "fontColor", param: null };
  if (id.startsWith("format-font-color-")) {
    const color = `#${id.slice("format-font-color-".length)}`;
    return normalizeColor(color) ? { command: "fontColor", param: color } : null;
  }
  if (id === "format-highlight-color-auto") return { command: "highlightColor", param: null };
  if (id.startsWith("format-highlight-color-")) {
    const color = `#${id.slice("format-highlight-color-".length)}`;
    return normalizeColor(color) ? { command: "highlightColor", param: color } : null;
  }
  if (id === "format-font-underline") return { command: "underline", param: null };
  if (id === "format-font-clear") return { command: "clearFormatting", param: null };
  return null;
}

// Runs a font attribute command (fontFamily / fontSize): `null` is "Normal"
// (clear the attribute back to the document default). A family is a
// non-empty (trimmed) name; a size is a positive point count given as a
// number or an "N"/"Npt" string, canonicalized to "Npt".
function runFontAttrCommand(
  editor: CoreEditor,
  mark: "fontFamily" | "fontSize",
  param: EditorCommandParam | undefined,
): boolean {
  if (param === null) {
    return editor.chain().focus().unsetMark(mark).run();
  }
  let value: string | null = null;
  if (typeof param === "number" && Number.isInteger(param) && param > 0) {
    value = `${param}pt`;
  } else if (typeof param === "string") {
    const trimmed = param.trim();
    if (trimmed === "") return false;
    if (mark === "fontSize") {
      // A point count given as an "Npt" string or a bare count ("14").
      const size = /^(\d+)(pt)?$/.exec(trimmed);
      if (!size) return false;
      const n = Number(size[1]);
      if (!Number.isInteger(n) || n <= 0) return false;
      value = `${n}pt`;
    } else {
      value = trimmed;
    }
  }
  if (value === null) return false;
  return editor.chain().focus().setMark(mark, { [mark]: value }).run();
}

// Runs a color command: `null` is "auto" (clear the color), a string is a
// picked swatch or custom color (normalized before it touches the mark).
function runColorCommand(
  editor: CoreEditor,
  mark: string,
  param: EditorCommandParam | undefined,
): boolean {
  if (param === null) {
    return editor.chain().focus().unsetMark(mark).run();
  }
  const color = typeof param === "string" ? normalizeColor(param) : null;
  if (!color) return false;
  return editor.chain().focus().setMark(mark, { color }).run();
}

// Node types that carry per-block alignment (plan 02 §2.2). The textAlign
// node attribute is parsed/serialized by pm.ts as the quillmd-align-* HTML
// wrapper block (plan 02 task 2.3); "left" is the default (absent attribute).
const ALIGNABLE_NODES = ["paragraph", "heading", "blockquote", "codeBlock"] as const;

type AlignValue = "left" | "center" | "right";

// The alignment of the block under the cursor, or null when the cursor is
// not in an alignable block.
export function textAlignOf(editor: CoreEditor): AlignValue | null {
  for (const name of ALIGNABLE_NODES) {
    if (editor.isActive(name)) {
      const value = editor.getAttributes(name).textAlign;
      if (value === "center" || value === "right") return value;
      return "left";
    }
  }
  return null;
}

// The outermost alignable blocks intersecting [from, to]. A block that is
// itself inside another alignable block (a paragraph inside an aligned
// blockquote) is skipped: aligning the inner block would nest two wrapper
// divs, so the selection always acts on the outermost block per range.
function alignableTargets(
  doc: PmNode,
  from: number,
  to: number,
): Array<{ pos: number; node: PmNode }> {
  const out: Array<{ pos: number; node: PmNode }> = [];
  const walk = (node: PmNode, pos: number, insideAlignable: boolean): void => {
    if (node.isText) return;
    if (!(pos < to && pos + node.nodeSize > from)) return;
    const isAlignable = ALIGNABLE_NODES.includes(node.type.name as (typeof ALIGNABLE_NODES)[number]);
    if (isAlignable && !insideAlignable) {
      out.push({ pos, node });
      return;
    }
    node.forEach((child, offset) => walk(child, pos + 1 + offset, insideAlignable || isAlignable));
  };
  // The root doc's children are indexed from position 0 (a child at content
  // `offset` sits at absolute `offset`), so seed the walk per child rather than
  // treating the doc itself as a positioned node.
  doc.forEach((child, offset) => walk(child, offset, false));
  return out;
}

function setAlignment(editor: CoreEditor, value: AlignValue): boolean {
  const { state } = editor;
  const { from, to } = state.selection;
  const targets = alignableTargets(state.doc, from, to);
  if (targets.length === 0) return false;
  const desired: string | null = value === "left" ? null : value;
  const tr = state.tr;
  for (const { pos, node } of targets) {
    if ((node.attrs.textAlign ?? null) !== desired) {
      tr.setNodeMarkup(pos, node.type, { ...node.attrs, textAlign: desired });
    }
  }
  if (tr.docChanged) {
    editor.view.dispatch(tr);
  }
  return true;
}

// setAlignment dispatches nothing when every target block already has the
// requested value, so re-clicking the active alignment never emits a no-op
// transaction. Returns true when the block(s) are aligned to `value`
// afterwards, false when the selection is not in an alignable block.

// The native sink/lift chain (same as the Tab key handler in Editor.tsx):
// both the listItem and taskItem variants run, the one that does not apply
// is a no-op. Two quirks are worked around here:
//   - chain().run() ANDs the per-command results, so the non-matching variant
//     reports false even though the other one already changed the document.
//     The document comparison is the true result.
//   - The converter currently emits task lists as bullet lists of task items,
//     a structure the native sink rejects with an error. Report the failure
//     instead of letting it escape into the dispatching surface.
function runListSinkOrLift(editor: CoreEditor, sink: boolean): boolean {
  const before = editor.state.doc;
  try {
    const chain = editor.chain().focus();
    if (sink) {
      chain.sinkListItem("listItem").sinkListItem("taskItem");
    } else {
      chain.liftListItem("listItem").liftListItem("taskItem");
    }
    chain.run();
  } catch {
    // Fall through to the document comparison.
  }
  return !before.eq(editor.state.doc);
}

// Indent (plan 02 §2.5): list items nest via the native sink commands; any
// other block is pushed one quote level deeper (wrap). Word parity: Ctrl+].
function indentRun(editor: CoreEditor): boolean {
  if (inList(editor)) {
    return runListSinkOrLift(editor, true);
  }
  if (editor.can().wrapIn("blockquote")) {
    return editor.chain().focus().wrapIn("blockquote").run();
  }
  return false;
}

// Indent is applicable when the block under the cursor can be pushed in:
// list items the native sink can nest, quoted blocks (nest one level), or any
// other wrappable block (the first wrap creates the quote level).
function indentActive(editor: CoreEditor): boolean {
  if (inList(editor)) {
    return editor.can().sinkListItem("listItem") || editor.can().sinkListItem("taskItem");
  }
  if (editor.isActive("blockquote")) return true;
  return editor.can().wrapIn("blockquote");
}

// Outdent (plan 02 §2.5): list items un-nest via the native lift commands;
// quoted blocks are pulled one quote level shallower (lift). Word parity:
// Ctrl+['.
function outdentRun(editor: CoreEditor): boolean {
  if (inList(editor)) {
    return runListSinkOrLift(editor, false);
  }
  if (editor.isActive("blockquote")) {
    return editor.chain().focus().lift("blockquote").run();
  }
  return false;
}

// Outdent is applicable when the block under the cursor can be pulled out:
// list items the native lift can raise (top-level items lift out of the list)
// or quoted blocks (lift removes one quote level).
function outdentActive(editor: CoreEditor): boolean {
  if (inList(editor)) {
    return editor.can().liftListItem("listItem") || editor.can().liftListItem("taskItem");
  }
  return editor.isActive("blockquote");
}

function inList(editor: CoreEditor): boolean {
  return editor.isActive("listItem") || editor.isActive("taskItem");
}

// An EditorFontSettings param (plan 04 task 4.5, issue #51). The tableInsert
// command (plan 06 task 6.3, issue #63) added a second object param to the
// union, so the font commands need a shape check to tell the two apart.
function isEditorFontSettings(
  param: EditorCommandParam | undefined,
): param is EditorFontSettings {
  if (typeof param !== "object" || param === null) return false;
  const settings = param as EditorFontSettings;
  return isEditorFontFamily(settings.family) && isEditorFontSize(settings.size);
}

// A TableInsertSpec param (plan 06 task 6.3, issue #63): an object with
// whole-number rows/cols and a header-row flag. Anything else (the string /
// number / null params the other commands use) is rejected.
function isTableInsertSpec(param: EditorCommandParam | undefined): param is TableInsertSpec {
  if (typeof param !== "object" || param === null) return false;
  const spec = param as TableInsertSpec;
  return (
    typeof spec.rows === "number" &&
    Number.isInteger(spec.rows) &&
    typeof spec.cols === "number" &&
    Number.isInteger(spec.cols) &&
    typeof spec.withHeaderRow === "boolean"
  );
}

// --- table commands (plan 06 task 6.2, issue #62) --------------------------
//
// The row / column / cell / header / delete commands. Each wraps TipTap's
// table extension (or a small ProseMirror transaction) so the toolbar
// (P3 task 6.4), the context menu, and the native menu all dispatch the same
// behavior through the registry. These commands mutate the ProseMirror model
// only; the GFM round-trip contract stays in the converter (pm.ts), which
// re-serializes the table (including the per-column alignment spec) on save.
//
// A cell position is the position directly before a cell node: its parent is
// the row, so `node(-1)` is the table and `findCell($pos)` resolves its
// column rect. `CellSelection.forEachCell` and `cellAround` both yield that
// shape.

// The table under the selection plus the 0-based indices of every column the
// selection touches. A cursor / text selection covers the cell under the
// caret (a merged cell touches every column it spans); a CellSelection
// covers all of its selected cells. Null when the selection is not inside a
// table.
function tableColumnsOf(state: EditorState): { tablePos: number; columns: number[] } | null {
  const sel = state.selection;
  const columns = new Set<number>();
  let tablePos = -1;
  const visit = (pos: number): void => {
    const $cell = state.doc.resolve(pos);
    if (tablePos === -1) {
      for (let d = $cell.depth; d > 0; d -= 1) {
        if ($cell.node(d).type.name === "table") {
          tablePos = $cell.before(d);
          break;
        }
      }
    }
    const rect = findCell($cell);
    for (let c = rect.left; c < rect.right; c += 1) columns.add(c);
  };
  if (sel instanceof CellSelection) {
    sel.forEachCell((_cell, pos) => visit(pos));
  } else {
    const $cell = cellAround(sel.$from);
    if (!$cell) return null;
    visit($cell.pos);
  }
  if (tablePos === -1) return null;
  return { tablePos, columns: [...columns].sort((a, b) => a - b) };
}

// Whether the selection is inside a table (every table command is
// applicable).
export function inTable(editor: CoreEditor): boolean {
  return tableColumnsOf(editor.state) !== null;
}

// Whether the selection is an image node (the image context menu's
// applicability, plan 03 task 3.4, issue #42 — the same shape as inTable /
// inDiagram). Only a NodeSelection on an image node qualifies: the image
// menu acts on the selected node, and a caret beside an image is not the
// node itself.
export function inImage(editor: CoreEditor): boolean {
  const sel = editor.state.selection;
  return isNodeSelection(sel) && sel.node.type.name === "image";
}

// The position of the table node under the selection (the node the floating
// table toolbar, plan 06 task 6.4, issue #64, positions itself over), or
// null when the selection is not inside a table. A cursor / text selection
// resolves the cell under the caret, a CellSelection the anchor cell — both
// are inside the table, so the same walk covers every in-table selection
// shape.
export function tablePosOf(editor: CoreEditor): number | null {
  const target = tableColumnsOf(editor.state);
  return target ? target.tablePos : null;
}

type CellAlignValue = "left" | "center" | "right";

// The effective alignment of one column's spec entry. Unset (or an
// unrecognized) spec reads as "left" — the GFM default, serialized by
// pm.ts as a bare `---` delimiter.
function effectiveCellAlign(value: unknown): CellAlignValue {
  return value === "center" || value === "right" ? value : "left";
}

// The alignment shared by every column the selection touches, or null when
// the selection is not in a table (or a multi-column selection spans mixed
// alignments). Drives the active state of the cell alignment commands.
export function cellAlignOf(editor: CoreEditor): CellAlignValue | null {
  const target = tableColumnsOf(editor.state);
  if (!target) return null;
  const table = editor.state.doc.nodeAt(target.tablePos);
  if (!table) return null;
  const align = table.attrs.align;
  const values = target.columns.map((c) =>
    effectiveCellAlign(Array.isArray(align) ? align[c] : null),
  );
  return values.every((v) => v === values[0]) ? values[0] : null;
}

// Sets the GFM alignment spec on every column the selection touches. The
// spec lives on the table node's `align` attribute (pm.ts re-serializes it
// as the `:---` / `:---:` / `---:` delimiter row, plan 06 §2.4). A never-set
// column reads as the GFM default (a bare `---`, which renders left), so an
// explicit "align left" on such a column is a no-op like the block
// alignment commands; left is written as the explicit `:---` spec only when
// it replaces another alignment.
function setCellAlign(editor: CoreEditor, value: CellAlignValue): boolean {
  const target = tableColumnsOf(editor.state);
  if (!target) return false;
  const { state } = editor;
  const table = state.doc.nodeAt(target.tablePos);
  if (!table) return false;
  const align = table.attrs.align;
  const already = target.columns.every((c) =>
    effectiveCellAlign(Array.isArray(align) ? align[c] : null) === value,
  );
  if (already) return true;
  let width = 0;
  table.forEach((row) => {
    width = Math.max(width, row.childCount);
  });
  const spec: Array<string | null> = [];
  for (let i = 0; i < width; i += 1) {
    const a = Array.isArray(align) ? align[i] : null;
    spec.push(a === "left" || a === "center" || a === "right" ? a : null);
  }
  for (const c of target.columns) {
    spec[c] = value;
  }
  const tr = state.tr.setNodeMarkup(target.tablePos, table.type, {
    ...table.attrs,
    align: spec,
  });
  editor.view.dispatch(tr);
  return true;
}

// The header-row state of the table under the selection — GFM has exactly
// one header row and it is always the first row (pm.ts), so only the first
// row's header-ness is read. Null outside a table.
export function headerRowOf(editor: CoreEditor): boolean | null {
  const target = tableColumnsOf(editor.state);
  if (!target) return null;
  const table = editor.state.doc.nodeAt(target.tablePos);
  const firstCell = table?.firstChild?.firstChild;
  return firstCell ? firstCell.type.name === "tableHeader" : null;
}

// Toggles the header-ness of the FIRST row, whichever row the cursor is in.
// TipTap's own toggleHeaderRow acts on the selected row, which would create a
// second header row in a body row — invalid in the GFM model, where the
// header is always row 0 (pm.ts). No-op (returns false) outside a table.
function headerRowToggleRun(editor: CoreEditor): boolean {
  const target = tableColumnsOf(editor.state);
  if (!target) return false;
  const { state } = editor;
  const table = state.doc.nodeAt(target.tablePos);
  const firstRow = table?.firstChild;
  const headerType = state.schema.nodes.tableHeader;
  const cellType = state.schema.nodes.tableCell;
  if (!table || !firstRow || !headerType || !cellType) return false;
  let isHeader = true;
  firstRow.forEach((cell) => {
    if (cell.type !== headerType) isHeader = false;
  });
  const tr = state.tr;
  let offset = 0;
  firstRow.forEach((cell) => {
    const cellPos = target.tablePos + 2 + offset;
    const wanted = isHeader ? cellType : headerType;
    if (cell.type !== wanted) {
      tr.setNodeMarkup(cellPos, wanted, cell.attrs);
    }
    offset += cell.nodeSize;
  });
  if (tr.docChanged) {
    editor.view.dispatch(tr);
  }
  return true;
}

// Whether a multi-cell (CellSelection) selection is active — the only
// selection shape cell merging applies to.
function cellMergeActive(editor: CoreEditor): boolean {
  const sel = editor.state.selection;
  if (!(sel instanceof CellSelection)) return false;
  let count = 0;
  sel.forEachCell(() => {
    count += 1;
  });
  return count >= 2;
}

// Clears the content of every cell the selection covers (the cell under the
// caret, or all cells of a CellSelection), leaving one empty paragraph per
// cell. TipTap 2.x ships no clear-cells command; the closest relative,
// prosemirror-tables' deleteCellSelection (Backspace on a cell selection),
// only accepts a CellSelection — a plain cursor in a single cell reports
// failure — so the registry keeps its own to cover both selection shapes.
function cellClearRun(editor: CoreEditor): boolean {
  const { state } = editor;
  const ranges: Array<{ from: number; to: number }> = [];
  const addCell = (pos: number): void => {
    const cell = state.doc.nodeAt(pos);
    if (cell) ranges.push({ from: pos + 1, to: pos + cell.nodeSize - 1 });
  };
  const sel = state.selection;
  if (sel instanceof CellSelection) {
    sel.forEachCell((_cell, pos) => addCell(pos));
  } else {
    const $cell = cellAround(sel.$from);
    if (!$cell) return false;
    addCell($cell.pos);
  }
  const empty = state.schema.nodes.paragraph.createChecked();
  if (!empty || ranges.length === 0) return false;
  let tr = state.tr;
  for (const r of [...ranges].sort((a, b) => b.from - a.from)) {
    tr = tr.replaceWith(r.from, r.to, empty);
  }
  editor.view.dispatch(tr);
  return true;
}

// --- diagram node helpers (plan 11 task 11.6, issue #105) ------------------

// The canonical fenced form of a mermaid source: the same bytes the
// converter (pm.ts) serializes a mermaidBlock to, so a copied fence re-pasted
// here — or into GitHub / Obsidian / Notion — round-trips to the same
// diagram.
export function mermaidFenceOf(source: string): string {
  return "```mermaid\n" + source + "\n```";
}

// The mermaidBlock under the selection — a NodeSelection on the diagram, or
// any cursor / text selection whose $from sits inside one — plus the doc
// position of the node. Null when the selection is not in a diagram.
export function diagramNodeOf(
  editor: CoreEditor,
): { pos: number; node: PmNode } | null {
  const sel = editor.state.selection;
  if (isNodeSelection(sel)) {
    if (sel.node.type.name !== "mermaidBlock") return null;
    return { pos: sel.from, node: sel.node };
  }
  const $from = sel.$from;
  for (let d = $from.depth; d > 0; d -= 1) {
    if ($from.node(d).type.name === "mermaidBlock") {
      return { pos: $from.before(d), node: $from.node(d) };
    }
  }
  return null;
}

// Whether the selection is inside a diagram (every diagram command's
// applicability — the same shape as inTable for the table commands).
export function inDiagram(editor: CoreEditor): boolean {
  return diagramNodeOf(editor) !== null;
}

// The display mode of the diagram under the selection, reported by the
// mounted card through the mode channel (mermaidCardMode.ts). Null when the
// selection is not in a diagram or no card is mounted (the mode is a view
// state that only exists in the WYSIWYG card).
export function diagramModeOf(editor: CoreEditor): MermaidCardMode | null {
  const target = diagramNodeOf(editor);
  if (!target) return null;
  return mermaidCardModeAt(target.pos);
}

export const EDITOR_COMMANDS: EditorCommand[] = [
  {
    id: "paragraph",
    label: "Paragraph",
    // Plan 05 task 5.1 (issue #54): the styles registry needs a Normal-text
    // command ("Normal" / "No Spacing" styles). Word's "Normal" returns the
    // block to a plain paragraph, lifting out of a list item or one quote
    // level first — setParagraph alone cannot convert a list item's inner
    // paragraph. Only the applicable lift variant is chained, and the result
    // is the document comparison (same as runListSinkOrLift): chain().run()
    // ANDs the per-command results, and a lift + setParagraph pair can report
    // false even though the document changed.
    run: (editor) => {
      const before = editor.state.doc;
      const chain = editor.chain().focus();
      if (editor.isActive("taskItem")) {
        chain.liftListItem("taskItem");
      } else if (editor.isActive("listItem")) {
        chain.liftListItem("listItem");
      }
      if (editor.isActive("blockquote")) {
        chain.lift("blockquote");
      }
      chain.setParagraph().run();
      return !before.eq(editor.state.doc);
    },
    active: (editor) => editor.isActive("paragraph"),
  },
  headingCmd(1),
  headingCmd(2),
  headingCmd(3),
  headingCmd(4),
  headingCmd(5),
  headingCmd(6),
  {
    id: "bold",
    label: "Bold",
    shortcut: "Ctrl+B",
    run: (editor) => editor.chain().focus().toggleBold().run(),
    active: (editor) => editor.isActive("bold"),
  },
  {
    id: "italic",
    label: "Italic",
    shortcut: "Ctrl+I",
    run: (editor) => editor.chain().focus().toggleItalic().run(),
    active: (editor) => editor.isActive("italic"),
  },
  {
    id: "strike",
    label: "Strikethrough",
    shortcut: "Ctrl+Shift+X",
    run: (editor) => editor.chain().focus().toggleStrike().run(),
    active: (editor) => editor.isActive("strike"),
  },
  {
    id: "code",
    label: "Inline code",
    shortcut: "Ctrl+E",
    run: (editor) => editor.chain().focus().toggleCode().run(),
    active: (editor) => editor.isActive("code"),
  },
  {
    id: "link",
    label: "Link",
    shortcut: "Ctrl+K",
    // Plan 08 task 8.1 (issue #76): the link command no longer prompts — it
    // requests the in-app link dialog (App.tsx renders it). Toolbar, Insert
    // menu, Ctrl+K, and the slash menu all reach this one command.
    run: (editor) => requestLinkDialog(editor),
    active: (editor) => editor.isActive("link"),
  },
  {
    id: "image",
    label: "Image from URL",
    // Plan 08 task 8.2 (issue #77): the image command no longer prompts — it
    // requests the in-app image dialog for the "From URL" flow (App.tsx
    // renders it), the same shape as the link command from task 8.1. The
    // toolbar main button, the Insert > Image > From URL menu item, and the
    // slash menu all reach this one command.
    run: (editor) => requestImageInsert(editor, "url"),
  },
  {
    id: "imageFromFile",
    label: "Image from file",
    // Plan 08 task 8.2 (issue #77): the "From file" half of the Image
    // submenu. The registry cannot open the native picker itself, so the
    // command requests the flow and the app shell (App.tsx) runs the picker
    // and inserts the relativized src.
    run: (editor) => requestImageInsert(editor, "file"),
  },
  {
    id: "imageEdit",
    label: "Edit image",
    // Plan 08 task 8.4 (issue #79): the Edit-image command requests the in-app
    // image edit dialog (App.tsx renders it), the same shape as the link
    // command from task 8.1. Clicking an image in the editor reaches this
    // command; the dialog prefills from the image under the caret and applies
    // URL/alt/width back to the same instance.
    run: (editor) => requestImageEditDialog(editor),
    active: inImage,
  },
  {
    id: "imageAlt",
    label: "Change alt text",
    // Plan 03 task 3.4 (issue #42): the image menu's alt-text item. Requests
    // the image edit dialog with the alt field focused (App.tsx renders it);
    // the dialog prefills from the selected image and applies the result back
    // to the same instance (plan 08 task 8.4 plumbing).
    run: (editor) => requestImageAltDialog(editor),
    active: inImage,
  },
  {
    id: "imageReplace",
    label: "Replace image",
    // Plan 03 task 3.4 (issue #42): the image menu's replace item. Requests
    // the replace flow; the app shell (App.tsx) runs the native file picker
    // and swaps the selected image's src through the asset pipeline — the
    // same request/listener shape as the image insert "file" flow.
    run: (editor) => requestImageReplace(editor),
    active: inImage,
  },
  {
    id: "imageDelete",
    label: "Remove image",
    // Plan 03 task 3.4 (issue #42): the image menu's destructive item.
    // Deletes the image node under the selection and drops the cursor where
    // the node stood. A plain ProseMirror delete, so undo (Ctrl+Z) restores
    // the image exactly (plan 03 AC3). The surface gates the pick on its
    // native confirm dialog before this runs (plan 03 §3), the same rule as
    // the table and diagram delete commands.
    run: (editor) => {
      const sel = editor.state.selection;
      if (!isNodeSelection(sel) || sel.node.type.name !== "image") return false;
      const { state } = editor;
      const tr = state.tr.delete(sel.from, sel.to);
      tr.setSelection(TextSelection.near(tr.doc.resolve(sel.from)));
      editor.view.dispatch(tr);
      return true;
    },
    active: inImage,
  },
  {
    id: "highlight",
    label: "Highlight",
    run: (editor) => editor.chain().focus().toggleHighlight().run(),
    active: (editor) => editor.isActive("highlight"),
  },
  {
    id: "fontFamily",
    label: "Font family",
    // Plan 04 task 4.3 (issue #49): the family select's pick. A family name
    // sets the fontFamily mark (the quillmd-font span's font-family
    // attribute); "Normal" (null) clears it back to the document default.
    run: (editor, param) => runFontAttrCommand(editor, "fontFamily", param),
    active: (editor) => editor.isActive("fontFamily"),
  },
  {
    id: "fontSize",
    label: "Font size",
    // Plan 04 task 4.3 (issue #49): the size select's pick. A point count
    // (number or "Npt" string) sets the fontSize mark (font-size: Npt);
    // "Normal" (null) clears it back to inherit.
    run: (editor, param) => runFontAttrCommand(editor, "fontSize", param),
    active: (editor) => editor.isActive("fontSize"),
  },
  {
    id: "fontColor",
    label: "Font color",
    // Plan 04 task 4.2 (issue #48): the shared color palette's font half.
    // A swatch/custom hex sets the fontColor mark (the quillmd-font span's
    // color attribute); "auto" (null) clears it back to the document default.
    run: (editor, param) => runColorCommand(editor, "fontColor", param),
    active: (editor) => editor.isActive("fontColor"),
  },
  {
    id: "highlightColor",
    label: "Highlight color",
    // Plan 04 task 4.2 (issue #48): the shared color palette's highlight half.
    // A swatch/custom hex sets the highlight's color attribute (the
    // quillmd-highlight span); "auto" (null) removes the highlight entirely
    // (Word's "no color"), which also drops a colored highlight back to
    // nothing rather than to ==text==.
    run: (editor, param) => runColorCommand(editor, "highlight", param),
    active: (editor) => editor.isActive("highlight"),
  },
  {
    id: "subscript",
    label: "Subscript",
    run: (editor) => editor.chain().focus().toggleSubscript().run(),
    active: (editor) => editor.isActive("subscript"),
  },
  {
    id: "superscript",
    label: "Superscript",
    run: (editor) => editor.chain().focus().toggleSuperscript().run(),
    active: (editor) => editor.isActive("superscript"),
  },
  {
    id: "blockquote",
    label: "Blockquote",
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
    active: (editor) => editor.isActive("blockquote"),
  },
  {
    id: "bulletList",
    label: "Bullet list",
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
    active: (editor) => editor.isActive("bulletList"),
  },
  {
    id: "orderedList",
    label: "Ordered list",
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
    active: (editor) => editor.isActive("orderedList"),
  },
  {
    id: "taskList",
    label: "Task list",
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
    active: (editor) => editor.isActive("taskList"),
  },
  {
    id: "table",
    label: "Table",
    // Plan 06 task 6.3 (issue #63): the fixed 3x3 insert is replaced by the
    // size-picker popover — the command requests it (the toolbar's Table
    // button renders it) instead of inserting directly, the same shape as
    // the link and image dialog commands. A no-op outside WYSIWYG, where no
    // toolbar is mounted to host the picker.
    run: (editor) => requestTableInsert(editor),
  },
  {
    id: "tableInsert",
    label: "Insert table",
    // Plan 06 task 6.3 (issue #63): inserts the picked size (a TableInsertSpec
    // param from the size-picker popover or the "Insert table…" dialog).
    // Every surface dispatches this one command, so the inserted table is
    // identical no matter where the pick came from. Invalid sizes are
    // rejected (no document change).
    run: (editor, param) => {
      if (!isTableInsertSpec(param)) return false;
      return insertTableAt(editor, param);
    },
  },
  {
    id: "tableDialog",
    label: "Insert table…",
    // Plan 06 task 6.3 (issue #63): requests the "Insert table…" dialog for
    // precise sizes (>10, or with/without a header row). The app shell
    // (App.tsx) renders it, the same shape as the link/image dialog
    // commands; a no-op outside WYSIWYG, where there is no editor to insert
    // into.
    run: (editor) => requestTableDialog(editor),
  },
  // Table editing (plan 06 task 6.2, issue #62). TipTap's table commands
  // resolve the cell under the selection themselves; focus() (position
  // null) preserves the current selection, including a CellSelection.
  {
    id: "rowInsertAbove",
    label: "Insert row above",
    run: (editor) => editor.chain().focus().addRowBefore().run(),
    active: inTable,
  },
  {
    id: "rowInsertBelow",
    label: "Insert row below",
    run: (editor) => editor.chain().focus().addRowAfter().run(),
    active: inTable,
  },
  {
    id: "rowDelete",
    label: "Delete row",
    run: (editor) => editor.chain().focus().deleteRow().run(),
    active: inTable,
  },
  {
    id: "colInsertLeft",
    label: "Insert column left",
    run: (editor) => editor.chain().focus().addColumnBefore().run(),
    active: inTable,
  },
  {
    id: "colInsertRight",
    label: "Insert column right",
    run: (editor) => editor.chain().focus().addColumnAfter().run(),
    active: inTable,
  },
  {
    id: "colDelete",
    label: "Delete column",
    run: (editor) => editor.chain().focus().deleteColumn().run(),
    active: inTable,
  },
  {
    id: "cellAlignLeft",
    label: "Align cells left",
    run: (editor) => setCellAlign(editor, "left"),
    active: (editor) => cellAlignOf(editor) === "left",
  },
  {
    id: "cellAlignCenter",
    label: "Align cells center",
    run: (editor) => setCellAlign(editor, "center"),
    active: (editor) => cellAlignOf(editor) === "center",
  },
  {
    id: "cellAlignRight",
    label: "Align cells right",
    run: (editor) => setCellAlign(editor, "right"),
    active: (editor) => cellAlignOf(editor) === "right",
  },
  {
    id: "headerRowToggle",
    label: "Toggle header row",
    run: headerRowToggleRun,
    active: (editor) => headerRowOf(editor) === true,
  },
  {
    id: "cellMerge",
    label: "Merge cells",
    run: (editor) => editor.chain().focus().mergeCells().run(),
    active: cellMergeActive,
  },
  {
    id: "cellClear",
    label: "Clear cell contents",
    run: cellClearRun,
    active: inTable,
  },
  {
    id: "tableDelete",
    label: "Delete table",
    run: (editor) => editor.chain().focus().deleteTable().run(),
    active: inTable,
  },
  {
    id: "codeBlock",
    label: "Code block",
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
    active: (editor) => editor.isActive("codeBlock"),
  },
  {
    id: "diagram",
    label: "Diagram",
    // Plan 11 task 11.1 (issue #100): insert a mermaidBlock with the starter
    // template at the cursor. Every surface (Insert > Diagram, /diagram, the
    // toolbar) dispatches this one command, so the inserted diagram is
    // identical no matter where it came from. A no-op when the cursor is
    // already inside a diagram (no nested insert).
    //
    // The insertion follows TipTap's block-insert algorithm (the one
    // setHorizontalRule uses): when the cursor sits at the very start of a
    // paragraph, the diagram goes *before* that paragraph instead of splitting
    // it — splitting would leave a stray empty paragraph at the top of the
    // document. Otherwise the paragraph splits around the cursor. The cursor
    // then lands just after the inserted block, or inside it when the diagram
    // ends the document (so the user can edit the starter template in place).
    run: (editor) => {
      if (editor.isActive("mermaidBlock")) return false;
      const state = editor.state;
      if (!canInsertNode(state, state.schema.nodes.mermaidBlock)) return false;
      const { selection } = state;
      const {
        $from: $originFrom,
        $to: $originTo,
      } = selection;
      const diagram = {
        type: "mermaidBlock",
        content: [{ type: "text", text: MERMAID_STARTER_TEMPLATE }],
      };
      const chain = editor.chain().focus();
      if ($originFrom.parentOffset === 0) {
        chain.insertContentAt(
          { from: Math.max($originFrom.pos - 1, 0), to: $originTo.pos },
          diagram,
        );
      } else if (isNodeSelection(selection)) {
        chain.insertContentAt($originTo.pos, diagram);
      } else {
        chain.insertContent(diagram);
      }
      return chain
        .command(({ tr, dispatch }) => {
          if (dispatch) {
            const { $to } = tr.selection;
            const posAfter = $to.end();
            if ($to.nodeAfter) {
              if ($to.nodeAfter.isTextblock) {
                tr.setSelection(TextSelection.create(tr.doc, $to.pos + 1));
              } else if ($to.nodeAfter.isBlock) {
                tr.setSelection(NodeSelection.create(tr.doc, $to.pos));
              } else {
                tr.setSelection(TextSelection.create(tr.doc, $to.pos));
              }
            } else {
              const filler = $to.parent.type.contentMatch.defaultType?.create();
              if (filler) {
                tr.insert(posAfter, filler);
                tr.setSelection(TextSelection.create(tr.doc, posAfter + 1));
              }
            }
            tr.scrollIntoView();
          }
          return true;
        })
        .run();
    },
    active: (editor) => editor.isActive("mermaidBlock"),
  },
  // Diagram node commands (plan 11 task 11.6, issue #105): the actions behind
  // the diagram node's context-menu item set (Edit diagram / Preview diagram
  // / Copy diagram code / Delete diagram). The item set itself — labels,
  // order, enabled/checked/danger state — is the pure builder in
  // diagramMenu.ts; plan 03 (#38) renders it through the shared ContextMenu
  // and dispatches these four commands, so the context menu runs the
  // identical behavior every other surface does (plan 03 AC1: 1:1 command
  // mapping).
  {
    id: "diagramEdit",
    label: "Edit diagram",
    // Requests the mounted card to switch to edit mode through the mode
    // channel (mermaidCardMode.ts) — the document bytes are untouched (the
    // mode is a view state). A no-op when the selection is not in a diagram
    // or no card is mounted for it (source/preview view, read-only).
    run: (editor) => {
      const target = diagramNodeOf(editor);
      if (!target) return false;
      return requestMermaidCardMode(target.pos, "edit");
    },
    active: (editor) => diagramModeOf(editor) === "edit",
  },
  {
    id: "diagramPreview",
    label: "Preview diagram",
    // The same request for preview mode.
    run: (editor) => {
      const target = diagramNodeOf(editor);
      if (!target) return false;
      return requestMermaidCardMode(target.pos, "preview");
    },
    active: (editor) => diagramModeOf(editor) === "preview",
  },
  {
    id: "diagramCopyCode",
    label: "Copy diagram code",
    // Copies the diagram's fenced source — the portable ```mermaid form, the
    // same bytes the converter (pm.ts) writes — to the system clipboard. No
    // document change.
    run: (editor) => {
      const target = diagramNodeOf(editor);
      if (!target) return false;
      if (typeof navigator === "undefined" || !navigator.clipboard) return false;
      const source = target.node.textBetween(0, target.node.content.size);
      void navigator.clipboard.writeText(mermaidFenceOf(source));
      return true;
    },
    active: inDiagram,
  },
  {
    id: "diagramDelete",
    label: "Delete diagram",
    // Deletes the mermaidBlock under the selection (the fence leaves the
    // document) and drops the cursor where the block stood. A plain
    // ProseMirror delete, so undo restores the prior fence text exactly
    // (plan 11 AC7). Plan 03 renders this item as the destructive one
    // (danger styling) and gates it on its native confirm dialog.
    run: (editor) => {
      const target = diagramNodeOf(editor);
      if (!target) return false;
      const { state } = editor;
      const { pos, node } = target;
      const tr = state.tr.delete(pos, pos + node.nodeSize);
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
      editor.view.dispatch(tr);
      return true;
    },
    active: inDiagram,
  },
  {
    id: "hr",
    label: "Horizontal rule",
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: "footnote",
    label: "Footnote",
    run: (editor) => {
      const label = nextFootnoteLabel(editor);
      const refInserted = editor
        .chain()
        .focus()
        .insertContent({ type: "footnoteRef", attrs: { label } })
        .run();
      if (!refInserted) return false;
      editor
        .chain()
        .insertContentAt(editor.state.doc.content.size, {
          type: "footnoteDef",
          attrs: { label },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Footnote text" }] }],
        })
        .run();
      return true;
    },
  },
  {
    id: "frontmatter",
    label: "Front matter",
    run: (editor) =>
      editor
        .chain()
        .focus()
        .insertContentAt(0, {
          type: "codeBlock",
          attrs: { language: FRONTMATTER_LANG },
          content: [{ type: "text", text: "---\ntitle: \n---" }],
        })
        .run(),
  },
  {
    id: "emoji",
    label: "Emoji",
    run: (editor) => {
      const name = window.prompt("Emoji shortcode (without colons)") ?? "";
      if (!name) return false;
      return editor.chain().focus().insertContent(`:${name}:`).run();
    },
  },
  {
    id: "definitionList",
    label: "Definition list",
    run: (editor) =>
      editor
        .chain()
        .focus()
        .insertContent({
          type: "opaqueBlock",
          attrs: { raw: "Term\n: Definition", hint: "Definition list" },
        })
        .run(),
  },
  {
    id: "underline",
    label: "Underline",
    shortcut: "Ctrl+U",
    run: (editor) => editor.chain().focus().toggleUnderline().run(),
    active: (editor) => editor.isActive("underline"),
  },
  {
    id: "alignLeft",
    label: "Align left",
    run: (editor) => setAlignment(editor, "left"),
    active: (editor) => textAlignOf(editor) === "left",
  },
  {
    id: "alignCenter",
    label: "Align center",
    run: (editor) => setAlignment(editor, "center"),
    active: (editor) => textAlignOf(editor) === "center",
  },
  {
    id: "alignRight",
    label: "Align right",
    run: (editor) => setAlignment(editor, "right"),
    active: (editor) => textAlignOf(editor) === "right",
  },
  {
    id: "indent",
    label: "Indent",
    shortcut: "Ctrl+]",
    run: indentRun,
    active: indentActive,
  },
  {
    id: "outdent",
    label: "Outdent",
    shortcut: "Ctrl+[",
    run: outdentRun,
    active: outdentActive,
  },
  {
    id: "lineSpacing",
    label: "Line spacing",
    run: (editor, param) => {
      if (!isLineSpacingValue(param)) return false;
      editorDom(editor).style.setProperty(LINE_SPACING_VAR, LINE_SPACING_CSS[param]);
      return true;
    },
    active: (editor, param) => isLineSpacingValue(param) && lineSpacingOf(editor) === param,
  },
  {
    id: "showMarks",
    label: "Show formatting marks",
    run: (editor) => {
      editorDom(editor).classList.toggle(SHOW_MARKS_CLASS);
      return true;
    },
    active: (editor) => editorDom(editor).classList.contains(SHOW_MARKS_CLASS),
  },
  {
    id: "wordWrap",
    label: "Word wrap",
    run: (editor) => {
      editorDom(editor).classList.toggle(NO_WRAP_CLASS);
      return true;
    },
    // The command toggles; "active" reports whether wrap is on (the default),
    // i.e. whether the no-wrap class is absent.
    active: (editor) => !editorDom(editor).classList.contains(NO_WRAP_CLASS),
  },
  {
    id: "zoom",
    label: "Zoom",
    run: (editor, param) => {
      const current = zoomPercentOf(editor);
      if (param === "in") {
        setZoomPercent(editor, current + ZOOM_STEP);
        return true;
      }
      if (param === "out") {
        setZoomPercent(editor, current - ZOOM_STEP);
        return true;
      }
      if (param === "reset") {
        setZoomPercent(editor, ZOOM_DEFAULT);
        return true;
      }
      if (typeof param === "number" && Number.isFinite(param)) {
        setZoomPercent(editor, param);
        return true;
      }
      return false;
    },
    active: (editor, param) =>
      typeof param === "number" && Number.isFinite(param) && zoomPercentOf(editor) === param,
  },
  {
    id: "spellcheck",
    label: "Spellcheck",
    run: (editor) => {
      const dom = editorDom(editor);
      dom.setAttribute(SPELLCHECK_ATTR, spellcheckOf(editor) ? "false" : "true");
      return true;
    },
    active: (editor) => spellcheckOf(editor),
  },
  {
    id: "wordCount",
    label: "Word Count",
    shortcut: "Ctrl+Shift+F5",
    // Plan 09 task 9.4 (issue #87): the command cannot render UI itself, so it
    // requests the word-count dialog and the app shell (App.tsx) renders it,
    // the same shape as the link and table dialog commands. The request
    // carries the live editor so the dialog can scope to its selection when
    // text is selected; without a mounted editor the app falls back to the
    // whole-document counts (source/preview modes).
    run: (editor) => requestWordCountDialog(editor),
  },
  {
    id: "spelling",
    label: "Spelling…",
    shortcut: "Ctrl+Shift+F7",
    // Plan 09 task 9.5 (issue #88): the scan-and-flag spell check. Distinct
    // from the "spellcheck" command above (the contenteditable toggle,
    // issue #36): this one scans the doc against the bundled wordlist and
    // requests the "Spelling…" dialog (App.tsx renders it), the same shape
    // as the word-count dialog command. The request carries the live editor
    // so the dialog can scan its doc and select the first misspelling;
    // without a mounted editor the app falls back to the flat markdown text
    // (source/preview modes).
    run: (editor) => requestSpellCheckDialog(editor),
  },
  {
    id: "editorFont",
    label: "Editor font",
    run: (editor, param) => {
      if (!isEditorFontSettings(param)) return false;
      applyEditorFont(editor, param);
      return true;
    },
    active: (editor, param) => {
      if (!isEditorFontSettings(param)) return false;
      const current = editorFontOf(editor);
      return current.family === param.family && current.size === param.size;
    },
  },
  {
    id: "pasteAsText",
    label: "Paste as plain text",
    shortcut: "Ctrl+Shift+V",
    run: (editor, param) => {
      if (typeof param !== "string" || param.length === 0) return false;
      const lines = param.split(/\r\n|\r|\n/);
      // A single trailing newline on the clipboard does not imply an extra
      // empty paragraph.
      if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
      // Plain-text paste strips the payload's own formatting but inherits the
      // marks at the destination (Word parity). Marks are serialized to plain
      // objects because insertContent expects JSONContent.
      const marks = editor.state.selection
        .$from.marks()
        .map((mark) => ({ type: mark.type.name, attrs: { ...mark.attrs } }));
      const content = lines.map(
        (line) =>
          line.length > 0
            ? { type: "paragraph", content: [{ type: "text", text: line, marks }] }
            : { type: "paragraph" },
      );
      return editor.chain().focus().insertContent(content).run();
    },
  },
  {
    id: "undo",
    label: "Undo",
    shortcut: "Ctrl+Z",
    run: (editor) => editor.chain().focus().undo().run(),
    active: (editor) => editor.can().undo(),
  },
  {
    id: "redo",
    label: "Redo",
    shortcut: "Ctrl+Shift+Z",
    run: (editor) => editor.chain().focus().redo().run(),
    active: (editor) => editor.can().redo(),
  },
  {
    id: "clearFormatting",
    label: "Clear formatting",
    run: (editor) => {
      // Word behavior (plan 04 task 4.5, issue #51, AC4): clearing formatting
      // strips every character mark — the font family/size/color marks among
      // them — while keeping bold and italic. The mark set is derived from the
      // schema so future marks are cleared by default too. clearNodes()
      // unwraps block-level formatting (headings, lists, ...) as before.
      const chain = editor.chain().focus().clearNodes();
      for (const mark of Object.values(editor.state.schema.marks)) {
        if (mark.name !== "bold" && mark.name !== "italic") {
          chain.unsetMark(mark.name);
        }
      }
      return chain.run();
    },
  },
];

const BY_ID = new Map<EditorCommandId, EditorCommand>(
  EDITOR_COMMANDS.map((cmd) => [cmd.id, cmd]),
);

export function runEditorCommand(
  editor: CoreEditor,
  id: EditorCommandId,
  param?: EditorCommandParam,
): boolean {
  const cmd = BY_ID.get(id);
  if (!cmd) return false;
  return cmd.run(editor, param);
}

export function editorCommandActive(
  editor: CoreEditor,
  id: EditorCommandId,
  param?: EditorCommandParam,
): boolean {
  const cmd = BY_ID.get(id);
  if (!cmd || !cmd.active) return false;
  return cmd.active(editor, param);
}

// A single active-editor listener so App.tsx (native menu events) can reach
// the TipTap instance that owns the cursor. The WYSIWYG Editor registers on
// mount and unregisters on unmount; outside WYSIWYG the listener is null and
// dispatch is a no-op.
type CommandListener = (id: EditorCommandId, param?: EditorCommandParam) => void;
let commandListener: CommandListener | null = null;

export function registerEditorCommandListener(fn: CommandListener): () => void {
  commandListener = fn;
  return () => {
    if (commandListener === fn) commandListener = null;
  };
}

export function dispatchEditorCommand(id: EditorCommandId, param?: EditorCommandParam): boolean {
  if (!commandListener) return false;
  commandListener(id, param);
  return true;
}

// Link dialog plumbing (plan 08 task 8.1, issue #76). The link command
// cannot render UI itself, so it requests the dialog and the app shell
// (App.tsx) renders it: the request carries the live editor so the dialog
// can prefill from the caret and apply the result to the same instance.
type LinkDialogListener = (editor: CoreEditor) => void;
let linkDialogListener: LinkDialogListener | null = null;

export function registerLinkDialogListener(fn: LinkDialogListener): () => void {
  linkDialogListener = fn;
  return () => {
    if (linkDialogListener === fn) linkDialogListener = null;
  };
}

// Requests the link dialog for the given editor. Returns false (no-op) when
// no renderer is registered — e.g. outside WYSIWYG where there is no TipTap
// instance to edit.
export function requestLinkDialog(editor: CoreEditor): boolean {
  if (!linkDialogListener) return false;
  linkDialogListener(editor);
  return true;
}

// Image insert plumbing (plan 08 task 8.2, issue #77). The image commands
// cannot render UI or open native pickers themselves, so they request the
// flow and the app shell (App.tsx) reacts: "url" opens the image dialog,
// "file" runs the native picker and inserts the relativized src. The request
// carries the live editor so both flows apply to the same instance.
export type ImageInsertSource = "url" | "file";
type ImageInsertListener = (editor: CoreEditor, source: ImageInsertSource) => void;
let imageInsertListener: ImageInsertListener | null = null;

export function registerImageInsertListener(fn: ImageInsertListener): () => void {
  imageInsertListener = fn;
  return () => {
    if (imageInsertListener === fn) imageInsertListener = null;
  };
}

// Requests an image insert for the given editor. Returns false (no-op) when
// no renderer is registered — e.g. outside WYSIWYG where there is no TipTap
// instance to edit.
export function requestImageInsert(editor: CoreEditor, source: ImageInsertSource): boolean {
  if (!imageInsertListener) return false;
  imageInsertListener(editor, source);
  return true;
}

// Image edit plumbing (plan 08 task 8.4, issue #79). The image edit command
// and the editor's image click handler cannot render UI themselves, so they
// request the dialog and the app shell (App.tsx) renders it. The request
// carries the live editor so the dialog can prefill from the image under the
// caret and apply the result to the same instance.
type ImageEditDialogListener = (editor: CoreEditor) => void;
let imageEditDialogListener: ImageEditDialogListener | null = null;

export function registerImageEditDialogListener(fn: ImageEditDialogListener): () => void {
  imageEditDialogListener = fn;
  return () => {
    if (imageEditDialogListener === fn) imageEditDialogListener = null;
  };
}

// Requests the image edit dialog for the given editor. Returns false (no-op)
// when no renderer is registered — e.g. outside WYSIWYG where there is no
// TipTap instance to edit.
export function requestImageEditDialog(editor: CoreEditor): boolean {
  if (!imageEditDialogListener) return false;
  imageEditDialogListener(editor);
  return true;
}

// Image alt-text dialog plumbing (plan 03 task 3.4, issue #42): the image
// menu's "Change alt text" item requests the image edit dialog with the alt
// field focused. The same request/listener shape as the image edit dialog
// above — the app shell (App.tsx) is the single renderer.
let imageAltDialogListener: ImageEditDialogListener | null = null;

export function registerImageAltDialogListener(fn: ImageEditDialogListener): () => void {
  imageAltDialogListener = fn;
  return () => {
    if (imageAltDialogListener === fn) imageAltDialogListener = null;
  };
}

// Requests the alt-text-focused image edit dialog for the given editor.
// Returns false (no-op) when no renderer is registered.
export function requestImageAltDialog(editor: CoreEditor): boolean {
  if (!imageAltDialogListener) return false;
  imageAltDialogListener(editor);
  return true;
}

// Image replace plumbing (plan 03 task 3.4, issue #42): the image menu's
// "Replace image" item requests the replace flow. The same request/listener
// shape as the image insert "file" flow — the app shell (App.tsx) runs the
// native file picker and swaps the selected image's src through the asset
// pipeline.
let imageReplaceListener: ImageEditDialogListener | null = null;

export function registerImageReplaceListener(fn: ImageEditDialogListener): () => void {
  imageReplaceListener = fn;
  return () => {
    if (imageReplaceListener === fn) imageReplaceListener = null;
  };
}

// Requests the image replace flow for the given editor. Returns false (no-op)
// when no renderer is registered.
export function requestImageReplace(editor: CoreEditor): boolean {
  if (!imageReplaceListener) return false;
  imageReplaceListener(editor);
  return true;
}

// Table size-picker plumbing (plan 06 task 6.3, issue #63). The "table"
// command cannot render UI itself, so it requests the hover size-picker
// popover and the toolbar's Table button renders it (the same request/listener
// shape as the link and image dialog commands). The request carries the live
// editor so the picker's pick inserts into the same instance.
type TablePickerListener = (editor: CoreEditor) => void;
let tablePickerListener: TablePickerListener | null = null;

export function registerTablePickerListener(fn: TablePickerListener): () => void {
  tablePickerListener = fn;
  return () => {
    if (tablePickerListener === fn) tablePickerListener = null;
  };
}

// Requests the table size-picker popover for the given editor. Returns false
// (no-op) when no renderer is registered — e.g. outside WYSIWYG where the
// toolbar that hosts the picker is not mounted.
export function requestTableInsert(editor: CoreEditor): boolean {
  if (!tablePickerListener) return false;
  tablePickerListener(editor);
  return true;
}

// "Insert table…" dialog plumbing (plan 06 task 6.3, issue #63). The
// tableDialog command (the toolbar dropdown item and the Insert > Table
// menu) requests the dialog and the app shell (App.tsx) renders it: the
// request carries the live editor so the dialog's pick applies to the same
// instance, the same shape as the link dialog from plan 08 task 8.1.
type TableDialogListener = (editor: CoreEditor) => void;
let tableDialogListener: TableDialogListener | null = null;

export function registerTableDialogListener(fn: TableDialogListener): () => void {
  tableDialogListener = fn;
  return () => {
    if (tableDialogListener === fn) tableDialogListener = null;
  };
}

// Requests the "Insert table…" dialog for the given editor. Returns false
// (no-op) when no renderer is registered — e.g. outside WYSIWYG where there
// is no TipTap instance to edit.
export function requestTableDialog(editor: CoreEditor): boolean {
  if (!tableDialogListener) return false;
  tableDialogListener(editor);
  return true;
}

// Word-count dialog plumbing (plan 09 task 9.4, issue #87). The wordCount
// command cannot render UI itself, so it requests the dialog and the app
// shell (App.tsx) renders it: the request carries the live editor so the
// dialog can scope to its selection when text is selected, the same
// shape as the link and table dialog commands.
type WordCountDialogListener = (editor: CoreEditor) => void;
let wordCountDialogListener: WordCountDialogListener | null = null;

export function registerWordCountDialogListener(fn: WordCountDialogListener): () => void {
  wordCountDialogListener = fn;
  return () => {
    if (wordCountDialogListener === fn) wordCountDialogListener = null;
  };
}

// Requests the word-count dialog for the given editor. Returns false (no-op)
// when no renderer is registered — e.g. outside WYSIWYG where there is no
// TipTap instance to edit.
export function requestWordCountDialog(editor: CoreEditor): boolean {
  if (!wordCountDialogListener) return false;
  wordCountDialogListener(editor);
  return true;
}

// Spell-check dialog plumbing (plan 09 task 9.5, issue #88). The spelling
// command cannot render UI itself, so it requests the dialog and the app
// shell (App.tsx) renders it: the request carries the live editor so the
// dialog can scan its doc and select the first misspelling, the same shape
// as the word-count dialog command.
type SpellCheckDialogListener = (editor: CoreEditor) => void;
let spellCheckDialogListener: SpellCheckDialogListener | null = null;

export function registerSpellCheckDialogListener(fn: SpellCheckDialogListener): () => void {
  spellCheckDialogListener = fn;
  return () => {
    if (spellCheckDialogListener === fn) spellCheckDialogListener = null;
  };
}

// Requests the spell-check dialog for the given editor. Returns false (no-op)
// when no renderer is registered — e.g. outside WYSIWYG where there is no
// TipTap instance to edit.
export function requestSpellCheckDialog(editor: CoreEditor): boolean {
  if (!spellCheckDialogListener) return false;
  spellCheckDialogListener(editor);
  return true;
}

// Block-style inspector plumbing (plan 05 task 5.5, issue #58). The status
// bar (App.tsx) shows the built-in style that owns the block under the
// cursor; the WYSIWYG Editor is the only surface that knows it (it owns the
// TipTap selection), so it publishes the current style's label — or null
// outside WYSIWYG / for a block with no built-in style — on every doc and
// selection transaction. Single subscriber: at most one WYSIWYG editor is
// mounted at a time (the active document).
type BlockStyleListener = (label: string | null) => void;
let blockStyleListener: BlockStyleListener | null = null;

export function registerBlockStyleListener(fn: BlockStyleListener): () => void {
  blockStyleListener = fn;
  return () => {
    if (blockStyleListener === fn) blockStyleListener = null;
  };
}

export function publishBlockStyle(label: string | null): void {
  if (blockStyleListener) blockStyleListener(label);
}

// Style-gallery request plumbing (plan 05 task 5.5, issue #58). The
// status-bar inspector's "jump to style" action opens the toolbar's
// StyleGallery popover, which is a self-contained component the status bar
// cannot reach directly — so the request goes through a single-subscriber
// channel: the mounted StyleGallery registers an opener and the request
// carries the live editor (the gallery highlights the style active at its
// selection). A no-op when no gallery is mounted (outside WYSIWYG).
type StylesGalleryListener = (editor: CoreEditor) => void;
let stylesGalleryListener: StylesGalleryListener | null = null;

export function registerStylesGalleryListener(fn: StylesGalleryListener): () => void {
  stylesGalleryListener = fn;
  return () => {
    if (stylesGalleryListener === fn) stylesGalleryListener = null;
  };
}

export function requestStylesGallery(editor: CoreEditor): boolean {
  if (!stylesGalleryListener) return false;
  stylesGalleryListener(editor);
  return true;
}
