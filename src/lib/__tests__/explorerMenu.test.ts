// The Explorer's right-click context menu (plan 03 task 3.6, issue #44;
// plan 03 §2 item 6): on a folder row New file / New folder (inside that
// folder) plus Rename / Delete / Copy Path / Reveal in file manager; on a
// file row Rename / Delete / Copy Path / Reveal; on the Folder section
// itself (no entry under the cursor) New file / New folder (at the opened
// root) and Collapse all. Delete is the destructive item, gated on the
// native confirm by the surface and moved to the app-local trash (never an
// unlink) so the status-bar Undo can restore it.
import { describe, expect, it } from "vitest";
import { isSeparator, type ContextMenuItem } from "../../components/ContextMenu";
import {
  EXPLORER_MENU_ITEM_IDS,
  buildExplorerMenu,
  isExplorerMenuSeparator,
  toExplorerContextEntries,
  type ExplorerMenuTarget,
} from "../explorerMenu";
import type { ExplorerMenuItem } from "../explorerMenu";

const dirTarget: ExplorerMenuTarget = { path: "/docs/sub", name: "sub", isDir: true };
const fileTarget: ExplorerMenuTarget = { path: "/docs/note.md", name: "note.md", isDir: false };

const itemsOf = (entries: ReturnType<typeof buildExplorerMenu>): ExplorerMenuItem[] =>
  entries.filter((e): e is ExplorerMenuItem => !isExplorerMenuSeparator(e));

describe("buildExplorerMenu (plan 03 §2 item 6)", () => {
  it("folder section (no entry, folder opened) offers New file / New folder / Collapse all", () => {
    const items = buildExplorerMenu(null, true);
    expect(itemsOf(items).map((i) => i.id)).toEqual([
      "explorer-new-file",
      "explorer-new-folder",
      "explorer-collapse-all",
    ]);
    expect(itemsOf(items).map((i) => i.label)).toEqual([
      "New File",
      "New Folder",
      "Collapse All",
    ]);
    // No entry under the cursor: no entry-scoped items.
    for (const id of ["explorer-rename", "explorer-delete", "explorer-copy-path", "explorer-reveal"]) {
      expect(itemsOf(items).some((i) => i.id === id), id).toBe(false);
    }
    expect(itemsOf(items).every((i) => i.enabled)).toBe(true);
  });

  it("folder section without an opened folder disables every item", () => {
    const items = buildExplorerMenu(null, false);
    expect(itemsOf(items).map((i) => i.id)).toEqual([
      "explorer-new-file",
      "explorer-new-folder",
      "explorer-collapse-all",
    ]);
    expect(itemsOf(items).every((i) => i.enabled === false)).toBe(true);
  });

  it("a folder row offers create (inside it) plus rename / delete / copy path / reveal", () => {
    const items = buildExplorerMenu(dirTarget, true);
    expect(itemsOf(items).map((i) => i.id)).toEqual([
      "explorer-new-file",
      "explorer-new-folder",
      "explorer-rename",
      "explorer-delete",
      "explorer-copy-path",
      "explorer-reveal",
    ]);
    expect(itemsOf(items).map((i) => i.label)).toEqual([
      "New File",
      "New Folder",
      "Rename",
      "Delete",
      "Copy Path",
      "Reveal in File Manager",
    ]);
    expect(itemsOf(items).every((i) => i.enabled)).toBe(true);
    // Collapse all is tree-level: it belongs to the section menu, not rows.
    expect(itemsOf(items).some((i) => i.id === "explorer-collapse-all")).toBe(false);
  });

  it("a file row offers rename / delete / copy path / reveal (no create items)", () => {
    const items = buildExplorerMenu(fileTarget, true);
    expect(itemsOf(items).map((i) => i.id)).toEqual([
      "explorer-rename",
      "explorer-delete",
      "explorer-copy-path",
      "explorer-reveal",
    ]);
    expect(itemsOf(items).every((i) => i.enabled)).toBe(true);
  });

  it("Delete is the destructive item in both entry menus", () => {
    for (const target of [dirTarget, fileTarget]) {
      const items = itemsOf(buildExplorerMenu(target, true));
      const destructive = items.filter((i) => i.danger === true);
      expect(destructive.map((i) => i.id)).toEqual(["explorer-delete"]);
    }
  });

  it("every id is part of the plan 03 explorer item set", () => {
    const ids = [
      ...itemsOf(buildExplorerMenu(null, true)),
      ...itemsOf(buildExplorerMenu(dirTarget, true)),
      ...itemsOf(buildExplorerMenu(fileTarget, true)),
    ].map((i) => i.id);
    for (const id of ids) {
      expect(EXPLORER_MENU_ITEM_IDS, id).toContain(id as (typeof EXPLORER_MENU_ITEM_IDS)[number]);
    }
  });
});

describe("toExplorerContextEntries (the ContextMenu mapping)", () => {
  it("wires each item's onSelect to the dispatch, keeps separators, and carries state", () => {
    const items = buildExplorerMenu(fileTarget, true);
    const dispatched: ExplorerMenuItem[] = [];
    const mapped = toExplorerContextEntries(items, (item) => dispatched.push(item));
    expect(mapped).toHaveLength(5); // 4 items + 1 separator
    expect(mapped.filter((e) => isSeparator(e))).toHaveLength(1);
    const del = mapped.find((e) => !isSeparator(e) && e.id === "explorer-delete") as
      | ContextMenuItem
      | undefined;
    expect(del?.label).toBe("Delete");
    expect(del?.danger).toBe(true);
    del?.onSelect?.();
    expect(dispatched.map((i) => i.action)).toEqual(["delete"]);
  });
});
