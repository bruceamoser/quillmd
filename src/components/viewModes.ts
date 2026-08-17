export type ViewMode = "wysiwyg" | "source" | "split" | "preview";

const MODE_KEY = "quillmd.viewMode";

// Remember last-used mode per file (spec §2.2.1). Falls back to "wysiwyg".
export function loadViewMode(path: string): ViewMode {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    if (!raw) return "wysiwyg";
    const map = JSON.parse(raw) as Record<string, unknown>;
    const value = map[path];
    if (value === "wysiwyg" || value === "source" || value === "split" || value === "preview") {
      return value;
    }
    return "wysiwyg";
  } catch {
    return "wysiwyg";
  }
}

export function saveViewMode(path: string, mode: ViewMode): void {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    map[path] = mode;
    localStorage.setItem(MODE_KEY, JSON.stringify(map));
  } catch {
    // localStorage may be unavailable (private mode); view mode is best-effort.
  }
}
