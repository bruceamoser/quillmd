// @vitest-environment jsdom
// Table split button wiring (plan 06 task 6.3, issue #63): the toolbar's
// Table button opens the 10x10 size-picker popover, its caret opens the
// "Insert table…" menu, the pick dispatches the tableInsert registry command
// (the document changes, the popover closes), the menu dispatches the
// tableDialog command (the app shell's listener receives the editor), the
// "table" command (slash menu /table) opens the picker through the listener,
// and an outside click closes the popover.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { GfmTable } from "../../components/Editor";
import Toolbar from "../../components/Toolbar";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import {
  registerTableDialogListener,
  runEditorCommand,
} from "../editorCommands";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;
let editor: Editor | null = null;
const unregisters: Array<() => void> = [];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  const r = root;
  if (r) {
    act(() => r.unmount());
    root = null;
  }
  for (const off of unregisters.splice(0)) off();
  if (editor) {
    editor.destroy();
    editor = null;
  }
  document.body.innerHTML = "";
});

function makeEditor(): Editor {
  const e = new Editor({
    // Same table extensions as the app editor (Editor.tsx).
    extensions: [
      StarterKit,
      GfmTable.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: markdownToTiptap("Hello world"),
  });
  editor = e;
  // Put the cursor at the end of the paragraph so the insert lands
  // deterministically.
  e.state.doc.descendants((node, pos) => {
    if (node.isText) {
      e.chain().setTextSelection(pos + node.text!.length).run();
      return false;
    }
    return true;
  });
  return e;
}

function rowsOf(e: Editor): JSONContent[] {
  const table = e.getJSON().content?.find((n) => n.type === "table");
  return table?.content ?? [];
}

function md(e: Editor): string {
  return tiptapToMarkdown(e.getJSON());
}

function renderToolbar(e: Editor): void {
  const r = createRoot(container);
  root = r;
  act(() => {
    r.render(<Toolbar editor={e} />);
  });
}

function buttonByTitle(title: string): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  expect(btn, `button titled "${title}"`).not.toBeNull();
  return btn!;
}

function openPicker(): void {
  act(() => {
    buttonByTitle("Table").click();
  });
}

function pressCell(rows: number, cols: number): void {
  const cell = container.querySelector(
    `.quillmd-table-picker-cell[data-row="${rows}"][data-col="${cols}"]`,
  );
  expect(cell, `picker cell ${rows}x${cols}`).not.toBeNull();
  act(() => {
    cell!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  });
}

function outsideClick(): void {
  act(() => {
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
}

describe("Toolbar Table split button (issue #63)", () => {
  it("the Table button opens the 10x10 size picker", () => {
    renderToolbar(makeEditor());
    expect(container.querySelector(".quillmd-table-picker")).toBeNull();
    openPicker();
    const picker = container.querySelector(".quillmd-table-picker");
    expect(picker).not.toBeNull();
    expect(container.querySelectorAll(".quillmd-table-picker-cell")).toHaveLength(100);
    // The main button reads as active while the picker is open.
    expect(buttonByTitle("Table").className).toContain("quillmd-toolbar-active");
  });

  it("a picker pick inserts exactly the hovered size and closes the picker", () => {
    const e = makeEditor();
    renderToolbar(e);
    openPicker();
    pressCell(4, 3);
    // The pick dispatched tableInsert: a 4x3 table with a header row.
    expect(rowsOf(e)).toHaveLength(4);
    for (const row of rowsOf(e)) expect(row.content).toHaveLength(3);
    expect((rowsOf(e)[0]?.content ?? []).map((c) => c.type)).toEqual([
      "tableHeader",
      "tableHeader",
      "tableHeader",
    ]);
    // The surrounding text survived the insert.
    expect(md(e)).toContain("Hello world");
    // The picker closed after the pick.
    expect(container.querySelector(".quillmd-table-picker")).toBeNull();
  });

  it("the caret opens the Insert table… menu, which dispatches tableDialog", () => {
    const e = makeEditor();
    renderToolbar(e);
    const seen: Editor[] = [];
    unregisters.push(registerTableDialogListener((ed) => seen.push(ed)));

    act(() => {
      buttonByTitle("Table options").click();
    });
    const item = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Insert table…",
    );
    expect(item, "Insert table… menu item").not.toBeNull();

    act(() => {
      item!.click();
    });
    // The menu closed and the dialog command carried the live editor.
    expect(container.querySelector(".quillmd-toolbar-dropdown")).toBeNull();
    expect(seen).toEqual([e]);
  });

  it("the table command (slash menu /table) opens the picker", () => {
    const e = makeEditor();
    renderToolbar(e);
    expect(container.querySelector(".quillmd-table-picker")).toBeNull();
    act(() => {
      // The same dispatch the slash menu makes for its Table action.
      runEditorCommand(e, "table");
    });
    expect(container.querySelector(".quillmd-table-picker")).not.toBeNull();
  });

  it("an outside click closes the picker without inserting", () => {
    const e = makeEditor();
    renderToolbar(e);
    openPicker();
    const before = md(e);
    outsideClick();
    expect(container.querySelector(".quillmd-table-picker")).toBeNull();
    expect(md(e)).toBe(before);
  });

  it("Escape closes the picker without inserting", () => {
    const e = makeEditor();
    renderToolbar(e);
    openPicker();
    const before = md(e);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector(".quillmd-table-picker")).toBeNull();
    expect(md(e)).toBe(before);
  });

  it("the dialog command is a no-op when no renderer is registered", () => {
    const e = makeEditor();
    renderToolbar(e);
    // No App shell mounted here: only the picker listener is registered.
    expect(runEditorCommand(e, "tableDialog")).toBe(false);
  });
});
