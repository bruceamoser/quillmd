// Asset copy pipeline (plan 08 task 8.3, issue #78): the asset-folder
// setting, the copy_asset / file_exists invoke bridge, and the from-file
// src rule (inside the doc folder -> relative reference, no copy; outside
// -> Rust copy_asset; browser-dev / no doc folder -> fallback).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  DEFAULT_ASSET_FOLDER,
  assetSrcForPickedFile,
  climbsOutOf,
  copyAsset,
  filesExist,
  isAssetFolder,
  loadAssetFolder,
  saveAssetFolder,
} from "../assets";
import { docFolderOf } from "../images";

const g = globalThis as unknown as Record<string, unknown>;

// Minimal browser window: mockIPC needs window to exist to install
// __TAURI_INTERNALS__, mirroring docInfo.test.ts.
function installBrowserWindow() {
  const win = {
    prompt: vi.fn(),
    confirm: vi.fn(),
    alert: vi.fn(),
  };
  g.window = win;
  return win;
}

// Minimal localStorage stub: node has none, and the setting round-trip
// tests need a real store (the production code is try/catch'd and
// best-effort).
function installLocalStorage() {
  const store = new Map<string, string>();
  g.localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key) : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

interface IpcCall {
  cmd: string;
  payload: unknown;
}

// mockIPC that records every command so tests can assert the full sequence.
function tauriIpc(handler: (cmd: string, payload: unknown) => unknown): IpcCall[] {
  const calls: IpcCall[] = [];
  mockIPC((cmd, payload) => {
    calls.push({ cmd, payload });
    return handler(cmd, payload);
  });
  return calls;
}

beforeEach(() => {
  delete g.isTauri;
  installBrowserWindow();
  installLocalStorage();
});

afterEach(() => {
  clearMocks();
  delete g.isTauri;
  delete g.window;
  delete g.localStorage;
  vi.restoreAllMocks();
});

describe("asset folder setting (plan 08 §2.3)", () => {
  it("defaults to the assets subfolder when nothing is stored", () => {
    expect(DEFAULT_ASSET_FOLDER).toBe("assets");
    expect(loadAssetFolder()).toBe("assets");
  });

  it("persists the choice and restores it", () => {
    saveAssetFolder("doc");
    expect(loadAssetFolder()).toBe("doc");
    saveAssetFolder("assets");
    expect(loadAssetFolder()).toBe("assets");
  });

  it("rejects corrupted or unknown stored values", () => {
    (g.localStorage as { setItem: (k: string, v: string) => void }).setItem(
      "quillmd.assetFolder",
      JSON.stringify("everywhere"),
    );
    expect(loadAssetFolder()).toBe("assets");
    (g.localStorage as { setItem: (k: string, v: string) => void }).setItem(
      "quillmd.assetFolder",
      "not-json",
    );
    expect(loadAssetFolder()).toBe("assets");
  });

  it("isAssetFolder accepts only the two values", () => {
    expect(isAssetFolder("assets")).toBe(true);
    expect(isAssetFolder("doc")).toBe(true);
    expect(isAssetFolder("Assets")).toBe(false);
    expect(isAssetFolder(undefined)).toBe(false);
  });
});

describe("copy_asset / file_exists invoke bridge", () => {
  it("copyAsset invokes copy_asset with camelCase args", async () => {
    g.isTauri = true;
    const calls = tauriIpc((cmd, payload) => {
      expect(cmd).toBe("copy_asset");
      expect(payload).toEqual({
        src: "/in/photos/a.png",
        docDir: "/docs",
        assetFolder: "assets",
        collision: "suffix",
      });
      return "assets/a.png";
    });
    await expect(copyAsset("/in/photos/a.png", "/docs", "assets")).resolves.toBe("assets/a.png");
    expect(calls).toHaveLength(1);
  });

  it("copyAsset defaults to the assets folder", async () => {
    g.isTauri = true;
    const calls = tauriIpc(() => "assets/a.png");
    await copyAsset("/in/photos/a.png", "/docs");
    expect(calls[0].payload).toEqual({
      src: "/in/photos/a.png",
      docDir: "/docs",
      assetFolder: "assets",
      collision: "suffix",
    });
  });

  it("copyAsset passes a non-default collision through to copy_asset", async () => {
    // Plan 10 task 10.2 (issue #94): the "never" (fixed-name / overwrite)
    // behavior is a real option, not hardcoded to suffix.
    g.isTauri = true;
    const calls = tauriIpc(() => "a.png");
    await copyAsset("/in/photos/a.png", "/docs", "assets", "never");
    expect(calls[0].payload).toEqual({
      src: "/in/photos/a.png",
      docDir: "/docs",
      assetFolder: "assets",
      collision: "never",
    });
  });

  it("filesExist invokes file_exists with the path list in order", async () => {
    g.isTauri = true;
    const calls = tauriIpc((cmd, payload) => {
      expect(cmd).toBe("file_exists");
      expect(payload).toEqual({ paths: ["assets/a.png", "../missing.png"] });
      return [true, false];
    });
    await expect(filesExist(["assets/a.png", "../missing.png"])).resolves.toEqual([true, false]);
    expect(calls).toHaveLength(1);
  });
});

describe("climbsOutOf", () => {
  it("is false for paths that stay in the base directory", () => {
    expect(climbsOutOf("photo.png")).toBe(false);
    expect(climbsOutOf("assets/photo.png")).toBe(false);
    // A file literally named `..hidden.png` inside the folder is inside.
    expect(climbsOutOf("..hidden.png")).toBe(false);
  });

  it("is true when any segment is exactly ..", () => {
    expect(climbsOutOf("../photo.png")).toBe(true);
    expect(climbsOutOf("../../other/photo.png")).toBe(true);
    expect(climbsOutOf("a/../b.png")).toBe(true);
  });
});

describe("assetSrcForPickedFile (plan 08 task 8.3 copy rule)", () => {
  it("references picks inside the doc folder directly, with no copy", async () => {
    g.isTauri = true;
    const calls = tauriIpc(() => {
      throw new Error("copy_asset must not be called for in-folder picks");
    });
    expect(await assetSrcForPickedFile("/docs/notes.md", "/docs/assets/photo.png")).toBe(
      "assets/photo.png",
    );
    expect(await assetSrcForPickedFile("/docs/notes.md", "/docs/photo.png")).toBe("photo.png");
    expect(calls).toHaveLength(0);
  });

  it("copies picks outside the doc folder through copy_asset", async () => {
    g.isTauri = true;
    const calls = tauriIpc((cmd, payload) => {
      expect(cmd).toBe("copy_asset");
      expect(payload).toEqual({
        src: "/other/photo.png",
        docDir: "/docs",
        assetFolder: "assets",
        collision: "suffix",
      });
      return "assets/photo-1.png";
    });
    expect(await assetSrcForPickedFile("/docs/notes.md", "/other/photo.png")).toBe(
      "assets/photo-1.png",
    );
    expect(calls).toHaveLength(1);
  });

  it("passes the doc-folder setting through to copy_asset", async () => {
    g.isTauri = true;
    const calls = tauriIpc(() => "photo.png");
    await assetSrcForPickedFile("/docs/notes.md", "/other/photo.png", "doc");
    expect(calls[0].payload).toEqual({
      src: "/other/photo.png",
      docDir: "/docs",
      assetFolder: "doc",
      collision: "suffix",
    });
  });

  it("passes the collision setting through to copy_asset", async () => {
    // Plan 10 task 10.2 (issue #94): the collision behavior chosen in the
    // Settings dialog reaches the Rust copy_asset command.
    g.isTauri = true;
    const calls = tauriIpc(() => "photo.png");
    await assetSrcForPickedFile("/docs/notes.md", "/other/photo.png", "assets", "never");
    expect(calls[0].payload).toEqual({
      src: "/other/photo.png",
      docDir: "/docs",
      assetFolder: "assets",
      collision: "never",
    });
  });

  it("handles Windows paths and keeps the picked path verbatim", async () => {
    g.isTauri = true;
    const calls = tauriIpc(() => "assets/photo.png");
    expect(
      await assetSrcForPickedFile("C:\\docs\\notes.md", "C:\\other\\photo.png"),
    ).toBe("assets/photo.png");
    expect(calls[0].payload).toEqual({
      src: "C:\\other\\photo.png",
      docDir: "C:/docs",
      assetFolder: "assets",
      collision: "suffix",
    });
  });

  it("falls back to the relative path in the browser (no Rust layer)", async () => {
    // No g.isTauri -> isTauri() is false; no copy, no IPC.
    const calls = tauriIpc(() => {
      throw new Error("copy_asset must not be called outside Tauri");
    });
    expect(await assetSrcForPickedFile("/docs/notes.md", "/other/photo.png")).toBe(
      "../other/photo.png",
    );
    expect(calls).toHaveLength(0);
  });

  it("uses the bare file name when the document has no folder", async () => {
    g.isTauri = true;
    const calls = tauriIpc(() => {
      throw new Error("copy_asset must not be called without a doc folder");
    });
    // Unsaved :new: tab.
    expect(await assetSrcForPickedFile(":new:", "/other/photo.png")).toBe("photo.png");
    // An empty path is not on disk either.
    expect(await assetSrcForPickedFile("", "/other/photo.png")).toBe("photo.png");
    expect(calls).toHaveLength(0);
  });

  it("treats a pick under the root folder as in-folder for a root doc", async () => {
    g.isTauri = true;
    const calls = tauriIpc(() => {
      throw new Error("copy_asset must not be called for in-folder picks");
    });
    // A document at "/" has the folder "/"; a pick under it is in-folder.
    expect(await assetSrcForPickedFile("/notes.md", "/other/photo.png")).toBe(
      "other/photo.png",
    );
    expect(calls).toHaveLength(0);
  });
});

describe("docFolderOf stays absolute for the Rust copy_asset command", () => {
  it("keeps the POSIX root slash on the containing folder", () => {
    expect(docFolderOf("/docs/notes.md")).toBe("/docs");
    expect(docFolderOf("/docs/nested/notes.md")).toBe("/docs/nested");
    // A document at the filesystem root has the root as its folder.
    expect(docFolderOf("/notes.md")).toBe("/");
  });

  it("keeps the Windows drive root and uses forward slashes", () => {
    expect(docFolderOf("C:\\docs\\notes.md")).toBe("C:/docs");
  });

  it("is empty only for documents with no on-disk folder", () => {
    expect(docFolderOf("")).toBe("");
    expect(docFolderOf(":new:")).toBe("");
    expect(docFolderOf("bare-name.png")).toBe("");
  });

  it("returns a non-absolute pick as-is (browser-dev bare names)", async () => {
    g.isTauri = true;
    const calls = tauriIpc(() => {
      throw new Error("copy_asset must not be called for relative picks");
    });
    expect(await assetSrcForPickedFile("/docs/notes.md", "photo.png")).toBe("photo.png");
    expect(calls).toHaveLength(0);
  });
});
