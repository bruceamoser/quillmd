// @vitest-environment jsdom
// Date & Time (plan 09 task 9.6, issue #89): the dialog component (the ten
// live format rows, click inserts + closes, keyboard model), the menu.rs
// Insert item, the App wiring (the menu id opens the dialog), and the e2e —
// the menu opens the dialog, the picked row's sample is inserted at the caret
// as plain text (plan 09 AC5), and the dialog closes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import App from "../../App";
import { currentFindEditor } from "../find";
import { currentSourceFindView } from "../sourceFind";
import {
  EDITOR_COMMANDS,
  registerDateTimeDialogListener,
  requestDateTimeDialog,
} from "../editorCommands";
import DateTimeDialog from "../../components/DateTimeDialog";
import { DATE_TIME_FORMATS } from "../dateformats";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

// The dialog samples "now"; pin the clock so the row samples are
// deterministic (2026-08-30 15:45:22 local).
const FIXED = new Date(2026, 7, 30, 15, 45, 22);

describe("menu.rs Insert > Date & Time item (issue #89)", () => {
  it("offers the date & time dialog in the Insert submenu", () => {
    const src = repoFile("../../../src-tauri/src/menu.rs");
    expect(src).toContain(
      'MenuItem::with_id(app, "insert-date-time", "Date & Time", true, None::<&str>)',
    );
    expect(src).toContain("&date_time, &symbol");
  });
});

describe("App.tsx Insert > Date & Time routing (issue #89)", () => {
  it("routes the menu id to the dialog through the renderer channel", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('id === "insert-date-time"');
    expect(app).toContain("registerDateTimeDialogListener");
    expect(app).toContain('<DateTimeDialog');
  });
});

describe("the dateTime registry command (issue #89)", () => {
  it("keeps its label and requests the dialog through the renderer channel", () => {
    const cmd = EDITOR_COMMANDS.find((c) => c.id === "dateTime");
    expect(cmd).toBeTruthy();
    expect(cmd!.label).toBe("Date & Time");

    const seen: Array<unknown> = [];
    const dispose = registerDateTimeDialogListener((e) => seen.push(e));
    const editor = {} as never;
    expect(requestDateTimeDialog(editor)).toBe(true);
    expect(seen).toEqual([editor]);
    dispose();
    // Without a renderer the request is a no-op (returns false).
    expect(requestDateTimeDialog(editor)).toBe(false);
  });
});

describe("DateTimeDialog component", () => {
  let roots: Root[] = [];

  interface Harness {
    container: HTMLDivElement;
    onInsert: ReturnType<typeof vi.fn>;
    onClose: ReturnType<typeof vi.fn>;
    row: (label: string) => HTMLButtonElement;
    rowValue: (label: string) => string;
  }

  function renderDialog(): Harness {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<DateTimeDialog onInsert={onInsert} onClose={onClose} />);
    });
    const dialog = container.querySelector(".quillmd-datetime-dialog")!;
    return {
      container,
      onInsert,
      onClose,
      row: (label) =>
        Array.from(dialog.querySelectorAll<HTMLButtonElement>(".quillmd-datetime-row")).find(
          (b) => b.querySelector(".quillmd-datetime-label")!.textContent === label,
        )!,
      rowValue: (label) =>
        Array.from(dialog.querySelectorAll<HTMLButtonElement>(".quillmd-datetime-row"))
          .find((b) => b.querySelector(".quillmd-datetime-label")!.textContent === label)!
          .querySelector(".quillmd-datetime-value")!
          .textContent!,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED);
    document.body.innerHTML = "";
    roots = [];
  });
  afterEach(() => {
    for (const r of roots) act(() => r.unmount());
    roots = [];
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows every format row with its live sample", () => {
    const h = renderDialog();
    const rows = h.container.querySelectorAll(".quillmd-datetime-row");
    expect(rows).toHaveLength(DATE_TIME_FORMATS.length);
    // The pinned-clock rows carry the fixed sample (2026-08-30 15:45:22).
    expect(h.rowValue("2026-08-30")).toBe("2026-08-30");
    expect(h.rowValue("08/30/2026")).toBe("08/30/2026");
    expect(h.rowValue("3:45 PM")).toBe("3:45 PM");
    expect(h.rowValue("15:45")).toBe("15:45");
    expect(h.rowValue("3:45:22 PM")).toBe("3:45:22 PM");
    expect(h.rowValue("15:45:22")).toBe("15:45:22");
    // The composite row: ISO date + 24-hour time, single space (no locale
    // separator).
    expect(h.rowValue("2026-08-30 15:45")).toBe("2026-08-30 15:45");
  });

  it("the samples tick with the clock (the seconds rows stay live)", () => {
    const h = renderDialog();
    expect(h.rowValue("15:45:22")).toBe("15:45:22");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(h.rowValue("15:45:22")).toBe("15:45:23");
    // The date-only rows are unaffected.
    expect(h.rowValue("2026-08-30")).toBe("2026-08-30");
  });

  it("a row click inserts the live sample (the dialog closes in App)", () => {
    const h = renderDialog();
    act(() => {
      h.row("08/30/2026").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(h.onInsert).toHaveBeenCalledTimes(1);
    expect(h.onInsert).toHaveBeenCalledWith("08/30/2026");
  });

  it("autofocuses the first row; the arrows walk the list; Enter inserts", () => {
    const h = renderDialog();
    expect(document.activeElement).toBe(h.row(DATE_TIME_FORMATS[0].label));
    act(() => {
      h.container
        .querySelector(".quillmd-datetime-dialog")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
        );
    });
    expect(document.activeElement).toBe(h.row(DATE_TIME_FORMATS[1].label));
    // A real Enter keypress on the focused row fires its click (the browser
    // activation behavior); jsdom does not implement that default action, so
    // the test fires the resulting click on the focused row.
    act(() => {
      (document.activeElement as HTMLButtonElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    // Enter on the focused row (iso) inserts its live sample.
    expect(h.onInsert).toHaveBeenCalledTimes(1);
    expect(h.onInsert).toHaveBeenCalledWith("2026-08-30");
  });

  it("cancels on Esc", () => {
    const h = renderDialog();
    act(() => {
      h.container
        .querySelector(".quillmd-datetime-dialog")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("a backdrop press closes; a press inside the dialog does not", () => {
    const h = renderDialog();
    act(() => {
      h.container
        .querySelector(".quillmd-datetime-overlay")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);

    const h2 = renderDialog();
    act(() => {
      h2.container
        .querySelector(".quillmd-datetime-dialog")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h2.onClose).not.toHaveBeenCalled();
  });
});

describe("App menu-event e2e: Insert > Date & Time (issue #89)", () => {
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
    const el = container.querySelector<HTMLDivElement>(".quillmd-datetime-dialog");
    expect(el, "date & time dialog").not.toBeNull();
    return el!;
  }

  function row(label: string): HTMLButtonElement {
    const el = Array.from(dialog().querySelectorAll<HTMLButtonElement>(".quillmd-datetime-row")).find(
      (b) => b.querySelector(".quillmd-datetime-label")!.textContent === label,
    );
    expect(el, `row ${label}`).not.toBeNull();
    return el!;
  }

  function docText(): string {
    const editor = currentFindEditor();
    expect(editor, "live editor").not.toBeNull();
    return editor!.state.doc.textBetween(0, editor!.state.doc.content.size, "\n");
  }

  async function renderDoc(): Promise<void> {
    await renderApp();
    await openFile("date-time.md", DOC_MD);
    await waitFor(() => currentFindEditor() !== null, "live editor");
    // Park the caret at the end so the insert lands in a known place.
    await act(async () => {
      const editor = currentFindEditor()!;
      editor.chain().focus().setTextSelection(editor.state.doc.content.size).run();
    });
  }

  it("the menu opens the dialog; the picked row inserts its sample and closes (AC5)", async () => {
    await renderDoc();
    await emitMenu("insert-date-time");
    expect(dialog()).not.toBeNull();
    expect(dialog().querySelectorAll(".quillmd-datetime-row")).toHaveLength(10);

    // The iso row has no seconds, so its live sample is stable for the test.
    const isoRow = row("2026-08-30");
    const sample = isoRow.querySelector(".quillmd-datetime-value")!.textContent!;
    await act(async () => {
      isoRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Plain text at the caret, no markup; the dialog closed.
    expect(docText()).toBe(`Hello wonderful world.\nSecond sentence here.${sample}`);
    expect(container.querySelector(".quillmd-datetime-dialog")).toBeNull();
  });

  it("Esc closes the dialog and the document is untouched", async () => {
    await renderDoc();
    await emitMenu("insert-date-time");
    await act(async () => {
      dialog().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(container.querySelector(".quillmd-datetime-dialog")).toBeNull();
    expect(docText()).toBe("Hello wonderful world.\nSecond sentence here.");
  });

  it("source mode: the insert lands in the CodeMirror view (no TipTap instance)", async () => {
    await renderDoc();
    await emitMenu("view-source");
    await waitFor(() => currentSourceFindView() !== null, "source view");
    await emitMenu("insert-date-time");
    expect(dialog()).not.toBeNull();

    // The iso row has no seconds, so its live sample is stable for the test.
    const isoRow = row("2026-08-30");
    const sample = isoRow.querySelector(".quillmd-datetime-value")!.textContent!;
    await act(async () => {
      isoRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // CodeMirror's selection starts at 0 in a freshly mounted view, so the
    // sample lands at the top of the source text.
    const view = currentSourceFindView()!;
    expect(view.state.doc.toString().startsWith(sample)).toBe(true);
    expect(container.querySelector(".quillmd-datetime-dialog")).toBeNull();
  });
});
