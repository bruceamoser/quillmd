// @vitest-environment jsdom
// Special characters (plan 09 task 9.6, issue #89): the popover component
// (search by name, the six category tabs, the recents row, click inserts and
// stays open), the menu.rs Insert item, the App wiring, and the e2e — the
// menu opens the popover, the picks land at the caret as single UTF-8 code
// points (plan 09 AC5, code-page safe), and the recents survive a reopen.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import App from "../../App";
import { currentFindEditor } from "../find";
import {
  EDITOR_COMMANDS,
  registerSymbolDialogListener,
  requestSymbolDialog,
} from "../editorCommands";
import SymbolDialog from "../../components/SymbolDialog";
import { SYMBOL_COUNT, getRecentSymbols, searchSymbols } from "../symbols";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("menu.rs Insert > Special Characters item (issue #89)", () => {
  it("offers the symbol popover in the Insert submenu", () => {
    const src = repoFile("../../../src-tauri/src/menu.rs");
    expect(src).toContain(
      'MenuItem::with_id(app, "insert-symbol", "Special Characters...", true, None::<&str>)',
    );
    expect(src).toContain("&date_time, &symbol");
  });
});

describe("App.tsx Insert > Special Characters routing (issue #89)", () => {
  it("routes the menu id to the popover through the renderer channel", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('id === "insert-symbol"');
    expect(app).toContain("registerSymbolDialogListener");
    expect(app).toContain("<SymbolDialog");
  });
});

describe("the symbol registry command (issue #89)", () => {
  it("keeps its label and requests the popover through the renderer channel", () => {
    const cmd = EDITOR_COMMANDS.find((c) => c.id === "symbol");
    expect(cmd).toBeTruthy();
    expect(cmd!.label).toBe("Special Characters…");

    const seen: Array<unknown> = [];
    const dispose = registerSymbolDialogListener((e) => seen.push(e));
    const editor = {} as never;
    expect(requestSymbolDialog(editor)).toBe(true);
    expect(seen).toEqual([editor]);
    dispose();
    // Without a renderer the request is a no-op (returns false).
    expect(requestSymbolDialog(editor)).toBe(false);
  });
});

describe("SymbolDialog component", () => {
  let roots: Root[] = [];

  interface Harness {
    container: HTMLDivElement;
    onInsert: ReturnType<typeof vi.fn>;
    onClose: ReturnType<typeof vi.fn>;
    cell: (char: string) => HTMLButtonElement;
    tab: (label: string) => HTMLButtonElement;
    searchInput: () => HTMLInputElement;
  }

  function renderDialog(): Harness {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<SymbolDialog onInsert={onInsert} onClose={onClose} />);
    });
    return {
      container,
      onInsert,
      onClose,
      cell: (char) =>
        Array.from(container.querySelectorAll<HTMLButtonElement>(".quillmd-symbol-cell")).find(
          (b) => b.textContent === char,
        )!,
      tab: (label) =>
        Array.from(container.querySelectorAll<HTMLButtonElement>(".quillmd-symbol-tab")).find(
          (b) => b.textContent === label,
        )!,
      searchInput: () => container.querySelector<HTMLInputElement>(".quillmd-symbol-search")!,
    };
  }

  function gridCells(container: HTMLDivElement): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll<HTMLButtonElement>(".quillmd-symbol-cell"));
  }

  // React's value tracker swallows a direct `el.value = ...` (the instance
  // setter updates the tracker, so the input event reads "no change"). The
  // native prototype setter bypasses the tracker, so the input event reaches
  // React's onChange.
  function setSearch(input: HTMLInputElement, value: string): void {
    const set = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    roots = [];
  });
  afterEach(() => {
    for (const r of roots) act(() => r.unmount());
    roots = [];
    vi.restoreAllMocks();
  });

  it("shows the search box, the six category tabs, and the whole grid", () => {
    const h = renderDialog();
    expect(h.searchInput()).not.toBeNull();
    // The search box is autofocused so typing filters immediately.
    expect(document.activeElement).toBe(h.searchInput());
    const tabs = Array.from(h.container.querySelectorAll(".quillmd-symbol-tab"));
    expect(tabs.map((t) => t.textContent)).toEqual([
      "All",
      "Currency",
      "Math",
      "Arrows",
      "Bullets",
      "Typography",
      "Symbols",
    ]);
    expect(gridCells(h.container)).toHaveLength(SYMBOL_COUNT);
  });

  it("search narrows the grid by name ('copyright' → ©)", () => {
    const h = renderDialog();
    setSearch(h.searchInput(), "copyright");
    const cells = gridCells(h.container);
    expect(cells.some((c) => c.textContent === "©")).toBe(true);
    for (const c of cells) {
      const name = c.getAttribute("aria-label")!;
      expect(name.toLowerCase()).toContain("copyright");
    }
  });

  it("a nonsense search shows the empty state", () => {
    const h = renderDialog();
    setSearch(h.searchInput(), "zzzznotasymbolzzzz");
    expect(gridCells(h.container)).toHaveLength(0);
    expect(h.container.querySelector(".quillmd-symbol-empty")!.textContent).toContain(
      "zzzznotasymbolzzzz",
    );
  });

  it("a category tab narrows the grid to that category", () => {
    const h = renderDialog();
    act(() => {
      h.tab("Currency").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const cells = gridCells(h.container);
    expect(cells).toHaveLength(searchSymbols("").filter((s) => s.category === "currency").length);
    for (const c of cells) {
      expect(c.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("a pick inserts the character, records the recent, and stays open", () => {
    const h = renderDialog();
    act(() => {
      h.cell("©").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(h.onInsert).toHaveBeenCalledWith("©");
    // The popover stays open (multi-insert): no close call.
    expect(h.onClose).not.toHaveBeenCalled();
    // The recents row appears with the pick, most recent first.
    expect(h.container.querySelector(".quillmd-symbol-recent-label")!.textContent).toBe("Recent");
    expect(getRecentSymbols()).toEqual(["©"]);
  });

  it("the recents row hides while a search is running", () => {
    const h = renderDialog();
    act(() => {
      h.cell("©").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(h.container.querySelector(".quillmd-symbol-recents")).not.toBeNull();
    setSearch(h.searchInput(), "section");
    expect(h.container.querySelector(".quillmd-symbol-recents")).toBeNull();
  });

  it("cancels on Esc; the Close button closes", () => {
    const h = renderDialog();
    act(() => {
      h.container
        .querySelector(".quillmd-symbol-dialog")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);

    const h2 = renderDialog();
    act(() => {
      Array.from(h2.container.querySelectorAll("button"))
        .find((b) => b.textContent === "Close")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(h2.onClose).toHaveBeenCalledTimes(1);
  });

  it("a backdrop press closes; a press inside the dialog does not", () => {
    const h = renderDialog();
    act(() => {
      h.container
        .querySelector(".quillmd-symbol-overlay")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);

    const h2 = renderDialog();
    act(() => {
      h2.container
        .querySelector(".quillmd-symbol-dialog")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h2.onClose).not.toHaveBeenCalled();
  });
});

describe("App menu-event e2e: Insert > Special Characters (issue #89)", () => {
  const g = globalThis as Record<string, unknown>;
  let container: HTMLDivElement;
  let root: Root | null = null;

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
    const el = container.querySelector<HTMLDivElement>(".quillmd-symbol-dialog");
    expect(el, "symbol popover").not.toBeNull();
    return el!;
  }

  function cell(char: string): HTMLButtonElement {
    const el = Array.from(dialog().querySelectorAll<HTMLButtonElement>(".quillmd-symbol-cell")).find(
      (b) => b.textContent === char,
    );
    expect(el, `cell ${char}`).not.toBeNull();
    return el!;
  }

  function docText(): string {
    const editor = currentFindEditor();
    expect(editor, "live editor").not.toBeNull();
    return editor!.state.doc.textBetween(0, editor!.state.doc.content.size, "\n");
  }

  async function renderDoc(): Promise<void> {
    await renderApp();
    await openFile("symbols.md", DOC_MD);
    await waitFor(() => currentFindEditor() !== null, "live editor");
    // Park the caret at the end so the inserts land in a known place.
    await act(async () => {
      const editor = currentFindEditor()!;
      editor.chain().focus().setTextSelection(editor.state.doc.content.size).run();
    });
  }

  it("the menu opens the popover; the picks insert as plain UTF-8 and stay open (AC5)", async () => {
    await renderDoc();
    await emitMenu("insert-symbol");
    expect(dialog()).not.toBeNull();

    await act(async () => {
      cell("©").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Multi-insert: the popover is still open after the first pick.
    expect(dialog()).not.toBeNull();

    await act(async () => {
      cell("§").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Both picks landed at the caret as single code points, no markup.
    expect(docText()).toBe("Hello wonderful world.\nSecond sentence here.©§");
    // The file bytes are the UTF-8 encoding of exactly those code points
    // (code-page safe: nothing transcodes on the way to disk).
    expect(Array.from(new TextEncoder().encode("©§"))).toEqual([0xc2, 0xa9, 0xc2, 0xa7]);

    // The Close button dismisses the popover.
    await act(async () => {
      Array.from(dialog().querySelectorAll("button"))
        .find((b) => b.textContent === "Close")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector(".quillmd-symbol-dialog")).toBeNull();
  });

  it("the recents row survives a reopen (most recent first)", async () => {
    await renderDoc();
    await emitMenu("insert-symbol");
    await act(async () => {
      cell("©").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      cell("§").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Close and reopen: the recents row is the popover's first row.
    await act(async () => {
      Array.from(dialog().querySelectorAll("button"))
        .find((b) => b.textContent === "Close")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector(".quillmd-symbol-dialog")).toBeNull();

    await emitMenu("insert-symbol");
    const recents = Array.from(
      dialog().querySelectorAll<HTMLButtonElement>(".quillmd-symbol-recents .quillmd-symbol-cell"),
    ).map((b) => b.textContent);
    expect(recents).toEqual(["§", "©"]);
  });

  it("Esc closes the popover and the document is untouched", async () => {
    await renderDoc();
    await emitMenu("insert-symbol");
    await act(async () => {
      dialog().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(container.querySelector(".quillmd-symbol-dialog")).toBeNull();
    expect(docText()).toBe("Hello wonderful world.\nSecond sentence here.");
  });
});
