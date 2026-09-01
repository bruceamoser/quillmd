// @vitest-environment jsdom
// Word count (plan 09 task 9.4, issue #87): the dialog component (read-only
// counts, scope row, keyboard model), the registry command that requests it
// (Tools > Word Count, Ctrl+Shift+F5), and the App wiring — the menu event
// and the shortcut open the dialog, the whole-document counts match the
// status bar (plan 09 AC3), and a WYSIWYG selection scopes the counts to the
// selected text range.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import App from "../../App";
import { currentFindEditor } from "../find";
import type { Editor as CoreEditor } from "@tiptap/core";
import {
  EDITOR_COMMANDS,
  registerWordCountDialogListener,
  requestWordCountDialog,
} from "../editorCommands";
import WordCountDialog from "../../components/WordCountDialog";
import type { TextCounts } from "../counts";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("menu.rs Tools > Word Count item (issue #87)", () => {
  it("offers the word-count dialog with the Ctrl+Shift+F5 accelerator", () => {
    const src = repoFile("../../../src-tauri/src/menu.rs");
    expect(src).toContain('MenuItem::with_id(app, "tools-word-count", "Word Count", true, Some("Ctrl+Shift+F5"))');
    expect(src).toContain('SubmenuBuilder::new(app, "Tools")');
    // Tools sits between Format and Help on the menu bar.
    expect(src).toContain("[&file, &edit, &view, &insert, &format, &tools, &help]");
  });
});

describe("App.tsx Tools > Word Count routing (issue #87)", () => {
  it("routes the menu id and the Ctrl+Shift+F5 shortcut to the dialog", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('id === "tools-word-count"');
    expect(app).toContain("registerWordCountDialogListener");
    expect(app).toContain('key === "f5" && e.shiftKey');
    expect(app).toContain("openWordCountDialog()");
  });
});

describe("the wordCount registry command (issue #87)", () => {
  it("keeps its label and shortcut", () => {
    const cmd = EDITOR_COMMANDS.find((c) => c.id === "wordCount");
    expect(cmd).toBeTruthy();
    expect(cmd!.label).toBe("Word Count");
    expect(cmd!.shortcut).toBe("Ctrl+Shift+F5");
  });

  it("requests the dialog through the renderer channel", () => {
    const seen: CoreEditor[] = [];
    const dispose = registerWordCountDialogListener((e) => seen.push(e));
    const editor = {} as CoreEditor;
    expect(requestWordCountDialog(editor)).toBe(true);
    expect(seen).toEqual([editor]);
    dispose();
    // Without a renderer the request is a no-op (returns false).
    expect(requestWordCountDialog(editor)).toBe(false);
  });
});

describe("WordCountDialog component", () => {
  const COUNTS: TextCounts = {
    words: 123,
    chars: 456,
    charsNoSpaces: 400,
    sentences: 10,
    paragraphs: 5,
    readingMinutes: 1,
  };

  interface Harness {
    container: HTMLDivElement;
    onClose: ReturnType<typeof vi.fn>;
    row: (label: string) => string;
    button: (text: string) => HTMLButtonElement;
  }

  function renderDialog(scoped: boolean): Harness {
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<WordCountDialog counts={COUNTS} scoped={scoped} onClose={onClose} />);
    });
    const dialog = container.querySelector(".quillmd-wordcount-dialog")!;
    return {
      container,
      onClose,
      row: (label) => {
        const el = Array.from(dialog.querySelectorAll(".quillmd-wordcount-label")).find(
          (l) => l.textContent === label
        );
        return el!.parentElement!.querySelector(".quillmd-wordcount-value")!.textContent!;
      },
      button: (text) =>
        Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
          (b) => b.textContent === text
        )!,
    };
  }

  let roots: Root[] = [];
  beforeEach(() => {
    document.body.innerHTML = "";
    roots = [];
  });
  afterEach(() => {
    for (const r of roots) act(() => r.unmount());
    roots = [];
    vi.restoreAllMocks();
  });

  it("shows every count row and the whole-document scope", () => {
    const h = renderDialog(false);
    expect(h.container.querySelector(".quillmd-wordcount-title")!.textContent).toBe(
      "Word Count"
    );
    expect(h.container.querySelector(".quillmd-wordcount-scope")!.textContent).toBe(
      "Entire document"
    );
    expect(h.row("Words")).toBe("123");
    expect(h.row("Characters (with spaces)")).toBe("456");
    expect(h.row("Characters (no spaces)")).toBe("400");
    expect(h.row("Sentences")).toBe("10");
    expect(h.row("Paragraphs")).toBe("5");
    expect(h.row("Reading time (200 wpm)")).toBe("1 min");
  });

  it("labels the selection scope with its word count", () => {
    const h = renderDialog(true);
    expect(h.container.querySelector(".quillmd-wordcount-scope")!.textContent).toBe(
      "Selection (123 words)"
    );
  });

  it("autofocuses the Close button; Enter closes", () => {
    const h = renderDialog(false);
    expect(document.activeElement).toBe(h.button("Close"));
    act(() => {
      h.container
        .querySelector(".quillmd-wordcount-dialog")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels on Esc", () => {
    const h = renderDialog(false);
    act(() => {
      h.container
        .querySelector(".quillmd-wordcount-dialog")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("a backdrop press closes; a press inside the dialog does not", () => {
    const h = renderDialog(false);
    act(() => {
      h.container
        .querySelector(".quillmd-wordcount-overlay")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);

    const h2 = renderDialog(false);
    act(() => {
      h2.container
        .querySelector(".quillmd-wordcount-dialog")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h2.onClose).not.toHaveBeenCalled();
  });
});

describe("App menu-event e2e: Tools > Word Count (issue #87)", () => {
  const g = globalThis as Record<string, unknown>;
  let container: HTMLDivElement;
  let root: Root | null = null;

  // "Hello wonderful world." (22) + "\n\n" + "Second sentence here." (21):
  // 45 on disk, 46 after the editor's trailing-newline normalization.
  const DOC_MD = "Hello wonderful world.\n\nSecond sentence here.";

  beforeEach(() => {
    localStorage.clear();
    g.isTauri = true;
    mockIPC(
      (cmd) => {
        if (cmd === "get_recent_files") return [];
        return undefined;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Unmount before clearMocks: the App's effect cleanup unlistens through
    // the event-plugin internals the mock installed.
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    clearMocks();
    delete g.isTauri;
    container.remove();
    vi.restoreAllMocks();
  });

  async function renderApp(): Promise<void> {
    const r = createRoot(container);
    root = r;
    await act(async () => {
      r.render(<App />);
    });
  }

  async function openFile(name: string, content: string): Promise<void> {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("file input not found");
    const file = new File([content], name, { type: "text/markdown" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function waitFor(cond: () => boolean, what: string): Promise<void> {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > 4000) throw new Error(`timeout waiting for ${what}`);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
  }

  async function emitMenu(id: string): Promise<void> {
    await act(async () => {
      await emit("menu-event", id);
    });
  }

  function dialog(): HTMLDivElement {
    const el = container.querySelector<HTMLDivElement>(".quillmd-wordcount-dialog");
    expect(el, "word count dialog").not.toBeNull();
    return el!;
  }

  function rowValue(label: string): string {
    const labelEl = Array.from(dialog().querySelectorAll(".quillmd-wordcount-label")).find(
      (l) => l.textContent === label
    );
    expect(labelEl, `row ${label}`).not.toBeNull();
    return labelEl!.parentElement!.querySelector(".quillmd-wordcount-value")!.textContent!;
  }

  function statusBar(): string {
    const el = container.querySelector(".quillmd-statusbar");
    expect(el, "status bar").not.toBeNull();
    return el!.textContent!;
  }

  // Selects the first occurrence of `text` in the live WYSIWYG doc.
  function selectText(editor: CoreEditor, text: string): void {
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return true;
      const idx = node.text!.indexOf(text);
      if (idx === -1) return true;
      editor
        .chain()
        .setTextSelection({ from: pos + idx, to: pos + idx + text.length })
        .run();
      return false;
    });
  }

  async function renderDoc(): Promise<void> {
    await renderApp();
    await openFile("word-count.md", DOC_MD);
    await waitFor(() => currentFindEditor() !== null, "live editor");
  }

  it("the menu opens the dialog with whole-document counts matching the status bar (AC3)", async () => {
    await renderDoc();
    await emitMenu("tools-word-count");
    expect(dialog()).not.toBeNull();
    expect(dialog().querySelector(".quillmd-wordcount-scope")!.textContent).toBe(
      "Entire document"
    );
    expect(rowValue("Words")).toBe("6");
    // The editor normalizes the live text with a trailing newline on mount,
    // so the live length is 46 (the file's 45 plus the final newline).
    expect(rowValue("Characters (with spaces)")).toBe("46");
    expect(rowValue("Characters (no spaces)")).toBe("39");
    expect(rowValue("Sentences")).toBe("2");
    expect(rowValue("Paragraphs")).toBe("2");
    expect(rowValue("Reading time (200 wpm)")).toBe("1 min");
    // Plan 09 AC3: the dialog's numbers are the status bar's numbers.
    expect(statusBar()).toContain("6 words");
    expect(statusBar()).toContain("46 chars");
  });

  it("Ctrl+Shift+F5 opens the dialog in browser dev", async () => {
    await renderDoc();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "F5", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
      );
    });
    expect(dialog()).not.toBeNull();
    expect(rowValue("Words")).toBe("6");
  });

  it("a WYSIWYG selection scopes the counts to the selected range", async () => {
    await renderDoc();
    const editor = currentFindEditor()!;
    await act(async () => {
      selectText(editor, "Hello wonderful world.");
    });
    await emitMenu("tools-word-count");
    expect(dialog().querySelector(".quillmd-wordcount-scope")!.textContent).toBe(
      "Selection (3 words)"
    );
    expect(rowValue("Words")).toBe("3");
    expect(rowValue("Characters (with spaces)")).toBe("22");
    expect(rowValue("Paragraphs")).toBe("1");
    // The status bar still reports the whole document.
    expect(statusBar()).toContain("6 words");
  });

  it("Esc closes the dialog and the document is untouched", async () => {
    await renderDoc();
    await emitMenu("tools-word-count");
    await act(async () => {
      dialog().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
    });
    expect(container.querySelector(".quillmd-wordcount-dialog")).toBeNull();
    // Read-only tool: the document text is unchanged.
    const editor = currentFindEditor()!;
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n")).toBe(
      "Hello wonderful world.\nSecond sentence here."
    );
  });
});
