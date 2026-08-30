import { useEditorState } from "@tiptap/react";
import type { Editor as CoreEditor } from "@tiptap/core";
import {
  EDITOR_COMMANDS,
  editorCommandActive,
  runEditorCommand,
} from "../lib/editorCommands";
import type { EditorCommandId } from "../lib/editorCommands";

interface ToolbarProps {
  editor: CoreEditor | null;
}

// Inline marks rendered as toggle buttons, in display order.
const INLINE_CMDS: EditorCommandId[] = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "highlight",
  "subscript",
  "superscript",
];

// Block and insert commands rendered after the inline group.
const BLOCK_CMDS: EditorCommandId[] = [
  "link",
  "image",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "table",
  "codeBlock",
  "hr",
  "footnote",
];

// Block alignment group (plan 02 task 2.3).
const ALIGN_CMDS: EditorCommandId[] = ["alignLeft", "alignCenter", "alignRight"];

// Indent/outdent group (plan 02 task 2.4): list nesting and quote levels.
const INDENT_CMDS: EditorCommandId[] = ["indent", "outdent"];

const CMD = new Map(EDITOR_COMMANDS.map((c) => [c.id, c]));

// Compact glyph per command; the full label + shortcut live in the title.
const GLYPHS: Partial<Record<EditorCommandId, string>> = {
  bold: "B",
  italic: "I",
  underline: "U",
  strike: "S",
  code: "</>",
  highlight: "A",
  subscript: "x\u2082",
  superscript: "x\u00B2",
  link: "Link",
  image: "Img",
  blockquote: "\u201D",
  bulletList: "\u2022 List",
  orderedList: "1. List",
  taskList: "\u2610 List",
  table: "Table",
  codeBlock: "{ }",
  hr: "\u2014",
  footnote: "[^1]",
  alignLeft: "L",
  alignCenter: "C",
  alignRight: "R",
  indent: "\u21E5",
  outdent: "\u21E4",
};

function title(cmdId: EditorCommandId): string {
  const cmd = CMD.get(cmdId);
  if (!cmd) return "";
  return cmd.shortcut ? `${cmd.label} (${cmd.shortcut})` : cmd.label;
}

export default function Toolbar({ editor }: ToolbarProps) {
  // Re-render on every editor transaction so active states and the heading
  // indicator track the selection.
  useEditorState({
    editor,
    selector: ({ transactionNumber }) => transactionNumber,
  });

  if (!editor) return null;

  const heading = (["h1", "h2", "h3", "h4", "h5", "h6"] as EditorCommandId[]).find((id) =>
    editorCommandActive(editor, id),
  );

  const renderButton = (id: EditorCommandId) => (
    <button
      key={id}
      type="button"
      title={title(id)}
      className={editorCommandActive(editor, id) ? "quillmd-toolbar-active" : ""}
      onClick={() => runEditorCommand(editor, id)}
    >
      {GLYPHS[id] ?? id}
    </button>
  );

  return (
    <div className="quillmd-toolbar">
      <select
        className="quillmd-heading-select"
        title="Paragraph / heading level"
        value={heading ?? "paragraph"}
        onChange={(e) => {
          const value = e.target.value;
          if (value === "paragraph") {
            editor.chain().focus().setParagraph().run();
          } else {
            runEditorCommand(editor, value as EditorCommandId);
          }
        }}
      >
        <option value="paragraph">Paragraph</option>
        {(["h1", "h2", "h3", "h4", "h5", "h6"] as EditorCommandId[]).map((id) => (
          <option key={id} value={id}>
            {CMD.get(id)?.label ?? id}
          </option>
        ))}
      </select>

      <span className="quillmd-toolbar-sep" />
      {INLINE_CMDS.map(renderButton)}

      <span className="quillmd-toolbar-sep" />
      {BLOCK_CMDS.map(renderButton)}

      <span className="quillmd-toolbar-sep" />
      {ALIGN_CMDS.map(renderButton)}

      <span className="quillmd-toolbar-sep" />
      {INDENT_CMDS.map(renderButton)}

      <span className="quillmd-toolbar-sep" />
      <button
        type="button"
        title="Undo (Ctrl+Z)"
        disabled={!editor.can().undo()}
        onClick={() => runEditorCommand(editor, "undo")}
      >
        Undo
      </button>
      <button
        type="button"
        title="Redo (Ctrl+Shift+Z)"
        disabled={!editor.can().redo()}
        onClick={() => runEditorCommand(editor, "redo")}
      >
        Redo
      </button>
    </div>
  );
}
