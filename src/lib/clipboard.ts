// Clipboard reads for editor commands (plan 02 task 2.9, issue #36). The
// pasteAsText registry command takes a plain-text payload; the paste event
// path reads event.clipboardData synchronously, and the Edit menu item reads
// the system clipboard here, because by the time its menu event arrives the
// key stroke has already been consumed by the native menu.

// Reads the system clipboard as plain text. The Web Clipboard API is the only
// read path that works in the desktop webviews; where it is unavailable or
// denied (browser dev without permission, non-secure contexts) the read
// reports null and the caller degrades to a status message instead of
// guessing at the payload.
export async function readClipboardText(): Promise<string | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) return null;
    const text = await navigator.clipboard.readText();
    return text ?? null;
  } catch {
    return null;
  }
}
