import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as CoreEditor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { FRONTMATTER_LANG, markdownToTiptap, tiptapToMarkdown } from "../lib/pm";

interface EditorProps {
  value: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}

interface SlashAction {
  key: string;
  label: string;
  hint: string;
  run: (editor: CoreEditor) => void;
}

const SLASH_ACTIONS: SlashAction[] = [
  {
    key: "table",
    label: "Table",
    hint: "Insert a 3x3 GFM table",
    run: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    key: "code",
    label: "Code block",
    hint: "Fenced code block",
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    key: "image",
    label: "Image",
    hint: "Embed an image",
    run: (editor) => editor.chain().focus().setImage({ src: "", alt: "" }).run(),
  },
  {
    key: "link",
    label: "Link",
    hint: "Insert a hyperlink",
    run: (editor) => {
      const url = window.prompt("Link URL") ?? "";
      if (url) editor.chain().focus().setLink({ href: url }).run();
    },
  },
  {
    key: "footnote",
    label: "Footnote",
    hint: "Footnote reference",
    run: (editor) => editor.chain().focus().insertContent("[^1]").run(),
  },
  {
    key: "hr",
    label: "Horizontal rule",
    hint: "Thematic break",
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    key: "front-matter",
    label: "Front matter",
    hint: "YAML header block",
    run: (editor) => {
      editor
        .chain()
        .focus()
        .insertContentAt(0, {
          type: "codeBlock",
          attrs: { language: FRONTMATTER_LANG },
          content: [{ type: "text", text: "---\ntitle: \n---" }],
        })
        .run();
    },
  },
];

function deleteSlashRange(editor: CoreEditor): void {
  const { $from } = editor.state.selection;
  const start = $from.start();
  if ($from.pos > start) {
    editor.chain().focus().deleteRange({ from: start, to: $from.pos }).run();
  }
}

export default function Editor({
  value,
  onChange,
  readOnly = false,
  placeholder = "",
}: EditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const lastEmittedRef = useRef<string>(value);
  const initialRef = useRef<string>(value);
  const editorRef = useRef<CoreEditor | null>(null);

  const [slash, setSlash] = useState<{
    query: string;
    top: number;
    left: number;
  } | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: "ql-code-block" } },
      }),
      Underline,
      Highlight,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
      Subscript,
      Superscript,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: markdownToTiptap(initialRef.current),
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: "quillmd-prosemirror",
        spellcheck: "false",
      },
      handleKeyDown: (_view, event) => {
        const active = editorRef.current;
        if (!active) return false;
        if (event.key === "Tab") {
          const { $from } = active.state.selection;
          const parent = $from.parent.type.name;
          if (parent === "listItem" || parent === "taskItem") {
            event.preventDefault();
            if (event.shiftKey) {
              active.chain().focus().liftListItem("listItem").liftListItem("taskItem").run();
            } else {
              active.chain().focus().sinkListItem("listItem").sinkListItem("taskItem").run();
            }
            return true;
          }
        }
        if (event.key === "Backspace") {
          const state = active.state;
          if (state) {
            const { $from } = state.selection;
            const parent = $from.parent;
            const isEmpty =
              (parent.type.name === "listItem" || parent.type.name === "taskItem") &&
              parent.childCount === 1 &&
              parent.firstChild?.type.name === "paragraph" &&
              parent.firstChild.content.size === 0;
            if (isEmpty && $from.pos === $from.start()) {
              event.preventDefault();
              active.chain().focus().liftListItem("listItem").liftListItem("taskItem").run();
              return true;
            }
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const md = tiptapToMarkdown(ed.getJSON());
      lastEmittedRef.current = md;
      onChangeRef.current(md);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { $from } = ed.state.selection;
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "\uFFFC");
      const match = /^\/([a-z-]*)$/.exec(before);
      if (match && $from.parent.type.name === "paragraph") {
        const coords = ed.view.coordsAtPos($from.pos);
        setSlash({ query: match[1], top: coords.bottom, left: coords.left });
      } else {
        setSlash(null);
      }
    },
    onBlur: () => setSlash(null),
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    editor.commands.setContent(markdownToTiptap(value));
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [readOnly, editor]);

  const runSlash = (action: SlashAction) => {
    if (!editor) return;
    deleteSlashRange(editor);
    action.run(editor);
    setSlash(null);
  };

  const filtered = slash
    ? SLASH_ACTIONS.filter((a) => a.key.startsWith(slash.query))
    : [];

  return (
    <div className="quillmd-editor">
      {!readOnly && (
        <div className="quillmd-toolbar">
          <button
            type="button"
            title="Bold (Ctrl+B)"
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            B
          </button>
          <button
            type="button"
            title="Italic (Ctrl+I)"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            I
          </button>
          <button
            type="button"
            title="Strikethrough (Ctrl+Shift+X)"
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          >
            S
          </button>
          <button
            type="button"
            title="Inline code (Ctrl+E)"
            onClick={() => editor?.chain().focus().toggleCode().run()}
          >
            {"</>"}
          </button>
          <button
            type="button"
            title="Link (Ctrl+K)"
            onClick={() => {
              const url = window.prompt("Link URL") ?? "";
              if (url) editor?.chain().focus().setLink({ href: url }).run();
            }}
          >
            Link
          </button>
        </div>
      )}
      <div className="quillmd-editor-body">
        {placeholder && value === "" && (
          <div className="quillmd-placeholder">{placeholder}</div>
        )}
        <EditorContent editor={editor} />
      </div>
      {!readOnly && slash && (
        <div
          className="quillmd-slash-menu"
          style={{ top: slash.top, left: slash.left }}
        >
          {filtered.length === 0 && <div className="quillmd-slash-empty">No matches</div>}
          {filtered.map((action) => (
            <button
              key={action.key}
              type="button"
              className="quillmd-slash-item"
              onMouseDown={(e) => {
                e.preventDefault();
                runSlash(action);
              }}
            >
              <span className="quillmd-slash-label">/{action.key}</span>
              <span className="quillmd-slash-hint">{action.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
