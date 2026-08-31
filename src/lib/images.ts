// Image logic (plan 08 task 8.2/8.4, issues #77/#79): URL validation for the
// "From URL" dialog, the image node insert, the src computation behind the
// "From file" picker, and the image edit dialog (URL/alt/width). Pure over
// the TipTap editor so the registry commands, the toolbar split button, the
// Insert menu, the image click handler, and the tests all share one behavior
// (the same shape as links.ts).

import type { Editor as CoreEditor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
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

// --- image edit dialog (plan 08 task 8.4, issue #79) ------------------------

// What the edit dialog submits: the destination, the alt text, the width,
// and the title (carried through unedited when the dialog has no title
// field, so an edit never silently drops one).
export interface ImageEditPayload {
  src: string;
  alt: string;
  width: string;
  title: string;
}

// The dialog's opening state: the image under the caret (isEditing) or the
// empty values for a fresh insert.
export interface ImageEditPrefill extends ImageEditPayload {
  isEditing: boolean;
}

// Width (plan 08 §2.5): empty (no width), a pixel number ("320", "320px"),
// or a percentage ("50%"). The normalized form is what the HTML width
// attribute carries: the bare number for pixels, the percent sign for
// percentages. Returns null for anything else.
export function normalizeImageWidth(input: string): string | null {
  const width = input.trim();
  if (width === "") return "";
  const px = /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(width);
  if (px) return px[1];
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(width);
  if (pct) return `${pct[1]}%`;
  return null;
}

// The error message for a width the dialog refuses, or null when acceptable.
export function validateImageWidth(input: string): string | null {
  if (normalizeImageWidth(input) !== null) return null;
  return "Width must be pixels (e.g. 320) or a percent (e.g. 50%)";
}

// The image node the edit dialog should act on (plan 08 §2.5): the node
// selection when the caret sits over an image, otherwise the first image in
// the selection range, otherwise the inline image directly before or after a
// collapsed caret (clicking an inline image places the caret on its
// boundary).
export function imageAtCaret(
  editor: CoreEditor,
): { pos: number; node: PmNode } | null {
  const { state } = editor;
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === "image") {
    return { pos: sel.from, node: sel.node };
  }
  const { from, to } = sel;
  let found: { pos: number; node: PmNode } | null = null;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!found && node.type.name === "image") {
      found = { pos, node };
      return false;
    }
    return true;
  });
  if (found) return found;
  const $pos = state.doc.resolve(from);
  const before = $pos.nodeBefore;
  if (before?.type.name === "image") {
    return { pos: from - before.nodeSize, node: before };
  }
  const after = $pos.nodeAfter;
  if (after?.type.name === "image") {
    return { pos: from, node: after };
  }
  return null;
}

// The values the dialog opens with (plan 08 §2.5): the image's src, alt,
// width, and title when the caret is on an image, otherwise empty values
// with isEditing false (the dialog then acts as an insert at the caret).
export function readImagePrefill(editor: CoreEditor): ImageEditPrefill {
  const target = imageAtCaret(editor);
  if (!target) {
    return { src: "", alt: "", title: "", width: "", isEditing: false };
  }
  const attrs = target.node.attrs;
  return {
    src: typeof attrs.src === "string" ? attrs.src : "",
    alt: typeof attrs.alt === "string" ? attrs.alt : "",
    title: typeof attrs.title === "string" ? attrs.title : "",
    width: typeof attrs.width === "string" ? attrs.width : "",
    isEditing: true,
  };
}

// Applies the dialog's result to the image under the caret (plan 08 task
// 8.4): the src/alt/width attributes are (re)set and the title is preserved.
// The width is normalized first ("320px" -> "320"); an empty width clears
// the attribute so the image serializes back to markdown syntax. When no
// image is at the caret the payload inserts a new one (the dialog reached
// here through a caret with no image, e.g. a future context menu).
export function applyImageEdit(editor: CoreEditor, payload: ImageEditPayload): boolean {
  const src = payload.src.trim();
  if (validateImageUrl(src) !== null) return false;
  const width = normalizeImageWidth(payload.width);
  if (width === null) return false;
  const alt = payload.alt.trim();
  const title = payload.title.trim();
  const target = imageAtCaret(editor);
  if (target) {
    const { state } = editor;
    const tr = state.tr;
    tr.setNodeMarkup(target.pos, null, {
      ...target.node.attrs,
      src,
      alt: alt === "" ? null : alt,
      title: title === "" ? null : title,
      width: width === "" ? null : width,
    });
    tr.setSelection(NodeSelection.create(tr.doc, target.pos));
    editor.view.dispatch(tr);
    return true;
  }
  return insertImage(editor, { src, alt });
}
