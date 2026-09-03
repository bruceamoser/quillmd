// Close / Close All dirty-checking (plan 01 §2.5, issue #25). Closing a tab
// with unsaved changes asks first — through the native message dialog under
// Tauri, with the browser fallback handled by dialogs.ts (the single choke
// point for confirmation dialogs). Clean tabs close without any prompt: the
// confirm only happens when dirty (plan 01 acceptance #5).

import { choiceMessage } from "./dialogs";
import { baseName } from "./fileIo";
import { isUntitledPath, untitledDisplayName } from "./newDoc";

export interface ClosableDoc {
  path: string;
  displayName: string;
  dirty: boolean;
}

export type CloseAction = "close" | "save" | "cancel";

// Tab/status-bar display name: "Untitled <n>" for synthetic :new:<n> paths,
// the base file name otherwise.
export function docDisplayName(path: string): string {
  return isUntitledPath(path) ? untitledDisplayName(path) : baseName(path);
}

// Asks whether one dirty tab may be closed. Resolves false when the user
// declines (or the dialog is cancelled), leaving the tab open.
export async function confirmCloseTab(doc: ClosableDoc): Promise<CloseAction> {
  const result = await choiceMessage({
    title: "QuillMD",
    message: `${doc.displayName} has unsaved changes.`,
    kind: "warning",
    yes: "Save and close",
    no: "Close anyway",
    cancel: "Don't close",
  });
  return result === "yes" ? "save" : result === "no" ? "close" : "cancel";
}

// Asks whether all tabs may be closed. A batch with no dirty tabs resolves
// true without any dialog; otherwise a single dialog lists the dirty tabs.
export async function confirmCloseAll(docs: ClosableDoc[]): Promise<CloseAction> {
  const dirty = docs.filter((d) => d.dirty);
  if (dirty.length === 0) return "close";
  const list = dirty.map((d) => `  ${d.displayName}`).join("\n");
  const plural = dirty.length === 1 ? "document has" : "documents have";
  const result = await choiceMessage({
    title: "Close All",
    message: `Close all documents?\n\n${dirty.length} ${plural} unsaved changes:\n${list}`,
    kind: "warning",
    yes: "Save and close",
    no: "Close anyway",
    cancel: "Don't close",
  });
  return result === "yes" ? "save" : result === "no" ? "close" : "cancel";
}
