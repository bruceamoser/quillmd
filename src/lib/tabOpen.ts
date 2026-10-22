// VS Code-style tab opening for the Explorer (left content display).
//
// The Explorer's single click replaces the open tab (the "preview" behavior);
// a double click opens the file in a new tab. The decision and the record
// splice are pure so they stay unit-testable and the App's handlers stay thin:
//
//   activate — the clicked file is already open (it may be the active tab):
//              clicking a tab must never reload or duplicate it.
//   open     — there is no active tab to replace, or the active tab must be
//              kept (unsaved edits, or an untitled scratch buffer). A single
//              click must never discard work, so it falls back to a new tab
//              (VS Code keeps dirty and untitled preview tabs too).
//   replace  — swap the active tab for the clicked file, in place.

export type SingleClickIntent = "activate" | "open" | "replace";

export interface SingleClickContext {
  // The file the user clicked.
  path: string;
  // The tab currently in front, or null when no tab is open.
  activePath: string | null;
  // Every path that already has a tab.
  openPaths: Iterable<string>;
  // Whether the active tab must be kept: it has unsaved edits, or it is an
  // untitled scratch buffer (those are never "preview" tabs).
  activeProtected: boolean;
}

// What a single click on `path` should do (see the module comment).
export function singleClickIntent({
  path,
  activePath,
  openPaths,
  activeProtected,
}: SingleClickContext): SingleClickIntent {
  if (activePath === path) return "activate";
  for (const openPath of openPaths) {
    if (openPath === path) return "activate";
  }
  if (activePath === null) return "open";
  if (activeProtected) return "open";
  return "replace";
}

// Re-keyes the tab record for a single-click replace: the entry at `fromPath`
// is swapped for `doc` under `toPath` at the same position, so the tab bar
// keeps its order (a plain spread would append the new tab at the end). The
// entry is appended when `fromPath` is no longer open (the tab was closed
// while the file was being read). Other tabs carry over untouched.
export function replaceDocRecord<T>(
  docs: Record<string, T>,
  fromPath: string,
  toPath: string,
  doc: T,
): Record<string, T> {
  const out: Record<string, T> = {};
  let replaced = false;
  for (const [key, value] of Object.entries(docs)) {
    if (key === fromPath) {
      out[toPath] = doc;
      replaced = true;
    } else if (key !== toPath) {
      out[key] = value;
    }
  }
  if (!replaced) out[toPath] = doc;
  return out;
}
