// @vitest-environment jsdom
// Format > Styles submenu + toolbar button (plan 05 task 5.2, issue #55):
// the menu/toolbar wiring over the built-in style registry (styles.ts). The
// native menu carries no parameters, so every built-in style is its own menu
// id (built in src-tauri/src/menu.rs from the same registry rows); App.tsx
// resolves the ids through styleMenuCommand in styles.ts and dispatches the
// style's registry command — the identical path the toolbar's StyleGallery
// applies. This suite covers the id -> (command, with) resolution, the
// Rust/TS list sync, the App.tsx routing, the menu-vs-gallery dispatch
// parity (every style writes the same document either way), the toolbar
// mounting the gallery, and a full-App menu-event e2e asserting the menu
// path reaches the live editor.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import App from "../../App";
import Toolbar from "../../components/Toolbar";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { dispatchEditorCommand, registerEditorCommandListener, runEditorCommand } from "../editorCommands";
import { currentFindEditor } from "../find";
import {
  BUILT_IN_STYLES,
  STYLE_MENU_ID_PREFIX,
  applyStyle,
  styleById,
  styleMenuCommand,
} from "../styles";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- helpers ----------------------------------------------------------------

function makeEditor(markdown = "Hello world"): Editor {
  return new Editor({
    // Same extensions as the styles registry suite (styles.test.tsx).
    extensions: [StarterKit, Underline, TaskList, TaskItem.configure({ nested: true })],
    content: markdownToTiptap(markdown),
  });
}

// Put the cursor right after the first occurrence of `text` so block styles
// act on a deterministic position.
function cursorAfter(editor: Editor, text: string): void {
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    editor.chain().setTextSelection(pos + idx + text.length).run();
    return false;
  });
}

// Select the first occurrence of `text` so mark styles act deterministically.
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

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

// The (id, label) pairs of the `pub const STYLES: &[(&str, &str)]` literal in
// menu.rs — the list the Format > Styles submenu is built from.
function rustStyleList(): Array<[string, string]> {
  const src = repoFile("../../../src-tauri/src/menu.rs");
  const start = src.indexOf("pub const STYLES: ");
  expect(start, "menu.rs must define STYLES").toBeGreaterThan(-1);
  const assign = src.indexOf("= &[", start);
  const open = src.indexOf("[", assign);
  const close = src.indexOf("];", open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return [...src.slice(open, close).matchAll(/\("([^"]*)",\s*"([^"]*)"\)/g)].map(
    (m) => [m[1], m[2]] as [string, string],
  );
}

// --- styleMenuCommand: id -> (registry command, with) ------------------------

describe("styleMenuCommand (issue #55)", () => {
  it("maps every built-in style id to its registry command and `with` follow-up", () => {
    for (const style of BUILT_IN_STYLES) {
      expect(styleMenuCommand(`${STYLE_MENU_ID_PREFIX}${style.id}`), style.id).toEqual({
        command: style.command,
        param: style.param,
        with: style.with,
      });
    }
  });

  it("spells out the headline picks (Normal, Heading 2, Intense Quote)", () => {
    expect(styleMenuCommand("format-style-normal")).toEqual({
      command: "paragraph",
      param: undefined,
      with: undefined,
    });
    expect(styleMenuCommand("format-style-heading2")).toEqual({
      command: "h2",
      param: undefined,
      with: undefined,
    });
    expect(styleMenuCommand("format-style-intense-quote")).toEqual({
      command: "blockquote",
      param: undefined,
      with: "bold",
    });
  });

  it("returns null for unknown style ids and for ids off the submenu", () => {
    expect(styleMenuCommand("format-style-nope")).toBeNull();
    // Off-list / malformed ids.
    expect(styleMenuCommand("format-style-")).toBeNull();
    // Other menu ids are routed elsewhere (MENU_TO_COMMAND / font submenu).
    for (const id of [
      "format-bold",
      "format-font-family-georgia",
      "insert-h1",
      "styles",
      "",
    ]) {
      expect(styleMenuCommand(id), id).toBeNull();
    }
  });
});

// --- menu.rs list sync + submenu structure -----------------------------------

describe("menu.rs Styles submenu (issue #55)", () => {
  it("mirrors the frontend built-in style set (menu offers the same styles)", () => {
    expect(rustStyleList()).toEqual(
      BUILT_IN_STYLES.map((style) => [style.id, style.label] as [string, string]),
    );
  });

  it("builds Format > Styles with the stable item ids", () => {
    const src = repoFile("../../../src-tauri/src/menu.rs");
    for (const needle of [
      'SubmenuBuilder::new(app, "Styles")',
      'format!("format-style-{id}")',
      ".item(&styles)",
    ]) {
      expect(src, `menu.rs must contain ${needle}`).toContain(needle);
    }
  });
});

// --- App.tsx routing -----------------------------------------------------------

describe("App.tsx Styles submenu routing (issue #55)", () => {
  it("routes every Styles submenu id through the shared registry", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain("styleMenuCommand");
    expect(app).toContain('id.startsWith("format-style-")');
    expect(app).toContain("dispatchEditorCommand(action.command, action.param)");
    expect(app).toContain("if (action.with) dispatchEditorCommand(action.with)");
  });
});

// --- menu path vs gallery path document text ---------------------------------

describe("Styles submenu dispatch parity (issue #55)", () => {
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

  function positionFor(styleId: string, editor: Editor): void {
    const style = styleById(styleId)!;
    // The Intense Quote follow-up (bold) is a mark command: it needs an
    // actual text run to act on, so select the sample word even though the
    // primary command (blockquote) is a block command.
    if (style.kind === "mark" || style.with) {
      selectText(editor, "Hello");
    } else {
      cursorAfter(editor, "Hello");
    }
  }

  // The menu path: App.tsx resolves the id with styleMenuCommand and dispatches
  // through the listener the app's Editor registers on mount (primary command,
  // then the `with` follow-up when the style has one).
  function menuPath(styleId: string): string {
    const editor = trackedEditor();
    positionFor(styleId, editor);
    const action = styleMenuCommand(`${STYLE_MENU_ID_PREFIX}${styleId}`);
    expect(action, `no action for ${styleId}`).not.toBeNull();
    const off = registerEditorCommandListener((cid, param) => runEditorCommand(editor, cid, param));
    try {
      expect(dispatchEditorCommand(action!.command, action!.param)).toBe(true);
      if (action!.with) expect(dispatchEditorCommand(action!.with)).toBe(true);
    } finally {
      off();
    }
    return md(editor);
  }

  // The toolbar path: the style gallery's direct applyStyle call (StyleGallery).
  function galleryPath(styleId: string): string {
    const editor = trackedEditor();
    positionFor(styleId, editor);
    applyStyle(editor, styleById(styleId)!);
    return md(editor);
  }

  it("every style menu id dispatches the same commands the gallery does", () => {
    for (const style of BUILT_IN_STYLES) {
      expect(menuPath(style.id), `menu path ${style.id}`).toBe(galleryPath(style.id));
    }
  });

  it("the menu path writes the markdown the style mapping documents", () => {
    expect(menuPath("heading2")).toBe("## Hello world\n");
    expect(menuPath("title")).toBe("# Hello world\n");
    expect(menuPath("quote")).toBe("> Hello world\n");
    expect(menuPath("intense-quote")).toBe("> **Hello** world\n");
    expect(menuPath("list-paragraph")).toBe("- Hello world\n");
    expect(menuPath("source-code")).toBe("```\nHello world\n```\n");
    expect(menuPath("strong")).toBe("**Hello** world\n");
    expect(menuPath("emphasis")).toBe("*Hello* world\n");
    expect(menuPath("code")).toBe("`Hello` world\n");
  });

  it("Normal and No Spacing leave a plain paragraph untouched", () => {
    expect(menuPath("normal")).toBe("Hello world\n");
    expect(menuPath("no-spacing")).toBe("Hello world\n");
  });

  it("an unknown style id resolves to null (App.tsx dispatches nothing)", () => {
    const editor = trackedEditor();
    cursorAfter(editor, "Hello");
    expect(styleMenuCommand("format-style-nope")).toBeNull();
    // App.tsx's branch is a no-op when the resolver returns null, so the
    // document stays exactly as the registry never touched it.
    expect(md(editor)).toBe("Hello world\n");
  });
});

// --- the toolbar mounts the gallery -------------------------------------------

describe("toolbar style gallery button (issue #55)", () => {
  let editors: Editor[] = [];
  let roots: Root[] = [];

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    for (const root of roots) root.unmount();
    roots = [];
    for (const e of editors) e.destroy();
    editors = [];
  });

  function renderToolbar(e: Editor): HTMLDivElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<Toolbar editor={e} />);
    });
    return container;
  }

  const trackedEditor = (markdown?: string): Editor => {
    const editor = makeEditor(markdown);
    editors.push(editor);
    return editor;
  };

  function click(element: HTMLElement): void {
    act(() => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  }

  it("renders the Styles trigger as the first toolbar control, before the heading select", () => {
    const container = renderToolbar(trackedEditor());
    const trigger = container.querySelector<HTMLButtonElement>('button[title="Styles"]');
    expect(trigger).not.toBeNull();
    // The gallery sits at the head of the toolbar (Word convention): it
    // precedes the paragraph/heading select.
    const controls = Array.from(
      container.querySelectorAll<HTMLElement>("select, button"),
    ).map((el) => el.getAttribute("title"));
    expect(controls[0]).toBe("Styles");
    expect(controls[1]).toBe("Paragraph / heading level");
  });

  it("a swatch pick from the toolbar gallery applies the style through the registry", () => {
    const e = trackedEditor();
    cursorAfter(e, "Hello");
    const container = renderToolbar(e);
    click(container.querySelector<HTMLButtonElement>('button[title="Styles"]')!);
    const grid = container.querySelector(".quillmd-style-grid");
    expect(grid).not.toBeNull();
    click(grid!.querySelector<HTMLButtonElement>('button[data-style-id="heading2"]')!);
    expect(md(e)).toBe("## Hello world\n");
    expect(container.querySelector(".quillmd-styles-popover")).toBeNull();
  });

  it("a mark style from the toolbar gallery's More list applies to the selected run", () => {
    const e = trackedEditor();
    selectText(e, "Hello");
    const container = renderToolbar(e);
    click(container.querySelector<HTMLButtonElement>('button[title="Styles"]')!);
    click(container.querySelector<HTMLButtonElement>(".quillmd-style-more")!);
    click(
      container.querySelector<HTMLButtonElement>(
        '.quillmd-style-group > button[data-style-id="strong"]',
      )!,
    );
    expect(md(e)).toBe("**Hello** world\n");
  });
});

// --- full App menu-event e2e (Tauri mock) --------------------------------------

describe("App menu-event e2e (issue #55)", () => {
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

  function cursorAfterCurrentText(text: string): void {
    const editor = currentFindEditor();
    if (!editor) throw new Error("no live editor");
    let found = false;
    editor.state.doc.descendants((node, pos) => {
      if (found || !node.isText) return true;
      const idx = node.text!.indexOf(text);
      if (idx === -1) return true;
      found = true;
      editor.chain().setTextSelection(pos + idx + text.length).run();
      return false;
    });
    expect(found, `text ${text} not found in doc`).toBe(true);
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

  async function renderDoc(markdown = "Hello world\n"): Promise<void> {
    await renderApp();
    await openFile("styled.md", markdown);
    await waitFor(() => currentFindEditor() !== null, "live editor");
  }

  it("a Heading 2 menu pick sets H2 on the live editor (AC: menu -> registry command h2)", async () => {
    await renderDoc();
    cursorAfterCurrentText("Hello");
    await emitMenu("format-style-heading2");
    expect(docMd()).toBe("## Hello world\n");
  });

  it("block style picks apply through the live editor", async () => {
    await renderDoc();
    cursorAfterCurrentText("Hello");
    await emitMenu("format-style-quote");
    expect(docMd()).toBe("> Hello world\n");

    cursorAfterCurrentText("Hello");
    await emitMenu("format-style-list-paragraph");
    expect(docMd()).toBe("> - Hello world\n");
  });

  it("Intense Quote quotes the block and bolds the selection", async () => {
    await renderDoc();
    selectCurrentText("Hello");
    await emitMenu("format-style-intense-quote");
    expect(docMd()).toBe("> **Hello** world\n");
  });

  it("a mark style pick applies to the selected run", async () => {
    await renderDoc();
    selectCurrentText("Hello");
    await emitMenu("format-style-strong");
    expect(docMd()).toBe("**Hello** world\n");
  });

  it("Normal on a heading reverts it to a paragraph (registry toggle semantics)", async () => {
    await renderDoc("## Titled\n");
    cursorAfterCurrentText("Titled");
    await emitMenu("format-style-normal");
    expect(docMd()).toBe("Titled\n");
  });

  it("an unknown style id is a no-op", async () => {
    await renderDoc();
    cursorAfterCurrentText("Hello");
    await emitMenu("format-style-nope");
    expect(docMd()).toBe("Hello world\n");
  });
});
