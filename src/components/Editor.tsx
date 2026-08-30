import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import type { Editor as CoreEditor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Strike from "@tiptap/extension-strike";
import CodeBlock from "@tiptap/extension-code-block";
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
import { markdownToTiptap, tiptapToMarkdown } from "../lib/pm";
import { registerEditorCommandListener, runEditorCommand } from "../lib/editorCommands";
import type { EditorCommandId } from "../lib/editorCommands";
import Toolbar from "./Toolbar";

// Strikethrough is bound to Ctrl+Shift+X per spec §2.6 (the default Mod-Shift-s
// collides with Save As).
const Strikethrough = Strike.extend({
  addKeyboardShortcuts() {
    return { "Mod-Shift-x": () => this.editor.commands.toggleStrike() };
  },
});

// CodeBlock with a data-language attribute so the CSS can render a language
// label above each fenced block.
const CodeBlockWithLang = CodeBlock.extend({
  renderHTML({ node, HTMLAttributes }) {
    const lang = node.attrs.language as string | null;
    return [
      "pre",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-language": lang || null,
      }),
      ["code", { class: lang ? this.options.languageClassPrefix + lang : null }, 0],
    ];
  },
});

// Read-only verbatim leaf for constructs the PM schema cannot represent
// (definition lists). The clean-path pipeline owns their bytes; WYSIWYG shows
// them as a styled, non-editable block.
const OpaqueBlock = Node.create({
  name: "opaqueBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      raw: { default: "" },
      hint: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-opaque-block]" }];
  },
  renderHTML({ node }) {
    return [
      "div",
      {
        "data-opaque-block": "",
        "data-hint": String(node.attrs.hint ?? ""),
        class: "quillmd-opaque",
      },
      String(node.attrs.raw ?? ""),
    ];
  },
});

// Inline footnote reference atom. Click-to-edit relabels the reference.
const FootnoteRef = Node.create({
  name: "footnoteRef",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { label: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "sup[data-footnote-ref]" }];
  },
  renderHTML({ node }) {
    return [
      "sup",
      {
        "data-footnote-ref": String(node.attrs.label ?? ""),
        class: "quillmd-footnote-ref",
      },
      `[${node.attrs.label ?? ""}]`,
    ];
  },
});

// Footnote definition block; the body is editable prose, the label is rendered
// read-only via CSS so it never becomes a selectable part of the text.
const FootnoteDef = Node.create({
  name: "footnoteDef",
  group: "block",
  content: "block+",
  addAttributes() {
    return { label: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-footnote-def]" }];
  },
  renderHTML({ node }) {
    return [
      "div",
      {
        "data-footnote-def": String(node.attrs.label ?? ""),
        class: "quillmd-footnote-def",
      },
      0,
    ];
  },
});

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

function commandAction(
  key: string,
  id: EditorCommandId,
  label: string,
  hint: string,
): SlashAction {
  return {
    key,
    label,
    hint,
    run: (editor) => runEditorCommand(editor, id),
  };
}

const SLASH_ACTIONS: SlashAction[] = [
  {
    key: "heading",
    label: "Heading",
    hint: "Section heading (H2)",
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  commandAction("table", "table", "Table", "Insert a 3x3 GFM table"),
  commandAction("code", "codeBlock", "Code block", "Fenced code block"),
  commandAction("image", "image", "Image", "Embed an image"),
  commandAction("link", "link", "Link", "Insert a hyperlink"),
  commandAction("footnote", "footnote", "Footnote", "Footnote reference"),
  commandAction("hr", "hr", "Horizontal rule", "Thematic break"),
  commandAction("front-matter", "frontmatter", "Front matter", "YAML header block"),
  commandAction("blockquote", "blockquote", "Blockquote", "Quoted paragraph"),
  commandAction("task-list", "taskList", "Task list", "Checkbox list"),
  commandAction("bullet-list", "bulletList", "Bullet list", "Unordered list"),
  commandAction("ordered-list", "orderedList", "Ordered list", "Numbered list"),
  commandAction("strikethrough", "strike", "Strikethrough", "Deleted text"),
  commandAction("subscript", "subscript", "Subscript", "H~2~O"),
  commandAction("superscript", "superscript", "Superscript", "E=mc^2^"),
  commandAction("highlight", "highlight", "Highlight", "==Marked text=="),
  commandAction("emoji", "emoji", "Emoji", "Shortcode insert"),
  commandAction("definition-list", "definitionList", "Definition list", "Read-only term list"),
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
        codeBlock: false,
        strike: false,
      }),
      Strikethrough,
      CodeBlockWithLang,
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
      OpaqueBlock,
      FootnoteRef,
      FootnoteDef,
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
        const mod = event.ctrlKey || event.metaKey;

        if (mod && event.key.toLowerCase() === "k") {
          event.preventDefault();
          runEditorCommand(active, "link");
          return true;
        }

        if (event.key === "Tab") {
          const { $from } = active.state.selection;
          const parent = $from.parent.type.name;
          if (parent === "listItem" || parent === "taskItem") {
            event.preventDefault();
            runEditorCommand(active, event.shiftKey ? "outdent" : "indent");
            return true;
          }
        }
        if (event.key === "Backspace") {
          const state = active.state;
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
        if (event.key === "ArrowDown") {
          const { $from, empty } = active.state.selection;
          if (empty) {
            let depth = $from.depth;
            while (depth > 0 && $from.node(depth).type.name !== "table") depth -= 1;
            if (depth > 0 && $from.pos === $from.end(depth)) {
              event.preventDefault();
              const after = $from.after(depth);
              const nodeAfter = active.state.doc.nodeAt(after);
              if (nodeAfter && nodeAfter.type.name === "paragraph") {
                active.chain().focus().setTextSelection(after + 1).run();
              } else {
                active
                  .chain()
                  .focus()
                  .insertContentAt(after, { type: "paragraph" })
                  .setTextSelection(after + 1)
                  .run();
              }
              return true;
            }
          }
        }
        if (event.key === "Enter" && !event.shiftKey) {
          const { $from, empty } = active.state.selection;
          if (empty && $from.parent.type.name === "blockquote") {
            const isEmptyQuote =
              $from.parent.childCount === 1 &&
              $from.parent.firstChild?.type.name === "paragraph" &&
              $from.parent.firstChild.content.size === 0;
            if (isEmptyQuote) {
              event.preventDefault();
              active.chain().focus().lift("blockquote").run();
              return true;
            }
          }
        }
        return false;
      },
      handleClickOn: (_view, _pos, node, nodePos, _event, direct) => {
        const active = editorRef.current;
        if (!active || !direct) return false;
        if (node.type.name === "footnoteRef") {
          const label = window.prompt("Footnote label", String(node.attrs.label ?? "")) ?? "";
          if (label && label !== node.attrs.label) {
            active.chain().setNodeSelection(nodePos).updateAttributes("footnoteRef", { label }).run();
          }
          return true;
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
    return registerEditorCommandListener((id, param) => runEditorCommand(editor, id, param));
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
      {!readOnly && <Toolbar editor={editor} />}
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
