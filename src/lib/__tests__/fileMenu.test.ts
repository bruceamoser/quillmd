import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { DOCX_FILTER, MARKDOWN_FILTER } from "../dialogs";
import {
  exportDefaultName,
  exportDocumentAs,
  exportFilter,
  importDocx,
  importOutputName,
  openPickedFiles,
  saveAsDefaultName,
  saveAsDocument,
} from "../fileMenu";
import type { FileMenuDeps } from "../fileMenu";

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

function makeDeps(openByPath?: Mock) {
  const status = vi.fn();
  const deps: FileMenuDeps = {
    openByPath: openByPath ?? vi.fn(async () => {}),
    status,
  };
  return { deps, status, openByPath: deps.openByPath as Mock };
}

beforeEach(() => {
  delete g.isTauri;
  // A browser window always exists: clearMocks() and mockInternals() touch it,
  // and tests simulate the user's dialog choices through it.
  installBrowserWindow();
});

afterEach(() => {
  clearMocks();
  delete g.isTauri;
  delete g.window;
  vi.restoreAllMocks();
});

describe("File > Open (multi) (#23)", () => {
  it("opens one tab per picked file, in pick order", async () => {
    g.isTauri = true;
    tauriIpc((cmd, payload) => {
      expect(cmd).toBe("plugin:dialog|open");
      const options = (payload as { options: Record<string, unknown> }).options;
      expect(options.multiple).toBe(true);
      expect(options.filters).toEqual([MARKDOWN_FILTER]);
      return ["/docs/one.md", "/docs/two.md", "/docs/three.md"];
    });
    const { deps, openByPath } = makeDeps();
    await openPickedFiles(deps);
    expect(openByPath).toHaveBeenNthCalledWith(1, "/docs/one.md");
    expect(openByPath).toHaveBeenNthCalledWith(2, "/docs/two.md");
    expect(openByPath).toHaveBeenNthCalledWith(3, "/docs/three.md");
  });

  it("does nothing when the dialog is cancelled", async () => {
    g.isTauri = true;
    tauriIpc(() => null);
    const { deps, openByPath, status } = makeDeps();
    await openPickedFiles(deps);
    expect(openByPath).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("reports a per-file failure in the status bar without aborting the batch", async () => {
    g.isTauri = true;
    tauriIpc(() => ["/docs/one.md", "/docs/bad.md", "/docs/three.md"]);
    const openByPath = vi.fn(async (path: string) => {
      if (path === "/docs/bad.md") throw new Error("no such file");
    });
    const { status } = makeDeps(openByPath);
    await openPickedFiles({ openByPath, status });
    expect(openByPath).toHaveBeenCalledTimes(3);
    expect(openByPath).toHaveBeenNthCalledWith(3, "/docs/three.md");
    expect(status).toHaveBeenCalledWith("Open failed: /docs/bad.md (Error: no such file)");
  });
});

describe("File > Save As (#23)", () => {
  it("seeds the save dialog with the current path and opens the saved copy", async () => {
    g.isTauri = true;
    tauriIpc((cmd, payload) => {
      if (cmd === "plugin:dialog|save") {
        expect(saveOptionsOf({ cmd, payload })).toEqual({
          defaultPath: "/docs/notes.md",
          filters: [MARKDOWN_FILTER],
          title: "Save As",
        });
        return "/docs/copy.md";
      }
      if (cmd === "save_as") {
        expect(payload).toEqual({ path: "/docs/copy.md", bytes: [1, 2, 3] });
        return { hash: "abc123" };
      }
      throw new Error(`unexpected IPC ${cmd}`);
    });
    const { deps, openByPath, status } = makeDeps();
    await saveAsDocument({ path: "/docs/notes.md" }, new Uint8Array([1, 2, 3]), deps);
    expect(openByPath).toHaveBeenCalledWith("/docs/copy.md");
    expect(status).toHaveBeenCalledWith("Saved as /docs/copy.md");
  });

  it("seeds the save dialog with the file name for non-absolute doc paths", async () => {
    g.isTauri = true;
    tauriIpc((cmd, payload) => {
      if (cmd === "plugin:dialog|save") {
        expect(saveOptionsOf({ cmd, payload }).defaultPath).toBe("notes.md");
        return "/out/notes.md";
      }
      if (cmd === "save_as") return { hash: "abc123" };
      throw new Error(`unexpected IPC ${cmd}`);
    });
    const { deps, openByPath } = makeDeps();
    await saveAsDocument({ path: "notes.md" }, new Uint8Array([1]), deps);
    expect(openByPath).toHaveBeenCalledWith("/out/notes.md");
  });

  it("derives the default name per doc path shape", () => {
    expect(saveAsDefaultName("/docs/notes.md")).toBe("/docs/notes.md");
    expect(saveAsDefaultName("C:\\docs\\notes.md")).toBe("C:\\docs\\notes.md");
    expect(saveAsDefaultName("notes.md")).toBe("notes.md");
    expect(saveAsDefaultName("")).toBe("untitled.md");
  });

  it("does not write anything when the save dialog is cancelled", async () => {
    g.isTauri = true;
    const calls = tauriIpc((cmd) => (cmd === "plugin:dialog|save" ? null : undefined));
    const { deps, openByPath, status } = makeDeps();
    await saveAsDocument({ path: "/docs/notes.md" }, new Uint8Array([1]), deps);
    expect(calls.map((c) => c.cmd)).toEqual(["plugin:dialog|save"]);
    expect(openByPath).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("reports write failures in the status bar", async () => {
    g.isTauri = true;
    tauriIpc((cmd) => {
      if (cmd === "plugin:dialog|save") return "/docs/copy.md";
      if (cmd === "save_as") throw new Error("disk full");
      throw new Error(`unexpected IPC ${cmd}`);
    });
    const { deps, openByPath, status } = makeDeps();
    await saveAsDocument({ path: "/docs/notes.md" }, new Uint8Array([1]), deps);
    expect(openByPath).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith("Save as failed: /docs/copy.md (Error: disk full)");
  });
});

describe("File > Export (#23)", () => {
  it("seeds the save dialog with <stem>.<ext> and the per-format filter", async () => {
    g.isTauri = true;
    tauriIpc((cmd, payload) => {
      if (cmd === "plugin:dialog|save") {
        expect(saveOptionsOf({ cmd, payload })).toEqual({
          defaultPath: "/docs/notes.pdf",
          filters: [{ name: "PDF", extensions: ["pdf"] }],
          title: "Export as PDF",
        });
        return "/docs/notes.pdf";
      }
      if (cmd === "export_document") {
        expect(payload).toEqual({
          path: "/docs/notes.md",
          format: "pdf",
          outPath: "/docs/notes.pdf",
        });
        return;
      }
      throw new Error(`unexpected IPC ${cmd}`);
    });
    const { deps, status } = makeDeps();
    await exportDocumentAs("/docs/notes.md", "pdf", deps);
    expect(status).toHaveBeenLastCalledWith("Exported /docs/notes.pdf");
  });

  it("maps txt-plain to the .txt extension and filter", () => {
    expect(exportDefaultName("/docs/notes.md", "txt-plain")).toBe("/docs/notes.txt");
    expect(exportFilter("txt-plain")).toEqual({ name: "TXT", extensions: ["txt"] });
    expect(exportDefaultName("/docs/notes.md", "txt")).toBe("/docs/notes.txt");
  });

  it("keeps the directory of a Windows doc path", () => {
    expect(exportDefaultName("C:\\docs\\notes.md", "docx")).toBe("C:\\docs\\notes.docx");
    expect(exportDefaultName("C:\\docs\\notes.md", "epub")).toBe("C:\\docs\\notes.epub");
  });

  it("does not convert anything when the save dialog is cancelled", async () => {
    g.isTauri = true;
    const calls = tauriIpc((cmd) => (cmd === "plugin:dialog|save" ? null : undefined));
    const { deps, status } = makeDeps();
    await exportDocumentAs("/docs/notes.md", "pdf", deps);
    expect(calls.map((c) => c.cmd)).toEqual(["plugin:dialog|save"]);
    expect(status).not.toHaveBeenCalledWith(expect.stringContaining("Exported"));
  });

  it("reports conversion failures in the status bar", async () => {
    g.isTauri = true;
    tauriIpc((cmd) => {
      if (cmd === "plugin:dialog|save") return "/docs/notes.pdf";
      if (cmd === "export_document") throw new Error("tool_missing: typst");
      throw new Error(`unexpected IPC ${cmd}`);
    });
    const { deps, status } = makeDeps();
    await exportDocumentAs("/docs/notes.md", "pdf", deps);
    expect(status).toHaveBeenLastCalledWith("Export failed: Error: tool_missing: typst");
  });
});

describe("File > Import DOCX (#23)", () => {
  it("picks the docx source and .md destination, converts, and opens the result", async () => {
    g.isTauri = true;
    tauriIpc((cmd, payload) => {
      if (cmd === "plugin:dialog|open") {
        const options = (payload as { options: Record<string, unknown> }).options;
        expect(options.filters).toEqual([DOCX_FILTER]);
        return ["/docs/report.docx"];
      }
      if (cmd === "plugin:dialog|save") {
        expect(saveOptionsOf({ cmd, payload })).toEqual({
          defaultPath: "/docs/report.md",
          filters: [MARKDOWN_FILTER],
          title: "Save imported markdown as",
        });
        return "/docs/report.md";
      }
      if (cmd === "import_document") {
        expect(payload).toEqual({ path: "/docs/report.docx", outMdPath: "/docs/report.md" });
        return;
      }
      throw new Error(`unexpected IPC ${cmd}`);
    });
    const { deps, openByPath, status } = makeDeps();
    await importDocx(deps);
    expect(openByPath).toHaveBeenCalledWith("/docs/report.md");
    expect(status).toHaveBeenLastCalledWith("Imported /docs/report.docx -> /docs/report.md");
  });

  it("derives the output name from the docx stem on both path styles", () => {
    expect(importOutputName("/docs/report.docx")).toBe("/docs/report.md");
    expect(importOutputName("C:\\docs\\report.docx")).toBe("C:\\docs\\report.md");
    expect(importOutputName("report")).toBe("imported.md");
  });

  it("stops without converting when the source dialog is cancelled", async () => {
    g.isTauri = true;
    const calls = tauriIpc((cmd) => (cmd === "plugin:dialog|open" ? null : undefined));
    const { deps, openByPath } = makeDeps();
    await importDocx(deps);
    expect(calls.map((c) => c.cmd)).toEqual(["plugin:dialog|open"]);
    expect(openByPath).not.toHaveBeenCalled();
  });

  it("stops without converting when the output dialog is cancelled", async () => {
    g.isTauri = true;
    const calls = tauriIpc((cmd) => {
      if (cmd === "plugin:dialog|open") return ["/docs/report.docx"];
      if (cmd === "plugin:dialog|save") return null;
      throw new Error(`unexpected IPC ${cmd}`);
    });
    const { deps, openByPath } = makeDeps();
    await importDocx(deps);
    expect(calls.map((c) => c.cmd)).toEqual(["plugin:dialog|open", "plugin:dialog|save"]);
    expect(openByPath).not.toHaveBeenCalled();
  });

  it("reports conversion failures in the status bar", async () => {
    g.isTauri = true;
    tauriIpc((cmd) => {
      if (cmd === "plugin:dialog|open") return ["/docs/report.docx"];
      if (cmd === "plugin:dialog|save") return "/docs/report.md";
      if (cmd === "import_document") throw new Error("corrupt docx");
      throw new Error(`unexpected IPC ${cmd}`);
    });
    const { deps, openByPath, status } = makeDeps();
    await importDocx(deps);
    expect(openByPath).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith("Import failed: Error: corrupt docx");
  });
});

describe("prompt() paths deleted from the File menu wiring (#23)", () => {
  // The legacy window.prompt labels for file operations must be gone from
  // App.tsx (they were the Open / Save As / Export / Import path inputs), and
  // the file-menu orchestration module must never call window.prompt itself.
  const repoFile = (rel: string): string => {
    const url = new URL(rel, import.meta.url);
    return readFileSync(fileURLToPath(url), "utf8");
  };

  it("App.tsx no longer contains the file-op prompt labels", () => {
    const app = repoFile("../../App.tsx");
    const legacy = [
      "Open file (absolute path)",
      "Save as path",
      "Export as ",
      "Path to .docx file",
      "Save imported markdown as",
      "Enter absolute file path",
    ];
    for (const label of legacy) {
      expect(app, `App.tsx must not contain prompt label ${JSON.stringify(label)}`).not.toContain(
        label,
      );
    }
  });

  it("fileMenu.ts never calls window.prompt", () => {
    const fileMenu = repoFile("../fileMenu.ts");
    expect(fileMenu).not.toContain("window.prompt(");
  });

  it("fileMenu.ts routes every file operation through dialogs.ts", () => {
    const fileMenu = repoFile("../fileMenu.ts");
    expect(fileMenu).toContain('from "./dialogs"');
    expect(fileMenu).toContain("pickOpenFile(");
    expect(fileMenu).toContain("pickSavePath(");
  });
});
