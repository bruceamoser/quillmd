// The editor TEXT context-menu item set (plan 03 task 3.2, issue #40): the
// right-click menu for the three editor surfaces — WYSIWYG, source, and
// preview — each with its own item set, plus the ProseMirror selection
// resolution that picks which items are enabled/checked for the WYSIWYG
// surface.
//
// This is the *definition* of those sets: a declarative, pure, unit-testable
// item model plus a builder per surface that computes each item's
// enabled/checked/danger state. The shared ContextMenu component (plan 03
// task 3.1, issue #39) consumes items of this shape; each surface resolves
// its selection, builds its item set, renders the menu at the cursor, and
// dispatches the pick through the shared editorCommands registry (plan 03
// AC1: 1:1 command mapping, identical behavior to the toolbar/menu trigger).
//
// Item kinds:
//   - registry items carry `command` (+ optional `param`) — the registry
//     command id the item dispatches, 1:1 (plan 03 AC1). These are the items
//     the "same command id dispatched" test asserts on.
//   - surface items carry `action` — a clipboard/view action with no
//     registry command (Cut / Copy / Paste / Select All are the browser's
//     execCommand, "Open in WYSIWYG" is a view-mode switch, the link
//     Open/Edit/Copy-address/Remove actions read the link under the caret).
//     The surface runs these directly; they are excluded from the 1:1
//     command mapping.
//   - separators group the items (the clipboard block, the Format groups, ...).

import { isNodeSelection, type Editor as CoreEditor } from "@tiptap/core";
import type { ContextMenuEntry } from "../components/ContextMenu";
import {
  LINE_SPACING_VALUES,
  editorCommandActive,
  type EditorCommandId,
  type EditorCommandParam,
  type LineSpacingValue,
} from "./editorCommands";
import { coveringLinkRange, readLinkPrefill } from "./links";

// A surface action with no registry command (see the file header). The WYSIWYG
// surface owns cut/copy/paste/paste-as-text/select-all and the
// open-link / copy-address / remove-link link actions (its Edit link item
// dispatches the registry "link" command); the source and preview surfaces
// own open-in-wysiwyg (and the clipboard actions; the preview also runs the
// four link actions on its rendered anchor). The surface validates that an
// action is one it supports before running it.
export type TextMenuAction =
  | "cut"
  | "copy"
  | "paste"
  | "paste-as-text"
  | "select-all"
  | "open-link"
  | "edit-link"
  | "remove-link"
  | "copy-address"
  | "open-in-wysiwyg";

// One item of an editor text context menu. A leaf item carries exactly one of
// `command` (registry) or `action` (surface); a submenu opener carries
// `submenu` and neither. `enabled` grays the item; `checked` marks the active
// state of a toggle (the Bold/Italic/... and alignment/line-spacing checks);
// `danger` marks the destructive item (Remove link).
export interface TextMenuItem {
  // Stable item id (the key the menu renders and the tests address it by).
  id: string;
  // The label shown in the menu (plan 03 §2 wording).
  label: string;
  // The keyboard shortcut hint, right-aligned in the item.
  shortcut?: string;
  // Whether the item is enabled for the current selection / surface.
  enabled: boolean;
  // Set on toggle items while they are active.
  checked?: boolean;
  // Set on the destructive item.
  danger?: boolean;
  // The registry command dispatched when the item is chosen (1:1, plan 03
  // AC1). Mutually exclusive with `action` for leaf items.
  command?: EditorCommandId;
  // The parameter for the registry command (e.g. a line-spacing preset).
  param?: EditorCommandParam;
  // The surface action run when the item is chosen. Mutually exclusive with
  // `command` for leaf items.
  action?: TextMenuAction;
  // Submenu items (the Format and Insert groupings).
  submenu?: readonly TextMenuEntry[];
}

// A separator entry (the horizontal rule between item groups). Carries an
// optional stable id so the menu can key it.
export interface TextMenuSeparator {
  type: "separator";
  id?: string;
}

export type TextMenuEntry = TextMenuItem | TextMenuSeparator;

// Type guard: a separator is the only entry kind carrying `type`.
export function isTextMenuSeparator(
  entry: TextMenuEntry,
): entry is TextMenuSeparator {
  return (entry as TextMenuSeparator).type === "separator";
}

// Maps the pure item set to the shared ContextMenu component's entries,
// wiring each leaf's `onSelect` to `dispatch`. Separators pass through and
// submenus are mapped recursively. Pure in its structure: the only effect is
// the `onSelect` closure the surface supplies, which routes the pick through
// the registry (plan 03 AC1).
export function toContextEntries(
  items: readonly TextMenuEntry[],
  dispatch: (item: TextMenuItem) => void,
): ContextMenuEntry[] {
  return items.map((entry): ContextMenuEntry => {
    if (isTextMenuSeparator(entry)) {
      return { type: "separator", id: entry.id };
    }
    const item = entry;
    const base: ContextMenuEntry = {
      id: item.id,
      label: item.label,
      shortcut: item.shortcut,
      enabled: item.enabled,
      checked: item.checked,
      danger: item.danger,
    };
    if (item.submenu) {
      return { ...base, submenu: toContextEntries(item.submenu, dispatch) };
    }
    return { ...base, onSelect: () => dispatch(item) };
  });
}

// --- ProseMirror selection resolution --------------------------------------
//
// The plan's "empty vs range vs node" (plan 03 §3): the editor's contextmenu
// event resolves the current selection to one of these three shapes, which
// drives the menu's state. A collapsed caret is "empty", a text selection is
// "range", and a NodeSelection (an image or diagram clicked) is "node".

export type TextSelectionKind = "empty" | "range" | "node";

// The shape of the editor's current selection (plan 03 §3). Pure over the
// editor state, so the builder and the tests share one definition.
export function textSelectionKind(editor: CoreEditor): TextSelectionKind {
  const { selection } = editor.state;
  if (isNodeSelection(selection)) return "node";
  return selection.empty ? "empty" : "range";
}

// Whether the selection is a non-collapsed range or a node selection — the
// condition Cut/Copy require (a collapsed caret has nothing to cut or copy).
export function hasTextSelection(editor: CoreEditor): boolean {
  return textSelectionKind(editor) !== "empty";
}

// The href of the link under the caret, or null when the selection is not in
// a link (or the link has no href). Used by the WYSIWYG menu's "Open link"
// action — the same value the link dialog prefills (readLinkPrefill).
export function linkHrefAtCaret(editor: CoreEditor): string | null {
  const prefill = readLinkPrefill(editor);
  return prefill.isEditing && prefill.href !== "" ? prefill.href : null;
}

// --- WYSIWYG text menu -----------------------------------------------------

// The top-level WYSIWYG item ids, in display order (plan 03 §2): the
// clipboard block, the Format / Insert submenus, the Link item, and Emoji.
// (The separator between the clipboard block and the rest is not an item.)
export const TEXT_MENU_ITEM_IDS = [
  "text-cut",
  "text-copy",
  "text-paste",
  "text-paste-as-text",
  "text-select-all",
  "text-format",
  "text-insert",
  "text-link",
  "text-emoji",
] as const;

export type TextMenuItemId = (typeof TEXT_MENU_ITEM_IDS)[number];

// The Font group of the Format submenu (plan 03 §2: B/I/U/S, sub/sup,
// highlight, color, clear formatting). Every item is a registry command; the
// toggles carry their active state as a check.
function formatFontItems(editor: CoreEditor): TextMenuEntry[] {
  const check = (id: EditorCommandId): boolean | undefined =>
    editorCommandActive(editor, id) ? true : undefined;
  return [
    { id: "text-bold", label: "Bold", shortcut: "Ctrl+B", enabled: true, command: "bold", checked: check("bold") },
    { id: "text-italic", label: "Italic", shortcut: "Ctrl+I", enabled: true, command: "italic", checked: check("italic") },
    { id: "text-underline", label: "Underline", shortcut: "Ctrl+U", enabled: true, command: "underline", checked: check("underline") },
    { id: "text-strike", label: "Strikethrough", shortcut: "Ctrl+Shift+X", enabled: true, command: "strike", checked: check("strike") },
    { id: "text-code", label: "Inline code", shortcut: "Ctrl+E", enabled: true, command: "code", checked: check("code") },
    { id: "text-subscript", label: "Subscript", enabled: true, command: "subscript", checked: check("subscript") },
    { id: "text-superscript", label: "Superscript", enabled: true, command: "superscript", checked: check("superscript") },
    { id: "text-highlight", label: "Highlight", enabled: true, command: "highlight", checked: check("highlight") },
    { type: "separator", id: "text-format-sep-clear" },
    { id: "text-clear-formatting", label: "Clear formatting", enabled: true, command: "clearFormatting" },
  ];
}

// The Paragraph group of the Format submenu (plan 03 §2: align, indent, line
// spacing). The alignment and line-spacing items are checkable (the active
// value is checked); indent/outdent are plain registry commands.
function formatParagraphItems(editor: CoreEditor): TextMenuEntry[] {
  const spacing: TextMenuEntry[] = LINE_SPACING_VALUES.map(
    (value: LineSpacingValue): TextMenuEntry => ({
      id: `text-spacing-${value}`,
      label: `Line spacing: ${value}`,
      enabled: true,
      command: "lineSpacing",
      param: value,
      checked: editorCommandActive(editor, "lineSpacing", value) ? true : undefined,
    }),
  );
  return [
    { type: "separator", id: "text-format-sep-paragraph" },
    { id: "text-align-left", label: "Align left", enabled: true, command: "alignLeft", checked: editorCommandActive(editor, "alignLeft") ? true : undefined },
    { id: "text-align-center", label: "Align center", enabled: true, command: "alignCenter", checked: editorCommandActive(editor, "alignCenter") ? true : undefined },
    { id: "text-align-right", label: "Align right", enabled: true, command: "alignRight", checked: editorCommandActive(editor, "alignRight") ? true : undefined },
    { type: "separator", id: "text-format-sep-indent" },
    { id: "text-indent", label: "Indent", shortcut: "Ctrl+]", enabled: true, command: "indent" },
    { id: "text-outdent", label: "Outdent", shortcut: "Ctrl+[", enabled: true, command: "outdent" },
    { type: "separator", id: "text-format-sep-spacing" },
    ...spacing,
  ];
}

// The Insert submenu (plan 03 §2: the existing Insert menu items that make
// sense at the cursor — headings, table, image, link, hr, footnote, task
// list). Every item is a registry command, so the context menu inserts the
// identical content the native Insert menu does.
function insertItems(): TextMenuEntry[] {
  const headings: TextMenuEntry[] = ([1, 2, 3, 4, 5, 6] as const).map(
    (level): TextMenuEntry => ({
      id: `text-h${level}`,
      label: `Heading ${level}`,
      enabled: true,
      command: `h${level}` as EditorCommandId,
    }),
  );
  return [
    ...headings,
    { type: "separator", id: "text-insert-sep" },
    { id: "text-insert-link", label: "Link", shortcut: "Ctrl+K", enabled: true, command: "link" },
    { id: "text-insert-image-file", label: "Image from file…", enabled: true, command: "imageFromFile" },
    { id: "text-insert-image-url", label: "Image from URL…", enabled: true, command: "image" },
    { id: "text-insert-table", label: "Insert table…", enabled: true, command: "tableDialog" },
    { id: "text-insert-hr", label: "Horizontal rule", enabled: true, command: "hr" },
    { id: "text-insert-footnote", label: "Footnote", enabled: true, command: "footnote" },
    { id: "text-insert-tasklist", label: "Task list", enabled: true, command: "taskList" },
  ];
}

// The Link item (plan 03 §2): when the caret is on a link it is a submenu
// (Open link / Edit link / Copy address / Remove link, plan 03 task 3.5);
// otherwise it is the single "Insert link" item. Edit link dispatches the
// registry "link" command (the dialog prefills from the caret); the other
// items are surface actions that read the link under the caret.
function linkItem(editor: CoreEditor): TextMenuItem {
  const onLink = coveringLinkRange(editor) !== null;
  if (!onLink) {
    return { id: "text-link", label: "Insert link", shortcut: "Ctrl+K", enabled: true, command: "link" };
  }
  return {
    id: "text-link",
    label: "Link",
    enabled: true,
    submenu: [
      { id: "text-link-open", label: "Open link", enabled: true, action: "open-link" },
      { id: "text-link-edit", label: "Edit link", enabled: true, command: "link" },
      { id: "text-link-copy-address", label: "Copy address", enabled: true, action: "copy-address" },
      { id: "text-link-remove", label: "Remove link", enabled: true, action: "remove-link", danger: true },
    ],
  };
}

// Builds the WYSIWYG text context menu for the given editor: the clipboard
// items (enabled per the selection shape), a separator, the Format and Insert
// submenus, the Link item (submenu when on a link), and Emoji. Pure — it reads
// the editor state and nothing else, so the surface can rebuild it on every
// selection change and the logic stays unit-testable (plan 03 AC1).
export function buildTextMenu(editor: CoreEditor): TextMenuEntry[] {
  const hasSelection = hasTextSelection(editor);
  return [
    { id: "text-cut", label: "Cut", shortcut: "Ctrl+X", enabled: hasSelection, action: "cut" },
    { id: "text-copy", label: "Copy", shortcut: "Ctrl+C", enabled: hasSelection, action: "copy" },
    { id: "text-paste", label: "Paste", shortcut: "Ctrl+V", enabled: true, action: "paste" },
    { id: "text-paste-as-text", label: "Paste as text", shortcut: "Ctrl+Shift+V", enabled: true, action: "paste-as-text" },
    { id: "text-select-all", label: "Select all", enabled: true, action: "select-all" },
    { type: "separator", id: "text-sep-clipboard" },
    {
      id: "text-format",
      label: "Format",
      enabled: true,
      submenu: [...formatFontItems(editor), ...formatParagraphItems(editor)],
    },
    { id: "text-insert", label: "Insert", enabled: true, submenu: insertItems() },
    linkItem(editor),
    { id: "text-emoji", label: "Emoji", enabled: true, command: "emoji" },
  ];
}

// --- source view menu ------------------------------------------------------
//
// Plan 03 §3: Copy / Paste / Paste as text / Select All + "Open in WYSIWYG"
// (switches mode keeping the cursor). The source view is CodeMirror, not
// ProseMirror, so there is no selection-shape resolution here — the
// clipboard actions act on CodeMirror's own selection. The builder is
// argument-free: the source menu's item set is fixed and its state does not
// depend on the document.

export const SOURCE_MENU_ITEM_IDS = [
  "source-copy",
  "source-paste",
  "source-paste-as-text",
  "source-select-all",
  "source-open-wysiwyg",
] as const;

export type SourceMenuItemId = (typeof SOURCE_MENU_ITEM_IDS)[number];

// Builds the source view's context menu (plan 03 §3). Pure and fixed: the
// clipboard block, a separator, and "Open in WYSIWYG", in display order.
export function buildSourceMenu(): TextMenuEntry[] {
  return [
    { id: "source-copy", label: "Copy", shortcut: "Ctrl+C", enabled: true, action: "copy" },
    { id: "source-paste", label: "Paste", shortcut: "Ctrl+V", enabled: true, action: "paste" },
    { id: "source-paste-as-text", label: "Paste as text", shortcut: "Ctrl+Shift+V", enabled: true, action: "paste-as-text" },
    { id: "source-select-all", label: "Select all", enabled: true, action: "select-all" },
    { type: "separator", id: "source-sep-clipboard" },
    { id: "source-open-wysiwyg", label: "Open in WYSIWYG", enabled: true, action: "open-in-wysiwyg" },
  ];
}

// --- preview view menu -----------------------------------------------------
//
// Plan 03 §3: Copy (rendered markdown text), the link menu, and "Open in
// WYSIWYG". The preview is read-only rendered HTML, so there is no cut /
// select-all (nothing to edit) — Copy copies the rendered text under the
// caret, and the link menu offers the full link item set (plan 03 task 3.5,
// issue #43) for a link under the caret: Open link, Edit link, Copy address,
// and Remove link. The preview has no editor to run commands on, so the
// surface resolves those actions itself — Edit / Remove splice the markdown
// source (src/lib/markdownLinks.ts) and Edit reopens the app's link dialog
// with a markdown target.

export const PREVIEW_MENU_ITEM_IDS = [
  "preview-copy",
  "preview-link",
  "preview-open-wysiwyg",
] as const;

export type PreviewMenuItemId = (typeof PREVIEW_MENU_ITEM_IDS)[number];

// Builds the preview view's context menu (plan 03 §3, link items per plan 03
// task 3.5). `onLink` reports whether the caret is on a link in the rendered
// HTML (the surface resolves it from the anchor under the caret); when true
// the Link item is a submenu (Open link / Edit link / Copy address / Remove
// link), otherwise it is a disabled placeholder. Pure.
export function buildPreviewMenu(onLink: boolean, href: string | null): TextMenuEntry[] {
  const link: TextMenuEntry = onLink
    ? {
        id: "preview-link",
        label: "Link",
        enabled: true,
        submenu: [
          { id: "preview-link-open", label: "Open link", enabled: href !== null, action: "open-link" },
          { id: "preview-link-edit", label: "Edit link", enabled: href !== null, action: "edit-link" },
          { id: "preview-link-copy-address", label: "Copy address", enabled: href !== null, action: "copy-address" },
          { id: "preview-link-remove", label: "Remove link", enabled: href !== null, action: "remove-link", danger: true },
        ],
      }
    : { id: "preview-link", label: "Link", enabled: false };
  return [
    { id: "preview-copy", label: "Copy", shortcut: "Ctrl+C", enabled: true, action: "copy" },
    { type: "separator", id: "preview-sep" },
    link,
    { id: "preview-open-wysiwyg", label: "Open in WYSIWYG", enabled: true, action: "open-in-wysiwyg" },
  ];
}
