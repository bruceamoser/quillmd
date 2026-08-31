// Shared command registry for editor formatting. The toolbar, the slash menu,
// keyboard shortcuts, and native menu events all dispatch through the same
// command ids so each surface exercises identical behavior. Keeping the logic
// in one place is what lets App.tsx (menu events) and Toolbar.tsx reuse the
// exact same functions.

import type { Editor as CoreEditor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { FRONTMATTER_LANG } from "./pm";
import type { DocSettings } from "./docSettings";
import { normalizeColor } from "./colors";

export type EditorCommandId =
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
  | "highlight"
  | "subscript"
  | "superscript"
  | "blockquote"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "table"
  | "codeBlock"
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
  | "pasteAsText"
  | "fontFamily"
  | "fontSize"
  | "fontColor"
  | "highlightColor"
  | "undo"
  | "redo"
  | "clearFormatting";

// Parameters for the view-level commands that take one. `lineSpacing` takes a
// spacing preset, `zoom` takes a step (or an explicit percent), `pasteAsText`
// takes the plain-text payload (the clipboard read is owned by the caller:
// menu events, paste key handlers, tests), the font attribute commands
// (`fontFamily` / `fontSize`) take the picked value (a family name, or a
// point size as a number or "Npt" string) or `null` for "Normal" (the
// document default), and the color commands (`fontColor` / `highlightColor`)
// take the picked color — a hex string for a swatch or custom color, or
// `null` for "auto" (inherit / no color).
export type EditorCommandParam =
  | LineSpacingValue
  | ZoomParam
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

export const EDITOR_COMMANDS: EditorCommand[] = [
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
    run: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "codeBlock",
    label: "Code block",
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
    active: (editor) => editor.isActive("codeBlock"),
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
    run: (editor) => editor.chain().focus().clearNodes().unsetAllMarks().run(),
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
