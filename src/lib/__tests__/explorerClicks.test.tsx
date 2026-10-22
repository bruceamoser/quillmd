// @vitest-environment jsdom
// Explorer click model + file filter (left content display): Markdown-only by
// default with a header toggle, a single click that replaces the active tab
// after the double-click window, and a double click that opens a new tab.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Explorer from "../../components/Explorer";
import type { ExplorerHandle } from "../../components/Explorer";
import { getOpenFolders, listDir, runningInTauri, setOpenFolders } from "../fileIo";
import type { DirEntry } from "../fileIo";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// The disk + folder-persistence boundary is mocked; the component itself is
// real, so the filter and the click timing run exactly as they do in the app.
vi.mock("../fileIo", () => ({
  listDir: vi.fn(),
  runningInTauri: vi.fn(() => true),
  getOpenFolders: vi.fn(async () => []),
  setOpenFolders: vi.fn(async () => {}),
}));

const ROOT = "/docs";
const NOTE = "/docs/note.md";
const OTHER = "/docs/other.md";
const TEXT = "/docs/notes.txt";
const SUB = "/docs/sub";

const ROOT_ENTRIES: DirEntry[] = [
  { name: "note.md", path: NOTE, is_dir: false },
  { name: "other.md", path: OTHER, is_dir: false },
  { name: "notes.txt", path: TEXT, is_dir: false },
  { name: "sub", path: SUB, is_dir: true },
];

describe("Explorer file filter + click model", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  const explorerRef = { current: null as ExplorerHandle | null };
  let onOpenPath: Mock<(path: string) => void>;
  let onOpenPathInNewTab: Mock<(path: string) => void>;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(runningInTauri).mockReturnValue(true);
    vi.mocked(getOpenFolders).mockResolvedValue([]);
    vi.mocked(setOpenFolders).mockResolvedValue();
    vi.mocked(listDir).mockImplementation(async (dir: string) =>
      dir === ROOT ? ROOT_ENTRIES : [],
    );
    onOpenPath = vi.fn<(path: string) => void>();
    onOpenPathInNewTab = vi.fn<(path: string) => void>();
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
          ref={(handle) => {
            explorerRef.current = handle;
          }}
          open
          width={240}
          onResize={() => {}}
          activePath={null}
          recentFiles={[]}
          onOpenPath={(path) => onOpenPath(path)}
          onOpenPathInNewTab={(path) => onOpenPathInNewTab(path)}
        />,
      );
    });
    await act(async () => {
      explorerRef.current?.openFolderPath(ROOT);
    });
  }

  function hasRow(name: string): boolean {
    return [...container.querySelectorAll<HTMLSpanElement>(".quillmd-tree-name")].some(
      (span) => span.textContent === name,
    );
  }

  function rowButton(name: string): HTMLButtonElement {
    const span = [...container.querySelectorAll<HTMLSpanElement>(".quillmd-tree-name")].find(
      (s) => s.textContent === name,
    );
    const button = span?.closest("button.quillmd-tree-row");
    if (!button) throw new Error(`tree row not found: ${name}`);
    return button as HTMLButtonElement;
  }

  function filterToggle(): HTMLButtonElement {
    const button = container.querySelector<HTMLButtonElement>(".quillmd-explorer-filter");
    if (!button) throw new Error("filter toggle not found");
    return button;
  }

  function click(row: HTMLButtonElement, detail: number): void {
    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, detail }));
    });
  }

  async function waitOutDoubleClickWindow(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
  }

  it("shows only Markdown files by default and reveals the rest on toggle", async () => {
    await renderExplorer();
    expect(hasRow("note.md")).toBe(true);
    expect(hasRow("other.md")).toBe(true);
    expect(hasRow("sub")).toBe(true);
    expect(hasRow("notes.txt")).toBe(false);

    const toggle = filterToggle();
    expect(toggle.textContent).toBe("Markdown");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("title")).toContain("Showing Markdown files only");

    act(() => toggle.click());
    expect(hasRow("notes.txt")).toBe(true);
    expect(toggle.textContent).toBe("All files");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("quillmd.explorer.showAllFiles")).toBe("true");

    act(() => toggle.click());
    expect(hasRow("notes.txt")).toBe(false);
    expect(localStorage.getItem("quillmd.explorer.showAllFiles")).toBe("false");
  });

  it("remembers the all-files toggle on the next mount", async () => {
    localStorage.setItem("quillmd.explorer.showAllFiles", "true");
    await renderExplorer();
    expect(hasRow("notes.txt")).toBe(true);
    expect(filterToggle().textContent).toBe("All files");
  });

  it("filters the Recent list with the same rule", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <Explorer
          open
          width={240}
          onResize={() => {}}
          activePath={null}
          recentFiles={[NOTE, TEXT]}
          onOpenPath={(path) => onOpenPath(path)}
          onOpenPathInNewTab={(path) => onOpenPathInNewTab(path)}
        />,
      );
    });
    // Let the mount-time folder persistence read settle inside act().
    await act(async () => {});
    expect(hasRow("note.md")).toBe(true);
    expect(hasRow("notes.txt")).toBe(false);
    act(() => filterToggle().click());
    expect(hasRow("notes.txt")).toBe(true);
  });

  it("single click replaces the active tab after the double-click window", async () => {
    await renderExplorer();
    click(rowButton("note.md"), 1);
    // Held briefly so a second click can turn it into a double click.
    expect(onOpenPath).not.toHaveBeenCalled();
    await waitOutDoubleClickWindow();
    expect(onOpenPath).toHaveBeenCalledWith(NOTE);
    expect(onOpenPathInNewTab).not.toHaveBeenCalled();
  });

  it("double click opens a new tab and cancels the pending replace", async () => {
    await renderExplorer();
    const row = rowButton("other.md");
    click(row, 1);
    click(row, 2);
    expect(onOpenPathInNewTab).toHaveBeenCalledWith(OTHER);
    await waitOutDoubleClickWindow();
    expect(onOpenPath).not.toHaveBeenCalled();
  });
});
