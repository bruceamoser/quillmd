// @vitest-environment jsdom
// Indent/outdent + list keyboard (plan 02 task 2.4, issue #33): the Word
// parity Ctrl+]/Ctrl+[ shortcuts, Tab/Shift+Tab re-nesting of list items and
// blockquotes in the editor view, and the toolbar buttons around the native
// sink/lift commands. The registry command behavior (run/active, sink/lift
// semantics, quote wrap/lift) is covered by editorCommands.test.ts; the
// native Format > Paragraph menu items and App.tsx routing are covered by
// the p1-editor section of tests/acceptance-test.sh.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  AlignedBlockquote,
  AlignedHeading,
  AlignedParagraph,
  CodeBlockWithLang,
  handleEditorKeyDown,
} from "../../components/Editor";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { EDITOR_COMMANDS } from "../editorCommands";
import type { TabKeyBehavior } from "../../lib/settings";
import Toolbar from "../../components/Toolbar";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function makeEditor(markdown = "Hello world"): Editor {
  return new Editor({
    // Same block extensions as the app editor (Editor.tsx) so list/quote
    // nesting behaves exactly as it does in the WYSIWYG view.
    extensions: [
      StarterKit.configure({
        paragraph: false,
        heading: false,
        blockquote: false,
        codeBlock: false,
        strike: false,
      }),
      AlignedParagraph,
      AlignedHeading,
      AlignedBlockquote,
      CodeBlockWithLang,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: markdownToTiptap(markdown),
  });
}

// Put the cursor right after the first occurrence of `text` in the document
// so the block commands act on a deterministic position.
function cursorAfter(editor: Editor, text: string): void {
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    editor.chain().setTextSelection(pos + idx + text.length).run();
    return false;
  });
}

function md(editor: Editor): string {
  return tiptapToMarkdown(editor.getJSON());
}

// Emits the keydown and runs it through the component's
// editorProps.handleKeyDown (handleEditorKeyDown), the same binding the
// WYSIWYG view installs.
function press(
  editor: Editor,
  key: string,
  opts: { ctrl?: boolean; shift?: boolean; tabKey?: TabKeyBehavior } = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  handleEditorKeyDown(editor, event, opts.tabKey ?? "indent");
  return event;
}

let roots: Root[] = [];
let editors: Editor[] = [];

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  for (const root of roots) root.unmount();
  roots = [];
  for (const editor of editors) editor.destroy();
  editors = [];
});

function trackedEditor(markdown = "Hello world"): Editor {
  const editor = makeEditor(markdown);
  editors.push(editor);
  return editor;
}

describe("indent/outdent registry shortcuts (plan 02 task 2.4)", () => {
  it("declare the Word parity Ctrl+]/Ctrl+[ shortcuts", () => {
    const byId = new Map(EDITOR_COMMANDS.map((cmd) => [cmd.id, cmd]));
    expect(byId.get("indent")?.label).toBe("Indent");
    expect(byId.get("indent")?.shortcut).toBe("Ctrl+]");
    expect(byId.get("outdent")?.label).toBe("Outdent");
    expect(byId.get("outdent")?.shortcut).toBe("Ctrl+[");
  });
});

describe("Ctrl+] / Ctrl+[ in the editor view", () => {
  it("Ctrl+] nests a list item and Ctrl+[ lifts it", () => {
    const editor = trackedEditor("- one\n- two\n");
    cursorAfter(editor, "two");
    expect(press(editor, "]", { ctrl: true }).defaultPrevented).toBe(true);
    expect(md(editor)).toBe("- one\n  - two\n");

    cursorAfter(editor, "two");
    expect(press(editor, "[", { ctrl: true }).defaultPrevented).toBe(true);
    expect(md(editor)).toBe("- one\n- two\n");
  });

  it("Ctrl+] adds a quote level and Ctrl+[ lifts it", () => {
    const editor = trackedEditor("> Hello\n");
    cursorAfter(editor, "Hello");
    press(editor, "]", { ctrl: true });
    expect(md(editor)).toBe("> > Hello\n");

    cursorAfter(editor, "Hello");
    press(editor, "[", { ctrl: true });
    expect(md(editor)).toBe("> Hello\n");
  });

  it("Ctrl+] wraps a plain paragraph in a quote; Ctrl+[ lifts it back", () => {
    const editor = trackedEditor("Hello world");
    cursorAfter(editor, "Hello");
    expect(press(editor, "]", { ctrl: true }).defaultPrevented).toBe(true);
    expect(md(editor)).toBe("> Hello world\n");

    cursorAfter(editor, "Hello");
    expect(press(editor, "[", { ctrl: true }).defaultPrevented).toBe(true);
    expect(md(editor)).toBe("Hello world\n");
  });

  it("is a consumed no-op on a bare paragraph for outdent", () => {
    const editor = trackedEditor("Hello world");
    cursorAfter(editor, "Hello");
    expect(press(editor, "[", { ctrl: true }).defaultPrevented).toBe(true);
    expect(md(editor)).toBe("Hello world\n");
  });

  it("ignores Ctrl+Shift+] (history navigation stays with the browser)", () => {
    const editor = trackedEditor("Hello world");
    cursorAfter(editor, "Hello");
    const event = press(editor, "]", { ctrl: true, shift: true });
    expect(event.defaultPrevented).toBe(false);
    expect(md(editor)).toBe("Hello world\n");
  });
});

describe("Tab / Shift+Tab in the editor view", () => {
  it("Tab nests a list item and Shift+Tab lifts it", () => {
    const editor = trackedEditor("- one\n- two\n");
    cursorAfter(editor, "two");
    expect(press(editor, "Tab").defaultPrevented).toBe(true);
    expect(md(editor)).toBe("- one\n  - two\n");

    cursorAfter(editor, "two");
    expect(press(editor, "Tab", { shift: true }).defaultPrevented).toBe(true);
    expect(md(editor)).toBe("- one\n- two\n");
  });

  it("Shift+Tab lifts a top-level item out of the list", () => {
    const editor = trackedEditor("- one\n- two\n");
    cursorAfter(editor, "one");
    expect(press(editor, "Tab", { shift: true }).defaultPrevented).toBe(true);
    expect(md(editor)).toBe("one\n\n- two\n");
  });

  it("Tab on the first item is consumed but a no-op (native sink limit)", () => {
    const editor = trackedEditor("- one\n- two\n");
    cursorAfter(editor, "one");
    expect(press(editor, "Tab").defaultPrevented).toBe(true);
    expect(md(editor)).toBe("- one\n- two\n");
  });

  it("Tab on an empty list item finds the list ancestor and nests it", () => {
    const editor = trackedEditor("- one\n- \n");
    // The second item is empty; the serializer drops the marker's trailing
    // space.
    expect(md(editor)).toBe("- one\n-\n");
    let itemPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (
        node.type.name === "listItem" &&
        node.childCount === 1 &&
        node.firstChild?.type.name === "paragraph" &&
        node.firstChild.content.size === 0
      ) {
        itemPos = pos;
      }
    });
    expect(itemPos).toBeGreaterThan(-1);
    // The cursor sits in the item's empty paragraph; the handler must still
    // find the list ancestor (its parent is the paragraph, not the item).
    editor.chain().setTextSelection(itemPos + 2).run();
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(press(editor, "Tab").defaultPrevented).toBe(true);
    expect(md(editor)).toBe("- one\n  -\n");

    // Shift+Tab lifts the empty item back out.
    expect(press(editor, "Tab", { shift: true }).defaultPrevented).toBe(true);
    expect(md(editor)).toBe("- one\n-\n");
  });

  it("Tab adds a quote level and Shift+Tab lifts it", () => {
    const editor = trackedEditor("> Hello\n");
    cursorAfter(editor, "Hello");
    expect(press(editor, "Tab").defaultPrevented).toBe(true);
    expect(md(editor)).toBe("> > Hello\n");

    cursorAfter(editor, "Hello");
    expect(press(editor, "Tab", { shift: true }).defaultPrevented).toBe(true);
    expect(md(editor)).toBe("> Hello\n");
  });

  it("Tab in a list inside a quote nests the item, not the quote", () => {
    const editor = trackedEditor("> - one\n> - two\n");
    cursorAfter(editor, "two");
    expect(press(editor, "Tab").defaultPrevented).toBe(true);
    expect(md(editor)).toBe("> - one\n>   - two\n");
  });

  it("leaves a bare paragraph untouched (WYSIWYG has no paragraph indent)", () => {
    const editor = trackedEditor("Hello world");
    cursorAfter(editor, "Hello");
    expect(press(editor, "Tab").defaultPrevented).toBe(false);
    expect(md(editor)).toBe("Hello world\n");
    expect(press(editor, "Tab", { shift: true }).defaultPrevented).toBe(false);
    expect(md(editor)).toBe("Hello world\n");
  });
});

describe("tab-key behavior setting (plan 10 task 10.2, issue #94)", () => {
  it("'spaces': Tab on a bare paragraph inserts four spaces at the caret", () => {
    const editor = trackedEditor("HelloXworld");
    cursorAfter(editor, "Hello");
    expect(press(editor, "Tab", { tabKey: "spaces" }).defaultPrevented).toBe(true);
    expect(md(editor)).toBe("Hello    Xworld\n");
  });

  it("'spaces': Tab still nests list items and adds quote levels", () => {
    const editor = trackedEditor("- one\n- two\n");
    cursorAfter(editor, "two");
    expect(press(editor, "Tab", { tabKey: "spaces" }).defaultPrevented).toBe(true);
    expect(md(editor)).toBe("- one\n  - two\n");

    const quote = trackedEditor("> Hello\n");
    cursorAfter(quote, "Hello");
    expect(press(quote, "Tab", { tabKey: "spaces" }).defaultPrevented).toBe(true);
    expect(md(quote)).toBe("> > Hello\n");
  });

  it("'spaces': Shift+Tab outside a nestable context is left to the browser", () => {
    const editor = trackedEditor("Hello world");
    cursorAfter(editor, "Hello");
    expect(press(editor, "Tab", { shift: true, tabKey: "spaces" }).defaultPrevented).toBe(false);
    expect(md(editor)).toBe("Hello world\n");
  });

  it("'indent' (the handler default): Tab on a bare paragraph is not consumed", () => {
    const editor = trackedEditor("Hello world");
    cursorAfter(editor, "Hello");
    expect(press(editor, "Tab", { tabKey: "indent" }).defaultPrevented).toBe(false);
    expect(md(editor)).toBe("Hello world\n");
  });
});

describe("indent/outdent toolbar buttons", () => {
  it("render with the Word parity shortcut titles after the align group", () => {
    const editor = trackedEditor();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<Toolbar editor={editor} />);
    });

    const titles = Array.from(container.querySelectorAll("button")).map((b) =>
      b.getAttribute("title"),
    );
    const indentIdx = titles.indexOf("Indent (Ctrl+])");
    expect(indentIdx).toBeGreaterThan(-1);
    expect(titles[indentIdx + 1]).toBe("Outdent (Ctrl+[)");
    expect(titles[indentIdx - 1]).toBe("Align right");
  });

  it("clicking Indent on a nested item nests it and reflects the active state", async () => {
    const editor = trackedEditor("- one\n- two\n");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<Toolbar editor={editor} />);
    });

    const indentButton = () =>
      container.querySelector<HTMLButtonElement>('button[title="Indent (Ctrl+])"]');
    const outdentButton = () =>
      container.querySelector<HTMLButtonElement>('button[title="Outdent (Ctrl+[)"]');

    // Cursor in the first item: the native sink cannot nest it.
    act(() => {
      cursorAfter(editor, "one");
    });
    expect(indentButton()?.classList.contains("quillmd-toolbar-active")).toBe(false);

    act(() => {
      cursorAfter(editor, "two");
    });
    expect(indentButton()?.classList.contains("quillmd-toolbar-active")).toBe(true);

    await act(async () => {
      indentButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(md(editor)).toBe("- one\n  - two\n");
    expect(outdentButton()?.classList.contains("quillmd-toolbar-active")).toBe(true);
  });
});
