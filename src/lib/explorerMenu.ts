// The Explorer's right-click context-menu item set (plan 03 task 3.6, issue
// #44; plan 03 §2 item 6): right-clicking a file or folder in the tree shows
// Rename, Delete (native confirm, moved to the app-local trash with a
// status-bar Undo), Copy path, and Reveal in file manager; on a folder it
// also shows New file / New folder (inside that folder). Right-clicking the
// Folder section itself (no entry) shows New file / New folder (at the
// opened root) and Collapse all.
//
// This is the *definition* of that set: a declarative, pure, unit-testable
// item model plus a builder keyed on the right-click target — the same shape
// as the other per-surface builders (textMenu, imageMenu, tabMenu). The
// shared ContextMenu component (plan 03 task 3.1, issue #39) consumes items
// of this shape; Explorer renders the menu at the cursor and runs the picked
// action: the fs_* Rust commands (fileIo) for the disk operations, the
// clipboard for Copy path, and plugin-opener's revealItemInDir for Reveal.
// The destructive item (Delete) is gated on the native confirm dialog by the
// surface (Explorer.tsx), the same rule as the table/diagram/image menus.

import type { ContextMenuEntry } from "../components/ContextMenu";

export type ExplorerMenuAction =
  | "new-file"
  | "new-folder"
  | "rename"
  | "delete"
  | "copy-path"
  | "reveal"
  | "collapse-all";

// The right-clicked tree entry (a file or a folder).
export interface ExplorerMenuTarget {
  path: string;
  name: string;
  isDir: boolean;
}

export interface ExplorerMenuItem {
  // Stable item id (the key the menu renders and the tests address it by).
  id: string;
  // The label shown in the menu (plan 03 §2 item 6 wording).
  label: string;
  // Whether the item is enabled for the current target / folder state.
  enabled: boolean;
  // The explorer action the item dispatches.
  action: ExplorerMenuAction;
  // Set on the destructive item (Delete).
  danger?: boolean;
}

export interface ExplorerMenuSeparator {
  type: "separator";
  id?: string;
}

export type ExplorerMenuEntry = ExplorerMenuItem | ExplorerMenuSeparator;

export function isExplorerMenuSeparator(
  entry: ExplorerMenuEntry,
): entry is ExplorerMenuSeparator {
  return (entry as ExplorerMenuSeparator).type === "separator";
}

// The explorer item ids (plan 03 §2 item 6).
export const EXPLORER_MENU_ITEM_IDS = [
  "explorer-new-file",
  "explorer-new-folder",
  "explorer-rename",
  "explorer-delete",
  "explorer-copy-path",
  "explorer-reveal",
  "explorer-collapse-all",
] as const;

export type ExplorerMenuItemId = (typeof EXPLORER_MENU_ITEM_IDS)[number];

// Builds the explorer context menu for the right-click target. `target` is
// the tree entry, or null for the Folder section itself (no entry under the
// cursor); `hasRoot` reports whether a folder is opened (the create items
// and Collapse all need one). Pure — the surface rebuilds it on every open
// and the logic stays unit-testable (plan 03 AC1).
export function buildExplorerMenu(
  target: ExplorerMenuTarget | null,
  hasRoot: boolean,
): ExplorerMenuEntry[] {
  if (target === null) {
    // Section menu (no entry): create at the opened root, collapse the tree.
    return [
      { id: "explorer-new-file", label: "New File", enabled: hasRoot, action: "new-file" },
      { id: "explorer-new-folder", label: "New Folder", enabled: hasRoot, action: "new-folder" },
      { type: "separator", id: "explorer-sep" },
      { id: "explorer-collapse-all", label: "Collapse All", enabled: hasRoot, action: "collapse-all" },
    ];
  }
  if (target.isDir) {
    return [
      { id: "explorer-new-file", label: "New File", enabled: true, action: "new-file" },
      { id: "explorer-new-folder", label: "New Folder", enabled: true, action: "new-folder" },
      { type: "separator", id: "explorer-sep" },
      { id: "explorer-rename", label: "Rename", enabled: true, action: "rename" },
      { id: "explorer-delete", label: "Delete", enabled: true, action: "delete", danger: true },
      { type: "separator", id: "explorer-sep2" },
      { id: "explorer-copy-path", label: "Copy Path", enabled: true, action: "copy-path" },
      { id: "explorer-reveal", label: "Reveal in File Manager", enabled: true, action: "reveal" },
    ];
  }
  return [
    { id: "explorer-rename", label: "Rename", enabled: true, action: "rename" },
    { id: "explorer-delete", label: "Delete", enabled: true, action: "delete", danger: true },
    { type: "separator", id: "explorer-sep2" },
    { id: "explorer-copy-path", label: "Copy Path", enabled: true, action: "copy-path" },
    { id: "explorer-reveal", label: "Reveal in File Manager", enabled: true, action: "reveal" },
  ];
}

// Maps the pure item set to the shared ContextMenu component's entries,
// wiring each item's `onSelect` to `dispatch` (the surface runs the picked
// explorer action). Separators pass through with their stable id.
export function toExplorerContextEntries(
  items: readonly ExplorerMenuEntry[],
  dispatch: (item: ExplorerMenuItem) => void,
): ContextMenuEntry[] {
  return items.map(
    (entry): ContextMenuEntry => {
      if (isExplorerMenuSeparator(entry)) {
        return { type: "separator", id: entry.id };
      }
      return {
        id: entry.id,
        label: entry.label,
        enabled: entry.enabled,
        danger: entry.danger,
        onSelect: () => dispatch(entry),
      };
    },
  );
}
