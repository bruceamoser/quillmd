import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { MARKDOWN_FILTER, pickOpenFile } from "../dialogs";
import { openPath } from "../fileIo";
import type { OpenFileResult } from "../fileIo";
import { openPickedFiles } from "../fileMenu";
import type { FileMenuDeps } from "../fileMenu";

const g = globalThis as unknown as Record<string, unknown>;

// Same minimal browser window as the other lib suites: mockIPC needs window
// to exist. The multi-open path is Tauri-only; the browser fallback (hidden
// <input type="file">) is exercised in browser dev, not under test.
function installBrowserWindow() {
  const win = {
    prompt: vi.fn(),
    confirm: vi.fn(),
    alert: vi.fn(),
  };
  g.window = win;
  return win;
}

// mockIPC covering the two commands the Ctrl+O multi-open interaction
// touches: plugin:dialog|open is the native multi-select dialog (it returns
// the picked paths, or null when the user cancels), and open_file is the
// per-file open the Rust layer performs for each picked path.
function openIpc(opts: {
  picked: string[] | null;
  files?: Record<string, number[]>;
}): Array<{ cmd: string; payload: unknown }> {
  const files = opts.files ?? {};
  const calls: Array<{ cmd: string; payload: unknown }> = [];
  mockIPC((cmd, payload) => {
    calls.push({ cmd, payload });
    if (cmd === "plugin:dialog|open") return opts.picked;
    if (cmd === "open_file") {
      const path = (payload as { path: string }).path;
      const bytes = files[path];
      if (bytes === undefined) {
        throw new Error(`io: read ${path}: no such file`);
      }
      return { bytes, hash: `h-${path}`, eol: "lf", bom: false, snapshot: null };
    }
    throw new Error(`unexpected IPC ${cmd}`);
  });
  return calls;
}

const enc = (s: string): number[] => Array.from(new TextEncoder().encode(s));

// Tab state mirroring App.tsx's addDoc: one entry per path, the added tab is
// activated, and the status bar gets one "Opened ..." line per tab. The
// snapshot-restore branch is out of scope here (no fixture carries a
// snapshot) and addRecent is orthogonal to multi-open.
interface Tab {
  open: OpenFileResult;
  currentText: string;
}

function makeTabModel() {
  const docs: Record<string, Tab> = {};
  let active: string | null = null;
  const status: string[] = [];
  return {
    docs,
    active: () => active,
    status,
    addDoc(opened: OpenFileResult) {
      docs[opened.path] = { open: opened, currentText: opened.source };
      active = opened.path;
      status.push(`Opened ${opened.path} (${opened.eol.toUpperCase()})`);
    },
  };
}

// The App.tsx openByPath composition: real openPath (invoke) + tab add, with
// the per-file failure reported to the status bar instead of thrown.
function makeOpenByPath(model: ReturnType<typeof makeTabModel>) {
  return async (path: string) => {
    try {
      model.addDoc(await openPath(path));
    } catch (err) {
      model.status.push(`Open failed: ${String(err)}`);
    }
  };
}

beforeEach(() => {
  g.isTauri = true; // acceptance #2: the Tauri/native-dialog path
  installBrowserWindow();
});

afterEach(() => {
  clearMocks();
  delete g.isTauri;
  delete g.window;
  vi.restoreAllMocks();
});

describe("Ctrl+O multi-open interaction (#28, plan 01 acceptance #2)", () => {
  it("one tab per picked file, in pick order, last picked activated", async () => {
    const calls = openIpc({
      picked: ["/docs/one.md", "/docs/two.md", "/docs/three.md"],
      files: {
        "/docs/one.md": enc("# One\n"),
        "/docs/two.md": enc("# Two\r\n"),
        "/docs/three.md": enc("three\n"),
      },
    });
    const model = makeTabModel();
    const deps: FileMenuDeps = { openByPath: makeOpenByPath(model), status: (m) => model.status.push(m) };
    await openPickedFiles(deps);

    // The dialog was the native multi-select markdown dialog.
    const dialog = calls.find((c) => c.cmd === "plugin:dialog|open");
    expect(dialog?.payload).toEqual({
      options: { multiple: true, filters: [MARKDOWN_FILTER], title: undefined },
    });

    // One tab per picked file, in pick order; the last picked is active.
    expect(Object.keys(model.docs)).toEqual(["/docs/one.md", "/docs/two.md", "/docs/three.md"]);
    expect(model.active()).toBe("/docs/three.md");
    // Each tab carries the decoded source; per-tab status line with EOL.
    expect(model.docs["/docs/one.md"].currentText).toBe("# One\n");
    expect(model.docs["/docs/two.md"].open.eol).toBe("crlf");
    expect(model.docs["/docs/three.md"].open.source).toBe("three\n");
    expect(model.status).toEqual([
      "Opened /docs/one.md (LF)",
      "Opened /docs/two.md (CRLF)",
      "Opened /docs/three.md (LF)",
    ]);
  });

  it("decodes BOM and per-file hash into the tab's open state", async () => {
    openIpc({
      picked: ["/docs/bom.md"],
      files: { "/docs/bom.md": [0xef, 0xbb, 0xbf, ...enc("bom doc\n")] },
    });
    const model = makeTabModel();
    await openPickedFiles({ openByPath: makeOpenByPath(model), status: (m) => model.status.push(m) });
    expect(model.docs["/docs/bom.md"].open.source).toBe("bom doc\n");
    expect(model.docs["/docs/bom.md"].open.originalBytes[0]).toBe(0xef);
    expect(model.docs["/docs/bom.md"].open.hash).toBe("h-/docs/bom.md");
  });

  it("a failing file in the middle does not abort the batch", async () => {
    openIpc({
      picked: ["/docs/one.md", "/docs/bad.md", "/docs/three.md"],
      files: {
        "/docs/one.md": enc("one\n"),
        "/docs/three.md": enc("three\n"),
      },
    });
    const model = makeTabModel();
    await openPickedFiles({ openByPath: makeOpenByPath(model), status: (m) => model.status.push(m) });

    // The batch continues past the failure; the last good file is active.
    expect(Object.keys(model.docs)).toEqual(["/docs/one.md", "/docs/three.md"]);
    expect(model.active()).toBe("/docs/three.md");
    expect(model.status).toEqual([
      "Opened /docs/one.md (LF)",
      "Open failed: Error: io: read /docs/bad.md: no such file",
      "Opened /docs/three.md (LF)",
    ]);
  });

  it("a cancelled dialog opens nothing and reports nothing", async () => {
    const calls = openIpc({ picked: null, files: { "/docs/one.md": enc("one\n") } });
    const model = makeTabModel();
    await openPickedFiles({ openByPath: makeOpenByPath(model), status: (m) => model.status.push(m) });
    expect(Object.keys(model.docs)).toEqual([]);
    expect(model.status).toEqual([]);
    // No file was read: only the dialog was shown.
    expect(calls.map((c) => c.cmd)).toEqual(["plugin:dialog|open"]);
  });

  it("pickOpenFile surfaces the dialog's multi-selection to the batch", async () => {
    openIpc({
      picked: ["/docs/one.md", "/docs/two.md"],
      files: {
        "/docs/one.md": enc("one\n"),
        "/docs/two.md": enc("two\n"),
      },
    });
    const picked = await pickOpenFile();
    expect(picked).toEqual(["/docs/one.md", "/docs/two.md"]);
  });
});
