import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import {
  confirmMessage,
  DOCX_FILTER,
  extensionFilter,
  MARKDOWN_FILTER,
  pickOpenFile,
  pickOpenFolder,
  pickSavePath,
} from "../dialogs";

const g = globalThis as unknown as Record<string, unknown>;

// A minimal browser window: the dialog fallbacks only touch prompt/confirm/
// alert, and tests simulate the user's choices by setting their return values.
function installBrowserWindow() {
  const win = {
    prompt: vi.fn(),
    confirm: vi.fn(),
    alert: vi.fn(),
  };
  g.window = win;
  return win;
}

const promptOf = (win: { prompt: Mock }): Mock => win.prompt;
const confirmOf = (win: { confirm: Mock }): Mock => win.confirm;
const alertOf = (win: { alert: Mock }): Mock => win.alert;

beforeEach(() => {
  delete g.isTauri; // plain browser (dev) mode by default
});

afterEach(() => {
  clearMocks();
  delete g.isTauri;
  delete g.window;
  vi.restoreAllMocks();
});

describe("dialogs.ts browser fallback (simulated values)", () => {
  it("pickOpenFile returns the simulated prompt path as a list", async () => {
    const win = installBrowserWindow();
    promptOf(win).mockReturnValue("/home/user/notes.md");
    await expect(pickOpenFile()).resolves.toEqual(["/home/user/notes.md"]);
    expect(promptOf(win)).toHaveBeenCalledWith("Open file (absolute path)");
  });

  it("pickOpenFile returns null when the prompt is dismissed", async () => {
    const win = installBrowserWindow();
    promptOf(win).mockReturnValue(null);
    await expect(pickOpenFile()).resolves.toBeNull();
  });

  it("pickOpenFolder returns the simulated prompt path", async () => {
    const win = installBrowserWindow();
    promptOf(win).mockReturnValue("/home/user/docs");
    await expect(pickOpenFolder()).resolves.toBe("/home/user/docs");
    expect(promptOf(win)).toHaveBeenCalledWith("Open folder (absolute path)");
  });

  it("pickOpenFolder returns null when the prompt is dismissed", async () => {
    const win = installBrowserWindow();
    promptOf(win).mockReturnValue("");
    await expect(pickOpenFolder()).resolves.toBeNull();
  });

  it("pickSavePath returns the simulated prompt path seeded with the default name", async () => {
    const win = installBrowserWindow();
    promptOf(win).mockReturnValue("/home/user/out.md");
    await expect(pickSavePath("untitled.md")).resolves.toBe("/home/user/out.md");
    expect(promptOf(win)).toHaveBeenCalledWith("Save as path", "untitled.md");
  });

  it("pickSavePath returns null when the prompt is dismissed", async () => {
    const win = installBrowserWindow();
    promptOf(win).mockReturnValue(null);
    await expect(pickSavePath("untitled.md")).resolves.toBeNull();
  });

  it("confirmMessage with ok buttons alerts and resolves ok", async () => {
    const win = installBrowserWindow();
    await expect(
      confirmMessage({ title: "QuillMD", message: "Saved.", kind: "info", buttons: "ok" }),
    ).resolves.toBe("ok");
    expect(alertOf(win)).toHaveBeenCalledWith("Saved.");
    expect(confirmOf(win)).not.toHaveBeenCalled();
  });

  it("confirmMessage maps a confirmed okCancel to ok", async () => {
    const win = installBrowserWindow();
    confirmOf(win).mockReturnValue(true);
    await expect(
      confirmMessage({ message: "Close anyway?", kind: "warning", buttons: "okCancel" }),
    ).resolves.toBe("ok");
    expect(confirmOf(win)).toHaveBeenCalledWith("Close anyway?");
  });

  it("confirmMessage maps a dismissed okCancel to cancel", async () => {
    const win = installBrowserWindow();
    confirmOf(win).mockReturnValue(false);
    await expect(
      confirmMessage({ message: "Close anyway?", buttons: "okCancel" }),
    ).resolves.toBe("cancel");
  });

  it("confirmMessage maps yesNo to yes / no", async () => {
    const win = installBrowserWindow();
    confirmOf(win).mockReturnValue(true);
    await expect(confirmMessage({ message: "Restore?", buttons: "yesNo" })).resolves.toBe("yes");
    confirmOf(win).mockReturnValue(false);
    await expect(confirmMessage({ message: "Restore?", buttons: "yesNo" })).resolves.toBe("no");
  });

  it("confirmMessage maps yesNoCancel to yes / no", async () => {
    const win = installBrowserWindow();
    confirmOf(win).mockReturnValue(true);
    await expect(
      confirmMessage({ message: "Reload?", buttons: "yesNoCancel" }),
    ).resolves.toBe("yes");
    confirmOf(win).mockReturnValue(false);
    await expect(
      confirmMessage({ message: "Reload?", buttons: "yesNoCancel" }),
    ).resolves.toBe("no");
  });

  it("confirmMessage defaults to ok buttons when buttons is omitted", async () => {
    const win = installBrowserWindow();
    await expect(confirmMessage({ message: "Hello" })).resolves.toBe("ok");
    expect(alertOf(win)).toHaveBeenCalledWith("Hello");
  });
});

describe("dialogs.ts Tauri wrappers (mocked IPC)", () => {
  it("pickOpenFile forwards a multi-select markdown open dialog", async () => {
    const win = installBrowserWindow();
    g.isTauri = true;
    const calls: Array<{ cmd: string; payload: unknown }> = [];
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload });
      return ["/a/one.md", "/a/two.md"];
    });
    await expect(pickOpenFile()).resolves.toEqual(["/a/one.md", "/a/two.md"]);
    expect(calls).toEqual([
      {
        cmd: "plugin:dialog|open",
        payload: {
          options: {
            multiple: true,
            filters: [MARKDOWN_FILTER],
            title: undefined,
          },
        },
      },
    ]);
    expect(promptOf(win)).not.toHaveBeenCalled();
  });

  it("pickOpenFile honours custom filters (docx import)", async () => {
    installBrowserWindow();
    g.isTauri = true;
    mockIPC(() => "/docs/report.docx");
    await expect(pickOpenFile({ filters: [DOCX_FILTER] })).resolves.toBe(
      "/docs/report.docx",
    );
  });

  it("pickOpenFolder forwards a directory dialog", async () => {
    installBrowserWindow();
    g.isTauri = true;
    mockIPC((cmd, payload) => {
      expect(cmd).toBe("plugin:dialog|open");
      expect(payload).toEqual({ options: { directory: true, title: "Open Folder" } });
      return "/projects";
    });
    await expect(pickOpenFolder("Open Folder")).resolves.toBe("/projects");
  });

  it("pickSavePath forwards the default path and filter to the save dialog", async () => {
    installBrowserWindow();
    g.isTauri = true;
    mockIPC((cmd, payload) => {
      expect(cmd).toBe("plugin:dialog|save");
      expect(payload).toEqual({
        options: {
          defaultPath: "notes.md",
          filters: [extensionFilter("PDF", "pdf")],
          title: "Export as PDF",
        },
      });
      return "/out/notes.pdf";
    });
    await expect(
      pickSavePath("notes.md", extensionFilter("PDF", "pdf"), "Export as PDF"),
    ).resolves.toBe("/out/notes.pdf");
  });

  it("pickSavePath returns null when the user cancels the save dialog", async () => {
    installBrowserWindow();
    g.isTauri = true;
    mockIPC(() => null);
    await expect(pickSavePath("notes.md")).resolves.toBeNull();
  });

  it("confirmMessage forwards title, kind and buttons to the message dialog", async () => {
    installBrowserWindow();
    g.isTauri = true;
    mockIPC((cmd, payload) => {
      expect(cmd).toBe("plugin:dialog|message");
      expect(payload).toEqual({
        message: "Unsaved changes",
        title: "QuillMD",
        kind: "warning",
        buttons: "OkCancel",
      });
      return "Ok";
    });
    await expect(
      confirmMessage({
        title: "QuillMD",
        message: "Unsaved changes",
        kind: "warning",
        buttons: "okCancel",
      }),
    ).resolves.toBe("ok");
  });

  it("confirmMessage normalizes Yes/No results from the message dialog", async () => {
    installBrowserWindow();
    g.isTauri = true;
    mockIPC(() => "Yes");
    await expect(
      confirmMessage({ message: "Restore snapshot?", buttons: "yesNo" }),
    ).resolves.toBe("yes");
    clearMocks();
    mockIPC(() => "No");
    await expect(
      confirmMessage({ message: "Restore snapshot?", buttons: "yesNo" }),
    ).resolves.toBe("no");
    clearMocks();
    mockIPC(() => "Cancel");
    await expect(
      confirmMessage({ message: "Reload?", buttons: "yesNoCancel" }),
    ).resolves.toBe("cancel");
  });

  it("confirmMessage defaults to an Ok button when buttons is omitted", async () => {
    installBrowserWindow();
    g.isTauri = true;
    mockIPC((cmd, payload) => {
      expect(cmd).toBe("plugin:dialog|message");
      expect(payload).toEqual({
        message: "Saved.",
        title: undefined,
        kind: undefined,
        buttons: "Ok",
      });
      return "Ok";
    });
    await expect(confirmMessage({ message: "Saved." })).resolves.toBe("ok");
  });
});
