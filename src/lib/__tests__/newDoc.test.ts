import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { MARKDOWN_FILTER } from "../dialogs";
import { saveAsDefaultName } from "../fileMenu";
import {
  isUntitledPath,
  makeUntitledDoc,
  nextUntitledPath,
  rekeyDocRecord,
  saveNewDocument,
  untitledDefaultName,
  untitledDisplayName,
} from "../newDoc";
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

const saveOptionsOf = (call: IpcCall): Record<string, unknown> =>
  (call.payload as { options: Record<string, unknown> }).options;

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

describe("Synthetic untitled paths (#24)", () => {
  it("recognizes :new:<n> and rejects real or malformed paths", () => {
    expect(isUntitledPath(":new:1")).toBe(true);
    expect(isUntitledPath(":new:42")).toBe(true);
    expect(isUntitledPath("/docs/notes.md")).toBe(false);
    expect(isUntitledPath("C:\\docs\\notes.md")).toBe(false);
    expect(isUntitledPath(":new:")).toBe(false);
    expect(isUntitledPath(":new:abc")).toBe(false);
    expect(isUntitledPath(":new:1/")).toBe(false);
    expect(isUntitledPath("notes.md")).toBe(false);
    expect(isUntitledPath("")).toBe(false);
  });

  it("assigns the next free counter, reusing freed numbers", () => {
    expect(nextUntitledPath([])).toBe(":new:1");
    expect(nextUntitledPath([":new:1"])).toBe(":new:2");
    expect(nextUntitledPath([":new:1", ":new:2"])).toBe(":new:3");
    // Real paths and out-of-order synthetic paths are ignored / skipped over.
    expect(nextUntitledPath(["/docs/notes.md", ":new:2"])).toBe(":new:1");
    expect(nextUntitledPath([":new:2", ":new:1", "/x.md"])).toBe(":new:3");
  });

  it("derives the default save name and display name from the counter", () => {
    expect(untitledDefaultName(":new:3")).toBe("untitled-3.md");
    expect(untitledDefaultName(":new:1")).toBe("untitled-1.md");
    expect(untitledDisplayName(":new:2")).toBe("Untitled 2");
    expect(untitledDisplayName(":new:10")).toBe("Untitled 10");
  });
});

describe("makeUntitledDoc (#24)", () => {
  it("builds an in-memory OpenFileResult with LF/no-BOM defaults", () => {
    const opened = makeUntitledDoc(":new:1", "");
    expect(opened).toEqual({
      path: ":new:1",
      source: "",
      originalBytes: new Uint8Array(0),
      hash: "",
      eol: "lf",
      bom: false,
      snapshot: null,
    });
  });

  it("seeds template content as both source and original bytes", () => {
    const content = "# Meeting Notes\n\n**Date:**\n";
    const opened = makeUntitledDoc(":new:2", content);
    expect(opened.source).toBe(content);
    expect(new TextDecoder().decode(opened.originalBytes)).toBe(content);
  });
});

describe("Re-keying an untitled doc to its saved path (#24)", () => {
  interface DocEntry {
    open: OpenFileResult;
    currentText: string;
    viewMode: string;
  }

  function docsFor(path: string, content: string): Record<string, DocEntry> {
    return {
      [path]: { open: makeUntitledDoc(path, content), currentText: content, viewMode: "wysiwyg" },
    };
  }

  it("moves the entry to the real path, replacing the open state", () => {
    const docs = docsFor(":new:1", "# Draft\n");
    const bytes = new TextEncoder().encode("# Draft\n");
    const next = rekeyDocRecord(docs, ":new:1", "/docs/draft.md", "# Draft\n", bytes, "h1");
    expect(Object.keys(next)).toEqual(["/docs/draft.md"]);
    expect(next["/docs/draft.md"].open).toEqual({
      path: "/docs/draft.md",
      source: "# Draft\n",
      originalBytes: bytes,
      hash: "h1",
      eol: "lf",
      bom: false,
      snapshot: null,
    });
    // Content and view mode carry over untouched.
    expect(next["/docs/draft.md"].currentText).toBe("# Draft\n");
    expect(next["/docs/draft.md"].viewMode).toBe("wysiwyg");
  });

  it("leaves other tabs and the record intact when the source is gone", () => {
    const docs: Record<string, DocEntry> = {
      [":new:1"]: { open: makeUntitledDoc(":new:1", ""), currentText: "a", viewMode: "source" },
      ["/docs/other.md"]: { open: makeUntitledDoc("/docs/other.md", ""), currentText: "b", viewMode: "preview" },
    };
    const next = rekeyDocRecord(docs, ":new:9", "/docs/new.md", "x", new Uint8Array(1), "h");
    expect(next[":new:1"].currentText).toBe("a");
    expect(next["/docs/other.md"].viewMode).toBe("preview");
    expect(next["/docs/new.md"]).toBeUndefined();
  });
});

describe("First save of an untitled document (#24)", () => {
  it("seeds the save dialog with untitled-N.md and re-keys on success", async () => {
    g.isTauri = true;
    tauriIpc((cmd, payload) => {
      if (cmd === "plugin:dialog|save") {
        expect(saveOptionsOf({ cmd, payload })).toEqual({
          defaultPath: "untitled-3.md",
          filters: [MARKDOWN_FILTER],
          title: "Save",
        });
        return "/docs/notes.md";
      }
      if (cmd === "save_as") {
        expect(payload).toEqual({ path: "/docs/notes.md", bytes: [1, 2, 3] });
        return { hash: "abc123" };
      }
      throw new Error(`unexpected IPC ${cmd}`);
    });
    const onSaved = vi.fn();
    const status = vi.fn();
    await saveNewDocument(":new:3", new Uint8Array([1, 2, 3]), {
      status,
      onSaved,
    });
    expect(onSaved).toHaveBeenCalledWith("/docs/notes.md", "abc123");
    expect(status).toHaveBeenCalledWith("Saved as /docs/notes.md");
  });

  it("does not write anything when the save dialog is cancelled", async () => {
    g.isTauri = true;
    const calls = tauriIpc((cmd) => (cmd === "plugin:dialog|save" ? null : undefined));
    const onSaved = vi.fn();
    const status = vi.fn();
    await saveNewDocument(":new:1", new Uint8Array([1]), { status, onSaved });
    expect(calls.map((c) => c.cmd)).toEqual(["plugin:dialog|save"]);
    expect(onSaved).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("reports write failures in the status bar without re-keying", async () => {
    g.isTauri = true;
    tauriIpc((cmd) => {
      if (cmd === "plugin:dialog|save") return "/docs/notes.md";
      if (cmd === "save_as") throw new Error("disk full");
      throw new Error(`unexpected IPC ${cmd}`);
    });
    const onSaved = vi.fn();
    const status = vi.fn();
    await saveNewDocument(":new:1", new Uint8Array([1]), { status, onSaved });
    expect(onSaved).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith("Save failed: /docs/notes.md (Error: disk full)");
  });

  it("Save As seeds untitled-N.md for synthetic paths too", () => {
    expect(saveAsDefaultName(":new:4")).toBe("untitled-4.md");
    // Real-path behavior is unchanged.
    expect(saveAsDefaultName("/docs/notes.md")).toBe("/docs/notes.md");
    expect(saveAsDefaultName("notes.md")).toBe("notes.md");
    expect(saveAsDefaultName("")).toBe("untitled.md");
  });
});

describe("File menu + Ctrl+N wiring (#24)", () => {
  const repoFile = (rel: string): string => {
    const url = new URL(rel, import.meta.url);
    return readFileSync(fileURLToPath(url), "utf8");
  };

  it("App.tsx routes file-new and file-new-template-<id> menu events to doNew", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('id === "file-new"');
    expect(app).toContain('id.startsWith("file-new-template-")');
    expect(app).toContain('doNew(id.slice("file-new-template-".length))');
    expect(app).toContain('from "./lib/newDoc"');
    expect(app).toContain('from "./lib/templates"');
  });

  it("App.tsx binds the Ctrl+N browser-dev shortcut to doNew", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toMatch(/key === "n" && !e\.shiftKey[\s\S]{0,80}?doNew\(\)/);
  });

  it("App.tsx re-keys the untitled tab through saveNewDocument on first save", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain("isUntitledPath(doc.open.path)");
    expect(app).toContain("saveNewDocument(");
    expect(app).toContain("rekeyDoc(");
  });

  it("the native File menu offers New (Ctrl+N) and a New from Template submenu", () => {
    const menu = repoFile("../../../src-tauri/src/menu.rs");
    expect(menu).toContain('MenuItem::with_id(app, "file-new", "New", true, Some("Ctrl+N"))');
    expect(menu).toContain('SubmenuBuilder::new(app, "New from Template")');
    expect(menu).toContain('.item(&new_doc)');
    expect(menu).toContain(".item(&new_template)");
  });
});
