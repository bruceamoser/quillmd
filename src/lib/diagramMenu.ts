// The diagram node's context-menu item set (plan 11 task 11.6, issue #105;
// plan 11 §2.8): Edit diagram / Preview diagram / Copy diagram code / Delete
// diagram. This is the *definition* of that set — a declarative, pure,
// unit-testable item model plus a builder that computes each item's
// enabled/checked/danger state from the editor — specified for plan 03
// (#38) to implement: its shared ContextMenu component (plan 03 §2) consumes
// items of this shape, the editor's contextmenu handler resolves the
// selection to a mermaidBlock and renders buildDiagramMenu's output, and
// every item dispatches its registry command through the shared
// editorCommands registry (plan 03 AC1: 1:1 command mapping, identical
// behavior to every other surface).
//
// The item set itself is fixed by plan 11 §2.8; only the per-item state is
// computed here:
//   - all four items are enabled only while the selection is inside a
//     mermaidBlock (the menu never offers diagram actions for other blocks);
//   - "Edit diagram" / "Preview diagram" are checked while the mounted card
//     (mermaidCardMode.ts) reports that mode — mirroring the card header's
//     own Edit/Preview buttons, both of which stay available and highlight
//     the active one;
//   - "Delete diagram" is the destructive item (danger), which plan 03 gates
//     on its native confirm dialog.

import type { Editor as CoreEditor } from "@tiptap/core";
import { diagramModeOf, inDiagram, type EditorCommandId } from "./editorCommands";
import type { MermaidCardMode } from "./mermaidCardMode";

// One item of the diagram node's context menu. `command` is the registry
// command id the item dispatches (1:1, plan 03 AC1); `enabled` is the
// enable/disable state; `checked` marks the mode the item currently is
// (the Edit/Preview pair); `danger` marks the destructive item.
export interface DiagramMenuItem {
  // Stable item id (the key plan 03's menu renders and tests against).
  id: string;
  // The label shown in the menu (plan 11 §2.8 wording).
  label: string;
  // The registry command dispatched when the item is chosen.
  command: EditorCommandId;
  // Whether the item is enabled for the current selection.
  enabled: boolean;
  // Set on the Edit/Preview pair while the card is in that mode.
  checked?: boolean;
  // Set on the destructive item (Delete diagram).
  danger?: boolean;
}

// The item set, in display order (plan 11 §2.8).
export const DIAGRAM_MENU_ITEM_IDS = [
  "diagram-edit",
  "diagram-preview",
  "diagram-copy-code",
  "diagram-delete",
] as const;

export type DiagramMenuItemId = (typeof DIAGRAM_MENU_ITEM_IDS)[number];

// Builds the diagram node's context-menu item set for the given editor: the
// fixed four items with their enabled/checked/danger state computed from the
// selection (inDiagram) and the mounted card's mode (diagramModeOf). Pure —
// it reads the editor state and nothing else, so plan 03's menu can rebuild
// it on every selection change and the logic stays unit-testable.
export function buildDiagramMenu(editor: CoreEditor): DiagramMenuItem[] {
  const enabled = inDiagram(editor);
  const mode: MermaidCardMode | null = enabled ? diagramModeOf(editor) : null;
  return [
    {
      id: "diagram-edit",
      label: "Edit diagram",
      command: "diagramEdit",
      enabled,
      checked: mode === "edit",
    },
    {
      id: "diagram-preview",
      label: "Preview diagram",
      command: "diagramPreview",
      enabled,
      checked: mode === "preview",
    },
    {
      id: "diagram-copy-code",
      label: "Copy diagram code",
      command: "diagramCopyCode",
      enabled,
    },
    {
      id: "diagram-delete",
      label: "Delete diagram",
      command: "diagramDelete",
      enabled,
      danger: true,
    },
  ];
}
