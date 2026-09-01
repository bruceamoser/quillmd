// The image's right-click context-menu item set (plan 03 task 3.4, issue
// #42; plan 03 §2 item 3): right-clicking an image node shows the image menu
// instead of the text menu — edit image (URL dialog), change alt text,
// replace image (file picker), and remove image (native confirm, undoable
// node delete).
//
// This is the *definition* of that set: a declarative, pure, unit-testable
// item model plus a builder that computes each item's enabled/danger state
// from the editor's selection — the same shape as tableMenu.ts and
// diagramMenu.ts. The shared ContextMenu component (plan 03 task 3.1, issue
// #39) consumes items of this shape; the editor's contextmenu handler
// (Editor.tsx) picks the builder from the selection — image node selection
// -> buildImageMenu, in-table -> buildTableMenu, otherwise buildTextMenu —
// renders the menu at the cursor, and dispatches the pick through the shared
// editorCommands registry (plan 03 AC1: 1:1 command mapping, identical
// behavior to the toolbar and the native menu).
//
// Every item is a registry command: edit reuses the P0-era "imageEdit"
// command (the in-app URL dialog from plan 08 task 8.4), alt text reuses it
// with the alt field focused, replace requests the native file picker flow,
// and remove is a plain undoable ProseMirror delete. The destructive item
// (Remove image) is gated on the P0 native confirm dialog by the surface
// (Editor.tsx), the same rule as the table and diagram menus (plan 03 §3).

import type { Editor as CoreEditor } from "@tiptap/core";
import type { ContextMenuEntry } from "../components/ContextMenu";
import { inImage, type EditorCommandId } from "./editorCommands";

// One item of the image context menu. `command` is the registry command id
// the item dispatches (1:1, plan 03 AC1); `enabled` is the enable/disable
// state for the current selection; `danger` marks the destructive item
// (Remove image).
export interface ImageMenuItem {
  // Stable item id (the key the menu renders and the tests address it by).
  id: string;
  // The label shown in the menu (plan 03 §2 item 3 wording).
  label: string;
  // The registry command dispatched when the item is chosen.
  command: EditorCommandId;
  // Whether the item is enabled for the current selection (on an image node).
  enabled: boolean;
  // Set on the destructive item (Remove image).
  danger?: boolean;
}

// The image item ids, in display order (plan 03 §2 item 3).
export const IMAGE_MENU_ITEM_IDS = [
  "image-edit",
  "image-alt",
  "image-replace",
  "image-delete",
] as const;

export type ImageMenuItemId = (typeof IMAGE_MENU_ITEM_IDS)[number];

// Builds the image context menu for the given editor: the plan 03 §2 item 3
// set with each item's enabled/danger state computed from the selection.
// Pure — it reads the editor state and nothing else, so the surface can
// rebuild it on every selection change and the logic stays unit-testable
// (plan 03 AC1).
export function buildImageMenu(editor: CoreEditor): ImageMenuItem[] {
  const enabled = inImage(editor);
  return [
    { id: "image-edit", label: "Edit image", command: "imageEdit", enabled },
    { id: "image-alt", label: "Change alt text", command: "imageAlt", enabled },
    { id: "image-replace", label: "Replace image", command: "imageReplace", enabled },
    {
      id: "image-delete",
      label: "Remove image",
      command: "imageDelete",
      enabled,
      danger: true,
    },
  ];
}

// Maps the pure item set to the shared ContextMenu component's entries,
// wiring each item's `onSelect` to `dispatch`. The image menu has no
// separators or submenus, so the mapping is a single flat pass — the only
// effect is the `onSelect` closure the surface supplies, which routes the
// pick through the registry (plan 03 AC1).
export function toImageContextEntries(
  items: readonly ImageMenuItem[],
  dispatch: (item: ImageMenuItem) => void,
): ContextMenuEntry[] {
  return items.map(
    (item): ContextMenuEntry => ({
      id: item.id,
      label: item.label,
      enabled: item.enabled,
      danger: item.danger,
      onSelect: () => dispatch(item),
    }),
  );
}
