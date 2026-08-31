import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { openPath } from "../fileIo";
import { handleDroppedPaths, isImagePath, isMarkdownPath } from "../dragDrop";
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

function makeDeps(openFile?: Mock, insertImage?: Mock) {
  const status = vi.fn();
  const openFolder = vi.fn();
  const deps: DragDropDeps = {
    openFile: openFile ?? vi.fn(async () => {}),
    openFolder,
    insertImage: insertImage ?? vi.fn(async () => true),
    status,
  };
  return {
    deps,
    status,
    openFolder,
    openFile: deps.openFile as Mock,
    insertImage: deps.insertImage as Mock,
  };
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

describe("isImagePath (#81)", () => {
  it("accepts the IMAGE_FILTER image extensions case-insensitively", () => {
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]) {
      expect(isImagePath(`/docs/photo.${ext}`), ext).toBe(true);
    }
    expect(isImagePath("C:\\docs\\PHOTO.PNG")).toBe(true);
    expect(isImagePath("C:\\docs\\photo.Jpeg")).toBe(true);
  });

  it("rejects non-image extensions, extensionless names, and embedded dots", () => {
    expect(isImagePath("/docs/notes.md")).toBe(false);
    expect(isImagePath("/docs/notes.txt")).toBe(false);
    expect(isImagePath("/docs/photo")).toBe(false);
    expect(isImagePath("/docs/photo.png.bak")).toBe(false);
    expect(isImagePath("/docs/xpng")).toBe(false);
    expect(isImagePath("/docs/photo.pgn")).toBe(false);
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
      "Skipped notes.txt (not a markdown file or image)",
      "Opened folder /docs/folder",
    ]);
    expect(openFile).toHaveBeenCalledTimes(1);
  });

  it("skips non-markdown files without opening them", async () => {
    dropIpc({ dirs: [], files: {} });
    const { deps, status, openFile, insertImage } = makeDeps();
    await handleDroppedPaths(["/docs/notes.txt", "C:\\docs\\report.docx"], deps);
    expect(openFile).not.toHaveBeenCalled();
    expect(insertImage).not.toHaveBeenCalled();
    expect(status).toHaveBeenNthCalledWith(1, "Skipped notes.txt (not a markdown file or image)");
    expect(status).toHaveBeenNthCalledWith(2, "Skipped report.docx (not a markdown file or image)");
  });

  it("routes a dropped image file through the insertImage dep, not openFile (#81)", async () => {
    dropIpc({ dirs: [], files: {} });
    const { deps, status, openFile, insertImage } = makeDeps();
    await handleDroppedPaths(["/docs/assets/photo.png"], deps);
    expect(insertImage).toHaveBeenCalledTimes(1);
    expect(insertImage).toHaveBeenCalledWith("/docs/assets/photo.png");
    expect(openFile).not.toHaveBeenCalled();
    // The from-file flow reports its own "Inserted image ..." line.
    expect(status).not.toHaveBeenCalled();
  });

  it("routes every dropped image in a multi-image drop, in order (#81)", async () => {
    dropIpc({ dirs: [], files: {} });
    const { deps, insertImage } = makeDeps();
    await handleDroppedPaths(["/a/one.png", "/b/two.JPEG", "/c/three.webp"], deps);
    expect(insertImage.mock.calls.map((c) => c[0])).toEqual([
      "/a/one.png",
      "/b/two.JPEG",
      "/c/three.webp",
    ]);
  });

  it("reports a skip line when there is no WYSIWYG editor to insert into (#81)", async () => {
    dropIpc({ dirs: [], files: {} });
    const { deps, status } = makeDeps(undefined, vi.fn(async () => false));
    await handleDroppedPaths(["/docs/photo.png"], deps);
    expect(status).toHaveBeenNthCalledWith(
      1,
      "Skipped photo.png (no WYSIWYG editor to insert into)",
    );
  });

  it("reports a per-image insert failure without aborting the batch (#81)", async () => {
    dropIpc({ dirs: [], files: { "/docs/three.md": [1] } });
    const insertImage = vi.fn(async (path: string) => {
      if (path === "/other/pic.png") throw new Error("asset_copy: permission denied");
      return true;
    });
    const { deps, status, openFile } = makeDeps(undefined, insertImage);
    await handleDroppedPaths(["/other/pic.png", "/docs/one.md", "/docs/three.md"], deps);
    expect(status).toHaveBeenNthCalledWith(
      1,
      "Image insert failed: /other/pic.png (Error: asset_copy: permission denied)",
    );
    expect(openFile).toHaveBeenNthCalledWith(2, "/docs/three.md");
  });

  it("treats a directory named like an image file as a folder (#81)", async () => {
    dropIpc({ dirs: ["/docs/photo.png"], files: {} });
    const { deps, openFile, openFolder, insertImage } = makeDeps();
    await handleDroppedPaths(["/docs/photo.png"], deps);
    expect(openFile).not.toHaveBeenCalled();
    expect(insertImage).not.toHaveBeenCalled();
    expect(openFolder).toHaveBeenCalledWith("/docs/photo.png");
  });

  it("routes a mixed drop: md opens, image inserts, unknown skips, folder opens (#81)", async () => {
    dropIpc({
      dirs: ["/docs/folder"],
      files: { "/docs/one.md": [1] },
    });
    const { deps, status, openFile, openFolder, insertImage } = makeDeps();
    await handleDroppedPaths(
      ["/docs/one.md", "/docs/photo.png", "/docs/notes.txt", "/docs/folder"],
      deps,
    );
    expect(openFile).toHaveBeenCalledWith("/docs/one.md");
    expect(insertImage).toHaveBeenCalledWith("/docs/photo.png");
    expect(openFolder).toHaveBeenCalledWith("/docs/folder");
    expect(status).toHaveBeenNthCalledWith(
      1,
      "Skipped notes.txt (not a markdown file or image)",
    );
    expect(status).toHaveBeenNthCalledWith(2, "Opened folder /docs/folder");
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
    const { deps, status } = makeDeps(openFile);
    await handleDroppedPaths(["/docs/bad.md", "/docs/three.md"], deps);
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
