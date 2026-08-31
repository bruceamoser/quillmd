// Image insert logic (plan 08 task 8.2, issue #77): URL validation for the
// "From URL" dialog, the image node insert, and the src computation behind
// the "From file" picker. Pure over the TipTap editor so the registry
// commands, the toolbar split button, the Insert menu, and the tests all
// share one behavior (the same shape as links.ts).

import type { Editor as CoreEditor } from "@tiptap/core";
import { baseName, isAbsolutePath } from "./fileIo";

// What the From-URL dialog submits: the image destination and the alt text
// ("" when the field is left empty).
export interface ImagePayload {
  src: string;
  alt: string;
}

// Plan 08 §2.4 validation: an image destination is http/https or a relative
// path. Anything else (javascript:, data:, ftp:, ...) is refused before it
// can reach the document. A single letter before the colon is a Windows
// drive letter, so `c:\photos\a.png` stays a relative path, not a scheme.
const ALLOWED_IMAGE_SCHEMES = new Set(["http", "https"]);

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]+):/;

// The error message for a URL the dialog refuses, or null when acceptable.
export function validateImageUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return "Enter a URL";
  const m = SCHEME_RE.exec(trimmed);
  if (m) {
    const scheme = m[1].toLowerCase();
    if (!ALLOWED_IMAGE_SCHEMES.has(scheme)) {
      return `Unsupported URL scheme "${scheme}:" (allowed: http, https, or a relative path)`;
    }
  }
  // The serializer cannot express whitespace inside an image destination
  // (mdast wraps it and splits the image), so the dialog refuses it.
  if (/[\u0000-\u0020\u007F]/.test(trimmed)) {
    return "URLs may not contain spaces or line breaks";
  }
  return null;
}

// Inserts an image node at the caret (or over the selection). An empty alt
// serializes as a bare `![](src)`; an explicit one as `![alt](src)`.
export function insertImage(editor: CoreEditor, payload: ImagePayload): boolean {
  const src = payload.src.trim();
  if (validateImageUrl(src) !== null) return false;
  const alt = payload.alt.trim();
  const attrs: { src: string; alt?: string } = { src };
  if (alt !== "") attrs.alt = alt;
  return editor.chain().focus().setImage(attrs).run();
}

// The document's folder for a real on-disk path ("", when the document has
// no folder to relativize against: untitled :new: tabs, browser-picked
// files keyed by bare name). The result stays absolute (the POSIX root
// slash is kept) so it can be handed to the Rust copy_asset command as a
// real directory; relativePath is slash-insensitive, so the relative-src
// math is unaffected. Exported for the asset pipeline (assets.ts).
export function docFolderOf(docPath: string): string {
  if (!isAbsolutePath(docPath)) return "";
  const root = docPath.startsWith("/") ? "/" : "";
  const parts = docPath.split(/[\\/]/).filter(Boolean);
  parts.pop(); // the file name
  return root + parts.join("/");
}

// The relative path from `fromDir` to `toFile`: forward slashes (markdown's
// universal separator, golden rule 1) and `..` segments when the target sits
// outside the directory tree. Path segments compare case-insensitively so a
// Windows drive root (`C:` vs `c:`) does not split a same-folder pair.
// Exported for the asset pipeline (assets.ts), which needs to tell "inside
// the doc folder" (no `..` segment) from "outside" (leading `..`).
export function relativePath(fromDir: string, toFile: string): string {
  const from = fromDir.split(/[\\/]/).filter(Boolean);
  const to = toFile.split(/[\\/]/).filter(Boolean);
  let i = 0;
  while (
    i < from.length &&
    i < to.length &&
    from[i].toLowerCase() === to[i].toLowerCase()
  ) {
    i += 1;
  }
  const up = from.slice(i).map(() => "..");
  return [...up, ...to.slice(i)].join("/");
}

// The src the "From file" flow writes into the markdown for a picked image
// (plan 08 task 8.2, issue #77). Markdown stays portable (plan 08 §3
// relative-path invariant): when the active document has a real folder, the
// src is the picked file's path relative to that folder, so a file picked
// from the doc's own assets folder becomes `assets/photo.png` and a file
// next to the doc becomes `photo.png`. A document without a folder (an
// unsaved :new: tab, or a browser-dev file keyed by bare name) cannot be
// relativized, so the file name alone is referenced. The live from-file
// flow uses assetSrcForPickedFile (assets.ts, task 8.3), which copies picks
// outside the doc folder; this pure computation is kept as its no-copy
// fallback and for the tests.
export function imageSrcForPickedFile(docPath: string, filePath: string): string {
  if (!isAbsolutePath(filePath)) return filePath;
  const folder = docFolderOf(docPath);
  if (folder === "") return baseName(filePath);
  return relativePath(folder, filePath);
}
