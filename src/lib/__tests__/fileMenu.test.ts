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
  makeCopyDefaultName,
  makeCopyDocument,
  openPickedFiles,
  saveAsDefaultName,
  saveAsDocument,
} from "../fileMenu";
import type { FileMenuDeps } from "../fileMenu";
import { exportCurrentDocument } from "../mermaidExport";

// The pipeline itself (fence discovery, PNG rendering, temp assets, cleanup)
// is covered in mermaidExport.test.ts; here we only verify the File > Export
// wiring: dialog, job arguments, and status reporting.
vi.mock("../mermaidExport", () => ({
  exportCurrentDocument: vi.fn(async () => {}),
}));

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
  vi.mocked(exportCurrentDocument).mockReset();
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

describe("File > Make a copy (#25)", () => {
  it("seeds the save dialog with <stem>-copy.<ext>, writes, and opens the copy", async () => {
    g.isTauri = true;
    tauriIpc((cmd, payload) => {
      if (cmd === "plugin:dialog|save") {
        expect(saveOptionsOf({ cmd, payload })).toEqual({
          defaultPath: "/docs/notes-copy.md",
          filters: [MARKDOWN_FILTER],
          title: "Make a Copy",
        });
        return "/docs/notes-copy.md";
      }
      if (cmd === "save_as") {
        expect(payload).toEqual({ path: "/docs/notes-copy.md", bytes: [1, 2, 3] });
        return { hash: "abc123" };
      }
      throw new Error(`unexpected IPC ${cmd}`);
    });
    const { deps, openByPath, status } = makeDeps();
    await makeCopyDocument({ path: "/docs/notes.md" }, new Uint8Array([1, 2, 3]), deps);
    // The copy opens as its own tab; the original path is never rewritten.
    expect(openByPath).toHaveBeenCalledWith("/docs/notes-copy.md");
    expect(status).toHaveBeenCalledWith("Copied to /docs/notes-copy.md");
  });

  it("derives the default copy name per path shape (Windows + extensionless)", () => {
    expect(makeCopyDefaultName("/docs/notes.md")).toBe("/docs/notes-copy.md");
    expect(makeCopyDefaultName("C:\\docs\\notes.md")).toBe("C:\\docs\\notes-copy.md");
    expect(makeCopyDefaultName("C:\\docs\\report.markdown")).toBe("C:\\docs\\report-copy.markdown");
    expect(makeCopyDefaultName("notes.md")).toBe("notes-copy.md");
    expect(makeCopyDefaultName("notes")).toBe("notes-copy.md");
    expect(makeCopyDefaultName("")).toBe("untitled-copy.md");
  });

  it("seeds untitled-N.md for synthetic untitled paths", () => {
    expect(makeCopyDefaultName(":new:2")).toBe("untitled-2.md");
  });

  it("does not write anything when the save dialog is cancelled", async () => {
    g.isTauri = true;
    const calls = tauriIpc((cmd) => (cmd === "plugin:dialog|save" ? null : undefined));
    const { deps, openByPath, status } = makeDeps();
    await makeCopyDocument({ path: "/docs/notes.md" }, new Uint8Array([1]), deps);
    expect(calls.map((c) => c.cmd)).toEqual(["plugin:dialog|save"]);
    expect(openByPath).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("reports write failures in the status bar without opening a tab", async () => {
    g.isTauri = true;
    tauriIpc((cmd) => {
      if (cmd === "plugin:dialog|save") return "/docs/notes-copy.md";
      if (cmd === "save_as") throw new Error("disk full");
      throw new Error(`unexpected IPC ${cmd}`);
    });
    const { deps, openByPath, status } = makeDeps();
    await makeCopyDocument({ path: "/docs/notes.md" }, new Uint8Array([1]), deps);
    expect(openByPath).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(
      "Make a copy failed: /docs/notes-copy.md (Error: disk full)",
    );
  });
});

describe("File > Export (#23, mermaid pipeline #104)", () => {
  const job = { docPath: "/docs/notes.md", markdown: "# T\n\nText.\n", theme: "quill" as const };

  it("seeds the save dialog with <stem>.<ext> and the per-format filter, then runs the pipeline on the current text", async () => {
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
      throw new Error(`unexpected IPC ${cmd}`);
    });
    const { deps, status } = makeDeps();
    await exportDocumentAs(job, "pdf", deps);
    expect(vi.mocked(exportCurrentDocument)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(exportCurrentDocument)).toHaveBeenCalledWith({
      markdown: job.markdown,
      theme: "quill",
      format: "pdf",
      outPath: "/docs/notes.pdf",
    });
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

  it("does not run the pipeline when the save dialog is cancelled", async () => {
    g.isTauri = true;
    const calls = tauriIpc((cmd) => (cmd === "plugin:dialog|save" ? null : undefined));
    const { deps, status } = makeDeps();
    await exportDocumentAs(job, "pdf", deps);
    expect(calls.map((c) => c.cmd)).toEqual(["plugin:dialog|save"]);
    expect(vi.mocked(exportCurrentDocument)).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalledWith(expect.stringContaining("Exported"));
  });

  it("reports pipeline failures in the status bar", async () => {
    g.isTauri = true;
    vi.mocked(exportCurrentDocument).mockRejectedValueOnce(
      new Error("tool_missing: typst"),
    );
    tauriIpc((cmd) => (cmd === "plugin:dialog|save" ? "/docs/notes.pdf" : undefined));
    const { deps, status } = makeDeps();
    await exportDocumentAs(job, "pdf", deps);
    expect(status).toHaveBeenLastCalledWith("Export failed: Error: tool_missing: typst");
  });

  it("reports a refused mermaid export with the named diagrams", async () => {
    g.isTauri = true;
    vi.mocked(exportCurrentDocument).mockRejectedValueOnce(
      new Error("Mermaid export refused: diagram 2: Parse error on line 1"),
    );
    tauriIpc((cmd) => (cmd === "plugin:dialog|save" ? "/docs/notes.pdf" : undefined));
    const { deps, status } = makeDeps();
    await exportDocumentAs(job, "pdf", deps);
    expect(status).toHaveBeenLastCalledWith(
      "Export failed: Error: Mermaid export refused: diagram 2: Parse error on line 1",
    );
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

describe("File > Print (PDF)… alias (plan 10 §2.4, task 10.6, issue #98)", () => {
  // The alias must dispatch the PDF export with its save dialog (AC5): the
  // native menu item, the App.tsx routing to doExport("pdf"), the Ctrl+P
  // accelerator (native + browser dev), and the shortcuts table row.
  const repoFile = (rel: string): string => {
    const url = new URL(rel, import.meta.url);
    return readFileSync(fileURLToPath(url), "utf8");
  };

  it("menu.rs adds File > Print (PDF)… with the Ctrl+P accelerator", () => {
    const menu = repoFile("../../../src-tauri/src/menu.rs");
    expect(menu).toContain(
      'MenuItem::with_id(app, "file-print", "Print (PDF)…", true, Some("Ctrl+P"))'
    );
    expect(menu).toContain(".items(&[&save, &save_as, &print, &close, &close_all, &info])");
  });

  it("App.tsx routes file-print to the pdf export (save dialog + pipeline)", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('"file-print": "pdf"');
    // The generic export dispatch covers the alias: any EXPORT_FORMATS id
    // (including file-print) runs doExport with the mapped format.
    expect(app).toContain("void doExport(EXPORT_FORMATS[id]);");
    // Browser dev keydown mirrors the native Ctrl+P accelerator.
    expect(app).toContain('void doExport("pdf");');
  });

  it("the shortcuts table carries the Ctrl+P / Print (PDF)… row", () => {
    const shortcuts = repoFile("../shortcuts.ts");
    expect(shortcuts).toContain('{ group: "File", keys: "Ctrl+P", label: "Print (PDF)…" }');
  });
});
