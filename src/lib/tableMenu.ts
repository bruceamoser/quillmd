// The table's right-click context-menu item set (plan 03 task 3.3, issue
// #41; plan 03 §2 item 2): right-click inside a table cell shows the table
// menu instead of the text menu — row/column insert & delete, cell
// alignment, header-row toggle, and delete table.
//
// This is the *definition* of that set: a declarative, pure, unit-testable
// item model plus a builder that computes each item's enabled/checked/
// danger state from the editor's selection. The shared ContextMenu component
// (plan 03 task 3.1, issue #39) consumes items of this shape; the editor's
// contextmenu handler (Editor.tsx) picks the builder from the selection —
// in-table -> buildTableMenu, otherwise buildTextMenu — renders the menu at
// the cursor, and dispatches the pick through the shared editorCommands
// registry (plan 03 AC1: 1:1 command mapping, identical behavior to the
// floating table toolbar and the native menu).
//
// Every item is a registry command (plan 03 §2 item 2: "all implemented as
// P2/P6 table commands dispatched through the same registry") — there are no
// surface-only actions in this menu. Items enable/disable per the selection:
// the menu is built for the selection current when the contextmenu event
// fires, and the builder reports the disabled state for a selection outside
// a table so the logic stays pure and unit-testable.

import type { Editor as CoreEditor } from "@tiptap/core";
import type { ContextMenuEntry } from "../components/ContextMenu";
import {
  cellAlignOf,
  headerRowOf,
  inTable,
  type EditorCommandId,
} from "./editorCommands";

// One item of the table context menu. `command` is the registry command id
// the item dispatches (1:1, plan 03 AC1); `enabled` is the enable/disable
// state for the current selection; `checked` marks the active toggle (the
// cell alignment currently applied, the header-row state); `danger` marks
// the destructive items (Delete row / Delete column / Delete table).
export interface TableMenuItem {
  // Stable item id (the key the menu renders and the tests address it by).
  id: string;
  // The label shown in the menu (plan 03 §2 item 2 wording).
  label: string;
  // The registry command dispatched when the item is chosen.
  command: EditorCommandId;
  // Whether the item is enabled for the current selection (inside a table).
  enabled: boolean;
  // Set on a toggle while it is active (alignment items, header row).
  checked?: boolean;
  // Set on the destructive items.
  danger?: boolean;
}

// A separator entry (the horizontal rule between the row / column / cell /
// delete groups). Carries an optional stable id so the menu can key it.
export interface TableMenuSeparator {
  type: "separator";
  id?: string;
}

export type TableMenuEntry = TableMenuItem | TableMenuSeparator;

// Type guard: a separator is the only entry kind carrying `type`.
export function isTableMenuSeparator(
  entry: TableMenuEntry,
): entry is TableMenuSeparator {
  return (entry as TableMenuSeparator).type === "separator";
}

// The top-level table item ids, in display order (plan 03 §2 item 2): the
// row group (insert above / below, delete), the column group (insert left /
// right, delete), the cell group (alignment, header row), and delete table.
// (The group separators are not items.)
export const TABLE_MENU_ITEM_IDS = [
  "table-row-above",
  "table-row-below",
  "table-row-delete",
  "table-col-left",
  "table-col-right",
  "table-col-delete",
  "table-align-left",
  "table-align-center",
  "table-align-right",
  "table-header-row",
  "table-delete",
] as const;

export type TableMenuItemId = (typeof TABLE_MENU_ITEM_IDS)[number];

// Builds the table context menu for the given editor: the plan 03 §2 item 2
// set with each item's enabled/checked/danger state computed from the
// selection. Pure — it reads the editor state and nothing else, so the
// surface can rebuild it on every selection change and the logic stays
// unit-testable (plan 03 AC1).
export function buildTableMenu(editor: CoreEditor): TableMenuEntry[] {
  const enabled = inTable(editor);
  const align = enabled ? cellAlignOf(editor) : null;
  const header = enabled ? headerRowOf(editor) : null;
  const check = (value: "left" | "center" | "right"): boolean | undefined =>
    align === value ? true : undefined;
  return [
    { id: "table-row-above", label: "Insert row above", command: "rowInsertAbove", enabled },
    { id: "table-row-below", label: "Insert row below", command: "rowInsertBelow", enabled },
    { id: "table-row-delete", label: "Delete row", command: "rowDelete", enabled, danger: true },
    { type: "separator", id: "table-sep-rows" },
    { id: "table-col-left", label: "Insert column left", command: "colInsertLeft", enabled },
    { id: "table-col-right", label: "Insert column right", command: "colInsertRight", enabled },
    { id: "table-col-delete", label: "Delete column", command: "colDelete", enabled, danger: true },
    { type: "separator", id: "table-sep-cols" },
    { id: "table-align-left", label: "Align cells left", command: "cellAlignLeft", enabled, checked: check("left") },
    { id: "table-align-center", label: "Align cells center", command: "cellAlignCenter", enabled, checked: check("center") },
    { id: "table-align-right", label: "Align cells right", command: "cellAlignRight", enabled, checked: check("right") },
    { id: "table-header-row", label: "Toggle header row", command: "headerRowToggle", enabled, checked: header === true ? true : undefined },
    { type: "separator", id: "table-sep-cell" },
    { id: "table-delete", label: "Delete table", command: "tableDelete", enabled, danger: true },
  ];
}

// Maps the pure item set to the shared ContextMenu component's entries,
// wiring each item's `onSelect` to `dispatch`. Separators pass through. The
// table menu has no submenus, so the mapping is a single flat pass — the
// only effect is the `onSelect` closure the surface supplies, which routes
// the pick through the registry (plan 03 AC1).
export function toTableContextEntries(
  items: readonly TableMenuEntry[],
  dispatch: (item: TableMenuItem) => void,
): ContextMenuEntry[] {
  return items.map((entry): ContextMenuEntry => {
    if (isTableMenuSeparator(entry)) {
      return { type: "separator", id: entry.id };
    }
    const item = entry;
    return {
      id: item.id,
      label: item.label,
      enabled: item.enabled,
      checked: item.checked,
      danger: item.danger,
      onSelect: () => dispatch(item),
    };
  });
}
