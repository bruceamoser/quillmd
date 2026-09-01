// The tab bar's right-click context-menu item set (plan 03 task 3.6, issue
// #44; plan 03 §2 item 5): right-clicking a tab shows Close / Close Others /
// Close All. (Pin is the plan's stretch item and is not part of issue #44.)
//
// This is the *definition* of that set: a declarative, pure, unit-testable
// item model plus a builder that computes each item's enabled state — the
// same shape as the other per-surface builders (textMenu, tableMenu,
// imageMenu, linkMenu). The shared ContextMenu component (plan 03 task 3.1,
// issue #39) consumes items of this shape; TabBar renders the menu at the
// cursor and dispatches the pick to the App's close flows (the same
// closeDoc / closeAll the File menu uses, so the dirty confirm is identical).

import type { ContextMenuEntry } from "../components/ContextMenu";

export type TabMenuAction = "close" | "close-others" | "close-all";

export interface TabMenuItem {
  // Stable item id (the key the menu renders and the tests address it by).
  id: string;
  // The label shown in the menu (plan 03 §2 item 5 wording).
  label: string;
  // The keyboard shortcut hint, right-aligned in the item.
  shortcut?: string;
  // Whether the item is enabled for the current tab list.
  enabled: boolean;
  // The close flow the item dispatches.
  action: TabMenuAction;
}

export interface TabMenuSeparator {
  type: "separator";
  id?: string;
}

export type TabMenuEntry = TabMenuItem | TabMenuSeparator;

export function isTabMenuSeparator(entry: TabMenuEntry): entry is TabMenuSeparator {
  return (entry as TabMenuSeparator).type === "separator";
}

// The tab item ids, in display order (plan 03 §2 item 5).
export const TAB_MENU_ITEM_IDS = [
  "tab-close",
  "tab-close-others",
  "tab-close-all",
] as const;

export type TabMenuItemId = (typeof TAB_MENU_ITEM_IDS)[number];

// Builds the tab context menu for the right-clicked tab: the plan 03 §2 item
// 5 set with each item's enabled state computed from the open tab list.
// Pure — the surface can rebuild it on every open and the logic stays
// unit-testable (plan 03 AC1). "Close Others" needs at least one other open
// tab; "Close" and "Close All" are always available.
export function buildTabMenu(
  tabPaths: readonly string[],
  targetPath: string,
): TabMenuEntry[] {
  const hasOthers = tabPaths.some((p) => p !== targetPath);
  return [
    { id: "tab-close", label: "Close", shortcut: "Ctrl+W", enabled: true, action: "close" },
    { type: "separator", id: "tab-sep" },
    { id: "tab-close-others", label: "Close Others", enabled: hasOthers, action: "close-others" },
    { id: "tab-close-all", label: "Close All", enabled: true, action: "close-all" },
  ];
}

// Maps the pure item set to the shared ContextMenu component's entries,
// wiring each item's `onSelect` to `dispatch` (the surface routes the pick to
// its close flows). Separators pass through with their stable id.
export function toTabContextEntries(
  items: readonly TabMenuEntry[],
  dispatch: (item: TabMenuItem) => void,
): ContextMenuEntry[] {
  return items.map(
    (entry): ContextMenuEntry => {
      if (isTabMenuSeparator(entry)) {
        return { type: "separator", id: entry.id };
      }
      return {
        id: entry.id,
        label: entry.label,
        shortcut: entry.shortcut,
        enabled: entry.enabled,
        onSelect: () => dispatch(entry),
      };
    },
  );
}
