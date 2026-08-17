import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import { listDir, runningInTauri } from "../lib/fileIo";
import type { DirEntry } from "../lib/fileIo";

interface ExplorerProps {
  open: boolean;
  width: number;
  onResize: (width: number) => void;
  activePath: string | null;
  recentFiles: string[];
  onOpenPath: (path: string) => void;
}

export interface ExplorerHandle {
  openFolder: () => void;
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d={
          open
            ? "M1.5 3h4.2l1.6 1.8h7.2a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
            : "M1.5 3h4.2l1.6 1.8h7.2a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
        }
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3 1h7l3 3v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zM9 2.5V5h2.5L9 2.5z"
      />
    </svg>
  );
}

function isMarkdown(name: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(name);
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export default forwardRef<ExplorerHandle, ExplorerProps>(function Explorer(
  { open, width, onResize, activePath, recentFiles, onOpenPath },
  ref,
) {
  const [root, setRoot] = useState<string | null>(null);
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>("");

  const loadChildren = useCallback(async (dir: string) => {
    try {
      const entries = await listDir(dir);
      setChildren((prev) => ({ ...prev, [dir]: entries }));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const openFolder = useCallback(async () => {
    if (runningInTauri()) {
      // Native folder picker (VSCode-class); falls back to a text prompt in
      // browser dev where the Tauri dialog plugin is unavailable.
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: true });
        if (typeof selected === "string") {
          setRoot(selected);
          setError("");
          setExpanded(new Set([selected]));
          await loadChildren(selected);
        }
        return;
      } catch {
        // fall through to prompt in browser mode
      }
    }
    const path = window.prompt("Open folder (absolute path)") ?? "";
    if (!path) return;
    setRoot(path);
    setError("");
    setExpanded(new Set([path]));
    await loadChildren(path);
  }, [loadChildren]);

  useImperativeHandle(ref, () => ({ openFolder }), [openFolder]);

  const toggleDir = useCallback(
    async (dir: string) => {
      const next = new Set(expanded);
      if (next.has(dir)) {
        next.delete(dir);
        setExpanded(next);
        return;
      }
      next.add(dir);
      setExpanded(next);
      if (!children[dir]) await loadChildren(dir);
    },
    [expanded, children, loadChildren],
  );

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      const onMove = (ev: MouseEvent) => {
        onResize(Math.max(160, Math.min(480, startWidth + ev.clientX - startX)));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [width, onResize],
  );

  const renderDir = (dir: string, depth: number) => {
    const entries = children[dir] ?? [];
    return (
      <ul className="quillmd-tree" style={{ paddingLeft: depth > 0 ? 8 : 0 }}>
        {entries.map((entry) => {
          if (entry.is_dir) {
            const isOpen = expanded.has(entry.path);
            return (
              <li key={entry.path}>
                <button
                  type="button"
                  className="quillmd-tree-row quillmd-tree-dir"
                  style={{ paddingLeft: 8 + depth * 12 }}
                  onClick={() => void toggleDir(entry.path)}
                >
                  <span className="quillmd-tree-chevron">{isOpen ? "\u25BE" : "\u25B8"}</span>
                  <FolderIcon open={isOpen} />
                  <span className="quillmd-tree-name">{entry.name}</span>
                </button>
                {isOpen && renderDir(entry.path, depth + 1)}
              </li>
            );
          }
          const active = entry.path === activePath;
          return (
            <li key={entry.path}>
              <button
                type="button"
                className={`quillmd-tree-row ${active ? "quillmd-tree-active" : ""}`}
                style={{ paddingLeft: 20 + depth * 12 }}
                onClick={() => onOpenPath(entry.path)}
              >
                <FileIcon />
                <span className="quillmd-tree-name">{entry.name}</span>
                {isMarkdown(entry.name) && <span className="quillmd-tree-tag">md</span>}
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  if (!open) return null;

  return (
    <>
      <aside className="quillmd-explorer" style={{ width }}>
        <div className="quillmd-explorer-header">
          <span>Explorer</span>
          <button type="button" title="Open Folder" onClick={() => void openFolder()}>
            Open Folder
          </button>
        </div>

        <div className="quillmd-explorer-section">
          <div className="quillmd-explorer-section-title">Recent</div>
          {recentFiles.length === 0 ? (
            <div className="quillmd-explorer-empty">No recent files</div>
          ) : (
            <ul className="quillmd-tree">
              {recentFiles.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    className={`quillmd-tree-row ${path === activePath ? "quillmd-tree-active" : ""}`}
                    onClick={() => onOpenPath(path)}
                    title={path}
                  >
                    <FileIcon />
                    <span className="quillmd-tree-name">{baseName(path)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="quillmd-explorer-section">
          <div className="quillmd-explorer-section-title">Folder</div>
          {root ? (
            renderDir(root, 0)
          ) : (
            <div className="quillmd-explorer-empty">No folder opened</div>
          )}
          {error && <div className="quillmd-explorer-error">{error}</div>}
        </div>
      </aside>
      <div
        className="quillmd-splitter"
        onMouseDown={startResize}
        role="separator"
        aria-orientation="vertical"
      />
    </>
  );
});
