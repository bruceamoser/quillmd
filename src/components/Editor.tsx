import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core";
import type { Editor as CoreEditor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Strike from "@tiptap/extension-strike";
import CodeBlock from "@tiptap/extension-code-block";
import Paragraph from "@tiptap/extension-paragraph";
import Heading from "@tiptap/extension-heading";
import Blockquote from "@tiptap/extension-blockquote";
import { ALIGN_CLASSES, FONT_SPAN_CLASS, HIGHLIGHT_SPAN_CLASS } from "../lib/pm";
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
import { baseName } from "../lib/fileIo";
import { openLinkUrl } from "../lib/links";
import {
  applyEditorFont,
  applyViewSettings,
  publishBlockStyle,
  registerEditorCommandListener,
  requestImageEditDialog,
  runEditorCommand,
} from "../lib/editorCommands";
import type { EditorCommandId } from "../lib/editorCommands";
import { currentBlockStyle } from "../lib/styles";
import { loadEditorFont } from "../lib/editorFont";
import { DEFAULT_DOC_SETTINGS } from "../lib/docSettings";
import type { DocSettings } from "../lib/docSettings";
import { matchDecorations, registerFindEditor, registerFindStateListener } from "../lib/find";
import type { SearchState } from "../lib/find";
import { DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import Toolbar from "./Toolbar";

// Strikethrough is bound to Ctrl+Shift+X per spec §2.6 (the default Mod-Shift-s
// collides with Save As).
const Strikethrough = Strike.extend({
  addKeyboardShortcuts() {
    return { "Mod-Shift-x": () => this.editor.commands.toggleStrike() };
  },
});

// Link with a title attribute (plan 08 task 8.1, issue #76): the tooltip
// field of the link dialog round-trips through this mark attribute as the
// markdown [text](url "title") title. pm.ts parses/serializes it directly;
// parseHTML picks it up for HTML pasted into the editor.
export const LinkWithTitle = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("title"),
      },
    };
  },
});

// Font styling (plan 04 task 4.1, issue #47): fontFamily / fontSize /
// fontColor are three separate marks so the toolbar can toggle each
// independently. All three share one canonical HTML form —
// <span class="quillmd-font" style="..."> — so each mark's parse rule
// matches that span and reads only its own style property; pm.ts collapses
// the three marks back into a single span with a fixed attribute order.
function makeFontMark(name: string, styleProp: string, cssProp: string, attrName: string) {
  return Mark.create({
    name,
    addAttributes() {
      return {
        [attrName]: {
          default: null,
          parseHTML: (element: HTMLElement) =>
            (element.style as unknown as Record<string, string>)[styleProp] || null,
          renderHTML: (attrs: Record<string, unknown>) =>
            typeof attrs[attrName] === "string" && attrs[attrName] !== ""
              ? { style: `${cssProp}: ${attrs[attrName]}` }
              : {},
        },
      };
    },
    parseHTML() {
      return [{ tag: `span.${FONT_SPAN_CLASS}` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["span", mergeAttributes({ class: FONT_SPAN_CLASS }, HTMLAttributes), 0];
    },
  });
}

export const FontFamilyMark = makeFontMark("fontFamily", "fontFamily", "font-family", "fontFamily");
export const FontSizeMark = makeFontMark("fontSize", "fontSize", "font-size", "fontSize");
export const FontColorMark = makeFontMark("fontColor", "color", "color", "color");

// Colored highlight (plan 04 task 4.1, issue #47): the colorless ==text==
// stays a plain <mark> (browser yellow); a colored highlight round-trips
// through <span class="quillmd-highlight" style="background-color: ...">.
export const QuillHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-color") || element.style.backgroundColor || null,
        renderHTML: (attrs: Record<string, unknown>) =>
          typeof attrs.color === "string" && attrs.color !== ""
            ? { "data-color": attrs.color, style: `background-color: ${attrs.color}; color: inherit` }
            : {},
      },
    };
  },
  parseHTML() {
    return [...(this.parent?.() ?? []), { tag: `span.${HIGHLIGHT_SPAN_CLASS}` }];
  },
});

// Image with a width attribute (plan 08 task 8.4, issue #79): the Edit
// dialog's width field round-trips through this node attribute as the HTML
// width attribute. pm.ts parses/serializes it as the <img src alt width>
// HTML form; parseHTML picks it up for HTML pasted into the editor and
// renderHTML sizes the image in the WYSIWYG DOM.
// Broken-image placeholder (plan 08 task 8.5, issue #80): the set of image
// srcs whose local file is gone, computed by App on doc load, plus the
// re-link handler (App runs the picker and the asset copy). The node view
// below is created once per node, so it reads both through this module
// holder on every (re)render — the same registry shape as editorCommands.ts.
export const imagePlaceholderRuntime = {
  missing: new Set<string>() as ReadonlySet<string>,
  onReLink: null as ((src: string, pos: number) => void) | null,
};
// The live placeholder node views' re-render functions: the missing set can
// change without the doc changing (a file is restored, a re-link applied),
// so the Editor re-renders every mounted view when its props change.
const imagePlaceholderViews = new Set<() => void>();
const EMPTY_MISSING: ReadonlySet<string> = new Set();

export const ImageWithWidth = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("width"),
        renderHTML: (attrs: Record<string, unknown>) =>
          typeof attrs.width === "string" && attrs.width !== "" ? { width: attrs.width } : {},
      },
    };
  },
  addNodeView() {
    return ({ node, getPos }) => {
      const dom = document.createElement("span");
      const render = () => {
        dom.innerHTML = "";
        const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
        if (src !== "" && imagePlaceholderRuntime.missing.has(src)) {
          // Missing local file: the placeholder names the file and offers
          // the re-link flow (AC6). The doc bytes are untouched — the
          // placeholder is view-only until the user re-links.
          const wrap = document.createElement("span");
          wrap.className = "quillmd-img-missing";
          const label = document.createElement("span");
          label.className = "quillmd-img-missing-label";
          label.textContent = `${baseName(src)} (missing)`;
          const button = document.createElement("button");
          button.type = "button";
          button.className = "quillmd-img-relink";
          button.textContent = "Re-link…";
          // Keep the editor's selection while the button is pressed.
          button.addEventListener("mousedown", (e) => e.preventDefault());
          button.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pos = getPos();
            if (typeof pos === "number" && imagePlaceholderRuntime.onReLink) {
              imagePlaceholderRuntime.onReLink(src, pos);
            }
          });
          wrap.append(label, button);
          dom.appendChild(wrap);
          return;
        }
        const img = document.createElement("img");
        img.src = src;
        const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
        if (alt !== "") img.alt = alt;
        const width = typeof node.attrs.width === "string" ? node.attrs.width : "";
        if (width !== "") img.setAttribute("width", width);
        dom.appendChild(img);
      };
      render();
      imagePlaceholderViews.add(render);
      return {
        dom,
        update(updated) {
          if (updated.type !== node.type) return false;
          node = updated;
          render();
          return true;
        },
        selectNode() {
          dom.classList.add("ProseMirror-selectednode");
        },
        deselectNode() {
          dom.classList.remove("ProseMirror-selectednode");
        },
        stopEvent: () => false,
        ignoreMutation: () => true,
        destroy() {
          imagePlaceholderViews.delete(render);
        },
      };
    };
  },
});

// Text alignment (task 2.3): a textAlign node attribute parsed/serialized as
// the quillmd-align-* class. pm.ts maps it to/from the HTML wrapper block.
function parseAlign(element: HTMLElement): string | null {
  for (const [align, cls] of Object.entries(ALIGN_CLASSES)) {
    if (element.classList.contains(cls)) return align;
  }
  return null;
}

function renderAlign(attrs: Record<string, unknown>): Record<string, string> {
  const t = attrs.textAlign;
  return t === "center" || t === "right" ? { class: ALIGN_CLASSES[t] } : {};
}

const textAlignAttribute = {
  default: null,
  parseHTML: (element: HTMLElement) => parseAlign(element),
  renderHTML: (attrs: Record<string, unknown>) => renderAlign(attrs),
};

// CodeBlock with a data-language attribute so the CSS can render a language
// label above each fenced block.
export const CodeBlockWithLang = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: textAlignAttribute,
    };
  },
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

export const AlignedParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: textAlignAttribute,
    };
  },
});

export const AlignedHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: textAlignAttribute,
    };
  },
});

export const AlignedBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: textAlignAttribute,
    };
  },
});

// GFM tables (plan 06 task 6.1, issue #61): column alignment has no HTML
// form, so the converter (pm.ts) carries the per-column alignment spec on
// the table node and serializes it back as the `:---`/`:---:`/`---:`
// delimiter row. HTML parse/render stay inert: GFM tables only enter through
// the markdown converter, and pasted HTML tables carry no alignment.
export const GfmTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => [],
      },
    };
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

// Find decorations (plan 07 task 7.2, issue #70): a plugin whose DecorationSet
// is driven by the published SearchState. App publishes a state, the listener
// below rewrites the plugin state through a meta transaction (doc-unchanged,
// so no onUpdate / no serialization), and every other transaction remaps the
// set with the doc mapping so the highlights track edits.
const findDecoKey = new PluginKey<DecorationSet>("quillmdFind");

const findDecorationsPlugin = new Plugin({
  key: findDecoKey,
  props: {
    decorations: (state) => findDecoKey.getState(state),
  },
  state: {
    init: () => DecorationSet.empty,
    apply: (tr, old) => {
      const next = tr.getMeta(findDecoKey);
      if (next !== undefined) return next;
      return old.map(tr.mapping, tr.doc);
    },
  },
});

// Tiptap only surfaces ProseMirror plugins through an extension's
// addProseMirrorPlugins field (raw plugins in the extensions array are
// ignored), so the decoration plugin is carried by this no-op extension.
const FindDecorations = Extension.create({
  name: "quillmdFindDecorations",
  addProseMirrorPlugins() {
    return [findDecorationsPlugin];
  },
});

// Scrolls the active match into the editor's view (plan 07 §3: the panel
// drives next/prev; the editor shows where the active match is).
function scrollToFindMatch(editor: CoreEditor, state: SearchState): void {
  if (state.active < 0 || state.active >= state.matches.length) return;
  const m = state.matches[state.active];
  if (m.to <= m.from) return;
  try {
    const dom = editor.view.nodeDOM(m.from);
    const el = dom instanceof Text ? dom.parentElement : (dom as HTMLElement | null);
    if (el instanceof HTMLElement && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center" });
    }
  } catch {
    // The position can be transiently invalid mid-transaction; the highlight
    // is still correct, only the scroll is skipped.
  }
}

interface EditorProps {
  value: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  // Per-doc view settings (plan 02 task 2.5): line spacing, word wrap, and
  // formatting marks, applied to the editor DOM and persisted by the caller.
  settings?: DocSettings;
  // Broken-image placeholder (plan 08 task 8.5, issue #80): the srcs whose
  // local file no longer exists (rendered as the missing-image placeholder)
  // and the re-link handler the placeholder's button calls.
  missingImages?: ReadonlySet<string>;
  onReLinkImage?: (src: string, pos: number) => void;
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

// Key handling for the WYSIWYG view (plan 02 task 2.4). Covers the registry
// commands that have no native extension keymap: Ctrl+K (link), the Word
// parity Ctrl+]/Ctrl+[ (indent/outdent), and Ctrl+1..6 (heading levels,
// acceptance #3). Tab/Shift+Tab re-nests list items and blockquotes through
// the same registry commands the toolbar and menus use (native sink/lift for
// lists, wrap/lift for quotes). Returns true when the event was consumed.
export function handleEditorKeyDown(editor: CoreEditor, event: KeyboardEvent): boolean {
  const mod = event.ctrlKey || event.metaKey;

  if (mod && event.key.toLowerCase() === "k") {
    event.preventDefault();
    runEditorCommand(editor, "link");
    return true;
  }

  // Word parity: Ctrl+] indents, Ctrl+[ outdents (list nesting or one quote
  // level). The registry command is a no-op outside list/quote contexts.
  if (mod && !event.shiftKey && (event.key === "]" || event.key === "[")) {
    event.preventDefault();
    runEditorCommand(editor, event.key === "]" ? "indent" : "outdent");
    return true;
  }

  // Word parity (plan 02 §4 AC3): Ctrl+1..6 sets the heading level of the
  // block under the cursor. The h1..h6 registry commands toggle, so pressing
  // the current level's key again returns the block to a paragraph.
  if (mod && !event.shiftKey && !event.altKey && event.key >= "1" && event.key <= "6") {
    event.preventDefault();
    runEditorCommand(editor, `h${event.key}` as EditorCommandId);
    return true;
  }

  if (event.key === "Tab") {
    const { $from } = editor.state.selection;
    // Ancestors, not just the parent: an empty list item holds the cursor in
    // its (empty) paragraph, and a quote inside a list item is wrapped in
    // both. Lists win: Tab nests the item, the quote level is untouched.
    let inList = false;
    let inQuote = false;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const name = $from.node(depth).type.name;
      if (name === "listItem" || name === "taskItem") inList = true;
      else if (name === "blockquote") inQuote = true;
    }
    if (inList || inQuote) {
      event.preventDefault();
      runEditorCommand(editor, event.shiftKey ? "outdent" : "indent");
      return true;
    }
  }

  if (event.key === "Backspace") {
    const state = editor.state;
    const { $from } = state.selection;
    const parent = $from.parent;
    const isEmpty =
      (parent.type.name === "listItem" || parent.type.name === "taskItem") &&
      parent.childCount === 1 &&
      parent.firstChild?.type.name === "paragraph" &&
      parent.firstChild.content.size === 0;
    if (isEmpty && $from.pos === $from.start()) {
      event.preventDefault();
      editor.chain().focus().liftListItem("listItem").liftListItem("taskItem").run();
      return true;
    }
  }
  if (event.key === "ArrowDown") {
    const { $from, empty } = editor.state.selection;
    if (empty) {
      let depth = $from.depth;
      while (depth > 0 && $from.node(depth).type.name !== "table") depth -= 1;
      if (depth > 0 && $from.pos === $from.end(depth)) {
        event.preventDefault();
        const after = $from.after(depth);
        const nodeAfter = editor.state.doc.nodeAt(after);
        if (nodeAfter && nodeAfter.type.name === "paragraph") {
          editor.chain().focus().setTextSelection(after + 1).run();
        } else {
          editor
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
    const { $from, empty } = editor.state.selection;
    if (empty && $from.parent.type.name === "blockquote") {
      const isEmptyQuote =
        $from.parent.childCount === 1 &&
        $from.parent.firstChild?.type.name === "paragraph" &&
        $from.parent.firstChild.content.size === 0;
      if (isEmptyQuote) {
        event.preventDefault();
        editor.chain().focus().lift("blockquote").run();
        return true;
      }
    }
  }
  return false;
}

// Modifier key of a paste event. ClipboardEvent is a UIEvent: unlike
// KeyboardEvent it exposes no ctrlKey/shiftKey properties in browsers, so
// getModifierState is the spec path (the DOM lib types it only on
// Mouse/KeyboardEvent, hence the cast). The property fallback covers
// synthetic events (tests) where getModifierState is absent.
function pasteModifierKey(event: ClipboardEvent, state: string, prop: string): boolean {
  const ui = event as unknown as { getModifierState?: (key: string) => boolean };
  if (typeof ui.getModifierState === "function") return ui.getModifierState(state);
  return Boolean((event as unknown as Record<string, unknown>)[prop]);
}

// Paste-as-text interception (plan 02 §2.9, issue #36). ProseMirror already
// treats a shifted paste as plain text, but the insertion goes through the
// registry command (pasteAsText) so the Edit menu item, the Ctrl+Shift+V
// shortcut, and the tests all exercise identical behavior. A plain Ctrl+V
// returns false and keeps the native rich-HTML paste (bold/italic/links/
// headings survive into the markdown schema).
export function handleEditorPaste(editor: CoreEditor, event: ClipboardEvent): boolean {
  const controlOrMeta =
    pasteModifierKey(event, "Control", "ctrlKey") || pasteModifierKey(event, "Meta", "metaKey");
  if (!controlOrMeta || !pasteModifierKey(event, "Shift", "shiftKey")) return false;
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return false;
  event.preventDefault();
  runEditorCommand(editor, "pasteAsText", text);
  return true;
}

// The href of the link mark at a doc position, or null when the position
// carries no link (plan 08 task 8.5, issue #80).
export function linkHrefAt(view: EditorView, pos: number): string | null {
  const resolved = view.state.doc.resolve(pos);
  const mark = resolved.marks().find((m) => m.type.name === "link");
  const href = mark?.attrs.href;
  return typeof href === "string" && href !== "" ? href : null;
}

// Middle-click on a link (plan 08 task 8.5, issue #80, AC7): resolves the
// click to a doc position, finds the link mark there, and opens the href
// through plugin-opener — http/https in the system browser, file:// in the
// OS handler (openLinkUrl). Returns true when the event was consumed.
export function handleEditorMiddleClick(view: EditorView, event: MouseEvent): boolean {
  if (event.button !== 1) return false;
  const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!found) return false;
  const href = linkHrefAt(view, found.pos);
  if (href === null) return false;
  void openLinkUrl(href);
  return true;
}

export default function Editor({
  value,
  onChange,
  readOnly = false,
  placeholder = "",
  settings,
  missingImages,
  onReLinkImage,
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
        paragraph: false,
        heading: false,
        blockquote: false,
        codeBlock: false,
        strike: false,
      }),
      Strikethrough,
      AlignedParagraph,
      AlignedHeading,
      AlignedBlockquote,
      CodeBlockWithLang,
      Underline,
      QuillHighlight,
      FontFamilyMark,
      FontSizeMark,
      FontColorMark,
      LinkWithTitle.configure({ openOnClick: false, autolink: true }),
      // Inline (plan 08 task 8.2, issue #77): the converter treats images as
      // phrasing content (pm.ts), and a block image is dropped by
      // tiptapToMarkdown — so inserted images must land inside a paragraph
      // to survive the round-trip. The width attribute (task 8.4, issue
      // #79) carries the Edit dialog's width through the node.
      ImageWithWidth.configure({ inline: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Subscript,
      Superscript,
      GfmTable.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      OpaqueBlock,
      FootnoteRef,
      FootnoteDef,
      FindDecorations,
    ],
    content: markdownToTiptap(initialRef.current),
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: "quillmd-prosemirror",
        // Spellcheck (plan 02 §2.8, issue #36): on by default (the per-doc
        // setting, applied below), the browser engine does the checking.
        // applyViewSettings reconciles this on mount and on changes.
        spellcheck: (settings?.spellcheck ?? true) ? "true" : "false",
      },
      handleKeyDown: (_view, event) => {
        const active = editorRef.current;
        return active ? handleEditorKeyDown(active, event) : false;
      },
      handlePaste: (_view, event) => {
        const active = editorRef.current;
        return active ? handleEditorPaste(active, event) : false;
      },
      // Middle-click on a link (plan 08 task 8.5, issue #80, AC7): opens the
      // link through plugin-opener instead of the webview's default
      // (download/save-as for file://, nothing useful for http/https).
      handleDOMEvents: {
        auxclick: (view, event) => handleEditorMiddleClick(view, event as MouseEvent),
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
        // Image click (plan 08 task 8.4, issue #79): select the image and
        // request the edit dialog. The dialog prefills from the selection and
        // applies URL/alt/width back to this instance.
        if (node.type.name === "image") {
          active.chain().setNodeSelection(nodePos).run();
          requestImageEditDialog(active);
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
    // Style inspector (plan 05 task 5.5, issue #58): on every doc or
    // selection transaction, publish the built-in style that owns the block
    // under the cursor (or null for a block with no built-in style) so the
    // status-bar indicator tracks the cursor.
    onTransaction: ({ editor: ed }) => {
      publishBlockStyle(currentBlockStyle(ed)?.label ?? null);
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

  // Broken-image placeholder (plan 08 task 8.5, issue #80): point the module
  // holder at the latest missing set / re-link handler and re-render every
  // mounted image node view, so a change in the set (file restored, re-link
  // applied) swaps the placeholder without a doc transaction.
  useEffect(() => {
    imagePlaceholderRuntime.missing = missingImages ?? EMPTY_MISSING;
    imagePlaceholderRuntime.onReLink = onReLinkImage ?? null;
    for (const rerender of imagePlaceholderViews) rerender();
  }, [missingImages, onReLinkImage]);

  useEffect(() => {
    if (!editor) return;
    const unregister = registerEditorCommandListener((id, param) =>
      runEditorCommand(editor, id, param),
    );
    return () => {
      unregister();
      // Style inspector (plan 05 task 5.5, issue #58): no WYSIWYG editor is
      // mounted anymore (source/split/preview, or the tab closed), so clear
      // the status-bar block-style indicator.
      publishBlockStyle(null);
    };
  }, [editor]);

  // Find & replace bridge (plan 07 task 7.2, issue #70): expose the live
  // editor to the search/replace owned by App.tsx and apply the published
  // SearchState as inline decorations (plus a scroll to the active match).
  // While this view is unmounted (source/split/preview) no provider is
  // registered, so App's search reports no doc — source-view search is
  // task 7.4.
  useEffect(() => {
    if (!editor) return;
    const unregisterEditor = registerFindEditor(() => editor);
    const unregisterState = registerFindStateListener((state) => {
      const set = state ? matchDecorations(editor.state.doc, state) : DecorationSet.empty;
      editor.view.dispatch(editor.state.tr.setMeta(findDecoKey, set));
      if (state) scrollToFindMatch(editor, state);
    });
    return () => {
      unregisterEditor();
      unregisterState();
    };
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

  // Per-doc view settings (plan 02 task 2.5): restore the line spacing, word
  // wrap, and formatting-marks state onto the editor DOM on mount and when the
  // caller's settings change. The registry toggles mutate the same DOM state,
  // so this re-application is idempotent and never re-serializes the doc.
  useEffect(() => {
    if (!editor) return;
    applyViewSettings(editor, settings ?? DEFAULT_DOC_SETTINGS);
  }, [editor, settings]);

  // Per-app editor-chrome font (plan 04 task 4.5, issue #51): restore the
  // app-wide font/size onto the editor DOM on mount. Live picks go through
  // the editorFont registry command (the same DOM state), so this is
  // idempotent; the setting never touches the document.
  useEffect(() => {
    if (!editor) return;
    applyEditorFont(editor, loadEditorFont());
  }, [editor]);

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
