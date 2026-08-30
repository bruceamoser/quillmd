import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { openPath } from "../fileIo";
import { handleDroppedPaths, isMarkdownPath } from "../dragDrop";
import type { DragDropDeps } from "../dragDrop";

const g = globalThis as unknown as Record<string, unknown>;

// Same minimal browser window as the other lib suites: mockIPC needs window
// to exist, and the drag & drop path is Tauri-only.
function installBrowserWindow() {
  const win = {
    prompt: vi.fn(),
    confirm: vi.fn(),
    alert: vi.fn(),
  };
  g.window = win;
  return win;
}

// mockIPC handler for the two commands the drop path touches: list_dir is the
// directory discriminator (resolves for folders, rejects for files), and
// open_file is the real file-open command used in the integration-style test.
function dropIpc(opts: {
  dirs?: string[];
  files?: Record<string, number[]>;
} = {}): void {
  const dirs = opts.dirs ?? [];
  const files = opts.files ?? {};
  mockIPC((cmd, payload) => {
    const p = (payload as { path: string }).path;
    if (cmd === "list_dir") {
      if (dirs.includes(p)) return [];
      throw new Error(`io: read_dir ${p}: not a directory`);
    }
    if (cmd === "open_file") {
      const bytes = files[p];
      if (bytes === undefined) {
        throw new Error(`io: read ${p}: no such file`);
      }
      return { bytes, hash: "h", eol: "lf", bom: false, snapshot: null };
    }
    throw new Error(`unexpected IPC ${cmd}`);
  });
}

function makeDeps(openFile?: Mock) {
  const status = vi.fn();
  const openFolder = vi.fn();
  const deps: DragDropDeps = {
    openFile: openFile ?? vi.fn(async () => {}),
    openFolder,
    status,
  };
  return { deps, status, openFolder, openFile: deps.openFile as Mock };
}

beforeEach(() => {
  delete g.isTauri;
  installBrowserWindow();
});

afterEach(() => {
  clearMocks();
  delete g.isTauri;
  delete g.window;
  vi.restoreAllMocks();
});

describe("isMarkdownPath (#27)", () => {
  it("accepts the plan-01 markdown extensions case-insensitively", () => {
    expect(isMarkdownPath("/docs/notes.md")).toBe(true);
    expect(isMarkdownPath("/docs/notes.markdown")).toBe(true);
    expect(isMarkdownPath("/docs/notes.mdown")).toBe(true);
    expect(isMarkdownPath("/docs/notes.mkd")).toBe(true);
    expect(isMarkdownPath("C:\\docs\\NOTES.MD")).toBe(true);
  });

  it("rejects other extensions, extensionless names, and embedded dots", () => {
    expect(isMarkdownPath("/docs/notes.txt")).toBe(false);
    expect(isMarkdownPath("/docs/notes")).toBe(false);
    expect(isMarkdownPath("/docs/notes.md.bak")).toBe(false);
    expect(isMarkdownPath("/docs/xmd")).toBe(false);
    expect(isMarkdownPath("/docs/docx.md.old")).toBe(false);
  });
});

describe("handleDroppedPaths (#27)", () => {
  it("opens 2 md files as tabs and switches the Explorer root to a dropped folder (acceptance #7)", async () => {
    dropIpc({
      dirs: ["/docs/folder"],
      files: {
        "/docs/one.md": [1, 2],
        "/docs/two.md": [3, 4],
      },
    });
    const { deps, openFile, openFolder } = makeDeps();
    await handleDroppedPaths(["/docs/one.md", "/docs/two.md", "/docs/folder"], deps);
    expect(openFile).toHaveBeenNthCalledWith(1, "/docs/one.md");
    expect(openFile).toHaveBeenNthCalledWith(2, "/docs/two.md");
    expect(openFolder).toHaveBeenCalledTimes(1);
    expect(openFolder).toHaveBeenCalledWith("/docs/folder");
  });

  it("reports one status line per dropped item, in drop order", async () => {
    dropIpc({
      dirs: ["/docs/folder"],
      files: { "/docs/one.md": [1] },
    });
    const { deps, status, openFile } = makeDeps();
    await handleDroppedPaths(["/docs/one.md", "/docs/notes.txt", "/docs/folder"], deps);
    // The opened file's own "Opened ..." line comes from the openFile dep;
    // the module reports the items it decides on itself.
    expect(status.mock.calls.map((c) => c[0])).toEqual([
      "Skipped notes.txt (not a markdown file)",
      "Opened folder /docs/folder",
    ]);
    expect(openFile).toHaveBeenCalledTimes(1);
  });

  it("skips non-markdown files without opening them", async () => {
    dropIpc({ dirs: [], files: {} });
    const { deps, status, openFile } = makeDeps();
    await handleDroppedPaths(["/docs/notes.txt", "C:\\docs\\report.docx"], deps);
    expect(openFile).not.toHaveBeenCalled();
    expect(status).toHaveBeenNthCalledWith(1, "Skipped notes.txt (not a markdown file)");
    expect(status).toHaveBeenNthCalledWith(2, "Skipped report.docx (not a markdown file)");
  });

  it("treats a directory named like a markdown file as a folder", async () => {
    dropIpc({ dirs: ["/docs/notes.md"], files: {} });
    const { deps, openFile, openFolder } = makeDeps();
    await handleDroppedPaths(["/docs/notes.md"], deps);
    expect(openFile).not.toHaveBeenCalled();
    expect(openFolder).toHaveBeenCalledWith("/docs/notes.md");
  });

  it("reports a per-file failure in the status bar without aborting the batch", async () => {
    dropIpc({ dirs: [], files: { "/docs/three.md": [1] } });
    const openFile = vi.fn(async (path: string) => {
      if (path === "/docs/bad.md") throw new Error("no such file");
    });
    const { status } = makeDeps(openFile);
    await handleDroppedPaths(["/docs/bad.md", "/docs/three.md"], {
      openFile,
      openFolder: vi.fn(),
      status,
    });
    expect(openFile).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenNthCalledWith(1, "Open failed: /docs/bad.md (Error: no such file)");
  });

  it("opens a dropped file through the real openPath invoke", async () => {
    dropIpc({ dirs: [], files: { "/docs/one.md": [35, 10] } }); // "#\n"
    const { deps, status } = makeDeps();
    const opened = await openPath("/docs/one.md");
    expect(opened.source).toBe("#\n");
    // And the same path flows through the drop handler unchanged.
    await handleDroppedPaths(["/docs/one.md"], { ...deps, openFile: openPath });
    expect(status).not.toHaveBeenCalled();
  });

  it("deduplicates repeated paths in one drop", async () => {
    dropIpc({ dirs: ["/docs/folder"], files: { "/docs/one.md": [1] } });
    const { deps, openFile, openFolder } = makeDeps();
    await handleDroppedPaths(
      ["/docs/one.md", "/docs/one.md", "/docs/folder", "/docs/folder"],
      deps,
    );
    expect(openFile).toHaveBeenCalledTimes(1);
    expect(openFolder).toHaveBeenCalledTimes(1);
  });

  it("ignores empty entries and empty drops", async () => {
    dropIpc({ dirs: [], files: {} });
    const { deps, status, openFile, openFolder } = makeDeps();
    await handleDroppedPaths([], deps);
    await handleDroppedPaths(["", "   "], deps);
    expect(openFile).not.toHaveBeenCalled();
    expect(openFolder).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });
});
