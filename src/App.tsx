import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
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
import { collectDocInfo } from "./lib/docInfo";
import type { DocInfo } from "./lib/docInfo";
import {
  ZOOM_DEFAULT,
  ZOOM_STEP,
  clampZoom,
  dispatchEditorCommand,
  isLineSpacingValue,
} from "./lib/editorCommands";
import type { EditorCommandId, LineSpacingValue } from "./lib/editorCommands";
import { loadDocSettings, saveDocSettings } from "./lib/docSettings";
import type { DocSettings } from "./lib/docSettings";
import { readClipboardText } from "./lib/clipboard";
import { handleDroppedPaths } from "./lib/dragDrop";
import {
  compileSearch,
  currentFindDoc,
  currentFindEditor,
  nextMatch,
  prevMatch,
  publishFindState,
  replaceActiveMatch,
  replaceAllMatches,
  searchDoc,
} from "./lib/find";
import type { SearchState } from "./lib/find";
import Editor from "./components/Editor";
import DocInfoPanel from "./components/DocInfoPanel";
import SourceView from "./components/SourceView";
import SplitView from "./components/SplitView";
import PreviewView from "./components/PreviewView";
import StatusBar from "./components/StatusBar";
import TabBar from "./components/TabBar";
import Explorer from "./components/Explorer";
import type { ExplorerHandle } from "./components/Explorer";
import FindReplacePanel from "./components/FindReplacePanel";
import type { FindPanelMode, FindPanelOption, FindPanelResult } from "./components/FindReplacePanel";
import { loadViewMode, saveViewMode } from "./components/viewModes";
import type { ViewMode } from "./components/viewModes";
import "./App.css";

interface DocState {
  open: OpenFileResult;
  currentText: string;
  viewMode: ViewMode;
  // Per-doc view preferences (plan 02 task 2.5, zoom per task 2.6): line
  // spacing, word wrap, formatting marks, and zoom. View-only — never part of
  // the saved markdown.
  settings: DocSettings;
}

// Find & replace panel state (plan 07 task 7.2, issue #70). App owns the
// panel; the search engine (task 7.1) runs in the effect below against the
// live WYSIWYG doc and the outcome is kept in `findState`. The term and
// options survive closing the panel (Word behavior); per-doc term memory is
// task 7.5.
interface FindPanelState {
  open: boolean;
  mode: FindPanelMode;
  term: string;
  replaceTerm: string;
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

const FIND_PANEL_INITIAL: FindPanelState = {
  open: false,
  mode: "find",
  term: "",
  replaceTerm: "",
  matchCase: false,
  wholeWord: false,
  useRegex: false,
};

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
  "format-underline": "underline",
  "format-strike": "strike",
  "format-code": "code",
  "format-highlight": "highlight",
  "format-subscript": "subscript",
  "format-superscript": "superscript",
  "format-align-left": "alignLeft",
  "format-align-center": "alignCenter",
  "format-align-right": "alignRight",
  "format-indent": "indent",
  "format-outdent": "outdent",
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
  "Ctrl+B / Ctrl+I / Ctrl+U: bold / italic / underline",
  "Ctrl+K: link",
  "Ctrl+1..6: heading level 1-6 (press again to return to paragraph)",
  "Ctrl+] / Ctrl+[: indent / outdent (list item or quote level)",
  "Tab / Shift+Tab: nest / un-nest list item or quote",
  "Ctrl+= / Ctrl+- / Ctrl+0: zoom in / zoom out / reset (Ctrl+wheel)",
  "Ctrl+Shift+X: strikethrough",
  "Ctrl+E: inline code",
  "Ctrl+/: toggle WYSIWYG / Source",
  "Ctrl+F / Ctrl+H: find / find and replace",
  "F3 / Shift+F3: next / previous match (Esc closes the find panel)",
  "Ctrl+S / Ctrl+Shift+S: save / save as",
  "Ctrl+W: close tab",
  "Ctrl+Z / Ctrl+Shift+Z: undo / redo",
  "Ctrl+Shift+V: paste as plain text (Edit > Paste as Text)",
  "Ctrl+Shift+E: toggle explorer",
].join("\n");

export default function App() {
  const [docs, setDocs] = useState<Record<string, DocState>>({});
  const [activePath, setActivePath] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(240);
  const [statusbarVisible, setStatusbarVisible] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoData, setInfoData] = useState<DocInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [findPanel, setFindPanel] = useState<FindPanelState>(FIND_PANEL_INITIAL);
  const [findState, setFindState] = useState<SearchState | null>(null);
  const findStateRef = useRef<SearchState | null>(null);
  const findQueryRef = useRef("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const explorerRef = useRef<ExplorerHandle | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const activeDoc = activePath ? docs[activePath] : undefined;
  const currentText = activeDoc?.currentText ?? "";
  const model = useMemo(
    () => (activeDoc ? createDocument(activeDoc.open.source) : null),
    [activeDoc],
  );
  const dirty = activeDoc !== undefined && activeDoc.currentText !== activeDoc.open.source;
  const viewMode = activeDoc?.viewMode;

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
        settings: loadDocSettings(opened.path),
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
          settings: loadDocSettings(opened.path),
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

  // Per-doc view settings (plan 02 task 2.5, zoom per task 2.6): the View
  // menu handlers and changeZoom are the writers. The patch is persisted per
  // path (like the view mode) and the editor DOM is reconciled twice: the
  // registry command mutates it for the open WYSIWYG view, and Editor
  // re-applies the setting on mount, so the choice survives tab switches and
  // view-mode changes.
  const patchDocSettings = useCallback(
    (patch: Partial<DocSettings>) => {
      if (!activePath || !activeDoc) return;
      const settings = { ...activeDoc.settings, ...patch };
      updateDoc(activePath, { settings });
      saveDocSettings(activePath, settings);
    },
    [activePath, activeDoc, updateDoc],
  );

  const setLineSpacing = useCallback(
    (value: LineSpacingValue) => {
      if (!isLineSpacingValue(value)) return;
      patchDocSettings({ lineSpacing: value });
      dispatchEditorCommand("lineSpacing", value);
    },
    [patchDocSettings],
  );

  const toggleShowMarks = useCallback(() => {
    if (!activeDoc) return;
    patchDocSettings({ showMarks: !activeDoc.settings.showMarks });
    dispatchEditorCommand("showMarks");
  }, [activeDoc, patchDocSettings]);

  const toggleWordWrap = useCallback(() => {
    if (!activeDoc) return;
    patchDocSettings({ wordWrap: !activeDoc.settings.wordWrap });
    dispatchEditorCommand("wordWrap");
  }, [activeDoc, patchDocSettings]);

  // Spellcheck (plan 02 §2.8, issue #36): per-doc toggle like the other View
  // preferences — the persisted setting is the source of truth, the registry
  // command flips the contenteditable attribute on the open WYSIWYG DOM.
  const toggleSpellcheck = useCallback(() => {
    if (!activeDoc) return;
    patchDocSettings({ spellcheck: !activeDoc.settings.spellcheck });
    dispatchEditorCommand("spellcheck");
  }, [activeDoc, patchDocSettings]);

  // Paste as text (plan 02 §2.9, issue #36): the Edit menu item reads the
  // system clipboard (the native accelerator has already consumed the key
  // stroke) and dispatches the pasteAsText command with the payload.
  const doPasteAsText = useCallback(async () => {
    const text = await readClipboardText();
    if (text === null) {
      setStatus("Paste as text: clipboard unavailable in this view");
      return;
    }
    dispatchEditorCommand("pasteAsText", text);
  }, [setStatus]);

  // Zoom (plan 02 task 2.6, issue #35): the per-doc settings record is the
  // single source of truth for the percent. Every surface (View > Zoom
  // submenu, Ctrl+=/Ctrl+-/Ctrl+0, Ctrl-wheel, status-bar reset) funnels
  // through here: the clamped percent is persisted per path and then applied
  // to the open WYSIWYG DOM through the registry command (a no-op outside
  // WYSIWYG, where the next mount re-applies it via applyViewSettings).
  const changeZoom = useCallback(
    (percent: number) => {
      if (!activeDoc) return;
      const next = clampZoom(percent);
      patchDocSettings({ zoom: next });
      dispatchEditorCommand("zoom", next);
    },
    [activeDoc, patchDocSettings],
  );

  const stepZoom = useCallback(
    (delta: number) => {
      changeZoom((activeDoc?.settings.zoom ?? ZOOM_DEFAULT) + delta);
    },
    [activeDoc, changeZoom],
  );

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

  // --- find & replace panel (plan 07 task 7.2, issue #70) ------------------
  //
  // Ctrl+F / Edit > Find opens the panel in find mode; Ctrl+H / Edit > Find
  // and Replace in replace mode. F3 / Shift+F3 cycle the active match while
  // the panel is open (Word: no find bar, no F3). The search runs in the
  // effect below against the live WYSIWYG doc (exposed through the find
  // bridge); outside the WYSIWYG view the panel closes — source-view search
  // is task 7.4.

  const findNext = useCallback(() => {
    const cur = findStateRef.current;
    if (!cur || cur.matches.length === 0) return;
    const moved = nextMatch(cur);
    if (moved === cur) return;
    findStateRef.current = moved;
    setFindState(moved);
    publishFindState(moved);
  }, []);

  const findPrev = useCallback(() => {
    const cur = findStateRef.current;
    if (!cur || cur.matches.length === 0) return;
    const moved = prevMatch(cur);
    if (moved === cur) return;
    findStateRef.current = moved;
    setFindState(moved);
    publishFindState(moved);
  }, []);

  // The panel is a WYSIWYG feature until source-view search lands (task
  // 7.4): opening it in another view explains that in the status bar, and a
  // view switch while it is open closes it (Word closes its find bar on view
  // change too).
  const openFindPanel = useCallback(
    (mode: FindPanelMode) => {
      if (!activePath || viewMode !== "wysiwyg") {
        setStatus("Find & replace is available in the WYSIWYG view");
        return;
      }
      setFindPanel((p) => ({ ...p, open: true, mode }));
    },
    [activePath, viewMode],
  );

  const closeFindPanel = useCallback(() => {
    setFindPanel((p) => ({ ...p, open: false }));
  }, []);

  const setFindTerm = useCallback((term: string) => {
    setFindPanel((p) => ({ ...p, term }));
  }, []);

  const setFindReplaceTerm = useCallback((term: string) => {
    setFindPanel((p) => ({ ...p, replaceTerm: term }));
  }, []);

  const toggleFindOption = useCallback((option: FindPanelOption) => {
    setFindPanel((p) => ({ ...p, [option]: !p[option] }));
  }, []);

  const setFindMode = useCallback((mode: FindPanelMode) => {
    setFindPanel((p) => ({ ...p, mode }));
  }, []);

  const doReplace = useCallback(() => {
    const state = findStateRef.current;
    const editor = currentFindEditor();
    if (!state || !editor) return;
    replaceActiveMatch(editor, state, findPanel.replaceTerm);
  }, [findPanel.replaceTerm]);

  const doReplaceAll = useCallback(() => {
    const state = findStateRef.current;
    const editor = currentFindEditor();
    if (!state || !editor) return;
    replaceAllMatches(editor, state, findPanel.replaceTerm);
  }, [findPanel.replaceTerm]);

  // Runs the search engine (task 7.1) for the open panel: recomputes on
  // term/options changes, doc edits, tab switches, and view-mode changes. A
  // doc edit with an unchanged query keeps the navigation position (clamped
  // to the new match count); a new query restarts at the first match. A view
  // change away from WYSIWYG closes the panel (it is a WYSIWYG feature until
  // source-view search lands in task 7.4).
  useEffect(() => {
    if (!findPanel.open || !activeDoc) {
      findQueryRef.current = "";
      findStateRef.current = null;
      setFindState(null);
      publishFindState(null);
      return;
    }
    if (viewMode !== "wysiwyg") {
      findQueryRef.current = "";
      findStateRef.current = null;
      setFindState(null);
      setFindPanel((p) => ({ ...p, open: false }));
      publishFindState(null);
      return;
    }
    const options = {
      term: findPanel.term,
      matchCase: findPanel.matchCase,
      wholeWord: findPanel.wholeWord,
      useRegex: findPanel.useRegex,
    };
    const signature = [
      options.term,
      String(options.matchCase),
      String(options.wholeWord),
      String(options.useRegex),
    ].join("\u0000");
    const doc = currentFindDoc();
    if (!doc) {
      findQueryRef.current = "";
      findStateRef.current = null;
      setFindState(null);
      publishFindState(null);
      return;
    }
    const fresh = searchDoc(doc, options);
    const prev = findStateRef.current;
    const active =
      findQueryRef.current === signature && prev && fresh.matches.length > 0
        ? Math.max(0, Math.min(prev.active, fresh.matches.length - 1))
        : fresh.active;
    const state: SearchState = fresh.matches.length > 0 ? { ...fresh, active } : fresh;
    findQueryRef.current = signature;
    findStateRef.current = state;
    setFindState(state);
    publishFindState(state);
  }, [findPanel.open, findPanel.term, findPanel.matchCase, findPanel.wholeWord, findPanel.useRegex, activeDoc, viewMode]);

  // The result summary the panel renders: the engine's error for an invalid
  // regex term (searchDoc reports it as zero matches, so the panel gets it
  // from compileSearch), the match count, the active index, and the
  // cross-block flag of the active match (which disables the Replace button).
  const findPanelResult: FindPanelResult = useMemo(() => {
    const active =
      findState && findState.active >= 0 && findState.active < findState.matches.length
        ? findState.matches[findState.active]
        : undefined;
    return {
      count: findState?.matches.length ?? 0,
      active: findState?.active ?? -1,
      error: findPanel.open && findPanel.useRegex ? compileSearch(findPanel).error : null,
      activeCrossBlock: active?.crossBlock ?? false,
    };
  }, [findPanel, findState]);

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
      } else if (id === "file-info") {
        setInfoOpen((open) => !open);
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
      } else if (id === "edit-paste-as-text") {
        void doPasteAsText();
      } else if (id === "edit-find") {
        openFindPanel("find");
      } else if (id === "edit-find-replace") {
        openFindPanel("replace");
      } else if (id === "edit-find-next") {
        findNext();
      } else if (id === "edit-find-prev") {
        findPrev();
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
      } else if (id === "view-show-marks") {
        toggleShowMarks();
      } else if (id === "view-word-wrap") {
        toggleWordWrap();
      } else if (id === "view-spellcheck") {
        toggleSpellcheck();
      } else if (id.startsWith("view-spacing-")) {
        setLineSpacing(id.slice("view-spacing-".length) as LineSpacingValue);
      } else if (id === "view-zoom-in") {
        stepZoom(ZOOM_STEP);
      } else if (id === "view-zoom-out") {
        stepZoom(-ZOOM_STEP);
      } else if (id === "view-zoom-reset") {
        changeZoom(ZOOM_DEFAULT);
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
      openFindPanel,
      findNext,
      findPrev,
      setMode,
      toggleMode,
      setLineSpacing,
      toggleShowMarks,
      toggleWordWrap,
      toggleSpellcheck,
      doPasteAsText,
      stepZoom,
      changeZoom,
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

  // Drag & drop (plan 01 task 1.6, issue #27): Tauri emits tauri://drag-*
  // events to the webview by default; on drop each .md file opens as a tab,
  // each folder switches the Explorer root, and every dropped item gets its
  // own status-bar line (skipped non-markdown files included). In browser dev
  // the Tauri event stream does not exist, so this listener is never set up.
  useEffect(() => {
    if (!runningInTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        void handleDroppedPaths(event.payload.paths, {
          openFile: openByPath,
          openFolder: (path) => {
            setExplorerOpen(true);
            explorerRef.current?.openFolderPath(path);
          },
          status: setStatus,
        });
      })
      .then((fn) => {
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
  }, [openByPath]);

  // Load recent files once under Tauri.
  useEffect(() => {
    if (!runningInTauri()) return;
    getRecentFiles()
      .then(setRecentFiles)
      .catch(() => {
        // recent list unavailable; explorer shows empty
      });
  }, []);

  // File > Info (plan 01 §2.6, issue #26): while the properties flyout is
  // open, (re)collect the active doc's properties — live text counts plus
  // file_stat for size and OS timestamps. Stale results are ignored if the
  // tab switches or the panel closes mid-flight.
  useEffect(() => {
    if (!infoOpen || !activeDoc || !activePath) return;
    let stale = false;
    setInfoLoading(true);
    void collectDocInfo(activeDoc.open, activeDoc.currentText, dirty).then((info) => {
      if (stale) return;
      setInfoData(info);
      setInfoLoading(false);
    });
    return () => {
      stale = true;
    };
  }, [infoOpen, activeDoc, activePath, dirty]);

  // App-level shortcuts (browser dev has no native menu accelerators).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Find next/previous (plan 07 task 7.2): F3/Shift+F3 cycle the active
      // match (a no-op while the panel is closed — there is no active
      // search). The panel's own keydown handles F3 while it has focus (and
      // stops propagation), so this listener covers the rest of the window.
      if (e.key === "F3" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (e.shiftKey) findPrev();
        else findNext();
        return;
      }
      if (e.key === "Escape" && findPanel.open) {
        closeFindPanel();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "f" && !e.shiftKey) {
        e.preventDefault();
        openFindPanel("find");
      } else if (key === "h" && !e.shiftKey) {
        e.preventDefault();
        openFindPanel("replace");
      } else if (key === "n" && !e.shiftKey) {
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
      } else if (key === "=" || key === "+") {
        // Zoom in (plan 02 task 2.6): Ctrl+= on the main row, Ctrl+Shift+=
        // (which reports "+") on layouts where + sits behind Shift.
        e.preventDefault();
        stepZoom(ZOOM_STEP);
      } else if (key === "-") {
        e.preventDefault();
        stepZoom(-ZOOM_STEP);
      } else if (key === "0") {
        e.preventDefault();
        changeZoom(ZOOM_DEFAULT);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    toggleMode,
    doSave,
    doSaveAs,
    doNew,
    closeDoc,
    activePath,
    stepZoom,
    changeZoom,
    openFindPanel,
    closeFindPanel,
    findNext,
    findPrev,
    findPanel.open,
  ]);

  // Ctrl+mouse-wheel zoom (plan 02 task 2.6, Word behavior): a wheel event
  // with Ctrl held steps the active doc's zoom. The listener is non-passive so
  // preventDefault can stop the webview's own page zoom from also firing.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      stepZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [stepZoom]);

  const tabs = Object.entries(docs).map(([path, d]) => ({
    path,
    dirty: d.currentText !== d.open.source,
    viewMode: d.viewMode,
  }));

  let editorView: React.ReactNode = null;
  if (activeDoc) {
    switch (activeDoc.viewMode) {
      case "source":
        editorView = (
          <SourceView
            value={currentText}
            onChange={setActiveText}
            wrap={activeDoc.settings.wordWrap}
          />
        );
        break;
      case "split":
        editorView = (
          <SplitView
            value={currentText}
            onChange={setActiveText}
            settings={activeDoc.settings}
          />
        );
        break;
      case "preview":
        editorView = <PreviewView value={currentText} />;
        break;
      default:
        editorView = (
          <Editor
            value={currentText}
            onChange={setActiveText}
            settings={activeDoc.settings}
          />
        );
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
          <button type="button" onClick={() => setInfoOpen((open) => !open)}>
            Info
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
          <div className="quillmd-body">
            <div
              className="quillmd-content"
              key={activePath ?? "welcome"}
              ref={contentRef}
            >
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
              {findPanel.open && (
                <FindReplacePanel
                  mode={findPanel.mode}
                  term={findPanel.term}
                  replaceTerm={findPanel.replaceTerm}
                  matchCase={findPanel.matchCase}
                  wholeWord={findPanel.wholeWord}
                  useRegex={findPanel.useRegex}
                  result={findPanelResult}
                  onTermChange={setFindTerm}
                  onReplaceTermChange={setFindReplaceTerm}
                  onToggle={toggleFindOption}
                  onModeChange={setFindMode}
                  onNext={findNext}
                  onPrev={findPrev}
                  onReplace={doReplace}
                  onReplaceAll={doReplaceAll}
                  onClose={closeFindPanel}
                />
              )}
            </div>
            {infoOpen && activeDoc && (
              <DocInfoPanel
                info={infoData}
                loading={infoLoading}
                onClose={() => setInfoOpen(false)}
              />
            )}
          </div>
          {statusbarVisible && (
            <StatusBar
              mode={activeDoc?.viewMode ?? "wysiwyg"}
              wordCount={wordCount}
              charCount={charCount}
              eol={activeDoc?.open.eol ?? "lf"}
              dirty={dirty}
              zoom={activeDoc?.settings.zoom ?? ZOOM_DEFAULT}
              spellcheck={activeDoc?.settings.spellcheck ?? true}
              onSpellcheckToggle={toggleSpellcheck}
              fileName={
                activePath && isUntitledPath(activePath)
                  ? untitledDisplayName(activePath)
                  : activePath
              }
              onModeChange={setMode}
              onZoomReset={() => changeZoom(ZOOM_DEFAULT)}
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
