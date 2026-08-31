// @vitest-environment jsdom
// Editor-chrome font (plan 04 task 4.5, issue #51): the per-app font the
// WYSIWYG content renders in. This suite covers the localStorage persistence
// (editorFont.ts), the editorFont registry command (CSS variables on the
// editor DOM, never the document), the menu.rs list sync + submenu structure,
// the App.tsx routing, and a full-App menu-event e2e asserting a menu pick
// applies the CSS variables and survives a remount (the Editor re-applies the
// persisted setting on mount).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import App from "../../App";
import { FontColorMark, FontFamilyMark, FontSizeMark } from "../../components/Editor";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import {
  EDITOR_FONT_FAMILY_CSS,
  EDITOR_FONT_FAMILIES,
  EDITOR_FONT_SIZES,
  DEFAULT_EDITOR_FONT,
  loadEditorFont,
  saveEditorFont,
  type EditorFontSettings,
} from "../editorFont";
import {
  EDITOR_COMMANDS,
  applyEditorFont,
  editorCommandActive,
  editorFontOf,
  runEditorCommand,
} from "../editorCommands";
import { currentFindEditor } from "../find";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "quillmd.editorFont";

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

// The body of a `pub const <name>: &[...]` literal in menu.rs.
function rustArrayLiteral(name: string): string {
  const src = repoFile("../../../src-tauri/src/menu.rs");
  const start = src.indexOf(`pub const ${name}: `);
  expect(start, `menu.rs must define ${name}`).toBeGreaterThan(-1);
  const assign = src.indexOf("= &[", start);
  const open = src.indexOf("[", assign);
  const close = src.indexOf("];", open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return src.slice(open, close);
}

// --- persistence (editorFont.ts) -------------------------------------------

describe("editorFont persistence (issue #51)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to the app's current look (sans-serif, 15px)", () => {
    expect(loadEditorFont()).toEqual(DEFAULT_EDITOR_FONT);
    expect(DEFAULT_EDITOR_FONT).toEqual({ family: "sans-serif", size: 15 });
  });

  it("round-trips a saved setting", () => {
    saveEditorFont({ family: "monospace", size: 20 });
    expect(loadEditorFont()).toEqual({ family: "monospace", size: 20 });
  });

  it("offers the three families and a curated px size list", () => {
    expect(EDITOR_FONT_FAMILIES).toEqual(["sans-serif", "serif", "monospace"]);
    expect(EDITOR_FONT_SIZES).toEqual([12, 13, 14, 15, 16, 18, 20, 24]);
    for (const family of EDITOR_FONT_FAMILIES) {
      expect(EDITOR_FONT_FAMILY_CSS[family].length, family).toBeGreaterThan(0);
    }
  });

  it("recovers the defaults from a corrupted or wrong-shaped payload", () => {
    for (const raw of ["{not json", "[]", "null", '{"family": 42, "size": "big"}']) {
      localStorage.setItem(KEY, raw);
      expect(loadEditorFont(), raw).toEqual(DEFAULT_EDITOR_FONT);
    }
  });

  it("merges a partial record onto the defaults", () => {
    localStorage.setItem(KEY, JSON.stringify({ family: "serif" }));
    expect(loadEditorFont()).toEqual({ family: "serif", size: 15 });
    localStorage.setItem(KEY, JSON.stringify({ size: 18 }));
    expect(loadEditorFont()).toEqual({ family: "sans-serif", size: 18 });
  });

  it("clamps an out-of-range stored size into the 12-24 window", () => {
    localStorage.setItem(KEY, JSON.stringify({ size: 300 }));
    expect(loadEditorFont().size).toBe(24);
    localStorage.setItem(KEY, JSON.stringify({ size: 1 }));
    expect(loadEditorFont().size).toBe(12);
  });
});

// --- registry command --------------------------------------------------------

describe("editorFont registry command (issue #51)", () => {
  let editors: Editor[] = [];

  function makeEditor(markdown = "Hello world"): Editor {
    // The font marks are registered so the suite can prove the command never
    // touches the document's own styling.
    const editor = new Editor({
      extensions: [StarterKit, FontFamilyMark, FontSizeMark, FontColorMark],
      content: markdownToTiptap(markdown),
    });
    editors.push(editor);
    return editor;
  }

  function dom(editor: Editor): HTMLElement {
    return editor.view.dom as HTMLElement;
  }

  function md(editor: Editor): string {
    return tiptapToMarkdown(editor.getJSON());
  }

  afterEach(() => {
    for (const e of editors) e.destroy();
    editors = [];
  });

  it("registers the command id exactly once", () => {
    const ids = EDITOR_COMMANDS.map((cmd) => cmd.id);
    expect(ids.filter((x) => x === "editorFont")).toHaveLength(1);
  });

  it("applies the family and size as CSS variables on the editor DOM", () => {
    const e = makeEditor();
    expect(runEditorCommand(e, "editorFont", { family: "monospace", size: 16 })).toBe(true);
    expect(dom(e).style.getPropertyValue("--quillmd-editor-font")).toBe("var(--font-mono)");
    expect(dom(e).style.getPropertyValue("--quillmd-editor-font-size")).toBe("16px");
    // The document itself is untouched.
    expect(md(e)).toBe("Hello world\n");
  });

  it("maps each family to its CSS stack", () => {
    const e = makeEditor();
    for (const family of EDITOR_FONT_FAMILIES) {
      expect(runEditorCommand(e, "editorFont", { family, size: 15 })).toBe(true);
      expect(dom(e).style.getPropertyValue("--quillmd-editor-font")).toBe(
        EDITOR_FONT_FAMILY_CSS[family],
      );
    }
  });

  it("rejects params that are not a curated family/size pair", () => {
    const e = makeEditor();
    for (const param of [
      undefined,
      null,
      "monospace",
      16,
      { family: "cursive", size: 16 },
      { family: "monospace", size: 17 },
      { family: "monospace", size: "16px" },
    ]) {
      expect(runEditorCommand(e, "editorFont", param as EditorFontSettings), String(param)).toBe(
        false,
      );
    }
    expect(dom(e).style.getPropertyValue("--quillmd-editor-font")).toBe("");
  });

  it("reports active only at the exact applied setting", () => {
    const e = makeEditor();
    applyEditorFont(e, { family: "serif", size: 20 });
    expect(editorCommandActive(e, "editorFont", { family: "serif", size: 20 })).toBe(true);
    expect(editorCommandActive(e, "editorFont", { family: "serif", size: 18 })).toBe(false);
    expect(editorCommandActive(e, "editorFont", { family: "monospace", size: 20 })).toBe(false);
    expect(editorCommandActive(e, "editorFont", "serif")).toBe(false);
  });

  it("reads the applied setting back (unset reads as the defaults)", () => {
    const e = makeEditor();
    expect(editorFontOf(e)).toEqual(DEFAULT_EDITOR_FONT);
    applyEditorFont(e, { family: "monospace", size: 13 });
    expect(editorFontOf(e)).toEqual({ family: "monospace", size: 13 });
  });
});

// --- menu.rs sync + submenu structure -----------------------------------------

describe("menu.rs Editor font submenu (issue #51)", () => {
  it("mirrors the frontend family/size lists (menu offers the same picks)", () => {
    const families = [...rustArrayLiteral("EDITOR_FONT_FAMILIES").matchAll(/"([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(families).toEqual([...EDITOR_FONT_FAMILIES]);

    const sizes = [...rustArrayLiteral("EDITOR_FONT_SIZES").matchAll(/\d+/g)].map((m) =>
      Number(m[0]),
    );
    expect(sizes).toEqual([...EDITOR_FONT_SIZES]);
  });

  it("builds View > Editor font with the stable id scheme", () => {
    const src = repoFile("../../../src-tauri/src/menu.rs");
    for (const needle of [
      'SubmenuBuilder::new(app, "Editor font")',
      'format!("view-editor-font-{family}")',
      'format!("view-editor-font-size-{size}")',
      ".item(&editor_font)",
    ]) {
      expect(src, `menu.rs must contain ${needle}`).toContain(needle);
    }
  });
});

// --- App.tsx routing ------------------------------------------------------------

describe("App.tsx Editor font routing (issue #51)", () => {
  it("routes the family and size menu ids through the per-app setter", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('id.startsWith("view-editor-font-size-")');
    expect(app).toContain('id.startsWith("view-editor-font-")');
    expect(app).toContain("changeEditorFont({ size })");
    expect(app).toContain("changeEditorFont({ family })");
    expect(app).toContain("saveEditorFont(next)");
    expect(app).toContain('dispatchEditorCommand("editorFont", next)');
  });
});

// --- full App menu-event e2e (Tauri mock) --------------------------------------

describe("App menu-event e2e (issue #51)", () => {
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

  function editorDom(): HTMLElement {
    const editor = currentFindEditor();
    if (!editor) throw new Error("no live editor");
    return editor.view.dom as HTMLElement;
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

  it("a family and size pick apply the CSS variables without touching the document", async () => {
    await renderApp();
    await openFile("styled.md", "Hello world\n");
    await waitFor(() => currentFindEditor() !== null, "live editor");
    const dom = editorDom();

    // The Editor's mount effect already applied the persisted (default)
    // setting, so the variables carry the app's current look.
    expect(dom.style.getPropertyValue("--quillmd-editor-font")).toBe("var(--font-text)");
    expect(dom.style.getPropertyValue("--quillmd-editor-font-size")).toBe("15px");
    await emitMenu("view-editor-font-monospace");
    expect(dom.style.getPropertyValue("--quillmd-editor-font")).toBe("var(--font-mono)");
    await emitMenu("view-editor-font-size-16");
    expect(dom.style.getPropertyValue("--quillmd-editor-font-size")).toBe("16px");

    // Cosmetic only: the document text is unchanged and persisted app-wide.
    expect(docMd()).toBe("Hello world\n");
    expect(JSON.parse(localStorage.getItem(KEY) ?? "")).toEqual({
      family: "monospace",
      size: 16,
    });
  });

  it("the persisted setting is re-applied when the editor remounts", async () => {
    await renderApp();
    await openFile("styled.md", "Hello world\n");
    await waitFor(() => currentFindEditor() !== null, "live editor");
    await emitMenu("view-editor-font-serif");
    expect(editorDom().style.getPropertyValue("--quillmd-editor-font")).toBe(
      EDITOR_FONT_FAMILY_CSS["serif"],
    );

    // Remount the whole app: the Editor's mount effect reads the persisted
    // setting and restores it on the fresh DOM.
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    await renderApp();
    await openFile("styled.md", "Hello world\n");
    await waitFor(() => currentFindEditor() !== null, "live editor");
    expect(editorDom().style.getPropertyValue("--quillmd-editor-font")).toBe(
      EDITOR_FONT_FAMILY_CSS["serif"],
    );
    expect(editorDom().style.getPropertyValue("--quillmd-editor-font-size")).toBe("15px");
  });

  it("an unknown family or size pick is a no-op", async () => {
    await renderApp();
    await openFile("styled.md", "Hello world\n");
    await waitFor(() => currentFindEditor() !== null, "live editor");
    const dom = editorDom();
    // The mount effect applied the persisted (default) setting.
    expect(dom.style.getPropertyValue("--quillmd-editor-font")).toBe("var(--font-text)");
    await emitMenu("view-editor-font-cursive");
    expect(dom.style.getPropertyValue("--quillmd-editor-font")).toBe("var(--font-text)");
    await emitMenu("view-editor-font-size-17");
    expect(dom.style.getPropertyValue("--quillmd-editor-font-size")).toBe("15px");
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
