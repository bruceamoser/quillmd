// Asset copy pipeline (plan 08 task 8.3, issue #78). A picked image is
// copied next to the open document — into an `assets/` subfolder or the
// doc's own folder (plan 08 §2.3 user setting) — and the markdown
// references the copy by a forward-slash relative path (plan 08 §3
// relative-path invariant). The Rust `copy_asset` command performs the
// copy (collision-safe, atomic, traversal-validated through the fs safety
// core); the Rust `file_exists` command batch-checks asset paths on disk
// (plan 08 §3 broken-image detection, consumed by task 8.5's placeholder).

import { invoke, isTauri } from "@tauri-apps/api/core";
import { baseName, isAbsolutePath } from "./fileIo";
import { docFolderOf, relativePath } from "./images";

// Where copied assets land relative to the document (plan 08 §2.3): the
// `assets/` subfolder next to the doc (the default), or the doc's own
// folder. A global user setting persisted in localStorage exactly like the
// find-panel position — view-only, never part of the saved markdown.
export type AssetFolder = "assets" | "doc";

export const DEFAULT_ASSET_FOLDER: AssetFolder = "assets";

// Name-collision behavior on copy (plan 10 task 10.2, issue #94): "suffix"
// appends -1/-2/... until the name is free (the plan 08 default), "never"
// keeps the picked (fixed) name and overwrites the existing file.
export type AssetCollision = "never" | "suffix";

export const DEFAULT_ASSET_COLLISION: AssetCollision = "suffix";

const ASSET_FOLDER_KEY = "quillmd.assetFolder";

export function isAssetFolder(value: unknown): value is AssetFolder {
  return value === "assets" || value === "doc";
}

export function loadAssetFolder(): AssetFolder {
  try {
    const raw = localStorage.getItem(ASSET_FOLDER_KEY);
    if (raw === null) return DEFAULT_ASSET_FOLDER;
    const parsed: unknown = JSON.parse(raw);
    return isAssetFolder(parsed) ? parsed : DEFAULT_ASSET_FOLDER;
  } catch {
    return DEFAULT_ASSET_FOLDER;
  }
}

export function saveAssetFolder(folder: AssetFolder): void {
  try {
    localStorage.setItem(ASSET_FOLDER_KEY, JSON.stringify(folder));
  } catch {
    // localStorage may be unavailable (private mode); the setting is
    // best-effort.
  }
}

// The Rust copy_asset command (plan 08 §2.3): copies the file into the
// document's asset location and returns the markdown-relative path to
// embed. Resolves to `assets/photo.png` / `photo.png`; rejects with a
// structured string on failure (asset_copy:..., bad_request:...).
export async function copyAsset(
  src: string,
  docDir: string,
  folder: AssetFolder = DEFAULT_ASSET_FOLDER,
  collision: AssetCollision = DEFAULT_ASSET_COLLISION,
): Promise<string> {
  return invoke<string>("copy_asset", { src, docDir, assetFolder: folder, collision });
}

// The Rust file_exists command (plan 08 §3): batch existence check — one
// list in, one list out, in input order.
export async function filesExist(paths: string[]): Promise<boolean[]> {
  return invoke<boolean[]>("file_exists", { paths });
}

// Whether a relative path (from relativePath) climbs out of its base
// directory: true only when a path segment is exactly `..`, so a file
// literally named `..hidden.png` inside the folder still reads as inside.
export function climbsOutOf(relative: string): boolean {
  return relative.split("/").includes("..");
}

// The markdown src the from-file flow writes for a picked image (plan 08
// task 8.3, issue #78). The copy rule (plan 08 §3): a picked file that is
// already inside the document's folder is referenced directly, relative to
// the doc (no copy); any other absolute path is copied next to the doc
// through the Rust copy_asset command and the copy's relative path is
// referenced. A pick without an absolute location (browser-dev, keyed by
// bare name) or a document without a folder (unsaved :new: tab) cannot be
// copied or relativized, so it is referenced as-is.
export async function assetSrcForPickedFile(
  docPath: string,
  filePath: string,
  folder: AssetFolder = DEFAULT_ASSET_FOLDER,
  collision: AssetCollision = DEFAULT_ASSET_COLLISION,
): Promise<string> {
  if (!isAbsolutePath(filePath)) return filePath;
  const docDir = docFolderOf(docPath);
  if (docDir === "") return baseName(filePath);
  const relative = relativePath(docDir, filePath);
  if (!climbsOutOf(relative)) return relative;
  if (!isTauri()) return relative;
  return copyAsset(filePath, docDir, folder, collision);
}
