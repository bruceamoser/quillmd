import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import {
  fsNewDir,
  fsNewFile,
  fsRename,
  fsTrash,
  listDir,
  runningInTauri,
} from "../lib/fileIo";
import type { DirEntry } from "../lib/fileIo";
import { confirmMessage } from "../lib/dialogs";
import {
  buildExplorerMenu,
  toExplorerContextEntries,
  type ExplorerMenuTarget,
} from "../lib/explorerMenu";
import type { ExplorerMenuItem } from "../lib/explorerMenu";
import ContextMenu from "./ContextMenu";

interface ExplorerProps {
  open: boolean;
  width: number;
  onResize: (width: number) => void;
  activePath: string | null;
  recentFiles: string[];
  onOpenPath: (path: string) => void;
  // Explorer context menu (plan 03 task 3.6, issue #44): reported after a
  // Delete succeeds so the App can offer the status-bar Undo (the restore
  // is an fs_rename from the trash path back to the original location).
  onDeleted?: (entry: { path: string; name: string; isDir: boolean }, trashPath: string) => void;
}

export interface ExplorerHandle {
  openFolder: () => void;
  // Switches the root to a known folder path (drag & drop, issue #27).
  openFolderPath: (path: string) => void;
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

// The directory containing `path` (both / and \ separators; a filesystem
// root like `C:\` or `/` maps to itself).
function parentDirOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (idx <= 0) return path;
  return path.slice(0, idx);
}

// Joins a name to a directory using the separator the directory already uses.
function joinPath(dir: string, name: string): string {
  if (dir.endsWith("/") || dir.endsWith("\\")) return dir + name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir + sep + name;
}

// The open explorer menu: cursor position plus the right-click target (a
// tree entry, or null for the Folder section itself).
interface ExplorerMenuState {
  x: number;
  y: number;
  target: ExplorerMenuTarget | null;
}

export default forwardRef<ExplorerHandle, ExplorerProps>(function Explorer(
  { open, width, onResize, activePath, recentFiles, onOpenPath, onDeleted },
  ref,
) {
  const [root, setRoot] = useState<string | null>(null);
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>("");
  const [menu, setMenu] = useState<ExplorerMenuState | null>(null);

  const loadChildren = useCallback(async (dir: string) => {
    try {
      const entries = await listDir(dir);
      setChildren((prev) => ({ ...prev, [dir]: entries }));
    } catch (err) {
      setError(String(err));
    }
  }, []);

  // Sets the explorer root to a known folder path and loads its first level.
  // Shared by the Open Folder picker and drag & drop (issue #27).
  const showFolder = useCallback(
    (path: string) => {
      setRoot(path);
      setError("");
      setExpanded(new Set([path]));
      void loadChildren(path);
    },
    [loadChildren],
  );

  const openFolder = useCallback(async () => {
    if (runningInTauri()) {
      // Native folder picker (VSCode-class); falls back to a text prompt in
      // browser dev where the Tauri dialog plugin is unavailable.
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: true });
        if (typeof selected === "string") {
          showFolder(selected);
        }
        return;
      } catch {
        // fall through to prompt in browser mode
      }
    }
    const path = window.prompt("Open folder (absolute path)") ?? "";
    if (!path) return;
    showFolder(path);
  }, [showFolder]);

  useImperativeHandle(ref, () => ({ openFolder, openFolderPath: showFolder }), [
    openFolder,
    showFolder,
  ]);

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

  // Re-reads the directory a menu action changed (the action's target parent),
  // so the created/renamed/deleted entry shows up immediately.
  const refreshDir = useCallback(
    (dir: string) => {
      if (dir) void loadChildren(dir);
    },
    [loadChildren],
  );

  // --- context-menu actions (plan 03 task 3.6, issue #44) -------------------
  //
  // The picked item's disk work runs through the fs_* Rust commands; every
  // failure lands in the section error line, every success re-reads the
  // affected directory. Delete is gated on the native confirm dialog (plan
  // 03 §3) and moves to the app-local trash (never an unlink) so the App's
  // status-bar Undo can restore it.

  const doNewEntry = useCallback(
    async (dir: string, isDir: boolean) => {
      const name = (window.prompt(isDir ? "New folder name" : "New file name") ?? "").trim();
      if (!name) return;
      try {
        setError("");
        const created = isDir ? await fsNewDir(dir, name) : await fsNewFile(dir, name);
        refreshDir(dir);
        // A new folder is worth opening immediately (VSCode behavior).
        if (isDir) {
          setExpanded((prev) => new Set(prev).add(created));
          void loadChildren(created);
        }
      } catch (err) {
        setError(String(err));
      }
    },
    [loadChildren, refreshDir],
  );

  const doRename = useCallback(
    async (target: ExplorerMenuTarget) => {
      const name = (window.prompt("Rename to", target.name) ?? "").trim();
      if (!name || name === target.name) return;
      try {
        setError("");
        await fsRename(target.path, joinPath(parentDirOf(target.path), name));
        refreshDir(parentDirOf(target.path));
      } catch (err) {
        setError(String(err));
      }
    },
    [refreshDir],
  );

  const doDelete = useCallback(
    async (target: ExplorerMenuTarget) => {
      const result = await confirmMessage({
        title: "QuillMD",
        message: `Delete "${target.name}"? It will be moved to the trash.`,
        kind: "warning",
        buttons: "yesNo",
      });
      if (result !== "yes") return;
      try {
        setError("");
        const trashPath = await fsTrash(target.path);
        onDeleted?.(target, trashPath);
        refreshDir(parentDirOf(target.path));
      } catch (err) {
        setError(String(err));
      }
    },
    [onDeleted, refreshDir],
  );

  const doCopyPath = useCallback(async (target: ExplorerMenuTarget) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setError("Clipboard unavailable in this view");
      return;
    }
    try {
      setError("");
      await navigator.clipboard.writeText(target.path);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const doReveal = useCallback(async (target: ExplorerMenuTarget) => {
    if (!runningInTauri()) {
      setError("Reveal is only available in the desktop app");
      return;
    }
    try {
      setError("");
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(target.path);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const doCollapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  const dispatchMenu = useCallback(
    (item: ExplorerMenuItem) => {
      const target = menu?.target ?? null;
      switch (item.action) {
        case "new-file": {
          // Inside the right-clicked folder, or at the opened root from the
          // section menu.
          const dir = target?.isDir ? target.path : target ? parentDirOf(target.path) : root;
          if (dir) void doNewEntry(dir, false);
          return;
        }
        case "new-folder": {
          const dir = target?.isDir ? target.path : target ? parentDirOf(target.path) : root;
          if (dir) void doNewEntry(dir, true);
          return;
        }
        case "rename":
          if (target) void doRename(target);
          return;
        case "delete":
          if (target) void doDelete(target);
          return;
        case "copy-path":
          if (target) void doCopyPath(target);
          return;
        case "reveal":
          if (target) void doReveal(target);
          return;
        case "collapse-all":
          doCollapseAll();
          return;
      }
    },
    [menu, root, doNewEntry, doRename, doDelete, doCopyPath, doReveal, doCollapseAll],
  );

  const openMenu = useCallback((e: React.MouseEvent, target: ExplorerMenuTarget | null) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, target });
  }, []);

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
                  onContextMenu={(e) =>
                    openMenu(e, { path: entry.path, name: entry.name, isDir: true })
                  }
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
                onContextMenu={(e) =>
                  openMenu(e, { path: entry.path, name: entry.name, isDir: false })
                }
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

        <div
          className="quillmd-explorer-section"
          onContextMenu={(e) => openMenu(e, null)}
        >
          <div className="quillmd-explorer-section-title">Folder</div>
          {root ? (
            renderDir(root, 0)
          ) : (
            <div className="quillmd-explorer-empty">No folder opened</div>
          )}
          {error && <div className="quillmd-explorer-error">{error}</div>}
        </div>

        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            label="Explorer menu"
            items={toExplorerContextEntries(
              buildExplorerMenu(menu.target, root !== null),
              dispatchMenu,
            )}
            onClose={() => setMenu(null)}
          />
        )}
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
