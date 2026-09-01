// Document properties for File > Info (plan 01 §2.6, issue #26): the panel is
// a native-style in-app flyout, not a dialog. It reuses the values the app
// already computes (DocState: eol, bom, snapshot; live text for the counts)
// plus one new Rust command, file_stat, for the on-disk size and the OS
// created/modified times. Everything is read-only — the panel never writes.

import { fileStat, isAbsolutePath } from "./fileIo";
import type { Eol, OpenFileResult } from "./fileIo";
import { docDisplayName } from "./tabClose";
import { isUntitledPath } from "./newDoc";
import { countWords } from "./counts";

export interface DocInfo {
  path: string;
  displayName: string;
  // Bytes on disk from file_stat; null for in-memory docs (untitled or
  // browser-dev, where no Rust layer exists).
  size: number | null;
  words: number;
  chars: number;
  lines: number;
  encoding: string;
  eol: Eol;
  bom: boolean;
  created: number | null;
  modified: number | null;
  // Size in bytes of the crash-recovery snapshot that existed when the file
  // was opened (DocState), or null when none was present.
  snapshotSize: number | null;
  dirty: boolean;
}

// Word count: re-exported from counts.ts (plan 09 task 9.4, issue #87) so the
// Info panel, the status bar, and the Word Count dialog all share one rule —
// whitespace-split of the trimmed text.
export { countWords };

// Line count: 0 for an empty document, otherwise the number of text lines.
// A trailing newline does not create a phantom final line ("a\n" is 1 line,
// "a\n\n" is 2), matching how editors number lines.
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) lines += 1;
  }
  if (text.charCodeAt(text.length - 1) === 10) lines -= 1;
  return lines;
}

// Human-readable byte size (1024-base, one decimal below the top unit).
// Unknown sizes (null) render as an em dash so the row stays aligned.
export function formatBytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

// Local-time timestamp for an epoch-millis value; null renders as an em dash.
export function formatTimestamp(ms: number | null): string {
  if (ms === null) return "—";
  const d = new Date(ms);
  const pad = (v: number) => String(v).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

// Collects the properties for the Info panel. The counts come from the live
// text; eol/bom/snapshot come from the open state; size/created/modified come
// from file_stat, which is only reachable under Tauri for real paths —
// untitled and browser-dev docs report nulls for those.
export async function collectDocInfo(
  open: OpenFileResult,
  currentText: string,
  dirty: boolean,
): Promise<DocInfo> {
  const statable = !isUntitledPath(open.path) && isAbsolutePath(open.path);
  let stat: { size: number; created: number | null; modified: number | null } | null = null;
  if (statable) {
    try {
      stat = await fileStat(open.path);
    } catch {
      stat = null;
    }
  }
  return {
    path: open.path,
    displayName: docDisplayName(open.path),
    size: stat ? stat.size : null,
    words: countWords(currentText),
    chars: currentText.length,
    lines: countLines(currentText),
    encoding: "utf-8",
    eol: open.eol,
    bom: open.bom,
    created: stat ? stat.created : null,
    modified: stat ? stat.modified : null,
    snapshotSize: open.snapshot ? open.snapshot.byteLength : null,
    dirty,
  };
}
