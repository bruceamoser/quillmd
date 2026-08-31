// Style registry (plan 05 task 5.1, issue #54): the data behind the
// Word/Docs-style gallery. Every built-in style is an alias of an existing
// registry command — no style ever gains new markdown meaning — so applying
// a style goes through the exact same commands the toolbar, the menus, and
// the keyboard shortcuts use, and the round-trip invariant is untouched.
//
// The gallery is data-driven: adding a style is adding a row to
// BUILT_IN_STYLES below (a row that aliases an existing command). The
// preview swatches render `previewCSS` (visual only, never document content)
// and "More styles" documents `markdown`, the honest mapping from the
// Word/Docs name to the markdown the style really is (plan 05 §3: Title = H1,
// Subtitle = H2, Heading N = H{N}).

import type { Editor as CoreEditor } from "@tiptap/core";
import { editorCommandActive, runEditorCommand } from "./editorCommands";
import type { EditorCommandId, EditorCommandParam } from "./editorCommands";

export type StyleKind = "block" | "mark";

export interface QuillStyle {
  // Stable style id: the gallery's key and the data-style-id attribute.
  id: string;
  // The user-facing Word/Docs name ("Heading 2", "Intense Quote", ...).
  label: string;
  // "block" styles act on the block under the cursor, "mark" styles act on
  // the selected run. The gallery groups "More styles" by this.
  kind: StyleKind;
  // The registry command the style applies. Built-in styles only alias
  // commands that already exist, so the markdown meaning of a document can
  // never change because a style was added.
  command: EditorCommandId;
  // The command's parameter (none of the built-in styles needs one).
  param?: EditorCommandParam;
  // An optional second command applied after `command` when it succeeds
  // (Intense Quote = blockquote + bold).
  with?: EditorCommandId;
  // CSS for the gallery's preview swatch. Inline style on the swatch only —
  // never applied to the document, so it can't reach the serializer.
  previewCSS: string;
  // The markdown equivalent, shown in the "More styles" list so users learn
  // what the style really writes to disk.
  markdown: string;
  // Whether the style is active at the selection (drives the gallery's
  // highlight as the cursor moves). Defaults to the command's active().
  isActive?: (editor: CoreEditor) => boolean;
}

// A plain paragraph that is not inside a list item or a quote (Word's
// "Normal": a list item's inner paragraph is a paragraph node, but List
// Paragraph owns it, and a quoted paragraph reads as Quote).
const isPlainParagraph = (editor: CoreEditor): boolean =>
  editor.isActive("paragraph") &&
  !editor.isActive("listItem") &&
  !editor.isActive("taskItem") &&
  !editor.isActive("blockquote");

export const BUILT_IN_STYLES: QuillStyle[] = [
  {
    id: "normal",
    label: "Normal",
    kind: "block",
    command: "paragraph",
    previewCSS: "font-size: 14px; line-height: 1.7;",
    markdown: "plain paragraph",
    isActive: isPlainParagraph,
  },
  {
    id: "title",
    label: "Title",
    kind: "block",
    command: "h1",
    previewCSS: "font-size: 28px; font-weight: 700; line-height: 1.3;",
    markdown: "# Heading",
  },
  {
    id: "heading1",
    label: "Heading 1",
    kind: "block",
    command: "h1",
    previewCSS: "font-size: 24px; font-weight: 700; line-height: 1.35;",
    markdown: "# Heading",
  },
  {
    id: "heading2",
    label: "Heading 2",
    kind: "block",
    command: "h2",
    previewCSS: "font-size: 20px; font-weight: 700; line-height: 1.4;",
    markdown: "## Heading",
  },
  {
    id: "heading3",
    label: "Heading 3",
    kind: "block",
    command: "h3",
    previewCSS: "font-size: 17px; font-weight: 600; line-height: 1.45;",
    markdown: "### Heading",
  },
  {
    id: "heading4",
    label: "Heading 4",
    kind: "block",
    command: "h4",
    previewCSS: "font-size: 15px; font-weight: 600; line-height: 1.5;",
    markdown: "#### Heading",
  },
  {
    id: "heading5",
    label: "Heading 5",
    kind: "block",
    command: "h5",
    previewCSS: "font-size: 14px; font-weight: 600; line-height: 1.55;",
    markdown: "##### Heading",
  },
  {
    id: "heading6",
    label: "Heading 6",
    kind: "block",
    command: "h6",
    previewCSS: "font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;",
    markdown: "###### Heading",
  },
  {
    id: "subtitle",
    label: "Subtitle",
    kind: "block",
    command: "h2",
    previewCSS: "font-size: 20px; font-weight: 400; line-height: 1.4; color: #9d9d9d;",
    markdown: "## Heading",
  },
  {
    id: "quote",
    label: "Quote",
    kind: "block",
    command: "blockquote",
    previewCSS:
      "font-size: 14px; line-height: 1.6; border-left: 3px solid #3c3c3c; padding-left: 10px; color: #9d9d9d;",
    markdown: "> Quote",
  },
  {
    id: "intense-quote",
    label: "Intense Quote",
    kind: "block",
    command: "blockquote",
    with: "bold",
    previewCSS:
      "font-size: 14px; line-height: 1.6; font-weight: 700; border-left: 3px solid #3c3c3c; padding-left: 10px;",
    markdown: "> **Quote**",
    isActive: (editor) => editor.isActive("blockquote") && editor.isActive("bold"),
  },
  {
    id: "list-paragraph",
    label: "List Paragraph",
    kind: "block",
    command: "bulletList",
    previewCSS: "font-size: 14px; line-height: 1.7; padding-left: 18px;",
    markdown: "- Item",
    // Any list item: task items carry no bulletList ancestor, so the
    // command's active() (bulletList only) would miss them.
    isActive: (editor) => editor.isActive("listItem") || editor.isActive("taskItem"),
  },
  {
    id: "no-spacing",
    label: "No Spacing",
    kind: "block",
    command: "paragraph",
    // Word's No Spacing is a paragraph style with tight margins; markdown has
    // no paragraph-spacing syntax, so like Normal it aliases setParagraph
    // (plan 05 §3: styles never gain new markdown meaning).
    previewCSS: "font-size: 14px; line-height: 1.15;",
    markdown: "plain paragraph",
    isActive: isPlainParagraph,
  },
  {
    id: "source-code",
    label: "Source Code",
    kind: "block",
    command: "codeBlock",
    previewCSS:
      "font-family: var(--font-mono); font-size: 12px; line-height: 1.5; background: #1e1e1e; border-radius: 4px; padding: 6px 8px;",
    markdown: "``` fenced block",
  },
  {
    id: "code",
    label: "Code",
    kind: "mark",
    command: "code",
    previewCSS:
      "font-family: var(--font-mono); font-size: 12px; background: #1e1e1e; border-radius: 3px; padding: 1px 4px;",
    markdown: "`code`",
  },
  {
    id: "emphasis",
    label: "Emphasis",
    kind: "mark",
    command: "italic",
    previewCSS: "font-size: 14px; font-style: italic;",
    markdown: "*text*",
  },
  {
    id: "strong",
    label: "Strong",
    kind: "mark",
    command: "bold",
    previewCSS: "font-size: 14px; font-weight: 700;",
    markdown: "**text**",
  },
];

export const STYLES_BY_ID: ReadonlyMap<string, QuillStyle> = new Map(
  BUILT_IN_STYLES.map((style) => [style.id, style]),
);

// The Word-style gallery's top row: large preview swatches for these six,
// the rest behind "More styles" (plan 05 §3).
export const TOP_GALLERY_STYLES: readonly string[] = [
  "normal",
  "title",
  "heading1",
  "heading2",
  "heading3",
  "subtitle",
];

export function styleById(id: string): QuillStyle | null {
  return STYLES_BY_ID.get(id) ?? null;
}

// Whether `style` is active at the editor's selection (the gallery marks it
// as the current style). Styles with several aliases of one block (Title and
// Heading 1 on an H1, Subtitle and Heading 2 on an H2) are all reported
// active: the document literally has that block, and the "More styles"
// mapping documents which names share a markdown form.
export function styleActive(style: QuillStyle, editor: CoreEditor): boolean {
  if (style.isActive) return style.isActive(editor);
  return editorCommandActive(editor, style.command, style.param);
}

// Every built-in style active at the selection, in registry order.
export function activeStyles(editor: CoreEditor): QuillStyle[] {
  return BUILT_IN_STYLES.filter((style) => styleActive(style, editor));
}

// The Format > Styles submenu id prefix (plan 05 task 5.2, issue #55). The
// native menu carries no parameters, so every built-in style is its own menu
// id (built in src-tauri/src/menu.rs from the same registry rows, mirrored in
// its STYLES list); this maps an id back to the style's registry command —
// plus its `with` follow-up command — so the menu dispatches the identical
// commands the toolbar's style gallery applies.
export const STYLE_MENU_ID_PREFIX = "format-style-";

export function styleMenuCommand(
  id: string,
): { command: EditorCommandId; param?: EditorCommandParam; with?: EditorCommandId } | null {
  if (!id.startsWith(STYLE_MENU_ID_PREFIX)) return null;
  const style = styleById(id.slice(STYLE_MENU_ID_PREFIX.length));
  if (!style) return null;
  return { command: style.command, param: style.param, with: style.with };
}

// Applies a style: runs its registry command (and its `with` command when
// the first succeeds, so Intense Quote quotes and then bolds). Returns the
// primary command's result — with the registry's toggle semantics, picking
// an already-applied style reverts it (Heading 2 on an H2 becomes a
// paragraph), the same behavior as the heading select and every toolbar
// toggle.
export function applyStyle(editor: CoreEditor, style: QuillStyle): boolean {
  const applied = runEditorCommand(editor, style.command, style.param);
  if (applied && style.with) {
    runEditorCommand(editor, style.with);
  }
  return applied;
}
