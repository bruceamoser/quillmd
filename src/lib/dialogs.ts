// Single choke point for file and confirmation dialogs (plan 01 §3, task 1.1).
// Under Tauri every call goes through @tauri-apps/plugin-dialog; in a plain
// browser (dev) the module falls back to window.prompt/confirm/alert so the
// editor stays usable without the native plugin.

import { isTauri } from "@tauri-apps/api/core";
import type { DialogFilter, MessageDialogResult } from "@tauri-apps/plugin-dialog";

export type { DialogFilter };

// Plan 01 §3 filters: markdown = *.md, *.markdown, *.mdown, *.mkd; docx = *.docx.
export const MARKDOWN_FILTER: DialogFilter = {
  name: "Markdown",
  extensions: ["md", "markdown", "mdown", "mkd"],
};

export const DOCX_FILTER: DialogFilter = {
  name: "DOCX",
  extensions: ["docx"],
};

// Builds a single-extension filter (used for per-format export dialogs).
export function extensionFilter(name: string, extension: string): DialogFilter {
  return { name, extensions: [extension] };
}

export type MessageKind = "info" | "warning" | "error";

export type MessageButtons = "ok" | "okCancel" | "yesNo" | "yesNoCancel";

export type MessageResult = "ok" | "cancel" | "yes" | "no";

export interface ConfirmMessageOptions {
  title?: string;
  message: string;
  kind?: MessageKind;
  buttons?: MessageButtons;
}

const TAUERI_BUTTONS: Record<MessageButtons, "Ok" | "OkCancel" | "YesNo" | "YesNoCancel"> = {
  ok: "Ok",
  okCancel: "OkCancel",
  yesNo: "YesNo",
  yesNoCancel: "YesNoCancel",
};

function normalizeResult(result: MessageDialogResult): MessageResult {
  const r = result.toLowerCase();
  if (r === "ok") return "ok";
  if (r === "cancel") return "cancel";
  if (r === "yes") return "yes";
  return "no";
}

export interface PickOpenFileOptions {
  title?: string;
  filters?: DialogFilter[];
}

// Picks one or more files (multi-select). Tauri: native open dialog with
// markdown filters by default; browser: absolute-path prompt (dev fallback).
export async function pickOpenFile(options: PickOpenFileOptions = {}): Promise<string[] | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    return open({
      multiple: true,
      filters: options.filters ?? [MARKDOWN_FILTER],
      title: options.title,
    });
  }
  const path = window.prompt("Open file (absolute path)") ?? "";
  return path ? [path] : null;
}

// Picks a folder. Tauri: native directory dialog; browser: absolute-path
// prompt (dev fallback).
export async function pickOpenFolder(title?: string): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    return open({ directory: true, title });
  }
  const path = window.prompt("Open folder (absolute path)") ?? "";
  return path || null;
}

// Picks a save destination path. Tauri: native save dialog seeded with
// defaultName; browser: prompt (dev fallback).
export async function pickSavePath(
  defaultName: string,
  filter: DialogFilter = MARKDOWN_FILTER,
  title?: string,
): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    return save({ defaultPath: defaultName, filters: [filter], title });
  }
  const path = window.prompt("Save as path", defaultName) ?? "";
  return path || null;
}

// Confirmation / informational dialog. Tauri: native message dialog with the
// requested buttons; browser: alert for "ok", confirm for everything else.
export async function confirmMessage(options: ConfirmMessageOptions): Promise<MessageResult> {
  const buttons = options.buttons ?? "ok";
  if (isTauri()) {
    const { message } = await import("@tauri-apps/plugin-dialog");
    const result = await message(options.message, {
      title: options.title,
      kind: options.kind,
      buttons: TAUERI_BUTTONS[buttons],
    });
    return normalizeResult(result);
  }
  if (buttons === "ok") {
    window.alert(options.message);
    return "ok";
  }
  const accepted = window.confirm(options.message);
  if (buttons === "okCancel") return accepted ? "ok" : "cancel";
  return accepted ? "yes" : "no";
}
