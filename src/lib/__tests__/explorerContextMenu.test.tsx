// @vitest-environment jsdom
// The Explorer's right-click context menu, end to end (plan 03 task 3.6,
// issue #44; plan 03 AC5): the picked item's disk work runs through the
// fs_* Rust commands (mocked here) — New file / New folder create real
// entries, Rename moves one, Delete is gated on the native confirm and
// moves to the app-local trash (never an unlink) so the App's status-bar
// Undo can restore it — Copy path writes to the clipboard, Reveal opens the
// OS file manager (plugin-opener), and Collapse all folds the tree.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Explorer from "../../components/Explorer";
import type { ExplorerHandle } from "../../components/Explorer";
import {
  fsNewDir,
  fsNewFile,
  fsRename,
  fsTrash,
  getOpenFolders,
  listDir,
  runningInTauri,
  setOpenFolders,
} from "../fileIo";
import type { DirEntry } from "../fileIo";
import { confirmMessage } from "../dialogs";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// The fs_* commands + listDir are the disk boundary; confirmMessage is the
// dialog boundary; plugin-opener is the OS boundary. All mocked so the
// tests stay hermetic.
vi.mock("../fileIo", () => ({
  listDir: vi.fn(),
  runningInTauri: vi.fn(() => true),
  fsNewFile: vi.fn(),
  fsNewDir: vi.fn(),
  fsRename: vi.fn(),
  fsTrash: vi.fn(),
  getOpenFolders: vi.fn(async () => []),
  setOpenFolders: vi.fn(async () => {}),
}));

vi.mock("../dialogs", () => ({
  confirmMessage: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(async () => {}),
}));

const { revealItemInDir } = await import("@tauri-apps/plugin-opener");

const ROOT = "/docs";
const SUB = "/docs/sub";
const NOTE = "/docs/note.md";

const ROOT_ENTRIES: DirEntry[] = [
  { name: "sub", path: SUB, is_dir: true },
  { name: "note.md", path: NOTE, is_dir: false },
];
const SUB_ENTRIES: DirEntry[] = [{ name: "inner.md", path: `${SUB}/inner.md`, is_dir: false }];

// The root's listing the mocked listDir reports — tests update it after a
// create/rename so a refresh sees the new entry (as the real disk would).
let rootEntries: DirEntry[] = ROOT_ENTRIES;

function mockListDir(): Mock {
  const mocked = vi.mocked(listDir);
  mocked.mockReset();
  mocked.mockImplementation(async (dir: string) => {
    if (dir === ROOT) return rootEntries;
    if (dir === SUB) return SUB_ENTRIES;
    return [];
  });
  return mocked;
}

function mockRunningTauri(tauri: boolean): void {
  vi.mocked(runningInTauri).mockReset();
  vi.mocked(runningInTauri).mockReturnValue(tauri);
}

describe("Explorer context menu (plan 03 task 3.6, issue #44)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  const explorerRef = { current: null as ExplorerHandle | null };
  let onDeleted:
    | ((entry: { path: string; name: string; isDir: boolean }, trashPath: string) => void)
    | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    rootEntries = ROOT_ENTRIES;
    mockListDir();
    mockRunningTauri(true);
    vi.mocked(getOpenFolders).mockResolvedValue([]);
    vi.mocked(setOpenFolders).mockResolvedValue();
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  async function renderExplorer(): Promise<void> {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <Explorer
          ref={(h) => {
            explorerRef.current = h;
          }}
          open
          width={240}
          onResize={() => {}}
          activePath={null}
          recentFiles={[]}
          onOpenPath={() => {}}
          onDeleted={(entry, trashPath) => onDeleted?.(entry, trashPath)}
        />,
      );
    });
    // Open the folder root and let the first listing load.
    await act(async () => {
      explorerRef.current?.openFolderPath(ROOT);
    });
  }

  function rowButton(name: string): HTMLButtonElement {
    const spans = [...container.querySelectorAll<HTMLSpanElement>(".quillmd-tree-name")];
    const span = spans.find((s) => s.textContent === name);
    const button = span?.closest("button.quillmd-tree-row");
    if (!button) throw new Error(`tree row not found: ${name}`);
    return button as HTMLButtonElement;
  }

  function hasRow(name: string): boolean {
    const spans = [...container.querySelectorAll<HTMLSpanElement>(".quillmd-tree-name")];
    return spans.some((s) => s.textContent === name);
  }

  function openRowMenu(name: string): void {
    act(() => {
      rowButton(name).dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 80 }),
      );
    });
  }

  function openSectionMenu(): void {
    const section = container.querySelectorAll(".quillmd-explorer-section")[1];
    if (!section) throw new Error("Folder section not found");
    act(() => {
      section.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 80 }),
      );
    });
  }

  function menuItemButton(label: string): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(
      `.quillmd-context-item[aria-label="${label}"]`,
    );
    if (!button) throw new Error(`menu item not found: ${label}`);
    return button;
  }

  it("keeps multiple folder roots and lets each root opt out of startup persistence", async () => {
    await renderExplorer();
    await act(async () => {
      explorerRef.current?.openFolderPath("/notes");
    });

    expect(hasRow("docs")).toBe(true);
    expect(hasRow("notes")).toBe(true);
    expect(vi.mocked(setOpenFolders)).toHaveBeenLastCalledWith([ROOT, "/notes"]);

    const unpin = container.querySelector<HTMLButtonElement>(
      `[aria-label="Don't reopen ${ROOT} on startup"]`,
    );
    expect(unpin).not.toBeNull();
    act(() => unpin!.click());
    expect(vi.mocked(setOpenFolders)).toHaveBeenLastCalledWith(["/notes"]);
  });

  it("restores persisted roots on startup", async () => {
    vi.mocked(getOpenFolders).mockResolvedValue([ROOT, "/notes", ROOT]);
    await renderExplorer();
    expect(hasRow("docs")).toBe(true);
    expect(hasRow("notes")).toBe(true);
    expect(container.querySelectorAll(".quillmd-explorer-root")).toHaveLength(2);
  });

  it("right-clicking a file row shows Rename / Delete / Copy Path / Reveal", async () => {
    await renderExplorer();
    openRowMenu("note.md");
    const menu = document.querySelector(".quillmd-context-menu");
    expect(menu).not.toBeNull();
    for (const label of ["Rename", "Delete", "Copy Path", "Reveal in File Manager"]) {
      expect(menuItemButton(label), label).not.toBeNull();
    }
    // No create items on a file row, no Collapse All (section-level).
    expect(document.querySelector('.quillmd-context-item[aria-label="New File"]')).toBeNull();
    expect(document.querySelector('.quillmd-context-item[aria-label="New Folder"]')).toBeNull();
    expect(document.querySelector('.quillmd-context-item[aria-label="Collapse All"]')).toBeNull();
  });

  it("right-clicking a folder row shows create (inside it) plus the entry items", async () => {
    await renderExplorer();
    openRowMenu("sub");
    for (const label of [
      "New File",
      "New Folder",
      "Rename",
      "Delete",
      "Copy Path",
      "Reveal in File Manager",
    ]) {
      expect(menuItemButton(label), label).not.toBeNull();
    }
  });

  it("right-clicking the Folder section shows New file / New folder / Collapse all", async () => {
    await renderExplorer();
    openSectionMenu();
    const menu = document.querySelector(".quillmd-context-menu");
    expect(menu).not.toBeNull();
    for (const label of ["New File", "New Folder", "Collapse All"]) {
      expect(menuItemButton(label), label).not.toBeNull();
    }
    expect(document.querySelector('.quillmd-context-item[aria-label="Rename"]')).toBeNull();
    expect(document.querySelector('.quillmd-context-item[aria-label="Delete"]')).toBeNull();
  });

  it("New File on a folder row creates the file inside that folder and re-reads it", async () => {
    await renderExplorer();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("new.md");
    openRowMenu("sub");
    await act(async () => {
      menuItemButton("New File").click();
    });
    expect(prompt).toHaveBeenCalledWith("New file name");
    expect(vi.mocked(fsNewFile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fsNewFile)).toHaveBeenCalledWith(SUB, "new.md");
    // The affected directory is re-read so the new entry shows up.
    expect(vi.mocked(listDir)).toHaveBeenCalledWith(SUB);
  });

  it("New Folder from the section menu creates at the opened root and expands the result", async () => {
    await renderExplorer();
    vi.spyOn(window, "prompt").mockReturnValue("chapters");
    const created = `${ROOT}/chapters`;
    // The created folder appears in the root listing on the refresh.
    rootEntries = [...ROOT_ENTRIES, { name: "chapters", path: created, is_dir: true }];
    vi.mocked(fsNewDir).mockResolvedValueOnce(created);
    openSectionMenu();
    await act(async () => {
      menuItemButton("New Folder").click();
    });
    expect(vi.mocked(fsNewDir)).toHaveBeenCalledWith(ROOT, "chapters");
    // The new folder is opened immediately (its listing is read).
    expect(vi.mocked(listDir)).toHaveBeenCalledWith(created);
    // ...and its row renders expanded.
    expect(hasRow("chapters")).toBe(true);
  });

  it("Rename prompts, moves the entry to the same directory, and re-reads it", async () => {
    await renderExplorer();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("renamed.md");
    vi.mocked(fsRename).mockResolvedValueOnce(`${ROOT}/renamed.md`);
    openRowMenu("note.md");
    await act(async () => {
      menuItemButton("Rename").click();
    });
    expect(prompt).toHaveBeenCalledWith("Rename to", "note.md");
    expect(vi.mocked(fsRename)).toHaveBeenCalledWith(NOTE, `${ROOT}/renamed.md`);
    expect(vi.mocked(listDir)).toHaveBeenCalledWith(ROOT);
  });

  it("Rename with an unchanged or empty name moves nothing", async () => {
    await renderExplorer();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("note.md");
    openRowMenu("note.md");
    await act(async () => {
      menuItemButton("Rename").click();
    });
    expect(vi.mocked(fsRename)).not.toHaveBeenCalled();
    prompt.mockReturnValue("   ");
    openRowMenu("note.md");
    await act(async () => {
      menuItemButton("Rename").click();
    });
    expect(vi.mocked(fsRename)).not.toHaveBeenCalled();
  });

  it("Delete asks the native confirm, moves to the trash (no unlink), and reports the trash path for Undo", async () => {
    await renderExplorer();
    const deleted: {
      entry: { path: string; name: string; isDir: boolean };
      trashPath: string;
    }[] = [];
    onDeleted = (entry, trashPath) => deleted.push({ entry, trashPath });
    vi.mocked(confirmMessage).mockResolvedValueOnce("yes");
    vi.mocked(fsTrash).mockResolvedValueOnce("/cfg/trash/note.md");
    openRowMenu("note.md");
    await act(async () => {
      menuItemButton("Delete").click();
    });
    expect(vi.mocked(confirmMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Delete "note.md"? It will be moved to the trash.',
        buttons: "yesNo",
      }),
    );
    expect(vi.mocked(fsTrash)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fsTrash)).toHaveBeenCalledWith(NOTE);
    // The App is told where the entry went (the Undo restore source).
    expect(deleted).toEqual([
      { entry: { path: NOTE, name: "note.md", isDir: false }, trashPath: "/cfg/trash/note.md" },
    ]);
    expect(vi.mocked(listDir)).toHaveBeenCalledWith(ROOT);
  });

  it("declining the Delete confirm leaves the entry in place", async () => {
    await renderExplorer();
    vi.mocked(confirmMessage).mockResolvedValueOnce("no");
    // Forget the initial load so only a post-action refresh would register.
    vi.mocked(listDir).mockClear();
    openRowMenu("note.md");
    await act(async () => {
      menuItemButton("Delete").click();
    });
    expect(vi.mocked(confirmMessage)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fsTrash)).not.toHaveBeenCalled();
    expect(vi.mocked(listDir)).not.toHaveBeenCalled();
    // The row is still there.
    expect(hasRow("note.md")).toBe(true);
  });

  it("Copy Path writes the entry's full path to the clipboard", async () => {
    await renderExplorer();
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    openRowMenu("note.md");
    await act(async () => {
      menuItemButton("Copy Path").click();
    });
    expect(writeText).toHaveBeenCalledWith(NOTE);
  });

  it("Reveal opens the OS file manager at the entry (plugin-opener)", async () => {
    await renderExplorer();
    openRowMenu("note.md");
    await act(async () => {
      menuItemButton("Reveal in File Manager").click();
    });
    expect(vi.mocked(revealItemInDir)).toHaveBeenCalledWith(NOTE);
  });

  it("Reveal outside the desktop app reports an error instead of failing silently", async () => {
    await renderExplorer();
    mockRunningTauri(false);
    openRowMenu("note.md");
    await act(async () => {
      menuItemButton("Reveal in File Manager").click();
    });
    expect(vi.mocked(revealItemInDir)).not.toHaveBeenCalled();
    expect(container.querySelector(".quillmd-explorer-error")?.textContent).toBe(
      "Reveal is only available in the desktop app",
    );
  });

  it("Collapse All (section menu) folds every expanded directory", async () => {
    await renderExplorer();
    // Expand the folder so its child renders...
    await act(async () => {
      rowButton("sub").click();
    });
    expect(hasRow("inner.md")).toBe(true);
    // ...then Collapse All from the section menu.
    openSectionMenu();
    await act(async () => {
      menuItemButton("Collapse All").click();
    });
    expect(hasRow("inner.md")).toBe(false);
  });

  it("a failing fs command lands in the section error line", async () => {
    await renderExplorer();
    vi.spyOn(window, "prompt").mockReturnValue("new.md");
    vi.mocked(fsNewFile).mockRejectedValueOnce("exists:/docs/sub/new.md already exists");
    openRowMenu("sub");
    await act(async () => {
      menuItemButton("New File").click();
    });
    expect(container.querySelector(".quillmd-explorer-error")?.textContent).toBe(
      "exists:/docs/sub/new.md already exists",
    );
  });
});

describe("App.tsx trash-Undo wiring (plan 03 task 3.6, issue #44)", () => {
  const repoFile = (rel: string): string => {
    const url = new URL(rel, import.meta.url);
    return readFileSync(fileURLToPath(url), "utf8");
  };

  it("the App offers a ~30s status-bar Undo after an explorer delete", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain("onDeleted={offerTrashUndo}");
    // The window is ~30s (plan 03 AC5).
    expect(app).toMatch(/setTimeout\(\(\) => \{[\s\S]*?30000\)/);
    // The readout is the deleted entry's base name.
    expect(app).toContain("trashUndo={trashUndo ? baseName(trashUndo.path) : null}");
  });

  it("the Undo restore is an fs_rename from the trash path back to the original location", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain("const undoTrashDelete = useCallback(async () => {");
    expect(app).toContain("await fsRename(undo.trashPath, undo.path)");
    expect(app).toContain('onUndoTrash={() => void undoTrashDelete()}');
  });

  it("the Explorer routes its Delete through the fs_trash command and reports the trash path", () => {
    const explorer = repoFile("../../components/Explorer.tsx");
    expect(explorer).toContain("await fsTrash(target.path)");
    expect(explorer).toContain("onDeleted?.(target, trashPath)");
    // Reveal runs through plugin-opener (the OS file manager).
    expect(explorer).toContain('await import("@tauri-apps/plugin-opener")');
    expect(explorer).toContain("await revealItemInDir(target.path)");
  });
});
