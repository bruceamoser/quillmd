// File-menu orchestration (plan 01 §3, task 1.2). Open (multi), Save As,
// Export, and Import all pick their paths through the dialogs.ts choke point,
// so the Tauri code path never touches window.prompt. App.tsx supplies the
// tab-state callbacks (openByPath, status) and the active document; the pure
// default-name and filter helpers live here so they are unit-testable.

import {
  DOCX_FILTER,
  MARKDOWN_FILTER,
  extensionFilter,
  pickOpenFile,
  pickSavePath,
} from "./dialogs";
import type { DialogFilter } from "./dialogs";
import { baseName, exportDocument, importDocument, isAbsolutePath, saveAs } from "./fileIo";
import type { ExportFormat, OpenFileResult } from "./fileIo";

export interface FileMenuDeps {
  // Opens the file at `path` as a new tab and activates it.
  openByPath: (path: string) => Promise<void>;
  // Reports progress and problems to the status bar.
  status: (message: string) => void;
}

// File > Open: native multi-select dialog; each picked file becomes a tab and
// the last one is activated. A failure on one file surfaces in the status bar
// and never aborts the batch (plan 01 §3 multi-open).
export async function openPickedFiles(deps: FileMenuDeps): Promise<void> {
  const picked = await pickOpenFile();
  if (picked === null || picked.length === 0) return;
  for (const path of picked) {
    try {
      await deps.openByPath(path);
    } catch (err) {
      deps.status(`Open failed: ${path} (${String(err)})`);
    }
  }
}

// Default Save As destination: the current document path when it is a real
// path (Word behavior); just the file name for browser-picked files.
export function saveAsDefaultName(path: string): string {
  if (path === "") return "untitled.md";
  return isAbsolutePath(path) ? path : baseName(path);
}

// File > Save As: pick the destination through the save dialog seeded with
// the current path, write the bytes, then open the saved copy as a tab so
// subsequent edits target the new file.
export async function saveAsDocument(
  doc: Pick<OpenFileResult, "path">,
  bytes: Uint8Array,
  deps: FileMenuDeps,
): Promise<void> {
  const out = await pickSavePath(saveAsDefaultName(doc.path), MARKDOWN_FILTER, "Save As");
  if (out === null) return;
  try {
    await saveAs(out, bytes);
    await deps.openByPath(out);
    deps.status(`Saved as ${out}`);
  } catch (err) {
    deps.status(`Save as failed: ${out} (${String(err)})`);
  }
}

// Extension for an export format (txt-plain writes .txt like txt).
export function exportExtension(format: ExportFormat): string {
  return format === "txt-plain" ? "txt" : format;
}

// Display label for filter names and dialog titles ("TXT" for both txt
// variants, "PDF"/"DOCX"/"EPUB" otherwise).
export function exportLabel(format: ExportFormat): string {
  return exportExtension(format).toUpperCase();
}

// Filter for the per-format export save dialog.
export function exportFilter(format: ExportFormat): DialogFilter {
  return extensionFilter(exportLabel(format), exportExtension(format));
}

// Default export destination: the document path with the extension swapped
// (Word behavior), e.g. /docs/notes.md -> /docs/notes.pdf.
export function exportDefaultName(docPath: string, format: ExportFormat): string {
  const ext = exportExtension(format);
  if (docPath === "") return `document.${ext}`;
  const stem = docPath.replace(/\.[^.]+$/, "");
  return stem + "." + ext;
}

// File > Export: pick the destination through a per-format save dialog, then
// run the Rust conversion service.
export async function exportDocumentAs(
  docPath: string,
  format: ExportFormat,
  deps: FileMenuDeps,
): Promise<void> {
  deps.status(`Exporting ${exportLabel(format)}...`);
  const out = await pickSavePath(
    exportDefaultName(docPath, format),
    exportFilter(format),
    `Export as ${exportLabel(format)}`,
  );
  if (out === null) return;
  try {
    await exportDocument(docPath, format, out);
    deps.status(`Exported ${out}`);
  } catch (err) {
    deps.status(`Export failed: ${String(err)}`);
  }
}

// Default import destination: the docx path with the extension swapped to
// .md, e.g. C:\docs\report.docx -> C:\docs\report.md.
export function importOutputName(docxPath: string): string {
  const stem = docxPath.replace(/\.[^.]+$/, "");
  if (stem === "" || stem === docxPath) return "imported.md";
  return stem + ".md";
}

// File > Import: pick the .docx source, then the .md destination, convert
// through the Rust layer, and open the result as a tab.
export async function importDocx(deps: FileMenuDeps): Promise<void> {
  deps.status("Importing DOCX...");
  const src = await pickOpenFile({ filters: [DOCX_FILTER], title: "Import DOCX" });
  if (src === null || src.length === 0) return;
  const docx = src[0];
  const out = await pickSavePath(
    importOutputName(docx),
    MARKDOWN_FILTER,
    "Save imported markdown as",
  );
  if (out === null) return;
  try {
    await importDocument(docx, out);
    await deps.openByPath(out);
    deps.status(`Imported ${docx} -> ${out}`);
  } catch (err) {
    deps.status(`Import failed: ${String(err)}`);
  }
}
