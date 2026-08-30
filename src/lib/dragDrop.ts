// Drag & drop open (plan 01 task 1.6, issue #27). Tauri emits tauri://drag-*
// events to the webview by default; App.tsx listens with onDragDropEvent and
// hands the dropped paths here. Each dropped path is classified with the
// existing list_dir command (success means directory) so no Rust changes are
// needed: directories switch the Explorer root, markdown files open as tabs,
// and every dropped item — including skipped ones — gets its own status-bar
// line. A failure on one item never aborts the batch.

import { baseName, listDir } from "./fileIo";

// Plan 01 §3 filters: markdown = *.md, *.markdown, *.mdown, *.mkd.
const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd)$/i;

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXT.test(path);
}

// list_dir succeeds only for directories: files and missing paths error out
// (ENOTDIR / "not a directory"), which is exactly the discriminator we need
// without a new Rust command.
async function isDroppedDirectory(path: string): Promise<boolean> {
  try {
    await listDir(path);
    return true;
  } catch {
    return false;
  }
}

export interface DragDropDeps {
  // Opens a markdown file as a tab and activates it (reports its own
  // "Opened ..."/"Open failed: ..." status line). The resolved value is
  // irrelevant, so Promise<unknown> accepts both openByPath (Promise<void>)
  // and openPath (Promise<OpenFileResult>) call sites.
  openFile: (path: string) => Promise<unknown>;
  // Switches the Explorer root to the given folder.
  openFolder: (path: string) => void;
  // Reports per-item outcomes to the status bar.
  status: (message: string) => void;
}

// Handles one drop of files and folders (acceptance #7: dropping 2 .md files
// + 1 folder opens 2 tabs and switches the Explorer root to the folder).
export async function handleDroppedPaths(paths: string[], deps: DragDropDeps): Promise<void> {
  for (const raw of new Set(paths)) {
    const path = raw.trim();
    if (path === "") continue;
    if (await isDroppedDirectory(path)) {
      deps.openFolder(path);
      deps.status(`Opened folder ${path}`);
      continue;
    }
    if (!isMarkdownPath(path)) {
      deps.status(`Skipped ${baseName(path)} (not a markdown file)`);
      continue;
    }
    try {
      await deps.openFile(path);
    } catch (err) {
      deps.status(`Open failed: ${path} (${String(err)})`);
    }
  }
}
