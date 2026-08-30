import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { confirmCloseAll, confirmCloseTab, docDisplayName } from "../tabClose";

const g = globalThis as unknown as Record<string, unknown>;

// Same minimal browser window as dialogs.test.ts: mockIPC needs window to
// exist, and the fallbacks fire when isTauri() is false.
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

const messageOf = (call: IpcCall) => (call.payload as { message: string }).message;

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

describe("docDisplayName (#25)", () => {
  it("shows Untitled <n> for synthetic paths and the base name otherwise", () => {
    expect(docDisplayName(":new:2")).toBe("Untitled 2");
    expect(docDisplayName("/docs/notes.md")).toBe("notes.md");
    expect(docDisplayName("C:\\docs\\notes.md")).toBe("notes.md");
    expect(docDisplayName("notes.md")).toBe("notes.md");
  });
});

describe("File > Close dirty-check (#25)", () => {
  it("confirms a dirty tab through the native message dialog and closes on Yes", async () => {
    g.isTauri = true;
    const calls = tauriIpc(() => "Yes");
    await expect(
      confirmCloseTab({ path: "/docs/notes.md", displayName: "notes.md", dirty: true }),
    ).resolves.toBe(true);
    expect(calls.map((c) => c.cmd)).toEqual(["plugin:dialog|message"]);
    const payload = calls[0].payload as Record<string, unknown>;
    expect(payload.message).toBe("notes.md has unsaved changes. Close anyway?");
    expect(payload.buttons).toBe("YesNo");
    expect(payload.kind).toBe("warning");
  });

  it("keeps the tab when the user answers No", async () => {
    g.isTauri = true;
    tauriIpc(() => "No");
    await expect(
      confirmCloseTab({ path: "/docs/notes.md", displayName: "notes.md", dirty: true }),
    ).resolves.toBe(false);
  });

  it("keeps the tab when the dialog is cancelled", async () => {
    g.isTauri = true;
    tauriIpc(() => "Cancel");
    await expect(
      confirmCloseTab({ path: "/docs/notes.md", displayName: "notes.md", dirty: true }),
    ).resolves.toBe(false);
  });

  it("names the untitled tab in the confirm message", async () => {
    g.isTauri = true;
    const calls = tauriIpc(() => "Yes");
    await expect(
      confirmCloseTab({ path: ":new:3", displayName: docDisplayName(":new:3"), dirty: true }),
    ).resolves.toBe(true);
    expect(messageOf(calls[0])).toBe("Untitled 3 has unsaved changes. Close anyway?");
  });

  it("falls back to window.confirm in the browser and maps yes/no", async () => {
    const win = g.window as { confirm: Mock };
    win.confirm.mockReturnValue(true);
    await expect(
      confirmCloseTab({ path: "notes.md", displayName: "notes.md", dirty: true }),
    ).resolves.toBe(true);
    expect(win.confirm).toHaveBeenCalledWith("notes.md has unsaved changes. Close anyway?");
    win.confirm.mockReturnValue(false);
    await expect(
      confirmCloseTab({ path: "notes.md", displayName: "notes.md", dirty: true }),
    ).resolves.toBe(false);
  });
});

describe("File > Close All dirty-check (#25)", () => {
  it("closes without any dialog when no tab is dirty (acceptance #5)", async () => {
    g.isTauri = true;
    const calls = tauriIpc(() => "Yes");
    await expect(
      confirmCloseAll([
        { path: "/docs/a.md", displayName: "a.md", dirty: false },
        { path: "/docs/b.md", displayName: "b.md", dirty: false },
      ]),
    ).resolves.toBe(true);
    expect(calls).toEqual([]);
  });

  it("lists every dirty tab in a single confirm dialog", async () => {
    g.isTauri = true;
    const calls = tauriIpc(() => "Yes");
    await expect(
      confirmCloseAll([
        { path: "/docs/a.md", displayName: "a.md", dirty: true },
        { path: "/docs/b.md", displayName: "b.md", dirty: false },
        { path: "/docs/c.md", displayName: "c.md", dirty: true },
      ]),
    ).resolves.toBe(true);
    expect(calls.map((c) => c.cmd)).toEqual(["plugin:dialog|message"]);
    const message = messageOf(calls[0]);
    expect(message).toContain("Close all documents?");
    expect(message).toContain("2 documents have unsaved changes");
    expect(message).toContain("a.md");
    expect(message).toContain("c.md");
    expect(message).not.toContain("  b.md");
  });

  it("wording is singular for one dirty tab", async () => {
    g.isTauri = true;
    const calls = tauriIpc(() => "Yes");
    await expect(
      confirmCloseAll([{ path: "/docs/a.md", displayName: "a.md", dirty: true }]),
    ).resolves.toBe(true);
    expect(messageOf(calls[0])).toContain("1 document has unsaved changes");
  });

  it("keeps every tab when the user answers No", async () => {
    g.isTauri = true;
    tauriIpc(() => "No");
    await expect(
      confirmCloseAll([{ path: "/docs/a.md", displayName: "a.md", dirty: true }]),
    ).resolves.toBe(false);
  });

  it("an empty batch resolves true without a dialog", async () => {
    g.isTauri = true;
    const calls = tauriIpc(() => "Yes");
    await expect(confirmCloseAll([])).resolves.toBe(true);
    expect(calls).toEqual([]);
  });
});

describe("App.tsx Close / Close All / Make a Copy wiring (#25)", () => {
  const repoFile = (rel: string): string => {
    const url = new URL(rel, import.meta.url);
    return readFileSync(fileURLToPath(url), "utf8");
  };

  it("App.tsx routes the three menu ids and confirms closes through tabClose", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('id === "file-make-a-copy"');
    expect(app).toContain('id === "file-close"');
    expect(app).toContain('id === "file-close-all"');
    expect(app).toContain("void doMakeCopy()");
    expect(app).toContain("void closeAll()");
    expect(app).toContain("confirmCloseTab(");
    expect(app).toContain("confirmCloseAll(");
    expect(app).toContain("from \"./lib/tabClose\"");
  });

  it("App.tsx serializes Make-a-copy bytes through the clean-path pipeline", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain("saveDocument(model, doc.currentText)");
    expect(app).toContain("makeCopyDocument(doc.open, bytes");
    expect(app).toContain("encodeDocument(result.text, { eol: doc.open.eol, bom: doc.open.bom })");
  });

  it("App.tsx binds the Ctrl+W browser-dev shortcut to closeDoc", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toMatch(/key === "w"[\s\S]{0,80}?closeDoc\(activePath\)/);
  });

  it("the native File menu offers Make a Copy, Close (Ctrl+W), and Close All", () => {
    const menu = repoFile("../../../src-tauri/src/menu.rs");
    expect(menu).toContain('MenuItem::with_id(app, "file-make-a-copy", "Make a Copy"');
    expect(menu).toContain('MenuItem::with_id(app, "file-close", "Close", true, Some("Ctrl+W"))');
    expect(menu).toContain('MenuItem::with_id(app, "file-close-all", "Close All"');
  });
});
