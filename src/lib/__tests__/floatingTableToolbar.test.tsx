// @vitest-environment jsdom
// Floating table toolbar (plan 06 task 6.4, issue #64, plan 06 AC7): the bar
// appears while the selection is inside a table (cursor, text selection, or
// CellSelection) and hides as soon as the selection leaves; it is positioned
// above the table's nodeDOM rect (the table's offset in document space,
// raised by the gap); its button set is the task 6.2 row/column/cell command
// registry plus delete table, every button dispatching the shared registry
// command with the editor selection kept (mousedown preventDefault, a
// CellSelection included).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { CellSelection } from "@tiptap/pm/tables";
import QuillEditor, { GfmTable } from "../../components/Editor";
import TableToolbar, {
  TABLE_TOOLBAR_GAP,
  tableToolbarPosition,
} from "../../components/TableToolbar";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { currentFindEditor } from "../find";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// A 3x3 table with a header row and unique text in every cell.
const TABLE_MD =
  "| h1 | h2 | h3 |\n" +
  "|---|---|---|\n" +
  "| a1 | a2 | a3 |\n" +
  "| b1 | b2 | b3 |\n";

const DOC_MD = `Before\n\n${TABLE_MD}`;

function makeEditor(markdown = TABLE_MD): Editor {
  return new Editor({
    // Same table extensions as the app editor (Editor.tsx).
    extensions: [
      StarterKit,
      GfmTable.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: markdownToTiptap(markdown),
  });
}

// Put the cursor right after the first occurrence of `text` so the selection
// is deterministic (inside a cell when `text` is a cell's text).
function cursorAfter(editor: Editor, text: string): void {
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    editor.chain().setTextSelection(pos + idx + text.length).run();
    return false;
  });
}

// The position directly before the cell node containing the first
// occurrence of `text` (the shape CellSelection expects).
function cellPosOf(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1 || !node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    found = editor.state.doc.resolve(pos + idx).before(3);
    return false;
  });
  if (found === -1) throw new Error(`cell text not found: ${text}`);
  return found;
}

function selectCells(editor: Editor, a: string, b: string): void {
  const sel = CellSelection.create(editor.state.doc, cellPosOf(editor, a), cellPosOf(editor, b));
  editor.view.dispatch(editor.state.tr.setSelection(sel));
}

function rowsOf(e: Editor): JSONContent[] {
  const table = e.getJSON().content?.find((n) => n.type === "table");
  return table?.content ?? [];
}

function md(e: Editor): string {
  return tiptapToMarkdown(e.getJSON());
}

// The text of the cell at (row, col) in the first table, or undefined when
// the cell is empty (a cleared cell holds an empty paragraph).
function cellText(e: Editor, row: number, col: number): string | undefined {
  const cell = rowsOf(e)[row]?.content?.[col];
  let text: string | undefined;
  for (const block of cell?.content ?? []) {
    for (const n of block.content ?? []) {
      if (n.type === "text" && typeof n.text === "string") {
        text = text === undefined ? n.text : `${text}${n.text}`;
      }
    }
  }
  return text;
}

describe("tableToolbarPosition (plan 06 §3)", () => {
  function rectOf(el: HTMLElement, top: number, left: number): void {
    el.getBoundingClientRect = () => new DOMRect(left, top, 300, 200);
  }

  it("places the bar above the table's rect, in document space", () => {
    const table = document.createElement("table");
    const container = document.createElement("div");
    rectOf(table, 120, 40);
    rectOf(container, 30, 10);
    container.scrollTop = 25;
    container.scrollLeft = 5;
    expect(tableToolbarPosition(table, container)).toEqual({
      top: 120 - 30 + 25 - TABLE_TOOLBAR_GAP,
      left: 40 - 10 + 5,
    });
  });

  it("is scroll-invariant (the table's offset in the document)", () => {
    const table = document.createElement("table");
    const container = document.createElement("div");
    rectOf(table, 120, 40);
    rectOf(container, 30, 10);
    const at0 = tableToolbarPosition(table, container);
    // A 50px scroll moves the table's viewport rect up and the container's
    // scroll down by the same amount: the document offset is unchanged.
    rectOf(table, 70, 40);
    container.scrollTop = 50;
    expect(tableToolbarPosition(table, container)).toEqual(at0);
  });

  it("falls back to the viewport origin without a container", () => {
    const table = document.createElement("table");
    rectOf(table, 120, 40);
    expect(tableToolbarPosition(table, null)).toEqual({
      top: 120 - TABLE_TOOLBAR_GAP,
      left: 40,
    });
  });
});

describe("floating table toolbar (issue #64, AC7)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let editor: Editor | null = null;

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
    if (editor) {
      editor.destroy();
      editor = null;
    }
    document.body.innerHTML = "";
  });

  // Creates the editor and renders the toolbar over it.
  function setup(markdown = TABLE_MD): Editor {
    const e = makeEditor(markdown);
    editor = e;
    const r = createRoot(container);
    root = r;
    act(() => {
      r.render(<TableToolbar editor={e} />);
    });
    return e;
  }

  function bar(): HTMLDivElement | null {
    return container.querySelector(".quillmd-table-toolbar");
  }

  function buttonByTitle(title: string): HTMLButtonElement {
    const btn = container.querySelector<HTMLButtonElement>(
      `.quillmd-table-toolbar button[title="${title}"]`,
    );
    expect(btn, `floating toolbar button titled "${title}"`).not.toBeNull();
    return btn!;
  }

  function clickButton(title: string): void {
    const btn = buttonByTitle(title);
    act(() => {
      btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    act(() => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  }

  it("is hidden when the selection is not in a table", () => {
    setup("Hello world");
    expect(bar()).toBeNull();
  });

  it("appears when the cursor moves into a table", () => {
    const e = setup(DOC_MD);
    expect(bar()).toBeNull();
    act(() => cursorAfter(e, "a1"));
    const el = bar();
    expect(el).not.toBeNull();
    expect(el?.getAttribute("role")).toBe("toolbar");
    // The bar lives in the rendered output, positioned inline.
    expect(el!.style.top).not.toBe("");
    expect(el!.style.left).not.toBe("");
  });

  it("hides when the cursor leaves the table", () => {
    const e = setup(DOC_MD);
    act(() => cursorAfter(e, "a1"));
    expect(bar()).not.toBeNull();
    act(() => cursorAfter(e, "Before"));
    expect(bar()).toBeNull();
  });

  it("appears for a CellSelection and hides when the selection leaves", () => {
    const e = setup(DOC_MD);
    act(() => selectCells(e, "a1", "a3"));
    expect(bar()).not.toBeNull();
    // A merge selection spans cells, so the merge button reads as active.
    expect(buttonByTitle("Merge cells").className).toContain("quillmd-toolbar-active");
    act(() => cursorAfter(e, "Before"));
    expect(bar()).toBeNull();
  });

  it("offers the row/column/cell command set plus delete table", () => {
    const e = setup();
    act(() => cursorAfter(e, "a1"));
    const titles = Array.from(container.querySelectorAll(".quillmd-table-toolbar button")).map(
      (b) => (b as HTMLButtonElement).title,
    );
    expect(titles).toEqual([
      "Insert row above",
      "Insert row below",
      "Delete row",
      "Insert column left",
      "Insert column right",
      "Delete column",
      "Align cells left",
      "Align cells center",
      "Align cells right",
      "Toggle header row",
      "Merge cells",
      "Clear cell contents",
      "Delete table",
    ]);
  });

  it("keeps the editor selection while a button is pressed (mousedown preventDefault)", () => {
    const e = setup();
    act(() => cursorAfter(e, "a1"));
    const btn = buttonByTitle("Insert row below");
    const mousedown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      btn.dispatchEvent(mousedown);
    });
    expect(mousedown.defaultPrevented).toBe(true);
  });

  it("a row op dispatches the registry command and keeps the bar visible", () => {
    const e = setup();
    act(() => cursorAfter(e, "a1"));
    expect(rowsOf(e)).toHaveLength(3);
    clickButton("Insert row below");
    expect(rowsOf(e)).toHaveLength(4);
    // The selection stayed in the table, so the bar is still up.
    expect(bar()).not.toBeNull();
    clickButton("Delete row");
    expect(rowsOf(e)).toHaveLength(3);
    expect(bar()).not.toBeNull();
  });

  it("delete table removes the whole block and hides the bar", () => {
    const e = setup(DOC_MD);
    act(() => cursorAfter(e, "a1"));
    clickButton("Delete table");
    expect(e.getJSON().content?.some((n) => n.type === "table")).toBe(false);
    // The selection left the table with it: the bar is gone.
    expect(bar()).toBeNull();
  });

  it("cell alignment dispatches the registry command (the GFM spec persists)", () => {
    const e = setup();
    act(() => cursorAfter(e, "a2")); // middle column
    clickButton("Align cells center");
    const out = md(e);
    // The center marker in the established GFM delimiter format (#62).
    expect(out).toContain(":-:");
    // The spec survives a re-parse (re-serializes byte-identically).
    const reparsed = markdownToTiptap(out);
    const table = reparsed.content?.find((n) => n.type === "table");
    expect(table?.attrs?.align).toEqual([null, "center", null]);
    // The bar stays up and the alignment button reads as active.
    expect(bar()).not.toBeNull();
    expect(buttonByTitle("Align cells center").className).toContain("quillmd-toolbar-active");
  });

  it("the header-row toggle dispatches the registry command", () => {
    const e = setup();
    act(() => cursorAfter(e, "a1"));
    // The first row starts as a header row: the button reads as active.
    expect(buttonByTitle("Toggle header row").className).toContain("quillmd-toolbar-active");
    clickButton("Toggle header row");
    expect(rowsOf(e)[0].content?.map((c) => c.type)).toEqual([
      "tableCell",
      "tableCell",
      "tableCell",
    ]);
    expect(bar()).not.toBeNull();
  });

  it("clear cell empties the cell under the caret and keeps the bar visible", () => {
    const e = setup();
    act(() => cursorAfter(e, "a1"));
    clickButton("Clear cell contents");
    expect(cellText(e, 1, 0)).toBeUndefined();
    // Sibling cells are untouched.
    expect(cellText(e, 1, 1)).toBe("a2");
    expect(bar()).not.toBeNull();
  });

  it("merges a CellSelection through the registry command", () => {
    const e = setup();
    act(() => selectCells(e, "a1", "a2"));
    clickButton("Merge cells");
    // The two body-row cells merged into one (the header row is untouched).
    expect(rowsOf(e)[1].content).toHaveLength(2);
    expect(rowsOf(e)[0].content).toHaveLength(3);
    expect(bar()).not.toBeNull();
  });

  it("positions the bar above the table's nodeDOM rect", () => {
    const e = setup();
    const tableEl = e.view.dom.querySelector("table");
    expect(tableEl).not.toBeNull();
    tableEl!.getBoundingClientRect = () => new DOMRect(40, 120, 300, 200);
    act(() => cursorAfter(e, "a1"));
    const el = bar()!;
    // No editor body around a detached test editor: the viewport origin is
    // the fallback, so the bar lands at the table's rect minus the gap,
    // lifted by its own height.
    expect(el.style.top).toBe(`${120 - TABLE_TOOLBAR_GAP}px`);
    expect(el.style.left).toBe("40px");
    expect(el.style.transform).toBe("translateY(-100%)");
  });
});

describe("floating table toolbar inside the editor (issue #64, AC7)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

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
    document.body.innerHTML = "";
  });

  function liveEditor(): Editor {
    const e = currentFindEditor();
    if (!e) throw new Error("no live editor");
    return e;
  }

  it("appears inside the editor body on table focus and hides on leave", async () => {
    const r = createRoot(container);
    root = r;
    await act(async () => {
      r.render(<QuillEditor value={DOC_MD} onChange={() => {}} />);
    });
    const body = container.querySelector(".quillmd-editor-body");
    expect(body).not.toBeNull();
    expect(container.querySelector(".quillmd-table-toolbar")).toBeNull();

    await act(async () => {
      cursorAfter(liveEditor(), "a1");
    });
    const bar = container.querySelector(".quillmd-table-toolbar");
    expect(bar).not.toBeNull();
    // The bar is a child of the scroll container, so it tracks the table in
    // document space.
    expect(body!.contains(bar)).toBe(true);

    await act(async () => {
      cursorAfter(liveEditor(), "Before");
    });
    expect(container.querySelector(".quillmd-table-toolbar")).toBeNull();
  });
});
