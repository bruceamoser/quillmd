// Thin bridge between the React app and the M1 Rust filesystem layer. Under
// Tauri the heavy lifting (atomic writes, hash-guard, encoding, snapshots)
// lives in src-tauri; the file-input path mirrors that behavior client-side so
// the editor stays usable in a plain browser during development.

import { invoke, isTauri } from "@tauri-apps/api/core";

export type Eol = "lf" | "crlf";

export interface OpenFileResult {
  path: string;
  source: string;
  originalBytes: Uint8Array;
  hash: string;
  eol: Eol;
  bom: boolean;
  snapshot: Uint8Array | null;
}

export interface TauriOpenResult {
  bytes: number[];
  hash: string;
  eol: string;
  bom: boolean;
  snapshot: { path: string; mtime: number | null } | null;
}

export type ExternalStatus = "Unchanged" | "Modified" | "Deleted";

export function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    return crypto.subtle.digest("SHA-256", bytes).then((digest) => {
      const view = new Uint8Array(digest);
      let out = "";
      for (const b of view) out += b.toString(16).padStart(2, "0");
      return out;
    });
  }
  return Promise.resolve("");
}

// Strips a UTF-8 BOM and detects the dominant line ending, mirroring the Rust
// encoding module so the two paths agree on the document's on-disk shape.
export function decodeMarkdownBytes(bytes: Uint8Array): {
  source: string;
  eol: Eol;
  bom: boolean;
} {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = bom ? bytes.subarray(3) : bytes;
  const source = new TextDecoder("utf-8").decode(body);
  const eol: Eol = source.includes("\r\n") ? "crlf" : "lf";
  return { source, eol, bom };
}

async function hashOf(bytes: Uint8Array): Promise<string> {
  const hash = await sha256Hex(bytes);
  return hash;
}

// Opens a file picked through a browser <input type="file">. This is the v1
// open mechanism until the native dialog plugin is wired up.
export async function openFromFile(file: File): Promise<OpenFileResult> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const { source, eol, bom } = decodeMarkdownBytes(bytes);
  const hash = await hashOf(bytes);
  return {
    path: file.name,
    source,
    originalBytes: bytes,
    hash,
    eol,
    bom,
    snapshot: null,
  };
}

// Opens by native path through the Rust layer (Tauri only).
export async function openPath(path: string): Promise<OpenFileResult> {
  const res = await invoke<TauriOpenResult>("open_file", { path });
  const bytes = new Uint8Array(res.bytes);
  const { source, eol, bom } = decodeMarkdownBytes(bytes);
  const snapshotBytes = res.snapshot ? await recoverSnapshot(path) : null;
  return {
    path,
    source,
    originalBytes: bytes,
    hash: res.hash,
    eol: eol === "crlf" ? "crlf" : "lf",
    bom,
    snapshot: snapshotBytes,
  };
}

export async function saveFile(
  path: string,
  bytes: Uint8Array,
  expectedHash: string,
): Promise<string> {
  const res = await invoke<{ hash: string }>("save_file", {
    path,
    bytes: Array.from(bytes),
    expectedHash,
  });
  return res.hash;
}

export async function saveAs(path: string, bytes: Uint8Array): Promise<string> {
  const res = await invoke<{ hash: string }>("save_as", {
    path,
    bytes: Array.from(bytes),
  });
  return res.hash;
}

export async function checkExternal(path: string, expectedHash: string): Promise<ExternalStatus> {
  return invoke<ExternalStatus>("check_external", { path, expectedHash });
}

export async function recoverSnapshot(path: string): Promise<Uint8Array | null> {
  const res = await invoke<number[] | null>("recover_snapshot", { path });
  return res ? new Uint8Array(res) : null;
}

export function runningInTauri(): boolean {
  return isTauri();
}

// Triggers a browser download of the given bytes (dev-only save fallback).
export function downloadBytes(fileName: string, bytes: Uint8Array, mime = "text/markdown"): void {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
