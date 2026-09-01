export type ViewMode = "wysiwyg" | "source" | "split" | "preview";

const MODE_KEY = "quillmd.viewMode";

// Remember last-used mode per file (spec §2.2.1). Falls back to `fallback`
// (the "default view mode" app setting, plan 10 task 10.2, issue #94;
// "wysiwyg" when unset) for a path with no remembered mode.
export function loadViewMode(path: string, fallback: ViewMode = "wysiwyg"): ViewMode {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    if (!raw) return fallback;
    const map = JSON.parse(raw) as Record<string, unknown>;
    const value = map[path];
    if (value === "wysiwyg" || value === "source" || value === "split" || value === "preview") {
      return value;
    }
    return fallback;
  } catch {
    return fallback;
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
