// Shared command registry for editor formatting. The toolbar, the slash menu,
// keyboard shortcuts, and native menu events all dispatch through the same
// command ids so each surface exercises identical behavior. Keeping the logic
// in one place is what lets App.tsx (menu events) and Toolbar.tsx reuse the
// exact same functions.

import type { Editor as CoreEditor } from "@tiptap/core";
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
  | "undo"
  | "redo"
  | "clearFormatting";

export interface EditorCommand {
  id: EditorCommandId;
  label: string;
  shortcut?: string;
  run: (editor: CoreEditor) => boolean;
  active?: (editor: CoreEditor) => boolean;
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

export function runEditorCommand(editor: CoreEditor, id: EditorCommandId): boolean {
  const cmd = BY_ID.get(id);
  if (!cmd) return false;
  return cmd.run(editor);
}

export function editorCommandActive(editor: CoreEditor, id: EditorCommandId): boolean {
  const cmd = BY_ID.get(id);
  if (!cmd || !cmd.active) return false;
  return cmd.active(editor);
}

// A single active-editor listener so App.tsx (native menu events) can reach
// the TipTap instance that owns the cursor. The WYSIWYG Editor registers on
// mount and unregisters on unmount; outside WYSIWYG the listener is null and
// dispatch is a no-op.
type CommandListener = (id: EditorCommandId) => void;
let commandListener: CommandListener | null = null;

export function registerEditorCommandListener(fn: CommandListener): () => void {
  commandListener = fn;
  return () => {
    if (commandListener === fn) commandListener = null;
  };
}

export function dispatchEditorCommand(id: EditorCommandId): boolean {
  if (!commandListener) return false;
  commandListener(id);
  return true;
}
