// Untitled-document lifecycle (plan 01 §3, task 1.3). A new document is
// keyed by a synthetic path :new:<n> and lives in memory until its first
// save; the first Save picks a real path through the native save dialog and
// the tab is re-keyed from the synthetic path to the chosen one. dirty
// semantics are unchanged: an untouched untitled doc is not dirty, and the
// clean-path pipeline treats it like any other in-memory document.

import { MARKDOWN_FILTER, pickSavePath } from "./dialogs";
import { saveAs } from "./fileIo";
import type { Eol, OpenFileResult } from "./fileIo";
import type { DefaultEol } from "./settings";

export const UNTITLED_PREFIX = ":new:";

// Synthetic untitled tab paths look like :new:1, :new:2, ...
export function isUntitledPath(path: string): boolean {
  return /^:new:\d+$/.test(path);
}

// Next free synthetic path, avoiding collisions with currently open tabs.
export function nextUntitledPath(existingPaths: Iterable<string>): string {
  const taken = new Set(existingPaths);
  let n = 1;
  while (taken.has(`${UNTITLED_PREFIX}${n}`)) n += 1;
  return `${UNTITLED_PREFIX}${n}`;
}

// Default save-dialog filename for an untitled doc (plan 01 §3):
// untitled-N.md where N is the synthetic counter.
export function untitledDefaultName(path: string): string {
  const n = path.startsWith(UNTITLED_PREFIX) ? path.slice(UNTITLED_PREFIX.length) : "1";
  return `untitled-${n}.md`;
}

// Tab/status-bar display name for an untitled doc.
export function untitledDisplayName(path: string): string {
  const n = path.startsWith(UNTITLED_PREFIX) ? path.slice(UNTITLED_PREFIX.length) : "1";
  return `Untitled ${n}`;
}

// Whether the runtime platform is Windows (the "auto" EOL default follows
// it: CRLF on Windows, LF elsewhere). navigator is the only signal available
// in the webview; any absence reads as non-Windows (LF).
export function platformIsWindows(): boolean {
  try {
    return /win/i.test(navigator.platform || navigator.userAgent || "");
  } catch {
    return false;
  }
}

// Resolves the "default EOL" app setting (plan 10 task 10.2, issue #94) to
// the concrete EOL a new (untitled) document uses: "lf" / "crlf" pass
// through, "auto" follows the platform. Existing documents keep their
// per-doc detection; this only seeds new ones.
export function resolveDefaultEol(
  setting: DefaultEol,
  isWindows: boolean = platformIsWindows(),
): Eol {
  if (setting === "lf") return "lf";
  if (setting === "crlf") return "crlf";
  return isWindows ? "crlf" : "lf";
}

// Builds the in-memory OpenFileResult for a new (blank or template)
// document. LF without BOM is the default on-disk shape for a file that
// does not exist yet; both are re-detected from the real file after the
// first save. `eol` (plan 10 task 10.2) seeds the default-EOL setting for
// new docs; it defaults to LF so callers without a setting are unchanged.
export function makeUntitledDoc(
  path: string,
  content: string,
  eol: Eol = "lf",
): OpenFileResult {
  return {
    path,
    source: content,
    originalBytes: new TextEncoder().encode(content),
    hash: "",
    eol,
    bom: false,
    snapshot: null,
  };
}

// Pure re-key operation on the tab record: moves the entry at fromPath to
// toPath and replaces its open state with the saved file's source, bytes,
// and hash. Other tabs and the entry's content/view mode carry over
// untouched; the record is returned as-is when fromPath no longer exists
// (the tab was closed before the save finished).
export function rekeyDocRecord<T extends { open: OpenFileResult }>(
  docs: Record<string, T>,
  fromPath: string,
  toPath: string,
  source: string,
  bytes: Uint8Array,
  hash: string,
): Record<string, T> {
  const d = docs[fromPath];
  if (!d) return docs;
  const next = { ...docs };
  delete next[fromPath];
  next[toPath] = {
    ...d,
    open: {
      ...d.open,
      path: toPath,
      source,
      originalBytes: bytes,
      hash,
      snapshot: null,
    },
  };
  return next;
}

export interface SaveNewDeps {
  status: (message: string) => void;
  // Called after the write succeeds with the chosen path and the hash of
  // the bytes on disk, so the caller can re-key the untitled tab and keep
  // the external-change guard working from the second save on.
  onSaved: (path: string, hash: string) => void;
}

// First save of an untitled document: native save dialog seeded with
// untitled-N.md, then a save_as write. Cancelled dialogs write nothing and
// the tab keeps its synthetic path.
export async function saveNewDocument(
  path: string,
  bytes: Uint8Array,
  deps: SaveNewDeps,
): Promise<boolean> {
  const out = await pickSavePath(untitledDefaultName(path), MARKDOWN_FILTER, "Save");
  if (out === null) return false;
  try {
    const hash = await saveAs(out, bytes);
    deps.onSaved(out, hash);
    deps.status(`Saved as ${out}`);
    return true;
  } catch (err) {
    deps.status(`Save failed: ${out} (${String(err)})`);
    return false;
  }
}
