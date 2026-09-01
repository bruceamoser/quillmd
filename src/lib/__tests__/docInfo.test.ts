import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { collectDocInfo, countLines, countWords, formatBytes, formatTimestamp } from "../docInfo";
import type { OpenFileResult } from "../fileIo";

const g = globalThis as unknown as Record<string, unknown>;

// Same minimal browser window as dialogs.test.ts: mockIPC needs window to
// exist, and the fallbacks would only fire if isTauri() were false.
function installBrowserWindow() {
  const win = {
    prompt: vi.fn(),
    confirm: vi.fn(),
    alert: vi.fn(),
  };
  g.window = win;
  return win;
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

function makeOpen(path: string, source: string, over: Partial<OpenFileResult> = {}): OpenFileResult {
  const bytes = new TextEncoder().encode(source);
  return {
    path,
    source,
    originalBytes: bytes,
    hash: "abc123",
    eol: "lf",
    bom: false,
    snapshot: null,
    ...over,
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

describe("countWords (#26)", () => {
  it("counts zero for empty and whitespace-only text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t  ")).toBe(0);
  });

  it("splits on any whitespace run, matching the status bar rule", () => {
    expect(countWords("one two   three")).toBe(3);
    expect(countWords("a\nb\nc")).toBe(3);
    expect(countWords("single")).toBe(1);
  });
});

describe("countLines (#26)", () => {
  it("counts zero for an empty document", () => {
    expect(countLines("")).toBe(0);
  });

  it("counts text lines; a trailing newline adds no phantom line", () => {
    expect(countLines("a")).toBe(1);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\n\n")).toBe(2);
    expect(countLines("a\nb\nc\n")).toBe(3);
  });

  it("treats CRLF as a single line break", () => {
    expect(countLines("a\r\nb\r\n")).toBe(2);
    expect(countLines("a\r\nb")).toBe(2);
  });
});

describe("formatBytes (#26)", () => {
  it("renders null as an em dash and small sizes in bytes", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(184)).toBe("184 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("switches units at 1024 with one decimal", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5.0 GB");
  });
});

describe("formatTimestamp (#26)", () => {
  it("renders null as an em dash", () => {
    expect(formatTimestamp(null)).toBe("—");
  });

  it("formats epoch millis as local YYYY-MM-DD HH:MM:SS", () => {
    const ms = new Date(2026, 0, 5, 9, 7, 3).getTime();
    expect(formatTimestamp(ms)).toBe("2026-01-05 09:07:03");
  });
});

describe("collectDocInfo under Tauri (#26)", () => {
  it("merges live counts, open state, and file_stat output", async () => {
    g.isTauri = true;
    const calls = tauriIpc((cmd, payload) => {
      expect(cmd).toBe("file_stat");
      expect(payload).toEqual({ path: "/docs/headings.md" });
      return { size: 184, created: 1700000000000, modified: 1700000001000 };
    });
    const open = makeOpen("/docs/headings.md", "# Heading One\n\nA paragraph");
    const info = await collectDocInfo(open, "# Heading One\n\nA paragraph", false);
    expect(calls.map((c) => c.cmd)).toEqual(["file_stat"]);
    expect(info).toEqual({
      path: "/docs/headings.md",
      displayName: "headings.md",
      size: 184,
      words: 5,
      chars: "# Heading One\n\nA paragraph".length,
      lines: 3,
      encoding: "utf-8",
      eol: "lf",
      bom: false,
      created: 1700000000000,
      modified: 1700000001000,
      snapshotSize: null,
      dirty: false,
    });
  });

  it("reports a present snapshot from the open state", async () => {
    g.isTauri = true;
    tauriIpc(() => ({ size: 10, created: null, modified: 1 }));
    const open = makeOpen("/docs/headings.md", "x", { snapshot: new Uint8Array([1, 2, 3]) });
    const info = await collectDocInfo(open, "x", true);
    expect(info.snapshotSize).toBe(3);
    expect(info.dirty).toBe(true);
  });

  it("keeps the counts when file_stat fails (file deleted on disk)", async () => {
    g.isTauri = true;
    tauriIpc(() => {
      throw new Error("io:stat /gone.md: No such file");
    });
    const open = makeOpen("/gone.md", "a b\nc");
    const info = await collectDocInfo(open, "a b\nc", false);
    expect(info.size).toBeNull();
    expect(info.created).toBeNull();
    expect(info.modified).toBeNull();
    expect(info.words).toBe(3);
    expect(info.lines).toBe(2);
  });

  it("passes created through as null where the OS lacks a birth time", async () => {
    g.isTauri = true;
    tauriIpc(() => ({ size: 1, created: null, modified: 42 }));
    const open = makeOpen("/docs/notes.md", "x");
    const info = await collectDocInfo(open, "x", false);
    expect(info.created).toBeNull();
    expect(info.modified).toBe(42);
  });
});

describe("collectDocInfo for in-memory docs (#26)", () => {
  it("skips file_stat for untitled docs and names them", async () => {
    g.isTauri = true;
    const calls = tauriIpc(() => {
      throw new Error("file_stat must not be called for untitled docs");
    });
    const open = makeOpen(":new:2", "hello world");
    const info = await collectDocInfo(open, "hello world", true);
    expect(calls).toEqual([]);
    expect(info.displayName).toBe("Untitled 2");
    expect(info.size).toBeNull();
    expect(info.created).toBeNull();
    expect(info.modified).toBeNull();
    expect(info.dirty).toBe(true);
  });

  it("degrades to nulls where the IPC layer is absent (browser dev)", async () => {
    // No mockIPC installed: window has no __TAURI_INTERNALS__, so invoke
    // rejects and the collector must degrade to nulls instead of throwing.
    const open = makeOpen("/docs/notes.md", "x y");
    const info = await collectDocInfo(open, "x y", false);
    expect(info.size).toBeNull();
    expect(info.created).toBeNull();
    expect(info.modified).toBeNull();
    expect(info.words).toBe(2);
    expect(info.path).toBe("/docs/notes.md");
  });
});

describe("known fixture: correct size/counts/EOL (plan 01 acceptance #6)", () => {
  it("collectDocInfo reports the true on-disk shape of fixtures/clean/headings.md", async () => {
    g.isTauri = true;
    const fixture = readFileSync(fileURLToPath(new URL("../../../fixtures/clean/headings.md", import.meta.url)));
    const source = fixture.subarray(fixture[0] === 0xef ? 3 : 0).toString("utf8");
    const tauriIpcCalls = tauriIpc(() => ({
      size: fixture.length,
      created: 1700000000000,
      modified: 1700000001000,
    }));
    const open = makeOpen("/fixtures/clean/headings.md", source, {
      originalBytes: fixture,
    });
    const info = await collectDocInfo(open, source, false);
    expect(tauriIpcCalls.map((c) => c.cmd)).toEqual(["file_stat"]);
    expect(info.size).toBe(184);
    expect(info.words).toBe(27);
    expect(info.chars).toBe(184);
    expect(info.lines).toBe(13);
    expect(info.eol).toBe("lf");
    expect(info.bom).toBe(false);
    expect(info.encoding).toBe("utf-8");
  });
});

describe("App.tsx / menu.rs wiring (#26)", () => {
  const repoFile = (rel: string): string => {
    const url = new URL(rel, import.meta.url);
    return readFileSync(fileURLToPath(url), "utf8");
  };

  it("App.tsx routes the file-info menu id to the properties flyout", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('id === "file-info"');
    expect(app).toContain("setInfoOpen((open) => !open)");
    expect(app).toContain("from \"./lib/docInfo\"");
    expect(app).toContain("from \"./components/DocInfoPanel\"");
    expect(app).toContain("<DocInfoPanel");
    expect(app).toMatch(/infoOpen && activeDoc &&/);
    expect(app).toContain("collectDocInfo(activeDoc.open, activeDoc.currentText, dirty)");
  });

  it("the native File menu offers Info (no shortcut, between Close All and Export)", () => {
    const menu = repoFile("../../../src-tauri/src/menu.rs");
    expect(menu).toContain('MenuItem::with_id(app, "file-info", "Info", true, None::<&str>)');
    // Print (PDF)… (plan 10 §2.4, task 10.6, issue #98) slots in after
    // Save As; Info keeps its position between Close All and Export.
    expect(menu).toContain(".items(&[&save, &save_as, &print, &close, &close_all, &info])");
  });

  it("fileIo.ts bridges the file_stat command", () => {
    const io = repoFile("../fileIo.ts");
    expect(io).toContain('invoke<FileStat>("file_stat", { path })');
    expect(io).toContain("created: number | null;");
    expect(io).toContain("modified: number | null;");
  });

  it("the flyout renders every plan-§2.6 property row", () => {
    const panel = repoFile("../../components/DocInfoPanel.tsx");
    for (const label of [
      "Path",
      "Size on disk",
      "Words",
      "Characters",
      "Lines",
      "Encoding",
      "Line endings",
      "BOM",
      "Created",
      "Modified",
      "Snapshot",
      "Changes",
    ]) {
      expect(panel).toContain(label);
    }
  });
});
