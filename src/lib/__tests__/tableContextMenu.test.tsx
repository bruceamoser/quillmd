// @vitest-environment jsdom
// The table's right-click context menu (plan 03 task 3.3, issue #41; plan 03
// §2 item 2): right-click inside a table cell shows the table menu instead
// of the text menu — row/column insert & delete, cell alignment, header-row
// toggle, and delete table. Every item dispatches its registry command
// through the shared registry (plan 03 AC1: 1:1 command mapping, identical
// behavior to the floating table toolbar and the native menu), "Delete
// table" is gated on the native confirm dialog (plan 03 §3), and every
// command's result re-serializes to a valid GFM table that is a converter
// fixed point (plan AC2: "Insert column right" on a 3x3 table yields a valid
// 3x4 GFM table in the saved text; "Delete table" removes the block
// cleanly).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import type { Editor as CoreEditor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import QuillEditor, { GfmTable, TABLE_CELL_MIN_WIDTH } from "../../components/Editor";
import { isSeparator, type ContextMenuItem } from "../../components/ContextMenu";
import { EDITOR_COMMANDS, runEditorCommand } from "../editorCommands";
import {
  buildTableMenu,
  isTableMenuSeparator,
  TABLE_MENU_ITEM_IDS,
  toTableContextEntries,
  type TableMenuItem,
  type TableMenuEntry,
} from "../tableMenu";
import { parseToAst } from "../markdown";
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

// Strip mdast positions so structurally identical trees compare equal.
function astOf(markdown: string): { children: Array<{ type: string; children: unknown[] }> } {
  return JSON.parse(
    JSON.stringify(parseToAst(markdown), (k, v) => (k === "position" ? undefined : v)),
  );
}

// The same block/table extensions the app editor (Editor.tsx) uses, so the
// schema and selection handling behave exactly as in the real component.
function makeEditor(markdown = TABLE_MD): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      GfmTable.configure({ resizable: true, cellMinWidth: TABLE_CELL_MIN_WIDTH }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: markdownToTiptap(markdown),
  });
}

// Put the cursor right after the first occurrence of `text` (which lives in
// a cell) so table commands act on a deterministic position.
function cursorAfter(editor: Editor, text: string): void {
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    editor.chain().setTextSelection(pos + idx + text.length).run();
    return false;
  });
}

function md(editor: Editor): string {
  return tiptapToMarkdown(editor.getJSON());
}

// The pipe lines of the saved text (the table's rows including the delimiter
// row).
function tableLines(markdown: string): string[] {
  return markdown.split("\n").filter((l) => l.startsWith("|"));
}

// The non-separator items of a menu level, in display order.
function itemsOf(entries: readonly TableMenuEntry[]): TableMenuItem[] {
  return entries.filter((e): e is TableMenuItem => !isTableMenuSeparator(e));
}

function findItem(
  entries: readonly TableMenuEntry[],
  id: string,
): TableMenuItem | undefined {
  return itemsOf(entries).find((e) => e.id === id);
}

describe("buildTableMenu (plan 03 §2 item 2)", () => {
  it("carries the plan 03 table item set in display order, with the group separators", () => {
    const editor = makeEditor();
    cursorAfter(editor, "a2");
    const entries = buildTableMenu(editor);
    expect(itemsOf(entries).map((e) => e.id)).toEqual([...TABLE_MENU_ITEM_IDS]);
    expect(entries).toHaveLength(14);
    expect(entries[3]).toEqual({ type: "separator", id: "table-sep-rows" });
    expect(entries[7]).toEqual({ type: "separator", id: "table-sep-cols" });
    expect(entries[12]).toEqual({ type: "separator", id: "table-sep-cell" });
    editor.destroy();
  });

  it("wires every item 1:1 to a registered command (plan 03 AC1)", () => {
    const editor = makeEditor();
    cursorAfter(editor, "a2");
    const commands = new Map(EDITOR_COMMANDS.map((c) => [c.id, c]));
    const items = itemsOf(buildTableMenu(editor));
    expect(items).toHaveLength(11);
    for (const item of items) {
      expect(
        commands.has(item.command),
        `unknown registry command ${item.command} for ${item.id}`,
      ).toBe(true);
    }
    // The same ids the floating table toolbar and the native menu dispatch.
    expect(items.map((i) => i.command)).toEqual([
      "rowInsertAbove",
      "rowInsertBelow",
      "rowDelete",
      "colInsertLeft",
      "colInsertRight",
      "colDelete",
      "cellAlignLeft",
      "cellAlignCenter",
      "cellAlignRight",
      "headerRowToggle",
      "tableDelete",
    ]);
    editor.destroy();
  });

  it("enables every item for a selection inside a table and marks the destructive ones", () => {
    const editor = makeEditor();
    cursorAfter(editor, "a2");
    const items = itemsOf(buildTableMenu(editor));
    expect(items.every((i) => i.enabled === true)).toBe(true);
    expect(items.filter((i) => i.danger === true).map((i) => i.id)).toEqual([
      "table-row-delete",
      "table-col-delete",
      "table-delete",
    ]);
    editor.destroy();
  });

  it("disables every item and checks nothing for a selection outside a table", () => {
    const editor = makeEditor("Just a paragraph");
    cursorAfter(editor, "paragraph");
    const items = itemsOf(buildTableMenu(editor));
    expect(items.every((i) => i.enabled === false)).toBe(true);
    expect(items.every((i) => i.checked !== true)).toBe(true);
    editor.destroy();
  });

  it("checks the alignment items from the column spec under the cursor, and dispatches them", () => {
    const editor = makeEditor("| A | B |\n|:---|---:|\n| 1 | 2 |\n");
    cursorAfter(editor, "A");
    const checkedOf = (id: string): boolean | undefined =>
      findItem(buildTableMenu(editor), id)?.checked;
    expect(checkedOf("table-align-left")).toBe(true);
    expect(checkedOf("table-align-center")).toBeUndefined();
    expect(checkedOf("table-align-right")).toBeUndefined();
    cursorAfter(editor, "B");
    expect(checkedOf("table-align-right")).toBe(true);
    expect(checkedOf("table-align-left")).toBeUndefined();
    // Dispatch through the registry the item carries (plan 03 AC1).
    expect(runEditorCommand(editor, "cellAlignCenter")).toBe(true);
    expect(checkedOf("table-align-center")).toBe(true);
    editor.destroy();
  });

  it("checks the header row item from the table's first row, and dispatches it", () => {
    const editor = makeEditor();
    cursorAfter(editor, "b2");
    const checkedOf = (id: string): boolean | undefined =>
      findItem(buildTableMenu(editor), id)?.checked;
    expect(checkedOf("table-header-row")).toBe(true);
    expect(runEditorCommand(editor, "headerRowToggle")).toBe(true);
    expect(checkedOf("table-header-row")).toBeUndefined();
    expect(runEditorCommand(editor, "headerRowToggle")).toBe(true);
    expect(checkedOf("table-header-row")).toBe(true);
    editor.destroy();
  });
});

describe("toTableContextEntries (the ContextMenu mapping)", () => {
  it("wires each item's onSelect to the dispatch and passes separators through", () => {
    const editor = makeEditor();
    cursorAfter(editor, "a2");
    const entries = buildTableMenu(editor);
    const dispatched: TableMenuItem[] = [];
    const mapped = toTableContextEntries(entries, (item) => {
      dispatched.push(item);
      runEditorCommand(editor, item.command);
    });
    expect(mapped).toHaveLength(14);
    // Separators pass through untouched.
    expect(mapped[3]).toEqual({ type: "separator", id: "table-sep-rows" });
    expect(mapped.filter(isSeparator)).toHaveLength(3);
    // A leaf carries its state and an onSelect that dispatches its command.
    const colRight = mapped.find(
      (e) => !isSeparator(e) && e.id === "table-col-right",
    ) as ContextMenuItem;
    expect(colRight.label).toBe("Insert column right");
    expect(colRight.onSelect).toBeTypeOf("function");
    colRight.onSelect!();
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].command).toBe("colInsertRight");
    // The command ran: the table is now 3 rows x 4 columns.
    const rows = editor.getJSON().content?.find((n) => n.type === "table")?.content ?? [];
    expect(rows.map((r: JSONContent) => r.content?.length)).toEqual([4, 4, 4]);
    editor.destroy();
  });
});

describe("the menu's commands through the saved GFM (plan 03 AC2)", () => {
  it("insert column right on a 3x3 table yields a valid 3x4 GFM table", () => {
    const editor = makeEditor();
    cursorAfter(editor, "h1");
    expect(runEditorCommand(editor, "colInsertRight")).toBe(true);
    const out = md(editor);
    // 3 table rows + the delimiter row.
    const lines = tableLines(out);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/^\|[\s\-:|]+\|$/);
    // Every row has 4 cells (5 pipes) — the new (empty) column included.
    for (const line of lines) {
      expect(line.match(/\|/g)).toHaveLength(5);
    }
    // The other columns' content survived.
    expect(out).toContain("h2");
    expect(out).toContain("b3");
    // Valid GFM: it re-parses as a 3-row table.
    const ast = astOf(out);
    expect(ast.children[0].type).toBe("table");
    expect(ast.children[0].children).toHaveLength(3);
    // The saved shape is a converter fixed point (save -> reopen -> save).
    expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
    editor.destroy();
  });

  it("insert row above / below yield valid 4x3 GFM tables", () => {
    const above = makeEditor();
    cursorAfter(above, "b1");
    expect(runEditorCommand(above, "rowInsertAbove")).toBe(true);
    const outAbove = md(above);
    expect(tableLines(outAbove)).toHaveLength(5); // 4 rows + the delimiter row
    expect(astOf(outAbove).children[0].children).toHaveLength(4);
    expect(tiptapToMarkdown(markdownToTiptap(outAbove))).toBe(outAbove);
    above.destroy();

    const below = makeEditor();
    cursorAfter(below, "b1");
    expect(runEditorCommand(below, "rowInsertBelow")).toBe(true);
    const outBelow = md(below);
    expect(tableLines(outBelow)).toHaveLength(5);
    expect(astOf(outBelow).children[0].children).toHaveLength(4);
    expect(tiptapToMarkdown(markdownToTiptap(outBelow))).toBe(outBelow);
    below.destroy();
  });

  it("delete row / delete column keep a valid GFM table", () => {
    const rowEditor = makeEditor();
    cursorAfter(rowEditor, "a1");
    expect(runEditorCommand(rowEditor, "rowDelete")).toBe(true);
    const outRow = md(rowEditor);
    expect(tableLines(outRow)).toHaveLength(3); // 2 rows + the delimiter row
    expect(outRow).not.toContain("a1");
    expect(outRow).toContain("b1");
    expect(tiptapToMarkdown(markdownToTiptap(outRow))).toBe(outRow);
    rowEditor.destroy();

    const colEditor = makeEditor();
    cursorAfter(colEditor, "h2");
    expect(runEditorCommand(colEditor, "colDelete")).toBe(true);
    const outCol = md(colEditor);
    for (const line of tableLines(outCol)) {
      expect(line.match(/\|/g)).toHaveLength(3); // 2 cells
    }
    expect(outCol).not.toContain("h2");
    expect(outCol).toContain("h3");
    expect(tiptapToMarkdown(markdownToTiptap(outCol))).toBe(outCol);
    colEditor.destroy();
  });

  it("aligning a column writes the GFM alignment spec and stays a fixed point", () => {
    const editor = makeEditor();
    cursorAfter(editor, "a2");
    expect(runEditorCommand(editor, "cellAlignCenter")).toBe(true);
    const out = md(editor);
    expect(out).toContain(":-:");
    expect(tableLines(out)).toHaveLength(4);
    const ast = astOf(out);
    expect(ast.children[0].type).toBe("table");
    expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
    editor.destroy();
  });

  it("toggling the header row off still saves a valid GFM table (no dropped row)", () => {
    const editor = makeEditor();
    cursorAfter(editor, "b2");
    expect(runEditorCommand(editor, "headerRowToggle")).toBe(true);
    const out = md(editor);
    // GFM keeps the 3-row table; the former header row is now a body row.
    expect(tableLines(out)).toHaveLength(4);
    const ast = astOf(out);
    expect(ast.children[0].type).toBe("table");
    expect(ast.children[0].children).toHaveLength(3);
    expect(out).toContain("h1");
    expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
    editor.destroy();
  });

  it("delete table removes the block cleanly and keeps the surrounding text", () => {
    const editor = makeEditor("Before\n\n" + TABLE_MD + "\n\nAfter");
    cursorAfter(editor, "a2");
    expect(runEditorCommand(editor, "tableDelete")).toBe(true);
    const out = md(editor);
    expect(out).not.toContain("|");
    expect(out).toBe("Before\n\nAfter\n");
    editor.destroy();
  });
});

describe("WYSIWYG surface end-to-end (plan 03 AC2)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  afterEach(() => {
    const current = root;
    if (current) {
      act(() => current.unmount());
      root = null;
    }
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function menuItemButton(label: string): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(
      `.quillmd-context-item[aria-label="${label}"]`,
    );
    if (!button) throw new Error(`menu item not found: ${label}`);
    return button;
  }

  async function renderTableDoc(markdown: string): Promise<CoreEditor> {
    container = document.createElement("div");
    document.body.appendChild(container);
    const r = createRoot(container);
    root = r;
    await act(async () => {
      r.render(<QuillEditor value={markdown} onChange={() => {}} />);
    });
    const editor = currentFindEditor();
    if (!editor) throw new Error("no live editor");
    return editor;
  }

  function openTableMenu(editor: CoreEditor): void {
    editor.view.dom.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 80,
      }),
    );
  }

  it("right-click in a table shows the table menu, not the text menu", async () => {
    const editor = await renderTableDoc(TABLE_MD);
    await act(async () => {
      cursorAfter(editor, "a2");
      openTableMenu(editor);
    });
    const menu = document.querySelector(".quillmd-context-menu");
    expect(menu).not.toBeNull();
    // The plan 03 table item set is present...
    for (const label of [
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
      "Delete table",
    ]) {
      expect(menuItemButton(label), label).not.toBeNull();
    }
    // ...and the text menu's items are not.
    const menuText = menu!.textContent ?? "";
    expect(menuText).not.toContain("Cut");
    expect(menuText).not.toContain("Format");
    expect(menuText).not.toContain("Emoji");
  });

  it("right-click outside a table still shows the text menu", async () => {
    const editor = await renderTableDoc("Just a paragraph\n\n" + TABLE_MD);
    await act(async () => {
      // The caret in the leading paragraph, above the table.
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === "Just a paragraph") {
          editor.chain().setTextSelection(pos + 1).run();
          return false;
        }
        return true;
      });
      openTableMenu(editor);
    });
    const menu = document.querySelector(".quillmd-context-menu");
    expect(menu).not.toBeNull();
    expect(
      document.querySelector('.quillmd-context-item[aria-label="Delete table"]'),
    ).toBeNull();
    expect(menuItemButton("Format")).not.toBeNull();
  });

  it("insert column right through the menu yields a valid 3x4 GFM table in the saved text", async () => {
    const editor = await renderTableDoc(TABLE_MD);
    await act(async () => {
      cursorAfter(editor, "a2");
      openTableMenu(editor);
    });
    await act(async () => {
      menuItemButton("Insert column right").click();
    });
    // The pick ran the command and closed the menu.
    expect(document.querySelector(".quillmd-context-menu")).toBeNull();
    const out = tiptapToMarkdown(editor.getJSON());
    const lines = tableLines(out);
    expect(lines).toHaveLength(4); // 3 rows + the delimiter row
    expect(lines[1]).toMatch(/^\|[\s\-:|]+\|$/);
    for (const line of lines) {
      expect(line.match(/\|/g)).toHaveLength(5); // 4 cells
    }
    const ast = astOf(out);
    expect(ast.children[0].type).toBe("table");
    expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
  });

  it("delete table requires the native confirm and removes the block cleanly", async () => {
    const editor = await renderTableDoc("Before\n\n" + TABLE_MD + "\n\nAfter");
    await act(async () => {
      cursorAfter(editor, "a2");
      openTableMenu(editor);
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      menuItemButton("Delete table").click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(confirmSpy).toHaveBeenCalledWith("Delete this table?");
    // The menu closed on the pick...
    expect(document.querySelector(".quillmd-context-menu")).toBeNull();
    // ...and the confirmed delete removed the table, keeping the text.
    const out = tiptapToMarkdown(editor.getJSON());
    expect(out).not.toContain("|");
    expect(out).toBe("Before\n\nAfter\n");
  });

  it("declining the confirm leaves the table in place", async () => {
    const editor = await renderTableDoc(TABLE_MD);
    await act(async () => {
      cursorAfter(editor, "a2");
      openTableMenu(editor);
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => {
      menuItemButton("Delete table").click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(confirmSpy).toHaveBeenCalledWith("Delete this table?");
    const out = tiptapToMarkdown(editor.getJSON());
    expect(out).toContain("| h1 | h2 | h3 |");
    // The document is still a converter fixed point.
    expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
  });
});
