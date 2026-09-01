// Keyboard shortcut table (plan 10 task 10.5, issue #97): the single source
// of truth for every QuillMD keyboard shortcut. The Help > Shortcuts dialog
// (ShortcutsDialog.tsx) renders this table, and the drift test
// (shortcuts.test.ts) asserts that every `shortcut` string carried by the
// EDITOR_COMMANDS registry appears here — the registry and the dialog cannot
// drift from each other.
//
// Two sources are merged into one table:
//   - the editor registry (editorCommands.ts): every command that carries a
//     `shortcut` string. Those rows are generated from the registry at import
//     time, so a shortcut added to a registry command lands in the dialog
//     automatically.
//   - the app-level (menu-owned) accelerators: the File/Edit/View/Tools items
//     the native menu (menu.rs) registers and the browser-dev keydown
//     (App.tsx) handles, plus the editor-level keys (Tab, headings) that no
//     registry command carries.

import { EDITOR_COMMANDS } from "./editorCommands";
import type { EditorCommandId } from "./editorCommands";

// The display groups, in the order the dialog lists them.
export const SHORTCUT_GROUPS = [
  "File",
  "Edit",
  "Format",
  "View",
  "Tools",
  "Editor",
] as const;

export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

export interface ShortcutEntry {
  // The group heading the row renders under.
  group: ShortcutGroup;
  // The key combination, displayed verbatim (registry strings and the
  // menu.rs accelerators, rendered the way the menus show them).
  keys: string;
  // What the shortcut does (the menu item label where one exists).
  label: string;
}

// One group section of the table, as the dialog renders it.
export interface ShortcutGroupSection {
  group: ShortcutGroup;
  entries: ShortcutEntry[];
}

// The app-level (menu-owned) accelerators: every accelerator the native menu
// registers (menu.rs) or the app keydown handles (App.tsx) that no editor
// registry command carries. Registry-owned shortcuts (bold, undo, …) are NOT
// listed here — they are generated from the registry below so the key strings
// and labels stay byte-identical to the registry.
const APP_SHORTCUTS: ShortcutEntry[] = [
  { group: "File", keys: "Ctrl+N", label: "New document" },
  { group: "File", keys: "Ctrl+O", label: "Open" },
  { group: "File", keys: "Ctrl+Shift+O", label: "Open folder" },
  { group: "File", keys: "Ctrl+S", label: "Save" },
  { group: "File", keys: "Ctrl+Shift+S", label: "Save As" },
  { group: "File", keys: "Ctrl+W", label: "Close tab" },
  { group: "File", keys: "Ctrl+Q", label: "Exit" },
  { group: "Edit", keys: "Ctrl+X", label: "Cut" },
  { group: "Edit", keys: "Ctrl+C", label: "Copy" },
  { group: "Edit", keys: "Ctrl+V", label: "Paste" },
  { group: "Edit", keys: "Ctrl+F", label: "Find" },
  { group: "Edit", keys: "Ctrl+H", label: "Find and replace" },
  { group: "Edit", keys: "F3", label: "Find next" },
  { group: "Edit", keys: "Shift+F3", label: "Find previous" },
  { group: "Format", keys: "Ctrl+1..6", label: "Heading level 1–6 (press again to return to paragraph)" },
  { group: "View", keys: "Ctrl+/", label: "Toggle WYSIWYG / Source" },
  { group: "View", keys: "Ctrl+=", label: "Zoom in" },
  { group: "View", keys: "Ctrl+-", label: "Zoom out" },
  { group: "View", keys: "Ctrl+0", label: "Reset zoom" },
  { group: "View", keys: "Ctrl+wheel", label: "Zoom in / out (mouse wheel)" },
  { group: "View", keys: "Ctrl+Shift+E", label: "Toggle explorer" },
  { group: "View", keys: "Ctrl+Shift+8", label: "Toggle navigation pane" },
  { group: "View", keys: "F11", label: "Toggle full screen" },
  { group: "View", keys: "Esc", label: "Close find panel / exit full screen" },
  { group: "Tools", keys: "Ctrl+,", label: "Settings…" },
  { group: "Editor", keys: "Tab", label: "Nest list item or quote" },
  { group: "Editor", keys: "Shift+Tab", label: "Un-nest list item or quote" },
];

// The group each registry command's shortcut row renders under. A command
// without a mapping (a future registry shortcut) defaults to Format so it can
// never be silently dropped from the table.
const REGISTRY_COMMAND_GROUP: Partial<Record<EditorCommandId, ShortcutGroup>> = {
  bold: "Format",
  italic: "Format",
  strike: "Format",
  code: "Format",
  link: "Format",
  underline: "Format",
  indent: "Format",
  outdent: "Format",
  undo: "Edit",
  redo: "Edit",
  pasteAsText: "Edit",
  wordCount: "Tools",
  spelling: "Tools",
};

// Registry rows, generated so the dialog cannot drift from the registry:
// every command carrying a `shortcut` string becomes a table row with the
// registry's own key string and label.
const REGISTRY_SHORTCUTS: ShortcutEntry[] = EDITOR_COMMANDS.flatMap((command) => {
  if (!command.shortcut) return [];
  return [
    {
      group: REGISTRY_COMMAND_GROUP[command.id] ?? "Format",
      keys: command.shortcut,
      label: command.label,
    },
  ];
});

// The full single-source table: registry rows + app-level rows, deduplicated
// by key (a shortcut may only be listed once) and ordered by group.
function buildShortcutTable(): ShortcutEntry[] {
  const seen = new Set<string>();
  const rows: ShortcutEntry[] = [];
  for (const entry of [...REGISTRY_SHORTCUTS, ...APP_SHORTCUTS]) {
    if (seen.has(entry.keys)) continue;
    seen.add(entry.keys);
    rows.push(entry);
  }
  const order = new Map<string, number>(SHORTCUT_GROUPS.map((group, i) => [group, i]));
  return rows.sort(
    (a, b) =>
      (order.get(a.group) ?? 0) - (order.get(b.group) ?? 0) ||
      a.keys.localeCompare(b.keys)
  );
}

// The table the dialog renders (plan 10 task 10.5, issue #97).
export const SHORTCUTS: ShortcutEntry[] = buildShortcutTable();

// The table grouped for display: one section per non-empty group, in
// SHORTCUT_GROUPS order.
export function shortcutGroups(): ShortcutGroupSection[] {
  return SHORTCUT_GROUPS.map((group) => ({
    group,
    entries: SHORTCUTS.filter((entry) => entry.group === group),
  })).filter((section) => section.entries.length > 0);
}
