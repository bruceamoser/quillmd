// @vitest-environment jsdom
// Format > Font submenu (plan 04 task 4.4, issue #50): the menu wiring for
// family/size/color/highlight/underline/clear. The native menu carries no
// parameters, so every family, size, and swatch is its own menu id (built in
// src-tauri/src/menu.rs); App.tsx resolves the ids through fontMenuCommand in
// editorCommands.ts and dispatches the identical registry commands the
// toolbar font cluster uses. This suite covers the slug contract, the
// id -> (command, param) resolution, the Rust/TS list sync, the App.tsx
// routing, and a full-App menu-event e2e asserting the menu path produces
// the same document text as the toolbar path (plan 04 AC6).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import App from "../../App";
import {
  FontColorMark,
  FontFamilyMark,
  FontSizeMark,
  QuillHighlight,
} from "../../components/Editor";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { COLOR_PALETTE } from "../colors";
import {
  FONT_FAMILIES,
  FONT_SIZES,
  dispatchEditorCommand,
  fontMenuCommand,
  fontFamilySlug,
  registerEditorCommandListener,
  runEditorCommand,
  type EditorCommandId,
  type EditorCommandParam,
} from "../editorCommands";
import { currentFindEditor } from "../find";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- helpers ----------------------------------------------------------------

function makeEditor(markdown = "Hello world"): Editor {
  return new Editor({
    // The same inline-mark extensions the app editor (Editor.tsx) registers
    // for this feature: the font marks, the colored highlight, underline.
    extensions: [StarterKit, Underline, FontFamilyMark, FontSizeMark, FontColorMark, QuillHighlight],
    content: markdownToTiptap(markdown),
  });
}

// Select the first occurrence of `text` so the commands act deterministically.
function selectText(editor: Editor, text: string): void {
  let found = false;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    found = true;
    editor.chain().setTextSelection({ from: pos + idx, to: pos + idx + text.length }).run();
    return false;
  });
  expect(found).toBe(true);
}

function md(editor: Editor): string {
  return tiptapToMarkdown(editor.getJSON());
}

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

// The body of a `pub const <name>: &[...]` literal in menu.rs.
function rustArrayLiteral(name: string): string {
  const src = repoFile("../../../src-tauri/src/menu.rs");
  const start = src.indexOf(`pub const ${name}: `);
  expect(start, `menu.rs must define ${name}`).toBeGreaterThan(-1);
  // Anchor on the `= &[` assignment: the type annotation (e.g. &[u8]) also
  // contains brackets.
  const assign = src.indexOf("= &[", start);
  const open = src.indexOf("[", assign);
  const close = src.indexOf("];", open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return src.slice(open, close);
}

// Every Font submenu id the menu can emit (Normal picks + the curated lists
// + underline + clear), derived from the same constants the menu is built
// from in menu.rs.
const ALL_MENU_IDS: string[] = [
  "format-font-family-normal",
  ...FONT_FAMILIES.map((f) => `format-font-family-${fontFamilySlug(f)}`),
  "format-font-size-normal",
  ...FONT_SIZES.map((n) => `format-font-size-${n}`),
  "format-font-color-auto",
  ...COLOR_PALETTE.map((c) => `format-font-color-${c.slice(1)}`),
  "format-highlight-color-auto",
  ...COLOR_PALETTE.map((c) => `format-highlight-color-${c.slice(1)}`),
  "format-font-underline",
  "format-font-clear",
];

// --- fontFamilySlug (must stay byte-identical to Rust family_slug) ----------

describe("fontFamilySlug (issue #50)", () => {
  it("lowercases and collapses non-alphanumerics (the Rust family_slug contract)", () => {
    expect(fontFamilySlug("Comic Sans MS")).toBe("comic-sans-ms");
    expect(fontFamilySlug("Arial Black")).toBe("arial-black");
    expect(fontFamilySlug("Brush Script MT")).toBe("brush-script-mt");
    expect(fontFamilySlug("Georgia")).toBe("georgia");
  });

  it("gives every curated family a unique nonempty slug", () => {
    const seen = new Set<string>();
    for (const family of FONT_FAMILIES) {
      const slug = fontFamilySlug(family);
      expect(slug.length, `empty slug for ${family}`).toBeGreaterThan(0);
      expect(seen.has(slug), `duplicate slug ${slug}`).toBe(false);
      seen.add(slug);
    }
  });
});

// --- fontMenuCommand: id -> (registry command, param) ------------------------

describe("fontMenuCommand (issue #50)", () => {
  it("maps the Normal picks to a null param (clear back to the document default)", () => {
    expect(fontMenuCommand("format-font-family-normal")).toEqual({
      command: "fontFamily",
      param: null,
    });
    expect(fontMenuCommand("format-font-size-normal")).toEqual({
      command: "fontSize",
      param: null,
    });
    expect(fontMenuCommand("format-font-color-auto")).toEqual({
      command: "fontColor",
      param: null,
    });
    expect(fontMenuCommand("format-highlight-color-auto")).toEqual({
      command: "highlightColor",
      param: null,
    });
  });

  it("maps every curated family to its name via the slug", () => {
    for (const family of FONT_FAMILIES) {
      expect(fontMenuCommand(`format-font-family-${fontFamilySlug(family)}`), family).toEqual({
        command: "fontFamily",
        param: family,
      });
    }
  });

  it("maps every Word size to its point count", () => {
    for (const size of FONT_SIZES) {
      expect(fontMenuCommand(`format-font-size-${size}`), String(size)).toEqual({
        command: "fontSize",
        param: size,
      });
    }
  });

  it("maps every palette swatch to its #hex for font and highlight", () => {
    for (const color of COLOR_PALETTE) {
      expect(fontMenuCommand(`format-font-color-${color.slice(1)}`), color).toEqual({
        command: "fontColor",
        param: color,
      });
      expect(fontMenuCommand(`format-highlight-color-${color.slice(1)}`), color).toEqual({
        command: "highlightColor",
        param: color,
      });
    }
  });

  it("maps underline and clear to the shared registry commands", () => {
    expect(fontMenuCommand("format-font-underline")).toEqual({
      command: "underline",
      param: null,
    });
    expect(fontMenuCommand("format-font-clear")).toEqual({
      command: "clearFormatting",
      param: null,
    });
  });

  it("returns null for ids that are not Font submenu picks", () => {
    // "Custom…" is owned by the dispatching surface (the prompt), not the map.
    expect(fontMenuCommand("format-font-family-custom")).toBeNull();
    // Off-list / malformed ids.
    for (const id of [
      "format-font-family-nope",
      "format-font-size-abc",
      "format-font-size-0",
      "format-font-color-12345",
      "format-highlight-color-1234567",
    ]) {
      expect(fontMenuCommand(id), id).toBeNull();
    }
    // Other menu ids are routed elsewhere (MENU_TO_COMMAND / file ops).
    for (const id of ["format-underline", "format-clear", "edit-undo", ""]) {
      expect(fontMenuCommand(id), id).toBeNull();
    }
  });
});

// --- menu.rs list sync + submenu structure -----------------------------------

describe("menu.rs Font submenu (issue #50)", () => {
  it("mirrors the frontend family/size/color lists (menu offers the same picks)", () => {
    const families = [...rustArrayLiteral("FONT_FAMILIES").matchAll(/"([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(families).toEqual([...FONT_FAMILIES]);

    const sizes = [...rustArrayLiteral("FONT_SIZES").matchAll(/\d+/g)].map((m) => Number(m[0]));
    expect(sizes).toEqual([...FONT_SIZES]);

    const colors = [...rustArrayLiteral("FONT_COLORS").matchAll(/"([0-9a-f]{6})"/g)].map(
      (m) => m[1],
    );
    expect(colors).toEqual(COLOR_PALETTE.map((c) => c.slice(1)));
  });

  it("builds Format > Font with the stable item ids", () => {
    const src = repoFile("../../../src-tauri/src/menu.rs");
    for (const needle of [
      'SubmenuBuilder::new(app, "Font")',
      'SubmenuBuilder::new(app, "Font family")',
      'SubmenuBuilder::new(app, "Font size")',
      'SubmenuBuilder::new(app, "Font color")',
      'SubmenuBuilder::new(app, "Highlight color")',
      '"format-font-family-normal"',
      '"format-font-family-custom"',
      '"format-font-size-normal"',
      '"format-font-color-auto"',
      '"format-highlight-color-auto"',
      '"format-font-underline"',
      '"format-font-clear"',
      ".item(&font)",
    ]) {
      expect(src, `menu.rs must contain ${needle}`).toContain(needle);
    }
    // The submenu Underline carries no accelerator: Ctrl+U stays on the
    // top-level format-underline item (plan 04 task 4.4).
    expect(src).toContain(
      'MenuItem::with_id(app, "format-font-underline", "Underline", true, None::<&str>)',
    );
    expect(src).toContain(
      'MenuItem::with_id(app, "format-underline", "Underline", true, Some("Ctrl+U"))',
    );
  });
});

// --- App.tsx routing -----------------------------------------------------------

describe("App.tsx Font submenu routing (issue #50)", () => {
  it("routes every Font submenu id through the shared registry", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain("fontMenuCommand");
    expect(app).toContain('id.startsWith("format-font-")');
    expect(app).toContain('id.startsWith("format-highlight-color-")');
    expect(app).toContain("dispatchEditorCommand(action.command, action.param)");
  });

  it("owns the Custom… prompt and dispatches the same fontFamily command", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('id === "format-font-family-custom"');
    expect(app).toContain('window.prompt("Custom font family")');
    expect(app).toContain('dispatchEditorCommand("fontFamily", name)');
  });
});

// --- menu path vs toolbar path document text (plan 04 AC6) ---------------------

describe("Font submenu dispatch parity (issue #50, plan 04 AC6)", () => {
  let editors: Editor[] = [];

  afterEach(() => {
    for (const e of editors) e.destroy();
    editors = [];
  });

  const trackedEditor = (markdown?: string): Editor => {
    const editor = makeEditor(markdown);
    editors.push(editor);
    return editor;
  };

  // The menu path: App.tsx resolves the id with fontMenuCommand and dispatches
  // through the listener the app's Editor registers on mount.
  function menuPath(id: string, markdown?: string): string {
    const editor = trackedEditor(markdown);
    selectText(editor, "Hello");
    const action = fontMenuCommand(id);
    expect(action, `no action for ${id}`).not.toBeNull();
    const off = registerEditorCommandListener((cid, param) => runEditorCommand(editor, cid, param));
    try {
      expect(dispatchEditorCommand(action!.command, action!.param)).toBe(true);
    } finally {
      off();
    }
    return md(editor);
  }

  // The toolbar path: the direct registry call Toolbar.tsx makes.
  function toolbarPath(command: EditorCommandId, param: EditorCommandParam | undefined): string {
    const editor = trackedEditor();
    selectText(editor, "Hello");
    expect(runEditorCommand(editor, command, param)).toBe(true);
    return md(editor);
  }

  it("every menu id dispatches the same registry command the toolbar does", () => {
    for (const id of ALL_MENU_IDS) {
      const action = fontMenuCommand(id);
      expect(action, `no action for ${id}`).not.toBeNull();
      // The menu path (listener dispatch) and the toolbar path (direct
      // registry call) must land on identical document text.
      expect(menuPath(id), `menu path ${id}`).toBe(toolbarPath(action!.command, action!.param));
    }
  });

  it("the menu path writes the exact span the toolbar pick produces", () => {
    expect(menuPath("format-font-family-georgia")).toBe(
      toolbarPath("fontFamily", "Georgia"),
    );
    expect(menuPath("format-font-family-georgia")).toBe(
      `<span class="quillmd-font" style="font-family: Georgia">Hello</span> world\n`,
    );
    expect(menuPath("format-font-size-14")).toBe(
      `<span class="quillmd-font" style="font-size: 14pt">Hello</span> world\n`,
    );
    expect(menuPath("format-font-color-c00000")).toBe(
      `<span class="quillmd-font" style="color: #c00000">Hello</span> world\n`,
    );
    expect(menuPath("format-highlight-color-ffc000")).toBe(
      `<span class="quillmd-highlight" style="background-color: #ffc000">Hello</span> world\n`,
    );
    expect(menuPath("format-font-underline")).toBe("<u>Hello</u> world\n");
  });

  it("Normal and auto picks clear the attribute back to the document default", () => {
    for (const id of [
      "format-font-family-normal",
      "format-font-size-normal",
      "format-font-color-auto",
      "format-highlight-color-auto",
    ]) {
      expect(menuPath(id), id).toBe("Hello world\n");
    }
  });

  it("Clear Formatting strips the font marks the menu applies", () => {
    const editor = trackedEditor();
    selectText(editor, "Hello");
    const off = registerEditorCommandListener((cid, param) => runEditorCommand(editor, cid, param));
    try {
      dispatchEditorCommand("fontFamily", "Georgia");
      dispatchEditorCommand("fontSize", 14);
      dispatchEditorCommand("fontColor", "#c00000");
      expect(md(editor)).toBe(
        `<span class="quillmd-font" style="font-family: Georgia; font-size: 14pt; color: #c00000">Hello</span> world\n`,
      );
      // The menu's Clear Formatting pick (format-font-clear -> clearFormatting).
      const action = fontMenuCommand("format-font-clear");
      expect(action).toEqual({ command: "clearFormatting", param: null });
      expect(dispatchEditorCommand(action!.command, action!.param)).toBe(true);
    } finally {
      off();
    }
    expect(md(editor)).toBe("Hello world\n");
  });
});

// --- full App menu-event e2e (Tauri mock) --------------------------------------

describe("App menu-event e2e (issue #50)", () => {
  const g = globalThis as Record<string, unknown>;
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    localStorage.clear();
    g.isTauri = true;
    // The Tauri-side commands the App touches under Tauri on mount; the event
    // plugin is mocked so emit("menu-event", ...) reaches App's listener.
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

  // Opens a file through the app's hidden <input type="file"> (the same path
  // the browser-dev "Open" uses; works in jsdom under the Tauri mock).
  async function openFile(name: string, content: string): Promise<void> {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("file input not found");
    const file = new File([content], name, { type: "text/markdown" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  // Polls (inside act, so async state updates flush) until cond() is true.
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

  function selectCurrentText(text: string): void {
    const editor = currentFindEditor();
    if (!editor) throw new Error("no live editor");
    let found = false;
    editor.state.doc.descendants((node, pos) => {
      if (found || !node.isText) return true;
      const idx = node.text!.indexOf(text);
      if (idx === -1) return true;
      found = true;
      editor.chain().setTextSelection({ from: pos + idx, to: pos + idx + text.length }).run();
      return false;
    });
    expect(found, `text ${text} not found in doc`).toBe(true);
  }

  async function emitMenu(id: string): Promise<void> {
    await act(async () => {
      await emit("menu-event", id);
    });
  }

  async function renderDoc(): Promise<void> {
    await renderApp();
    await openFile("styled.md", "Hello world\n");
    await waitFor(() => currentFindEditor() !== null, "live editor");
  }

  it("a family menu pick writes the same span the toolbar pick does (AC6)", async () => {
    await renderDoc();
    selectCurrentText("Hello");
    await emitMenu("format-font-family-georgia");
    expect(docMd()).toBe(
      `<span class="quillmd-font" style="font-family: Georgia">Hello</span> world\n`,
    );
    // Normal clears it back to the document default.
    await emitMenu("format-font-family-normal");
    expect(docMd()).toBe("Hello world\n");
  });

  it("size and font-color picks compose in the fixed attribute order (AC6)", async () => {
    await renderDoc();
    selectCurrentText("Hello");
    await emitMenu("format-font-color-c00000");
    await emitMenu("format-font-size-14");
    await emitMenu("format-font-family-georgia");
    // The same composed span the toolbar cluster produces (fonttoolbar.test.tsx).
    expect(docMd()).toBe(
      `<span class="quillmd-font" style="font-family: Georgia; font-size: 14pt; color: #c00000">Hello</span> world\n`,
    );
    // Font color Auto clears just the color attribute.
    await emitMenu("format-font-color-auto");
    expect(docMd()).toBe(
      `<span class="quillmd-font" style="font-family: Georgia; font-size: 14pt">Hello</span> world\n`,
    );
  });

  it("a highlight-color pick applies a colored highlight span (AC6)", async () => {
    await renderDoc();
    selectCurrentText("world");
    await emitMenu("format-highlight-color-ffc000");
    expect(docMd()).toBe(
      `Hello <span class="quillmd-highlight" style="background-color: #ffc000">world</span>\n`,
    );
    // Highlight Auto removes the highlight entirely.
    await emitMenu("format-highlight-color-auto");
    expect(docMd()).toBe("Hello world\n");
  });

  it("the submenu underline and clear picks dispatch through the registry (AC6)", async () => {
    await renderDoc();
    selectCurrentText("Hello");
    await emitMenu("format-font-underline");
    expect(docMd()).toBe("<u>Hello</u> world\n");

    selectCurrentText("Hello");
    await emitMenu("format-font-family-comic-sans-ms");
    expect(docMd()).toBe(
      `<span class="quillmd-font" style="font-family: Comic Sans MS"><u>Hello</u></span> world\n`,
    );
    // Clear Formatting strips the marks (the submenu pick runs the same
    // clearFormatting command the top-level format-clear item runs).
    selectCurrentText("Hello");
    await emitMenu("format-font-clear");
    expect(docMd()).toBe("Hello world\n");
  });

  it("Custom… prompts for a free-text family and applies it (AC6)", async () => {
    await renderDoc();
    selectCurrentText("Hello");
    const prompt = vi.spyOn(window, "prompt").mockImplementation(() => "Papyrus");
    await emitMenu("format-font-family-custom");
    expect(prompt).toHaveBeenCalledWith("Custom font family");
    expect(docMd()).toBe(
      `<span class="quillmd-font" style="font-family: Papyrus">Hello</span> world\n`,
    );

    // A dismissed prompt leaves the document untouched.
    selectCurrentText("world");
    prompt.mockImplementation(() => null);
    await emitMenu("format-font-family-custom");
    expect(docMd()).toBe(
      `<span class="quillmd-font" style="font-family: Papyrus">Hello</span> world\n`,
    );
  });

  it("an unknown font-menu id is a no-op", async () => {
    await renderDoc();
    selectCurrentText("Hello");
    await emitMenu("format-font-family-nope");
    expect(docMd()).toBe("Hello world\n");
  });
});
