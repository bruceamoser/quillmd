// @vitest-environment jsdom
// Mermaid diagram node (plan 11 task 11.1, issue #100): a ```mermaid fenced
// code block is its own TipTap node (mermaidBlock) that serializes back to the
// fence — the source is the document content, the rendered SVG is a later
// task. Insert > Diagram (and /diagram, the toolbar) insert the node with the
// starter template through one shared "diagram" command, so every surface
// writes the identical fence (plan 11 AC1).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import App from "../../App";
import { MermaidBlock } from "../../components/Editor";
import { currentFindEditor } from "../find";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import {
  EDITOR_COMMANDS,
  MERMAID_STARTER_TEMPLATE,
  editorCommandActive,
  runEditorCommand,
} from "../editorCommands";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

const FENCE = "```mermaid\n" + MERMAID_STARTER_TEMPLATE + "\n```";

describe("pm.ts: ```mermaid fence <-> mermaidBlock (issue #100)", () => {
  it("maps a mermaid fence to a mermaidBlock node", () => {
    const json = markdownToTiptap(FENCE + "\n");
    const block = json.content![0];
    expect(block.type).toBe("mermaidBlock");
    expect(block.content![0].text).toBe(MERMAID_STARTER_TEMPLATE);
  });

  it("maps non-mermaid fences to codeBlock (not mermaidBlock)", () => {
    const json = markdownToTiptap("```js\nconsole.log(1)\n```\n");
    const block = json.content![0];
    expect(block.type).toBe("codeBlock");
    expect(block.attrs?.language).toBe("js");
  });

  it("round-trips a bare mermaid fence byte-identically", () => {
    const src = FENCE + "\n";
    expect(tiptapToMarkdown(markdownToTiptap(src))).toBe(src);
  });

  it("round-trips a mermaid fence among other blocks byte-identically", () => {
    const src = "Before.\n\n" + FENCE + "\n\nAfter.\n";
    expect(tiptapToMarkdown(markdownToTiptap(src))).toBe(src);
  });

  it("round-trips a diagram with a different body (not just the template)", () => {
    const src = "```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n";
    expect(tiptapToMarkdown(markdownToTiptap(src))).toBe(src);
  });
});

describe("diagram command (issue #100)", () => {
  function makeEditor(markdown = "Hello world") {
    return new Editor({
      // The diagram node plus the default kit: both codeBlock and
      // mermaidBlock coexist, as in the app editor.
      extensions: [StarterKit, MermaidBlock],
      content: markdownToTiptap(markdown),
    });
  }

  function md(e: Editor): string {
    return tiptapToMarkdown(e.getJSON());
  }

  it("is registered in the command registry", () => {
    expect(EDITOR_COMMANDS.some((c) => c.id === "diagram")).toBe(true);
  });

  it("inserts a mermaid fence with the starter template (AC1)", () => {
    const e = makeEditor();
    expect(runEditorCommand(e, "diagram")).toBe(true);
    const out = md(e);
    expect(out).toContain(FENCE);
    // The inserted diagram carries exactly the starter template.
    expect(out).toContain("```mermaid\n" + MERMAID_STARTER_TEMPLATE + "\n```");
    // The surrounding text survived.
    expect(out).toContain("Hello world");
    // The saved shape is a converter fixed point (save -> reopen -> save
    // stability, the round-trip contract).
    expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
    e.destroy();
  });

  it("is active inside a diagram and a no-op there (no nested insert)", () => {
    const e = makeEditor(FENCE + "\n");
    // The document is a single diagram; the initial cursor sits inside it.
    expect(editorCommandActive(e, "diagram")).toBe(true);
    expect(runEditorCommand(e, "diagram")).toBe(false);
    // Still exactly one diagram — nothing was nested.
    expect(md(e).match(/```mermaid/g)).toHaveLength(1);
    e.destroy();
  });

  it("is inactive outside a diagram", () => {
    const e = makeEditor();
    expect(editorCommandActive(e, "diagram")).toBe(false);
    e.destroy();
  });
});

describe("Insert > Diagram menu wiring (issue #100)", () => {
  it("menu.rs keeps a stable insert-diagram id", () => {
    const src = repoFile("../../../src-tauri/src/menu.rs");
    expect(src).toContain(
      'MenuItem::with_id(app, "insert-diagram", "Diagram (Mermaid)", true, None::<&str>)',
    );
    // It is offered in the Insert submenu.
    expect(src).toContain("&diagram,");
  });

  it("App.tsx routes the menu id to the diagram command", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('"insert-diagram": "diagram"');
  });

  it("the toolbar offers the Diagram button", () => {
    const toolbar = repoFile("../../components/Toolbar.tsx");
    expect(toolbar).toContain('"diagram"');
    expect(toolbar).toContain('diagram: "Diagram"');
  });

  it("the slash menu offers /diagram", () => {
    const editor = repoFile("../../components/Editor.tsx");
    expect(editor).toContain('commandAction("diagram", "diagram", "Diagram", "Mermaid diagram")');
  });
});

describe("App menu-event e2e: Insert > Diagram (issue #100)", () => {
  const g = globalThis as Record<string, unknown>;
  let container: HTMLDivElement;
  let root: Root | null = null;

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

  function docMd(): string {
    const editor = currentFindEditor();
    if (!editor) throw new Error("no live editor");
    return tiptapToMarkdown(editor.getJSON());
  }

  async function emitMenu(id: string): Promise<void> {
    await act(async () => {
      await emit("menu-event", id);
    });
  }

  async function renderDoc(): Promise<void> {
    await renderApp();
    await openFile("diagrams.md", "Hello world\n");
    await waitFor(() => currentFindEditor() !== null, "live editor");
  }

  it("Insert > Diagram writes the starter-template fence into the document (AC1)", async () => {
    await renderDoc();
    expect(docMd()).toBe("Hello world\n");
    await emitMenu("insert-diagram");
    const out = docMd();
    expect(out).toContain(FENCE);
    expect(out).toContain("```mermaid\n" + MERMAID_STARTER_TEMPLATE + "\n```");
    // The surrounding text survived.
    expect(out).toContain("Hello world");
    // The saved shape is a converter fixed point.
    expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
  });
});
