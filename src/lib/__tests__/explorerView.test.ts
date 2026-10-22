// @vitest-environment jsdom
// Explorer file filter (left content display): Markdown-only by default, the
// header toggle reveals every file, and the choice persists app-locally.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  filterDirEntries,
  filterFilePaths,
  isMarkdownFile,
  loadShowAllFiles,
  saveShowAllFiles,
} from "../explorerView";
import type { DirEntry } from "../fileIo";

const DIR = "/docs";
const ENTRIES: DirEntry[] = [
  { name: "notes.md", path: `${DIR}/notes.md`, is_dir: false },
  { name: "README.MD", path: `${DIR}/README.MD`, is_dir: false },
  { name: "spec.markdown", path: `${DIR}/spec.markdown`, is_dir: false },
  { name: "changelog.mdown", path: `${DIR}/changelog.mdown`, is_dir: false },
  { name: "index.mkd", path: `${DIR}/index.mkd`, is_dir: false },
  { name: "app.ts", path: `${DIR}/app.ts`, is_dir: false },
  { name: "image.png", path: `${DIR}/image.png`, is_dir: false },
  { name: "archive.md.bak", path: `${DIR}/archive.md.bak`, is_dir: false },
  { name: "src", path: `${DIR}/src`, is_dir: true },
  { name: "node_modules", path: `${DIR}/node_modules`, is_dir: true },
];

const names = (entries: DirEntry[]): string[] => entries.map((entry) => entry.name);

describe("isMarkdownFile", () => {
  it("accepts the CommonMark-family extensions, case-insensitively", () => {
    expect(isMarkdownFile("notes.md")).toBe(true);
    expect(isMarkdownFile("README.MD")).toBe(true);
    expect(isMarkdownFile("spec.markdown")).toBe(true);
    expect(isMarkdownFile("changelog.mdown")).toBe(true);
    expect(isMarkdownFile("index.mkd")).toBe(true);
  });

  it("rejects everything else (including a .md in the middle of the name)", () => {
    expect(isMarkdownFile("app.ts")).toBe(false);
    expect(isMarkdownFile("image.png")).toBe(false);
    expect(isMarkdownFile("archive.md.bak")).toBe(false);
    expect(isMarkdownFile("md")).toBe(false);
  });
});

describe("filterDirEntries", () => {
  it("keeps Markdown files and every directory by default", () => {
    expect(names(filterDirEntries(ENTRIES, false))).toEqual([
      "notes.md",
      "README.MD",
      "spec.markdown",
      "changelog.mdown",
      "index.mkd",
      "src",
      "node_modules",
    ]);
  });

  it("keeps every entry when the toggle is on", () => {
    expect(names(filterDirEntries(ENTRIES, true))).toEqual(names(ENTRIES));
  });

  it("does not mutate the input listing", () => {
    const listing = [...ENTRIES];
    filterDirEntries(listing, false);
    expect(listing).toEqual(ENTRIES);
  });
});

describe("filterFilePaths (the Recent section)", () => {
  const paths = ["a.md", "b.txt", "c.markdown", "d.ts"];

  it("keeps Markdown paths by default", () => {
    expect(filterFilePaths(paths, false)).toEqual(["a.md", "c.markdown"]);
  });

  it("keeps every path when the toggle is on", () => {
    expect(filterFilePaths(paths, true)).toEqual(paths);
  });
});

describe("the persisted toggle", () => {
  const KEY = "quillmd.explorer.showAllFiles";

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("defaults to Markdown only on a first run", () => {
    expect(loadShowAllFiles()).toBe(false);
  });

  it("round-trips the preference", () => {
    saveShowAllFiles(true);
    expect(localStorage.getItem(KEY)).toBe("true");
    expect(loadShowAllFiles()).toBe(true);
    saveShowAllFiles(false);
    expect(loadShowAllFiles()).toBe(false);
  });

  it("falls back to Markdown only when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadShowAllFiles()).toBe(false);
    expect(() => saveShowAllFiles(true)).not.toThrow();
  });
});
