// Explorer file filter (left content display): the tree shows Markdown
// documents only by default, with a header toggle that reveals every file in
// the opened folders (the VS Code "show all files" affordance). Directories
// always show so the tree stays navigable.
//
// The predicate and the filter are pure so the rule is unit-testable and the
// toggle's persistence (localStorage, app-local like the other view
// preferences) never touches the document pipeline.

import type { DirEntry } from "./fileIo";

// The extensions the editor treats as Markdown documents. Kept wider than
// ".md" so a CommonMark-family file still counts as a document.
export const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown", "mkd"] as const;

const MARKDOWN_RE = new RegExp(`\\.(${MARKDOWN_EXTENSIONS.join("|")})$`, "i");

// True when the entry name is a Markdown document (case-insensitive).
export function isMarkdownFile(name: string): boolean {
  return MARKDOWN_RE.test(name);
}

// One directory listing filtered for display. Directories are always kept;
// files are kept when they are Markdown documents or when the user turned on
// "show all files". The input is never mutated.
export function filterDirEntries(
  entries: readonly DirEntry[],
  showAllFiles: boolean,
): DirEntry[] {
  if (showAllFiles) return [...entries];
  return entries.filter((entry) => entry.is_dir || isMarkdownFile(entry.name));
}

// The same rule for a flat path list (the Explorer's Recent section).
export function filterFilePaths(
  paths: readonly string[],
  showAllFiles: boolean,
): string[] {
  if (showAllFiles) return [...paths];
  return paths.filter((path) => isMarkdownFile(path));
}

// --- toggle persistence ----------------------------------------------------

const SHOW_ALL_KEY = "quillmd.explorer.showAllFiles";

// The stored preference; a first run (or unavailable storage, e.g. private
// mode) reads as the default: Markdown only.
export function loadShowAllFiles(): boolean {
  try {
    return localStorage.getItem(SHOW_ALL_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveShowAllFiles(showAll: boolean): void {
  try {
    localStorage.setItem(SHOW_ALL_KEY, showAll ? "true" : "false");
  } catch {
    // Persistence is best-effort; the toggle still works for this session.
  }
}

// --- click timing ----------------------------------------------------------

// How long the Explorer waits after a single click before it replaces the
// active tab. A second click inside this window is a double click, which
// cancels the replace and opens the file in a new tab instead.
export const EXPLORER_DOUBLE_CLICK_MS = 220;
