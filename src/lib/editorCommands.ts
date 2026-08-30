// Shared command registry for editor formatting. The toolbar, the slash menu,
// keyboard shortcuts, and native menu events all dispatch through the same
// command ids so each surface exercises identical behavior. Keeping the logic
// in one place is what lets App.tsx (menu events) and Toolbar.tsx reuse the
// exact same functions.

import type { Editor as CoreEditor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { FRONTMATTER_LANG } from "./pm";

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
  | "zoom"
  | "pasteAsText"
  | "undo"
  | "redo"
  | "clearFormatting";

// Parameters for the view-level commands that take one. `lineSpacing` takes a
// spacing preset, `zoom` takes a step (or an explicit percent), and
// `pasteAsText` takes the plain-text payload (the clipboard read is owned by
// the caller: menu events, paste key handlers, tests).
export type EditorCommandParam =
  | LineSpacingValue
  | ZoomParam
  | string
  | number;

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

const LINE_SPACING_CSS: Record<LineSpacingValue, string> = {
  single: "1",
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

function setZoomPercent(editor: CoreEditor, percent: number): void {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(percent)));
  editorDom(editor).style.setProperty(ZOOM_VAR, String(clamped));
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
    run: (editor) => {
      const url = window.prompt("Link URL") ?? "";
      if (!url) return editor.chain().focus().unsetLink().run();
      return editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    },
    active: (editor) => editor.isActive("link"),
  },
  {
    id: "image",
    label: "Image",
    run: (editor) => {
      const src = window.prompt("Image URL") ?? "";
      if (!src) return false;
      const alt = window.prompt("Alt text (optional)") ?? "";
      return editor.chain().focus().setImage({ src, alt }).run();
    },
  },
  {
    id: "highlight",
    label: "Highlight",
    run: (editor) => editor.chain().focus().toggleHighlight().run(),
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
