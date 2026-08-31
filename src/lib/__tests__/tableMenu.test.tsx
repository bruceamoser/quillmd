// @vitest-environment jsdom
// Insert > Table menu wiring (plan 06 task 6.3, issue #63): the native menu
// item dispatches the tableDialog command (a native menu cannot anchor the
// hover size-picker popover, which the toolbar carries), the app shell opens
// the "Insert table…" dialog, and the dialog's pick inserts the exact size
// through the shared tableInsert command — so the menu path and the toolbar
// path write the identical GFM (plan 06 AC1: a 7x2 with header generates
// valid GFM with a header row in the saved file).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import App from "../../App";
import { currentFindEditor } from "../find";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("menu.rs Insert > Table item (issue #63)", () => {
  it("keeps the stable insert-table id and offers the dialog", () => {
    const src = repoFile("../../../src-tauri/src/menu.rs");
    expect(src).toContain(
      'MenuItem::with_id(app, "insert-table", "Insert Table...", true, None::<&str>)',
    );
  });
});

describe("App.tsx Insert > Table routing (issue #63)", () => {
  it("routes the menu id to the tableDialog command", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('"insert-table": "tableDialog"');
    expect(app).toContain("registerTableDialogListener");
    // The dialog's pick applies through the shared tableInsert command.
    expect(app).toContain('runEditorCommand(tableDialog.editor, "tableInsert", spec)');
  });
});

describe("App menu-event e2e: Insert > Table (issue #63)", () => {
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

  function dialog(): HTMLDivElement {
    const el = container.querySelector<HTMLDivElement>(".quillmd-table-dialog");
    expect(el, "insert table dialog").not.toBeNull();
    return el!;
  }

  function dialogField(label: "Rows" | "Columns"): HTMLInputElement {
    const dialogEl = dialog();
    const labelEl = Array.from(dialogEl.querySelectorAll(".quillmd-image-label")).find(
      (l) => l.textContent === label,
    );
    const input = labelEl?.parentElement?.querySelector<HTMLInputElement>("input");
    expect(input, `${label} field`).not.toBeNull();
    return input!;
  }

  function setNumber(el: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function emitMenu(id: string): Promise<void> {
    await act(async () => {
      await emit("menu-event", id);
    });
  }

  async function renderDoc(): Promise<void> {
    await renderApp();
    await openFile("tables.md", "Hello world\n");
    await waitFor(() => currentFindEditor() !== null, "live editor");
  }

  it("Insert > Table opens the dialog on the 3x3 header default", async () => {
    await renderDoc();
    await emitMenu("insert-table");
    expect(dialog()).not.toBeNull();
    expect(dialogField("Rows").value).toBe("3");
    expect(dialogField("Columns").value).toBe("3");
    const header = dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(header.checked).toBe(true);
    // Nothing is inserted until the dialog applies.
    expect(docMd()).toBe("Hello world\n");
  });

  it("the menu path inserts exactly the picked 7x2 header table (AC1)", async () => {
    await renderDoc();
    await emitMenu("insert-table");
    setNumber(dialogField("Rows"), "7");
    setNumber(dialogField("Columns"), "2");
    const insert = dialog().querySelector<HTMLButtonElement>(
      "button.quillmd-image-button.primary",
    )!;
    await act(async () => {
      insert.click();
    });
    // The dialog closed and the document carries a 7-row, 2-column GFM table
    // with a header row.
    expect(container.querySelector(".quillmd-table-dialog")).toBeNull();
    const out = docMd();
    const lines = out.split("\n").filter((l) => l.startsWith("|"));
    expect(lines).toHaveLength(8); // 7 rows + the delimiter row
    expect(lines[1]).toMatch(/^\|[\s\-:|]+\|$/);
    // The surrounding text survived.
    expect(out).toContain("Hello world");
    // The saved shape is a converter fixed point (save -> reopen -> save
    // stability, the round-trip contract).
    expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
  });

  it("cancelling the dialog leaves the document untouched", async () => {
    await renderDoc();
    await emitMenu("insert-table");
    const cancel = Array.from(dialog().querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel",
    )!;
    await act(async () => {
      cancel.click();
    });
    expect(container.querySelector(".quillmd-table-dialog")).toBeNull();
    expect(docMd()).toBe("Hello world\n");
  });
});
