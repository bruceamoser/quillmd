// Broken-image detection (plan 08 task 8.5, issue #80): collect the image
// srcs from the WYSIWYG doc, resolve the local ones against the document's
// folder, and batch-check their existence through the Rust file_exists
// command. The set of missing srcs drives the placeholder node view
// (Editor.tsx); the re-link folder computation seeds the picker. Pure over
// the doc plus an injectable existence check so the tests never need IPC.

import type { Node as PmNode } from "@tiptap/pm/model";
import { filesExist } from "./assets";
import { isAbsolutePath } from "./fileIo";
import { docFolderOf } from "./images";

// A scheme is two or more characters before the colon (same rule as the link
// and image validators): a single letter is a Windows drive letter, so
// `c:\photos\a.png` is a local path, not a scheme.
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]+):/;

// Whether an image src points at a local file: no scheme, so a relative path
// (resolved against the doc folder) or an absolute path (checked as-is).
// http/https/data/file/... destinations never touch this machine's disk.
export function isLocalImageSrc(src: string): boolean {
  return !SCHEME_RE.test(src);
}

// The absolute path a local image src refers to, or null when it cannot be
// resolved on this machine: any scheme (http/https/data/...), a relative
// path whose document has no folder (untitled :new: tabs, browser-dev bare
// names), or an empty src.
export function resolveImageSrc(docPath: string, src: string): string | null {
  if (src === "" || !isLocalImageSrc(src)) return null;
  if (isAbsolutePath(src)) return src;
  const folder = docFolderOf(docPath);
  if (folder === "") return null;
  // Relative srcs are joined with forward slashes (markdown's universal
  // separator): a Windows-authored `assets\photo.png` still resolves.
  const relative = src.replace(/\\/g, "/");
  return folder === "/" ? `/${relative}` : `${folder}/${relative}`;
}

// The srcs of every image node in the doc, document order, deduplicated.
// Empty srcs are skipped: they have nothing to check and no file to name.
export function collectImageSrcs(doc: PmNode): string[] {
  const srcs: string[] = [];
  const seen = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === "image") {
      const src = node.attrs.src;
      if (typeof src === "string" && src !== "" && !seen.has(src)) {
        seen.add(src);
        srcs.push(src);
      }
    }
    return true;
  });
  return srcs;
}

// The folder the re-link picker opens in (plan 08 §3 "pre-filtered to the
// last folder"): the directory of the src's resolved path, so an image
// that was `assets/photo.png` re-opens in the doc's `assets/` folder and a
// bare `photo.png` in the doc folder itself. "" when the src cannot be
// resolved (the picker then opens at its default location).
export function relinkFolderFor(docPath: string, src: string): string {
  const resolved = resolveImageSrc(docPath, src);
  if (resolved === null) return "";
  const root = resolved.startsWith("/") ? "/" : "";
  const parts = resolved.split("/").filter(Boolean);
  parts.pop(); // the file name
  if (parts.length === 0) return root; // a file at the POSIX root: folder is "/"
  return root + parts.join("/");
}

// The set of image srcs whose local file no longer exists on disk (plan 08
// §3): the local srcs are resolved against the document's folder and checked
// in one batched file_exists call, so a document with fifty images costs one
// IPC round-trip. Non-local srcs (http/https/...) are never flagged — a
// remote image's availability is not this machine's business. The check is
// injectable for the tests; production uses the Rust file_exists command.
export async function findMissingImageSrcs(
  doc: PmNode,
  docPath: string,
  check: (paths: string[]) => Promise<boolean[]> = filesExist,
): Promise<Set<string>> {
  const local: { src: string; abs: string }[] = [];
  for (const src of collectImageSrcs(doc)) {
    const abs = resolveImageSrc(docPath, src);
    if (abs !== null) local.push({ src, abs });
  }
  if (local.length === 0) return new Set();
  const results = await check(local.map((l) => l.abs));
  const missing = new Set<string>();
  local.forEach((l, i) => {
    if (results[i] === false) missing.add(l.src);
  });
  return missing;
}
