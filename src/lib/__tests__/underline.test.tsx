// @vitest-environment jsdom
// Underline exposure (plan 02 task 2.2, issue #31): the toolbar button, the
// Ctrl+U shortcut, and the registry wiring behind both. The registry behavior
// itself (toggle + active state) is covered by editorCommands.test.ts; the
// native Format menu item and App.tsx routing are covered by the p1-editor
// section of tests/acceptance-test.sh.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { EDITOR_COMMANDS, runEditorCommand } from "../editorCommands";
import Toolbar from "../../components/Toolbar";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function makeEditor(markdown = "Hello world"): Editor {
  return new Editor({
    // Same inline-mark extensions as the app editor (Editor.tsx).
    extensions: [StarterKit, Underline],
    content: markdownToTiptap(markdown),
  });
}

// Select the first occurrence of `text` so the toggle acts deterministically.
function selectText(editor: Editor, text: string): void {
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    editor.chain().setTextSelection({ from: pos + idx, to: pos + idx + text.length }).run();
    return false;
  });
}

function md(editor: Editor): string {
  return tiptapToMarkdown(editor.getJSON());
}

// Emits a Ctrl+U keydown the way the browser would deliver it to the editor
// view (the Underline extension's Mod-u keymap binding handles it).
function pressCtrlU(editor: Editor): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { key: "u", ctrlKey: true, bubbles: true, cancelable: true }),
  );
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

describe("underline (plan 02 task 2.2)", () => {
  it("registry entry declares the Ctrl+U shortcut and toggles the mark", () => {
    const underline = EDITOR_COMMANDS.filter((cmd) => cmd.id === "underline");
    expect(underline).toHaveLength(1);
    expect(underline[0].label).toBe("Underline");
    expect(underline[0].shortcut).toBe("Ctrl+U");

    const editor = trackedEditor();
    selectText(editor, "Hello");
    expect(runEditorCommand(editor, "underline")).toBe(true);
    expect(md(editor)).toBe("<u>Hello</u> world\n");
  });

  it("Ctrl+U toggles underline in the editor view", () => {
    const editor = trackedEditor();
    selectText(editor, "Hello");
    expect(md(editor)).toBe("Hello world\n");

    pressCtrlU(editor);
    expect(editor.isActive("underline")).toBe(true);
    expect(md(editor)).toBe("<u>Hello</u> world\n");

    // The mark persists across a selection change; a second Ctrl+U removes it.
    pressCtrlU(editor);
    expect(editor.isActive("underline")).toBe(false);
    expect(md(editor)).toBe("Hello world\n");
  });

  it("toolbar renders an Underline button between Italic and Strikethrough", () => {
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
    const underlineIdx = titles.indexOf("Underline (Ctrl+U)");
    expect(underlineIdx).toBeGreaterThan(-1);
    expect(titles[underlineIdx - 1]).toBe("Italic (Ctrl+I)");
    expect(titles[underlineIdx + 1]).toBe("Strikethrough (Ctrl+Shift+X)");
  });

  it("clicking the toolbar button toggles the mark and the active state", async () => {
    const editor = trackedEditor();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<Toolbar editor={editor} />);
    });

    act(() => {
      selectText(editor, "Hello");
    });
    const button = () =>
      container.querySelector<HTMLButtonElement>('button[title="Underline (Ctrl+U)"]');

    expect(button()?.classList.contains("quillmd-toolbar-active")).toBe(false);

    await act(async () => {
      button()?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(md(editor)).toBe("<u>Hello</u> world\n");
    expect(button()?.classList.contains("quillmd-toolbar-active")).toBe(true);

    await act(async () => {
      button()?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(md(editor)).toBe("Hello world\n");
    expect(button()?.classList.contains("quillmd-toolbar-active")).toBe(false);
  });
});
