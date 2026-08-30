import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { createDocument, encodeDocument, saveDocument } from "./lib/pipeline";
import {
  checkExternal,
  downloadBytes,
  getRecentFiles,
  isAbsolutePath,
  openFromFile,
  openPath,
  runningInTauri,
  saveFile,
  setRecentFiles as persistRecentFiles,
} from "./lib/fileIo";
import type { ExportFormat, OpenFileResult } from "./lib/fileIo";
import {
  exportDefaultName,
  exportDocumentAs,
  importDocx,
  makeCopyDocument,
  openPickedFiles,
  saveAsDocument,
} from "./lib/fileMenu";
import { confirmCloseAll, confirmCloseTab, docDisplayName } from "./lib/tabClose";
import {
  isUntitledPath,
  makeUntitledDoc,
  nextUntitledPath,
  rekeyDocRecord,
  saveNewDocument,
  untitledDefaultName,
  untitledDisplayName,
} from "./lib/newDoc";
import { templateById } from "./lib/templates";
import { dispatchEditorCommand } from "./lib/editorCommands";
import type { EditorCommandId } from "./lib/editorCommands";
import Editor from "./components/Editor";
import SourceView from "./components/SourceView";
import SplitView from "./components/SplitView";
import PreviewView from "./components/PreviewView";
import StatusBar from "./components/StatusBar";
import TabBar from "./components/TabBar";
import Explorer from "./components/Explorer";
import type { ExplorerHandle } from "./components/Explorer";
import { loadViewMode, saveViewMode } from "./components/viewModes";
import type { ViewMode } from "./components/viewModes";
import "./App.css";

interface DocState {
  open: OpenFileResult;
  currentText: string;
  viewMode: ViewMode;
}

// Native menu item id -> shared editor command. Both Insert and Format menus
// dispatch through the same registry the toolbar uses.
const MENU_TO_COMMAND: Record<string, EditorCommandId> = {
  "insert-h1": "h1",
  "insert-h2": "h2",
  "insert-h3": "h3",
  "insert-h4": "h4",
  "insert-h5": "h5",
  "insert-h6": "h6",
  "insert-bold": "bold",
  "insert-italic": "italic",
  "insert-strike": "strike",
  "insert-code": "code",
  "insert-link": "link",
  "insert-image": "image",
  "insert-table": "table",
  "insert-codeblock": "codeBlock",
  "insert-hr": "hr",
  "insert-footnote": "footnote",
  "insert-tasklist": "taskList",
  "insert-blockquote": "blockquote",
  "insert-emoji": "emoji",
  "format-bold": "bold",
  "format-italic": "italic",
  "format-strike": "strike",
  "format-code": "code",
  "format-highlight": "highlight",
  "format-subscript": "subscript",
  "format-superscript": "superscript",
  "format-clear": "clearFormatting",
};

const EXPORT_FORMATS: Record<string, ExportFormat> = {
  "export-pdf": "pdf",
  "export-docx": "docx",
  "export-epub": "epub",
  "export-txt": "txt",
};

const SHORTCUTS_TEXT = [
  "Ctrl+N: new document",
  "Ctrl+B / Ctrl+I: bold / italic",
  "Ctrl+K: link",
  "Ctrl+Shift+X: strikethrough",
  "Ctrl+E: inline code",
  "Ctrl+/: toggle WYSIWYG / Source",
  "Ctrl+F / Ctrl+H: find / replace",
  "Ctrl+S / Ctrl+Shift+S: save / save as",
  "Ctrl+W: close tab",
  "Ctrl+Z / Ctrl+Shift+Z: undo / redo",
  "Ctrl+Shift+E: toggle explorer",
].join("\n");

export default function App() {
  const [docs, setDocs] = useState<Record<string, DocState>>({});
  const [activePath, setActivePath] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(240);
  const [statusbarVisible, setStatusbarVisible] = useState(true);
  const [status, setStatus] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const explorerRef = useRef<ExplorerHandle | null>(null);

  const activeDoc = activePath ? docs[activePath] : undefined;
  const currentText = activeDoc?.currentText ?? "";
  const model = useMemo(
    () => (activeDoc ? createDocument(activeDoc.open.source) : null),
    [activeDoc],
  );
  const dirty = activeDoc !== undefined && activeDoc.currentText !== activeDoc.open.source;

  const wordCount = useMemo(() => {
    const trimmed = currentText.trim();
    return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  }, [currentText]);

  const charCount = currentText.length;

  const updateDoc = useCallback((path: string, patch: Partial<DocState>) => {
    setDocs((prev) => {
      const d = prev[path];
      if (!d) return prev;
      return { ...prev, [path]: { ...d, ...patch } };
    });
  }, []);

  const setActiveText = useCallback(
    (text: string) => {
      if (activePath) updateDoc(activePath, { currentText: text });
    },
    [activePath, updateDoc],
  );

  const addDoc = useCallback((opened: OpenFileResult) => {
    setDocs((prev) => ({
      ...prev,
      [opened.path]: {
        open: opened,
        currentText: opened.source,
        viewMode: loadViewMode(opened.path),
      },
    }));
    setActivePath(opened.path);
    setStatus(`Opened ${opened.path} (${opened.eol.toUpperCase()})`);
    if (opened.snapshot && opened.snapshot.length > 0) {
      const restore = window.confirm(
        "A crash-recovery snapshot exists with unsaved edits. Restore it?",
      );
      if (restore) {
        const restored = new TextDecoder("utf-8").decode(opened.snapshot);
        updateDoc(opened.path, { currentText: restored });
        setStatus("Restored unsaved edits from snapshot");
      }
    }
  }, [updateDoc]);

  const addRecent = useCallback(
    async (path: string) => {
      if (!runningInTauri() || !isAbsolutePath(path)) return;
      const next = [path, ...recentFiles.filter((p) => p !== path)].slice(0, 10);
      setRecentFiles(next);
      try {
        await persistRecentFiles(next);
      } catch {
        // best-effort; recent list is non-critical
      }
    },
    [recentFiles],
  );

  const clearRecent = useCallback(async () => {
    setRecentFiles([]);
    if (runningInTauri()) {
      try {
        await persistRecentFiles([]);
      } catch {
        // best-effort
      }
    }
  }, []);

  const openByPath = useCallback(
    async (path: string) => {
      try {
        const opened = await openPath(path);
        addDoc(opened);
        void addRecent(path);
      } catch (err) {
        setStatus(`Open failed: ${String(err)}`);
      }
    },
    [addDoc, addRecent],
  );

  const handleOpenInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      for (const file of Array.from(files)) {
        try {
          const opened = await openFromFile(file);
          addDoc(opened);
        } catch (err) {
          setStatus(`Open failed: ${file.name} (${String(err)})`);
        }
      }
      if (e.target) e.target.value = "";
    },
    [addDoc],
  );

  // File > New / New from template: creates an untitled tab keyed by a
  // synthetic :new:<n> path (plan 01 §3). Template content is seeded from
  // the bundled src/templates set; without a template the doc starts blank.
  const doNew = useCallback(
    (templateId?: string) => {
      if (templateId !== undefined && !templateById(templateId)) {
        setStatus(`Unknown template: ${templateId}`);
        return;
      }
      const template = templateId ? templateById(templateId) : undefined;
      const content = template?.content ?? "";
      const opened = makeUntitledDoc(nextUntitledPath(Object.keys(docs)), content);
      setDocs((prev) => ({
        ...prev,
        [opened.path]: {
          open: opened,
          currentText: content,
          viewMode: loadViewMode(opened.path),
        },
      }));
      setActivePath(opened.path);
      setStatus(template ? `New from template: ${template.label}` : "New untitled document");
    },
    [docs],
  );

  // Re-keys an untitled tab from its synthetic :new:<n> path to a real path
  // after the first save. The document content and view mode carry over; the
  // open state is replaced with the saved file's source, bytes, and hash so
  // the external-change guard works from the second save on.
  const rekeyDoc = useCallback(
    (fromPath: string, toPath: string, source: string, bytes: Uint8Array, hash: string) => {
      setDocs((prev) => rekeyDocRecord(prev, fromPath, toPath, source, bytes, hash));
      setActivePath((cur) => (cur === fromPath ? toPath : cur));
      void addRecent(toPath);
    },
    [addRecent],
  );

  // File > Open: native multi-select dialog under Tauri (one tab per file);
  // the hidden <input type="file"> is the browser-dev fallback.
  const doOpen = useCallback(() => {
    if (runningInTauri()) {
      void openPickedFiles({ openByPath, status: setStatus });
    } else {
      fileInputRef.current?.click();
    }
  }, [openByPath]);

  const doSave = useCallback(async () => {
    const doc = activeDoc;
    if (!doc || !model) return;
    const result = saveDocument(model, doc.currentText);
    let bytes: Uint8Array;
    if (result.kind === "verbatim") {
      bytes = doc.open.originalBytes;
    } else {
      bytes = encodeDocument(result.text, { eol: doc.open.eol, bom: doc.open.bom });
    }

    // First save of an untitled doc: native save dialog, then re-key the tab
    // from the synthetic path to the chosen one (plan 01 acceptance #3).
    if (runningInTauri() && isUntitledPath(doc.open.path)) {
      await saveNewDocument(doc.open.path, bytes, {
        status: setStatus,
        onSaved: (out, hash) => rekeyDoc(doc.open.path, out, result.text, bytes, hash),
      });
      return;
    }

    if (runningInTauri() && isAbsolutePath(doc.open.path)) {
      const external = await checkExternal(doc.open.path, doc.open.hash);
      if (external === "Modified") {
        const reload = window.confirm(
          "File changed on disk. Reload it? (OK = reload, Cancel = keep my edits)",
        );
        if (reload) {
          const opened = await openPath(doc.open.path);
          updateDoc(doc.open.path, { open: opened, currentText: opened.source });
        }
        return;
      }
      if (external === "Deleted") {
        window.alert("The file was deleted on disk. Use Save As to recreate it.");
        return;
      }
      const newHash = await saveFile(doc.open.path, bytes, doc.open.hash);
      updateDoc(doc.open.path, {
        open: { ...doc.open, source: result.text, originalBytes: bytes, hash: newHash },
        currentText: result.text,
      });
      setStatus("Saved");
      return;
    }

    const downloadName = isUntitledPath(doc.open.path)
      ? untitledDefaultName(doc.open.path)
      : doc.open.path || "document.md";
    downloadBytes(downloadName, bytes);
    updateDoc(doc.open.path, {
      open: { ...doc.open, source: result.text, originalBytes: bytes },
      currentText: result.text,
    });
    setStatus("Saved (downloaded)");
  }, [activeDoc, model, updateDoc, rekeyDoc]);

  const doSaveAs = useCallback(async () => {
    const doc = activeDoc;
    if (!doc || !model) return;
    const result = saveDocument(model, doc.currentText);
    const bytes =
      result.kind === "verbatim"
        ? doc.open.originalBytes
        : encodeDocument(result.text, { eol: doc.open.eol, bom: doc.open.bom });
    if (runningInTauri()) {
      await saveAsDocument(doc.open, bytes, { openByPath, status: setStatus });
    } else {
      const downloadName = isUntitledPath(doc.open.path)
        ? untitledDefaultName(doc.open.path)
        : doc.open.path || "document.md";
      downloadBytes(downloadName, bytes);
      setStatus("Saved (downloaded)");
    }
  }, [activeDoc, model, openByPath]);

  const setMode = useCallback(
    (mode: ViewMode) => {
      if (!activePath) return;
      updateDoc(activePath, { viewMode: mode });
      saveViewMode(activePath, mode);
    },
    [activePath, updateDoc],
  );

  const toggleMode = useCallback(() => {
    const doc = activeDoc;
    if (!doc || !activePath) return;
    setMode(doc.viewMode === "wysiwyg" ? "source" : "wysiwyg");
  }, [activeDoc, activePath, setMode]);

  const doExport = useCallback(
    async (format: ExportFormat) => {
      const doc = activeDoc;
      if (!doc) return;
      if (runningInTauri()) {
        await exportDocumentAs(doc.open.path, format, {
          openByPath,
          status: setStatus,
        });
      } else {
        const mime =
          format === "pdf"
            ? "application/pdf"
            : format === "docx"
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : format === "epub"
                ? "application/epub+zip"
                : "text/plain";
        const defaultName = exportDefaultName(doc.open.path, format);
        downloadBytes(defaultName, new TextEncoder().encode(doc.currentText), mime);
        setStatus(`Exported ${defaultName} (dev: raw markdown bytes)`);
      }
    },
    [activeDoc, openByPath],
  );

  // File > Import: native docx picker + save-as dialog under Tauri; the
  // browser dev path has no Rust conversion layer, so it reports that.
  const doImport = useCallback(async () => {
    if (!activeDoc) return;
    if (runningInTauri()) {
      await importDocx({ openByPath, status: setStatus });
    } else {
      setStatus("Import DOCX is only available in the desktop app");
    }
  }, [activeDoc, openByPath]);

  // Closes one tab. A dirty tab confirms through the native dialog first
  // (plan 01 §2.5 / acceptance #5); a clean tab closes without any prompt.
  // The active tab moves to the rightmost remaining tab, or to the welcome
  // screen when the last tab closes.
  const closeDoc = useCallback(
    async (path: string) => {
      const d = docs[path];
      if (!d) return;
      const dirty = d.currentText !== d.open.source;
      if (dirty) {
        const ok = await confirmCloseTab({ path, displayName: docDisplayName(path), dirty });
        if (!ok) return;
      }
      const next = { ...docs };
      delete next[path];
      setDocs(next);
      if (activePath === path) {
        const remaining = Object.keys(next);
        setActivePath(remaining.length > 0 ? remaining[remaining.length - 1] : null);
      }
    },
    [docs, activePath],
  );

  // File > Close All: confirms once, listing the dirty tabs (clean-only
  // batches close without a dialog), then removes every tab.
  const closeAll = useCallback(async () => {
    const docsList = Object.values(docs);
    if (docsList.length === 0) return;
    const ok = await confirmCloseAll(
      docsList.map((d) => ({
        path: d.open.path,
        displayName: docDisplayName(d.open.path),
        dirty: d.currentText !== d.open.source,
      })),
    );
    if (!ok) return;
    setDocs({});
    setActivePath(null);
    setStatus("Closed all documents");
  }, [docs]);

  // File > Make a copy: serializes the current text through the clean-path
  // pipeline (verbatim bytes when untouched), picks a new .md destination,
  // writes it, and opens the copy as a new independent tab. The original
  // tab keeps its own state (plan 01 acceptance #4).
  const doMakeCopy = useCallback(async () => {
    const doc = activeDoc;
    if (!doc || !model) return;
    const result = saveDocument(model, doc.currentText);
    const bytes =
      result.kind === "verbatim"
        ? doc.open.originalBytes
        : encodeDocument(result.text, { eol: doc.open.eol, bom: doc.open.bom });
    await makeCopyDocument(doc.open, bytes, { openByPath, status: setStatus });
  }, [activeDoc, model, openByPath]);

  const doFind = useCallback(() => {
    const term = window.prompt("Find text") ?? "";
    if (!term) return;
    try {
      (window as unknown as { find?: (t: string) => boolean }).find?.(term);
    } catch {
      // window.find is unsupported in some webviews; no-op
    }
  }, []);

  const handleMenuEvent = useCallback(
    (id: string) => {
      if (id === "file-new") {
        doNew();
      } else if (id.startsWith("file-new-template-")) {
        doNew(id.slice("file-new-template-".length));
      } else if (id === "file-open") {
        doOpen();
      } else if (id === "file-open-folder") {
        explorerRef.current?.openFolder();
      } else if (id === "file-save") {
        void doSave();
      } else if (id === "file-save-as") {
        void doSaveAs();
      } else if (id === "file-make-a-copy") {
        void doMakeCopy();
      } else if (id === "file-close") {
        if (activePath) void closeDoc(activePath);
      } else if (id === "file-close-all") {
        void closeAll();
      } else if (id === "file-exit") {
        window.close();
      } else if (id.startsWith("file-recent-")) {
        const idx = parseInt(id.slice("file-recent-".length), 10);
        if (Number.isFinite(idx) && recentFiles[idx]) void openByPath(recentFiles[idx]);
      } else if (id === "file-recent-clear") {
        void clearRecent();
      } else if (EXPORT_FORMATS[id]) {
        void doExport(EXPORT_FORMATS[id]);
      } else if (id === "import-docx") {
        void doImport();
      } else if (id === "edit-undo") {
        dispatchEditorCommand("undo");
      } else if (id === "edit-redo") {
        dispatchEditorCommand("redo");
      } else if (id === "edit-cut") {
        document.execCommand("cut");
      } else if (id === "edit-copy") {
        document.execCommand("copy");
      } else if (id === "edit-paste") {
        document.execCommand("paste");
      } else if (id === "edit-find") {
        doFind();
      } else if (id === "view-wysiwyg") {
        setMode("wysiwyg");
      } else if (id === "view-source") {
        setMode("source");
      } else if (id === "view-split") {
        setMode("split");
      } else if (id === "view-preview") {
        setMode("preview");
      } else if (id === "view-toggle") {
        toggleMode();
      } else if (id === "view-explorer") {
        setExplorerOpen((open) => !open);
      } else if (id === "view-statusbar") {
        setStatusbarVisible((visible) => !visible);
      } else if (MENU_TO_COMMAND[id]) {
        dispatchEditorCommand(MENU_TO_COMMAND[id]);
      } else if (id === "help-about") {
        window.alert("QuillMD - a WYSIWYG Markdown editor that persists natively in markdown.");
      } else if (id === "help-shortcuts") {
        window.alert(SHORTCUTS_TEXT);
      }
    },
    [
      doNew,
      doOpen,
      doSave,
      doSaveAs,
      doMakeCopy,
      closeDoc,
      closeAll,
      doExport,
      doImport,
      doFind,
      setMode,
      toggleMode,
      recentFiles,
      activePath,
      openByPath,
      clearRecent,
    ],
  );

  // Native menu events (Tauri only). In browser dev this listener never fires.
  useEffect(() => {
    if (!runningInTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<string>("menu-event", (event) => handleMenuEvent(event.payload)).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleMenuEvent]);

  // Load recent files once under Tauri.
  useEffect(() => {
    if (!runningInTauri()) return;
    getRecentFiles()
      .then(setRecentFiles)
      .catch(() => {
        // recent list unavailable; explorer shows empty
      });
  }, []);

  // App-level shortcuts (browser dev has no native menu accelerators).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "n" && !e.shiftKey) {
        e.preventDefault();
        doNew();
      } else if (key === "e" && e.shiftKey) {
        e.preventDefault();
        setExplorerOpen((open) => !open);
      } else if (key === "/") {
        e.preventDefault();
        toggleMode();
      } else if (key === "s" && e.shiftKey) {
        e.preventDefault();
        void doSaveAs();
      } else if (key === "s") {
        e.preventDefault();
        void doSave();
      } else if (key === "w") {
        e.preventDefault();
        if (activePath) void closeDoc(activePath);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleMode, doSave, doSaveAs, doNew, closeDoc, activePath]);

  const tabs = Object.entries(docs).map(([path, d]) => ({
    path,
    dirty: d.currentText !== d.open.source,
    viewMode: d.viewMode,
  }));

  let editorView: React.ReactNode = null;
  if (activeDoc) {
    switch (activeDoc.viewMode) {
      case "source":
        editorView = <SourceView value={currentText} onChange={setActiveText} />;
        break;
      case "split":
        editorView = <SplitView value={currentText} onChange={setActiveText} />;
        break;
      case "preview":
        editorView = <PreviewView value={currentText} />;
        break;
      default:
        editorView = <Editor value={currentText} onChange={setActiveText} />;
        break;
    }
  }

  return (
    <main className="quillmd-app">
      {!runningInTauri() && (
        <header className="quillmd-header">
          <button type="button" onClick={() => doNew()}>
            New
          </button>
          <button type="button" onClick={doOpen}>
            Open
          </button>
          <button type="button" onClick={() => void doSave()}>
            Save
          </button>
          <button type="button" onClick={() => void doSaveAs()}>
            Save As
          </button>
          <button type="button" onClick={() => void doMakeCopy()}>
            Make a Copy
          </button>
          <button type="button" onClick={() => activePath && void closeDoc(activePath)}>
            Close
          </button>
          <button type="button" onClick={() => void closeAll()}>
            Close All
          </button>
          <span className="quillmd-menu-sep">|</span>
          <button type="button" onClick={() => void doExport("pdf")}>
            Export PDF
          </button>
          <button type="button" onClick={() => void doExport("docx")}>
            Export DOCX
          </button>
          <button type="button" onClick={() => void doExport("epub")}>
            Export EPUB
          </button>
          <button type="button" onClick={() => void doExport("txt")}>
            Export TXT
          </button>
          <button type="button" onClick={() => void doImport()}>
            Import DOCX
          </button>
        </header>
      )}

      <div className="quillmd-main">
        <Explorer
          ref={explorerRef}
          open={explorerOpen}
          width={explorerWidth}
          onResize={setExplorerWidth}
          activePath={activePath}
          recentFiles={recentFiles}
          onOpenPath={(path) => void openByPath(path)}
        />
        <div className="quillmd-editor-area">
          <TabBar
            tabs={tabs}
            activePath={activePath ?? ""}
            onSelect={setActivePath}
            onClose={(path) => void closeDoc(path)}
            onNewTab={doOpen}
          />
          <div className="quillmd-content" key={activePath ?? "welcome"}>
            {activeDoc ? (
              editorView
            ) : (
              <div className="quillmd-welcome">
                <h1>QuillMD</h1>
                <p>Open a Markdown file to begin editing.</p>
                <button type="button" onClick={doOpen}>
                  Open file
                </button>
                <button type="button" onClick={() => doNew()}>
                  New document
                </button>
              </div>
            )}
          </div>
          {statusbarVisible && (
            <StatusBar
              mode={activeDoc?.viewMode ?? "wysiwyg"}
              wordCount={wordCount}
              charCount={charCount}
              eol={activeDoc?.open.eol ?? "lf"}
              dirty={dirty}
              fileName={
                activePath && isUntitledPath(activePath)
                  ? untitledDisplayName(activePath)
                  : activePath
              }
              onModeChange={setMode}
            />
          )}
        </div>
      </div>

      {status && <div className="quillmd-status-toast">{status}</div>}

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown"
        multiple
        style={{ display: "none" }}
        onChange={handleOpenInput}
      />
    </main>
  );
}
