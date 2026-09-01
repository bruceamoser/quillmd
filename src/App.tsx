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
  fontMenuCommand,
  isLineSpacingValue,
  registerBlockStyleListener,
  registerImageAltDialogListener,
  registerImageEditDialogListener,
  registerImageInsertListener,
  registerImageReplaceListener,
  registerLinkDialogListener,
  registerTableDialogListener,
  requestStylesGallery,
  runEditorCommand,
} from "./lib/editorCommands";
import { IMAGE_FILTER, pickOpenFile } from "./lib/dialogs";
import {
  applyImageEdit,
  imageAtCaret,
  insertImage,
  readImagePrefill,
} from "./lib/images";
import type { ImageEditPayload, ImageEditPrefill, ImagePayload } from "./lib/images";
import { assetSrcForPickedFile, loadAssetFolder } from "./lib/assets";
import { findMissingImageSrcs, relinkFolderFor } from "./lib/missingImages";
import type { EditorCommandId, LineSpacingValue } from "./lib/editorCommands";
import {
  applyLink,
  openLinkUrl,
  readLinkPrefill,
  removeLink,
} from "./lib/links";
import type { LinkPayload, LinkPrefill } from "./lib/links";
import {
  findMarkdownLink,
  relinkMarkdownLink,
  unlinkMarkdownLink,
} from "./lib/markdownLinks";
import type { MarkdownLinkRef } from "./lib/markdownLinks";
import type { Editor as CoreEditor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { loadDocSettings, saveDocSettings } from "./lib/docSettings";
import type { DocSettings } from "./lib/docSettings";
import {
  THEME_DEFAULT_MENU_ID_PREFIX,
  THEME_MENU_ID_PREFIX,
  THEME_RESET_MENU_ID,
  hasSavedThemeDefault,
  isThemeId,
  loadThemeDefault,
  resolveTheme,
  saveThemeDefault,
} from "./lib/theme";
import type { ThemeId } from "./lib/theme";
import { isEditorFontFamily, isEditorFontSize, loadEditorFont, saveEditorFont } from "./lib/editorFont";
import type { EditorFontSettings } from "./lib/editorFont";
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
import {
  loadFindMemory,
  loadFindPanelPosition,
  saveFindMemory,
  saveFindPanelPosition,
} from "./lib/findMemory";
import type { FindMemory, FindPanelPosition } from "./lib/findMemory";
import {
  currentSourceFindView,
  replaceAllSourceMatches,
  replaceSourceActiveMatch,
  selectSourceMatch,
  setSourceFindHighlight,
  sourceMatches,
  toSearchQuery,
} from "./lib/sourceFind";
import type { SourceMatch } from "./lib/sourceFind";
import { getSearchQuery, setSearchQuery, type SearchQuery } from "@codemirror/search";
import { styleMenuCommand } from "./lib/styles";
import { activeStyles } from "./lib/styles";
import {
  MODIFY_STYLE_MENU_ID,
  loadStyleOverrides,
  overridesToCss,
  saveStyleOverrides,
  styleKeyForStyleId,
} from "./lib/styleOverrides";
import type { OverrideKey, StyleOverride, StyleOverrides } from "./lib/styleOverrides";
import ModifyStyleDialog from "./components/ModifyStyleDialog";
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
import LinkDialog from "./components/LinkDialog";
import ImageDialog from "./components/ImageDialog";
import ImageEditDialog from "./components/ImageEditDialog";
import InsertTableDialog from "./components/InsertTableDialog";
import type { TableInsertSpec } from "./lib/tables";
import { loadViewMode, saveViewMode } from "./components/viewModes";
import type { ViewMode } from "./components/viewModes";
import "./themes/index.css";
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
// options survive closing the panel (Word behavior) and are remembered per
// doc (plan 07 task 7.5, issue #73): on a tab switch the active doc's last
// search is restored from findMemory, and every edit to the term/options
// persists back to that doc's memory.
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
  // Plan 08 task 8.2 (issue #77): the flat "Image" item became the submenu
  // Insert > Image > From file / From URL; "insert-image" is kept as an
  // alias so an older menu build still reaches the From URL default.
  "insert-image": "image",
  "insert-image-from-file": "imageFromFile",
  "insert-image-from-url": "image",
  // Plan 06 task 6.3 (issue #63): Insert > Table opens the "Insert table…"
  // dialog (precise sizes, header choice) — the native menu cannot host the
  // hover size-picker popover, which the toolbar's Table button carries.
  "insert-table": "tableDialog",
  "insert-codeblock": "codeBlock",
  // Plan 11 task 11.1 (issue #100): Insert > Diagram (Mermaid) dispatches the
  // shared "diagram" command — the same path as /diagram and the toolbar
  // button — inserting a ```mermaid block with the starter template.
  "insert-diagram": "diagram",
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
  // Style inspector (plan 05 task 5.5, issue #58): the built-in style that
  // owns the block under the cursor, published by the WYSIWYG editor (null
  // outside WYSIWYG or for a block with no built-in style — the indicator is
  // hidden then). Drives the status-bar block-type readout.
  const [blockStyleLabel, setBlockStyleLabel] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoData, setInfoData] = useState<DocInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [findPanel, setFindPanel] = useState<FindPanelState>(FIND_PANEL_INITIAL);
  // Link dialog (plan 08 task 8.1, issue #76): the registry link command
  // (toolbar button, Insert > Link, Ctrl+K, /link) requests the dialog; the
  // editor the request came from is kept so the dialog prefills from the
  // caret and applies its result to the same instance. The preview link menu
  // (plan 03 task 3.5, issue #43) reuses the same dialog with a markdown
  // target instead: its Edit item has no TipTap instance to edit, so the
  // result splices the active doc's markdown source (`md`) — exactly one of
  // `editor` / `md` is set.
  const [linkDialog, setLinkDialog] = useState<{
    editor: CoreEditor | null;
    prefill: LinkPrefill;
    md: MarkdownLinkRef | null;
  } | null>(null);
  // Image dialog (plan 08 task 8.2, issue #77): the registry "image" command
  // (toolbar main button, Insert > Image > From URL, /image) requests the
  // dialog; the editor the request came from is kept so the result applies
  // to the same instance.
  const [imageDialog, setImageDialog] = useState<{
    editor: CoreEditor;
  } | null>(null);
  // Image edit dialog (plan 08 task 8.4, issue #79): the registry "imageEdit"
  // command (or clicking an image in the editor) requests the dialog; the
  // editor the request came from is kept so the dialog prefills from the
  // image under the caret and applies its result to the same instance.
  const [imageEditDialog, setImageEditDialog] = useState<{
    editor: CoreEditor;
    prefill: ImageEditPrefill;
    // Which field the dialog opens focused (plan 03 task 3.4, issue #42):
    // "url" for the edit item (plan 08 §3 default), "alt" for the image
    // menu's "Change alt text" item.
    focus: "url" | "alt";
  } | null>(null);
  // Insert-table dialog (plan 06 task 6.3, issue #63): the registry
  // "tableDialog" command (toolbar Table dropdown, Insert > Table) requests
  // the dialog; the editor the request came from is kept so the pick inserts
  // into the same instance (same shape as the link dialog).
  const [tableDialog, setTableDialog] = useState<{
    editor: CoreEditor;
  } | null>(null);
  // Broken-image detection (plan 08 task 8.5, issue #80, AC6): the srcs of
  // the active doc whose local file no longer exists on disk (drives the
  // WYSIWYG placeholder node view), plus a version counter bumped whenever
  // an image src can have changed (dialog apply, re-link) to re-run the
  // check without waiting for the next doc load.
  const [missingImages, setMissingImages] = useState<ReadonlySet<string>>(new Set());
  const [missingRefresh, setMissingRefresh] = useState(0);
  // Find panel position setting (plan 07 task 7.5, issue #73): a global
  // top/bottom preference persisted in localStorage; the panel docks via its
  // root class and the toggle lives on the panel itself.
  const [findPanelPos, setFindPanelPos] = useState<FindPanelPosition>(() =>
    loadFindPanelPosition(),
  );
  // Per-app editor-chrome font (plan 04 task 4.5, issue #51): the font the
  // WYSIWYG content renders in, persisted app-wide (editorFont.ts) and
  // applied through the editorFont registry command + the Editor's mount
  // re-application. Cosmetic — never part of any document.
  const [editorFont, setEditorFont] = useState<EditorFontSettings>(() => loadEditorFont());
  // Per-app default document theme (plan 05 task 5.3, issue #56). A per-doc
  // override lives in DocSettings.theme; the active theme is the override when
  // present, otherwise this app-wide default. Cosmetic only — the document
  // bytes are never touched.
  const [appTheme, setAppTheme] = useState<ThemeId>(() => loadThemeDefault());
  // User style overrides (plan 05 task 5.4, issue #57): the Modify Style
  // look of built-in styles, stored in the app config dir (Rust commands)
  // and rendered as CSS on the content container only — the document bytes
  // never change. Loaded once on mount; the Modify Style dialog edits them.
  const [styleOverrides, setStyleOverrides] = useState<StyleOverrides>({});
  const [modifyStyleKey, setModifyStyleKey] = useState<OverrideKey | null>(null);
  const [findState, setFindState] = useState<SearchState | null>(null);
  const findStateRef = useRef<SearchState | null>(null);
  const findQueryRef = useRef("");
  // Source-view search (plan 07 task 7.4, issue #72): mirrors findState for the
  // CodeMirror doc — the matches in doc offsets, the active index, and the
  // SearchQuery they came from (so navigation can re-publish the highlight
  // without re-reading the panel). The panel result and the navigation/replace
  // handlers read the ref (which is always current); the state drives re-renders.
  const [sourceFind, setSourceFind] = useState<{
    matches: SourceMatch[];
    active: number;
    query: SearchQuery;
  } | null>(null);
  const sourceFindRef = useRef<{
    matches: SourceMatch[];
    active: number;
    query: SearchQuery;
  } | null>(null);
  const sourceQueryRef = useRef("");
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
  // The theme the content container renders in (plan 05 task 5.3, issue #56):
  // the active doc's per-doc override when present, otherwise the app-wide
  // default. View-only — it drives the data-theme attribute and the scoped
  // CSS variable sheets, never the document bytes.
  const activeTheme = activeDoc ? resolveTheme(appTheme, activeDoc.settings.theme) : appTheme;

  // The CSS the stored style overrides render as (plan 05 task 5.4,
  // issue #57): scoped to the WYSIWYG and preview content containers, so
  // the modified styles restyle the rendered document without ever reaching
  // the save pipeline (plan 05 AC6).
  const overridesCss = useMemo(
    () =>
      overridesToCss(styleOverrides, [
        ".quillmd-prosemirror",
        ".quillmd-preview-content",
      ]),
    [styleOverrides],
  );

  // Which engine the open find panel acts on (plan 07 task 7.4, issue #72):
  // the WYSIWYG doc in wysiwyg mode, the CodeMirror source doc whenever the
  // source pane is visible (source or split mode), and nothing in preview
  // (no editable pane — the panel closes). The same term/options object drives
  // both engines, so results stay in sync across view switches.
  const findEngine: "wysiwyg" | "source" | "none" =
    viewMode === "wysiwyg"
      ? "wysiwyg"
      : viewMode === "source" || viewMode === "split"
        ? "source"
        : "none";

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

  // Editor-chrome font (plan 04 task 4.5, issue #51): per-app, so the patch
  // lands in the app-wide record (not per path) and the registry command
  // applies it to the open WYSIWYG DOM (a no-op outside WYSIWYG, where the
  // next mount re-applies the persisted setting).
  const changeEditorFont = useCallback(
    (patch: Partial<EditorFontSettings>) => {
      const next: EditorFontSettings = { ...editorFont, ...patch };
      setEditorFont(next);
      saveEditorFont(next);
      dispatchEditorCommand("editorFont", next);
    },
    [editorFont],
  );

  // Theme picks (plan 05 task 5.3, issue #56). The View > Theme submenu sets
  // the active document's per-doc override (or clears it back to the app
  // default); View > Default theme sets the app-wide default. Both are
  // view-only: the data-theme attribute on the content container changes the
  // rendered look without dispatching an editor command, so currentText stays
  // byte-identical.
  const changeDocTheme = useCallback(
    (theme: ThemeId | null) => {
      patchDocSettings({ theme });
    },
    [patchDocSettings],
  );

  const changeAppTheme = useCallback((theme: ThemeId) => {
    setAppTheme(theme);
    saveThemeDefault(theme);
  }, []);

  // Modify Style (plan 05 task 5.4, issue #57): Format > Styles > "Modify…"
  // opens the in-app dialog. Word preselects the style under the cursor, so
  // the first built-in style active at the selection wins, else Normal. The
  // override is app-wide (all documents), not per-doc.
  const openModifyStyle = useCallback(() => {
    const editor = currentFindEditor();
    let key: OverrideKey = "paragraph";
    if (editor) {
      for (const style of activeStyles(editor)) {
        const k = styleKeyForStyleId(style.id);
        if (k) {
          key = k;
          break;
        }
      }
    }
    setModifyStyleKey(key);
  }, []);

  // Style inspector (plan 05 task 5.5, issue #58): the status bar's
  // "jump to style" action opens the toolbar's style gallery, which
  // highlights the style active at the cursor (the same one the indicator
  // shows). No-op outside WYSIWYG, where no gallery is mounted.
  const jumpToStyle = useCallback(() => {
    const editor = currentFindEditor();
    if (editor) requestStylesGallery(editor);
  }, []);

  // OK in the dialog: persist the edited style's override (an empty override
  // deletes the style's record — the reset flow) and close.
  const applyModifyStyle = useCallback(
    (key: OverrideKey, override: StyleOverride) => {
      const next: StyleOverrides = { ...styleOverrides };
      if (Object.keys(override).length === 0) delete next[key];
      else next[key] = override;
      setStyleOverrides(next);
      void saveStyleOverrides(next).catch(() => setStatus("Could not save style overrides"));
      setModifyStyleKey(null);
    },
    [styleOverrides],
  );

  // "Reset all": clears every style's override (the global reset flow).
  const resetAllStyleOverrides = useCallback(() => {
    if (!window.confirm("Reset every style to its theme default? This clears all style overrides.")) {
      return;
    }
    setStyleOverrides({});
    void saveStyleOverrides({}).catch(() => setStatus("Could not save style overrides"));
    setModifyStyleKey(null);
    setStatus("Style overrides reset");
  }, []);

  const doExport = useCallback(
    async (format: ExportFormat) => {
      const doc = activeDoc;
      if (!doc) return;
      if (runningInTauri()) {
        // The current text (unsaved edits included) is what gets exported:
        // mermaid fences are rendered to PNG and swapped for image refs in a
        // temp copy before pandoc runs (plan 11 task 11.5, issue #104).
        await exportDocumentAs(
          { docPath: doc.open.path, markdown: doc.currentText, theme: activeTheme },
          format,
          {
            openByPath,
            status: setStatus,
          },
        );
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
    [activeDoc, activeTheme, openByPath],
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
  // effect below against the engine for the active view (findEngine): the
  // live WYSIWYG doc in wysiwyg mode, the CodeMirror source doc in source /
  // split mode (task 7.4). The same term/options object drives both engines,
  // so the results stay in sync across view switches.

  const findNext = useCallback(() => {
    if (findEngine === "source") {
      const cur = sourceFindRef.current;
      const view = currentSourceFindView();
      if (!cur || cur.matches.length === 0 || !view) return;
      const active = cur.active < 0 ? 0 : (cur.active + 1) % cur.matches.length;
      const moved = { ...cur, active };
      sourceFindRef.current = moved;
      setSourceFind(moved);
      view.dispatch({
        effects: [setSourceFindHighlight.of({ query: cur.query, active })],
      });
      selectSourceMatch(view, cur.matches[active]);
      return;
    }
    const cur = findStateRef.current;
    if (!cur || cur.matches.length === 0) return;
    const moved = nextMatch(cur);
    if (moved === cur) return;
    findStateRef.current = moved;
    setFindState(moved);
    publishFindState(moved);
  }, [findEngine]);

  const findPrev = useCallback(() => {
    if (findEngine === "source") {
      const cur = sourceFindRef.current;
      const view = currentSourceFindView();
      if (!cur || cur.matches.length === 0 || !view) return;
      const n = cur.matches.length;
      const active = cur.active < 0 ? n - 1 : (cur.active - 1 + n) % n;
      const moved = { ...cur, active };
      sourceFindRef.current = moved;
      setSourceFind(moved);
      view.dispatch({
        effects: [setSourceFindHighlight.of({ query: cur.query, active })],
      });
      selectSourceMatch(view, cur.matches[active]);
      return;
    }
    const cur = findStateRef.current;
    if (!cur || cur.matches.length === 0) return;
    const moved = prevMatch(cur);
    if (moved === cur) return;
    findStateRef.current = moved;
    setFindState(moved);
    publishFindState(moved);
  }, [findEngine]);

  // The panel opens in any editable view (WYSIWYG, source, or split); only
  // preview has no editable pane, so opening it there explains that in the
  // status bar (Word closes its find bar where there is nothing to search).
  const openFindPanel = useCallback(
    (mode: FindPanelMode) => {
      if (!activePath || viewMode === "preview") {
        setStatus("Find & replace needs an editable view");
        return;
      }
      setFindPanel((p) => ({ ...p, open: true, mode }));
    },
    [activePath, viewMode],
  );

  const closeFindPanel = useCallback(() => {
    setFindPanel((p) => ({ ...p, open: false }));
  }, []);

  // Flips the persisted panel position (plan 07 task 7.5, issue #73). The
  // setting is global (not per-doc) and survives reloads via localStorage.
  const toggleFindPanelPos = useCallback(() => {
    const next: FindPanelPosition = findPanelPos === "top" ? "bottom" : "top";
    saveFindPanelPosition(next);
    setFindPanelPos(next);
  }, [findPanelPos]);

  // --- link dialog (plan 08 task 8.1, issue #76) ---------------------------
  //
  // The registry link command requests the dialog; this listener is the
  // single renderer. The prefill (link under the caret, or the plain
  // selection) is read at request time so a tab switch while the dialog is
  // open can never prefill from the wrong document.

  useEffect(() => {
    return registerLinkDialogListener((editor) => {
      setLinkDialog({ editor, prefill: readLinkPrefill(editor), md: null });
    });
  }, []);

  // The dialog edits a specific TipTap instance, which unmounts on a tab
  // switch or a view-mode change — close it so it never talks to a dead
  // editor.
  useEffect(() => {
    setLinkDialog(null);
  }, [activePath, viewMode]);

  const closeLinkDialog = useCallback(() => {
    setLinkDialog(null);
  }, []);

  const applyLinkDialog = useCallback(
    (payload: LinkPayload) => {
      if (!linkDialog) return;
      if (linkDialog.editor) {
        applyLink(linkDialog.editor, payload);
      } else if (linkDialog.md && activeDoc) {
        // Markdown target (plan 03 task 3.5, issue #43): the preview link
        // menu's Edit item — the result splices the matched link's span in
        // the active doc's source, every other byte untouched.
        const next = relinkMarkdownLink(activeDoc.currentText, linkDialog.md, payload);
        if (next !== activeDoc.currentText) setActiveText(next);
      }
      setLinkDialog(null);
    },
    [linkDialog, activeDoc, setActiveText],
  );

  const removeLinkDialog = useCallback(() => {
    if (!linkDialog) return;
    if (linkDialog.editor) {
      removeLink(linkDialog.editor);
    } else if (linkDialog.md && activeDoc) {
      const next = unlinkMarkdownLink(activeDoc.currentText, linkDialog.md);
      if (next !== activeDoc.currentText) setActiveText(next);
    }
    setLinkDialog(null);
  }, [linkDialog, activeDoc, setActiveText]);

  // The preview link menu (plan 03 task 3.5, issue #43): the preview is
  // read-only rendered HTML with no editor to run the link mark on, so its
  // Edit / Remove items resolve the anchor under the caret (destination +
  // display text) to the matching markdown link and act on the source.
  // Edit reopens the link dialog with the markdown span as its target.
  const editPreviewLink = useCallback(
    (href: string, text: string) => {
      if (!activeDoc) return;
      const ref = findMarkdownLink(activeDoc.currentText, { href, text });
      if (!ref) {
        setStatus("Could not find this link in the document");
        return;
      }
      setLinkDialog({
        editor: null,
        prefill: { href: ref.href, title: ref.title, text: ref.text, isEditing: true },
        md: ref,
      });
    },
    [activeDoc, setStatus],
  );

  const removePreviewLink = useCallback(
    (href: string, text: string) => {
      if (!activeDoc) return;
      const ref = findMarkdownLink(activeDoc.currentText, { href, text });
      if (!ref) {
        setStatus("Could not find this link in the document");
        return;
      }
      const next = unlinkMarkdownLink(activeDoc.currentText, ref);
      if (next === activeDoc.currentText) {
        setStatus("Could not remove this link from the document");
        return;
      }
      setActiveText(next);
    },
    [activeDoc, setStatus, setActiveText],
  );

  // "Open": launch the destination in the system browser, then close (Word
  // parity — following the link dismisses the edit dialog).
  const openLinkDialogUrl = useCallback(async (href: string) => {
    await openLinkUrl(href);
    setLinkDialog(null);
  }, []);

  // --- image insert (plan 08 task 8.2, issue #77; asset copy is task 8.3,
  //     issue #78) -------------------------------------------------------------
  //
  // Two registry commands request the insert: "image" (the From URL default)
  // opens the dialog, "imageFromFile" runs the native image picker. Both
  // apply to the editor the request came from. The From file flow runs the
  // picked file through the asset pipeline (assets.ts): a pick inside the
  // active doc's folder is referenced relatively (no copy), a pick outside
  // is copied next to the doc — into `assets/` or the doc folder itself
  // per the asset-folder setting — and the copy's relative path is
  // inserted.

  // The from-file insert flow (plan 08 task 8.3, issue #78) shared by the
  // Insert > Image > From file picker and the DnD drop handler (plan 08 task
  // 8.6, issue #81): the file runs through the asset pipeline (assets.ts) —
  // referenced relatively when it already sits inside the active doc's
  // folder, otherwise copied next to the doc per the asset-folder setting —
  // and the resulting src is inserted at the editor's caret. Resolves to
  // false when the insert did not happen (the caller reports it).
  const insertImageFromPath = useCallback(
    async (editor: CoreEditor, filePath: string): Promise<boolean> => {
      const docPath = activeDoc?.open.path ?? "";
      try {
        const src = await assetSrcForPickedFile(docPath, filePath, loadAssetFolder());
        if (insertImage(editor, { src, alt: "" })) {
          setStatus(`Inserted image ${src}`);
          return true;
        }
        return false;
      } catch (e) {
        setStatus(`Could not insert image: ${String(e)}`);
        return false;
      }
    },
    [activeDoc, setStatus],
  );

  const insertImageFromFile = useCallback(async (editor: CoreEditor) => {
    const picked = await pickOpenFile({ title: "Insert image", filters: [IMAGE_FILTER] });
    if (!picked || picked.length === 0) return;
    await insertImageFromPath(editor, picked[0]);
  }, [insertImageFromPath]);

  // The listeners are registered once; the refs keep them pointed at the
  // latest flows (which track the active doc).
  const insertImageFromFileRef = useRef(insertImageFromFile);
  insertImageFromFileRef.current = insertImageFromFile;
  const insertImageFromPathRef = useRef(insertImageFromPath);
  insertImageFromPathRef.current = insertImageFromPath;

  useEffect(() => {
    return registerImageInsertListener((editor, source) => {
      if (source === "url") setImageDialog({ editor });
      else void insertImageFromFileRef.current(editor);
    });
  }, []);

  // The dialog edits a specific TipTap instance, which unmounts on a tab
  // switch or a view-mode change — close it so it never talks to a dead
  // editor (same rule as the link dialog).
  useEffect(() => {
    setImageDialog(null);
  }, [activePath, viewMode]);

  const closeImageDialog = useCallback(() => {
    setImageDialog(null);
  }, []);

  const applyImageDialog = useCallback(
    (payload: ImagePayload) => {
      if (!imageDialog) return;
      insertImage(imageDialog.editor, payload);
      setImageDialog(null);
      // A new (possibly local) src joined the doc: re-run the check.
      setMissingRefresh((n) => n + 1);
    },
    [imageDialog],
  );

  // --- image edit (plan 08 task 8.4, issue #79) -------------------------------
  //
  // The registry "imageEdit" command and the editor's image click handler
  // request the dialog; this listener is the single renderer. The prefill
  // (the image under the caret, or empty values when there is none) is read
  // at request time so a tab switch while the dialog is open can never
  // prefill from the wrong document (same rule as the link dialog).
  //
  // Plan 03 task 3.4 (issue #42) adds the image menu's "Change alt text"
  // item: the same dialog, requested through its own listener with the alt
  // field focused.

  useEffect(() => {
    const unregisterEdit = registerImageEditDialogListener((editor) => {
      setImageEditDialog({
        editor,
        prefill: readImagePrefill(editor),
        focus: "url",
      });
    });
    const unregisterAlt = registerImageAltDialogListener((editor) => {
      setImageEditDialog({
        editor,
        prefill: readImagePrefill(editor),
        focus: "alt",
      });
    });
    return () => {
      unregisterEdit();
      unregisterAlt();
    };
  }, []);

  // The dialog edits a specific TipTap instance, which unmounts on a tab
  // switch or a view-mode change — close it so it never talks to a dead
  // editor (same rule as the link dialog).
  useEffect(() => {
    setImageEditDialog(null);
  }, [activePath, viewMode]);

  const closeImageEditDialog = useCallback(() => {
    setImageEditDialog(null);
  }, []);

  const applyImageEditDialog = useCallback(
    (payload: ImageEditPayload) => {
      if (!imageEditDialog) return;
      applyImageEdit(imageEditDialog.editor, payload);
      setImageEditDialog(null);
      // The image's src can have changed: re-run the check.
      setMissingRefresh((n) => n + 1);
    },
    [imageEditDialog],
  );

  // --- image replace (plan 03 task 3.4, issue #42) ----------------------------
  //
  // The image menu's "Replace image" item requests the replace flow: run the
  // P0 native image picker (the same pickOpenFile + IMAGE_FILTER the from-file
  // insert uses) and swap the selected image's src for the picked file's, run
  // through the asset pipeline (assets.ts) — referenced relatively when the
  // pick already sits inside the active doc's folder, otherwise copied next to
  // the doc. The image node keeps its alt/width/title; only the src changes.
  // The selected node is re-selected so the image stays selected afterwards.

  const replaceImage = useCallback(
    async (editor: CoreEditor) => {
      const picked = await pickOpenFile({ title: "Replace image", filters: [IMAGE_FILTER] });
      if (!picked || picked.length === 0) return;
      const target = imageAtCaret(editor);
      if (!target) return;
      const docPath = activeDoc?.open.path ?? "";
      try {
        const src = await assetSrcForPickedFile(docPath, picked[0], loadAssetFolder());
        const { state } = editor;
        const tr = state.tr;
        tr.setNodeMarkup(target.pos, null, { ...target.node.attrs, src });
        tr.setSelection(NodeSelection.create(tr.doc, target.pos));
        editor.view.dispatch(tr);
        setStatus(`Replaced image ${src}`);
        // The image's src changed: re-run the check.
        setMissingRefresh((n) => n + 1);
      } catch (e) {
        setStatus(`Could not replace image: ${String(e)}`);
      }
    },
    [activeDoc, setStatus],
  );

  const replaceImageRef = useRef(replaceImage);
  replaceImageRef.current = replaceImage;

  useEffect(() => {
    return registerImageReplaceListener((editor) => {
      void replaceImageRef.current(editor);
    });
  }, []);

  // --- insert-table dialog (plan 06 task 6.3, issue #63) ---------------------
  //
  // The registry "tableDialog" command requests the dialog; this listener is
  // the single renderer. The dialog's pick dispatches the tableInsert
  // registry command on the requesting editor, so every surface (toolbar
  // dropdown, native menu) inserts the identical table.

  useEffect(() => {
    return registerTableDialogListener((editor) => {
      setTableDialog({ editor });
    });
  }, []);

  // The dialog edits a specific TipTap instance, which unmounts on a tab
  // switch or a view-mode change — close it so it never talks to a dead
  // editor (same rule as the link dialog).
  useEffect(() => {
    setTableDialog(null);
  }, [activePath, viewMode]);

  const closeTableDialog = useCallback(() => {
    setTableDialog(null);
  }, []);

  const applyTableDialog = useCallback(
    (spec: TableInsertSpec) => {
      if (!tableDialog) return;
      runEditorCommand(tableDialog.editor, "tableInsert", spec);
      setTableDialog(null);
    },
    [tableDialog],
  );

  // --- broken-image re-link (plan 08 task 8.5, issue #80, AC6) ----------------
  //
  // The placeholder's "Re-link…" button (Editor.tsx node view) calls this with
  // the clicked image's src and doc position. The picker opens in the missing
  // file's last folder (plan 08 §3), the pick runs through the same asset
  // copy pipeline as Insert > Image > From file, and the clicked image node
  // is pointed at the resulting src.

  const reLinkImage = useCallback(
    async (src: string, pos: number) => {
      const editor = currentFindEditor();
      const docPath = activePath ?? "";
      if (!editor) return;
      const picked = await pickOpenFile({
        title: "Re-link image",
        filters: [IMAGE_FILTER],
        defaultPath: relinkFolderFor(docPath, src),
      });
      if (!picked || picked.length === 0) return;
      try {
        const newSrc = await assetSrcForPickedFile(docPath, picked[0], loadAssetFolder());
        const node = editor.state.doc.nodeAt(pos);
        if (node?.type.name === "image" && node.attrs.src === src) {
          const tr = editor.state.tr;
          tr.setNodeMarkup(pos, null, { ...node.attrs, src: newSrc });
          editor.view.dispatch(tr);
          setStatus(`Re-linked image to ${newSrc}`);
        } else {
          setStatus("Image changed while the picker was open; re-link cancelled");
        }
        setMissingRefresh((n) => n + 1);
      } catch (e) {
        setStatus(`Could not re-link image: ${String(e)}`);
      }
    },
    [activePath, setStatus],
  );

  // The node view reads the handler through a module holder and re-renders
  // when its identity changes, so keep this callback stable across re-renders.
  const reLinkImageRef = useRef(reLinkImage);
  reLinkImageRef.current = reLinkImage;
  const stableReLinkImage = useCallback(
    (src: string, pos: number) => void reLinkImageRef.current(src, pos),
    [],
  );

  // The detection effect (plan 08 §3): on doc load and view switch, collect
  // the WYSIWYG doc's image srcs, resolve the local ones against the doc
  // folder, and batch-check them through the Rust file_exists command. Only
  // runs under Tauri with an absolute doc path (a browser-dev doc has no
  // disk to check) and with a WYSIWYG editor mounted (source/preview have no
  // placeholder to show).
  useEffect(() => {
    if (!runningInTauri() || !activePath || !isAbsolutePath(activePath)) {
      setMissingImages(new Set());
      return;
    }
    const editor = currentFindEditor();
    if (!editor) {
      setMissingImages(new Set());
      return;
    }
    let stale = false;
    void (async () => {
      const missing = await findMissingImageSrcs(editor.state.doc, activePath);
      if (!stale) setMissingImages(missing);
    })();
    return () => {
      stale = true;
    };
  }, [activePath, viewMode, missingRefresh]);

  // Per-doc term memory (plan 07 task 7.5, issue #73): writes the panel's
  // term + options to the active doc's memory. Only the active doc is
  // written; there is no doc (welcome screen) => no-op.
  const persistFindMemory = useCallback(
    (patch: Partial<FindMemory>) => {
      if (!activePath) return;
      const memory: FindMemory = {
        term: findPanel.term,
        matchCase: findPanel.matchCase,
        wholeWord: findPanel.wholeWord,
        useRegex: findPanel.useRegex,
        ...patch,
      };
      saveFindMemory(activePath, memory);
    },
    [
      activePath,
      findPanel.term,
      findPanel.matchCase,
      findPanel.wholeWord,
      findPanel.useRegex,
    ],
  );

  const setFindTerm = useCallback(
    (term: string) => {
      setFindPanel((p) => ({ ...p, term }));
      persistFindMemory({ term });
    },
    [persistFindMemory],
  );

  const setFindReplaceTerm = useCallback((term: string) => {
    setFindPanel((p) => ({ ...p, replaceTerm: term }));
  }, []);

  const toggleFindOption = useCallback(
    (option: FindPanelOption) => {
      const next = { ...findPanel, [option]: !findPanel[option] };
      setFindPanel(next);
      persistFindMemory({
        term: next.term,
        matchCase: next.matchCase,
        wholeWord: next.wholeWord,
        useRegex: next.useRegex,
      });
    },
    [findPanel, persistFindMemory],
  );

  const setFindMode = useCallback((mode: FindPanelMode) => {
    setFindPanel((p) => ({ ...p, mode }));
  }, []);

  const doReplace = useCallback(() => {
    const options = {
      term: findPanel.term,
      matchCase: findPanel.matchCase,
      wholeWord: findPanel.wholeWord,
      useRegex: findPanel.useRegex,
    };
    if (findEngine === "source") {
      const cur = sourceFindRef.current;
      const view = currentSourceFindView();
      if (!cur || !view) return;
      replaceSourceActiveMatch(view, cur.matches, cur.active, options, findPanel.replaceTerm);
      return;
    }
    const state = findStateRef.current;
    const editor = currentFindEditor();
    if (!state || !editor) return;
    replaceActiveMatch(editor, state, findPanel.replaceTerm);
  }, [
    findEngine,
    findPanel.term,
    findPanel.matchCase,
    findPanel.wholeWord,
    findPanel.useRegex,
    findPanel.replaceTerm,
  ]);

  const doReplaceAll = useCallback(() => {
    const options = {
      term: findPanel.term,
      matchCase: findPanel.matchCase,
      wholeWord: findPanel.wholeWord,
      useRegex: findPanel.useRegex,
    };
    if (findEngine === "source") {
      const cur = sourceFindRef.current;
      const view = currentSourceFindView();
      if (!cur || !view) return;
      replaceAllSourceMatches(view, cur.matches, options, findPanel.replaceTerm);
      return;
    }
    const state = findStateRef.current;
    const editor = currentFindEditor();
    if (!state || !editor) return;
    replaceAllMatches(editor, state, findPanel.replaceTerm);
  }, [
    findEngine,
    findPanel.term,
    findPanel.matchCase,
    findPanel.wholeWord,
    findPanel.useRegex,
    findPanel.replaceTerm,
  ]);

  // Per-doc term memory restore (plan 07 task 7.5, issue #73): when the active
  // tab changes, load that doc's remembered term + options into the panel. The
  // outgoing doc's term was already persisted by the change handlers above, so
  // restoring the incoming doc's memory here loses nothing. Runs only on a tab
  // switch (dep: activePath), so it never fights the live search effect.
  useEffect(() => {
    if (!activePath) return;
    const memory = loadFindMemory(activePath);
    setFindPanel((p) => ({ ...p, ...memory }));
  }, [activePath]);

  // Runs the search engine for the open panel against the engine of the active
  // view (findEngine): the WYSIWYG doc (task 7.1) or the CodeMirror source doc
  // (task 7.4). Recomputes on term/options changes, doc edits, tab switches,
  // and view-mode changes. A doc edit with an unchanged query keeps the
  // navigation position (clamped to the new match count); a new query restarts
  // at the first match. A switch to preview closes the panel (no editable
  // pane); switching between WYSIWYG and source/split keeps the panel and its
  // options and re-runs the search in the other engine.
  useEffect(() => {
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

    // Panel closed, no doc, or preview (no editable pane): clear both engines.
    if (!findPanel.open || !activeDoc || findEngine === "none") {
      findQueryRef.current = "";
      findStateRef.current = null;
      setFindState(null);
      publishFindState(null);
      sourceQueryRef.current = "";
      sourceFindRef.current = null;
      setSourceFind(null);
      // The source match decorations persist on the view's state, so turn
      // them off explicitly (the WYSIWYG ones clear via publishFindState).
      const srcView = currentSourceFindView();
      if (srcView) srcView.dispatch({ effects: [setSourceFindHighlight.of(null)] });
      if (findPanel.open && activeDoc && findEngine === "none") {
        // Preview: nothing to search — close the panel (Word behavior).
        setFindPanel((p) => ({ ...p, open: false }));
      }
      return;
    }

    if (findEngine === "source") {
      // WYSIWYG engine idle while the source doc is searched.
      findQueryRef.current = "";
      findStateRef.current = null;
      setFindState(null);
      publishFindState(null);
      const view = currentSourceFindView();
      if (!view) {
        // Source pane not mounted yet (just switched) — nothing to search.
        sourceQueryRef.current = "";
        sourceFindRef.current = null;
        setSourceFind(null);
        return;
      }
      // Map the panel options 1:1 onto CodeMirror's search state (task 7.4
      // AC3), then turn the match decorations on with the same query.
      const query = toSearchQuery(options);
      if (!getSearchQuery(view.state).eq(query)) {
        view.dispatch({ effects: [setSearchQuery.of(query)] });
      }
      const matches = sourceMatches(view, options);
      const prev = sourceFindRef.current;
      const sameQuery = sourceQueryRef.current === signature;
      const active =
        sameQuery && prev && matches.length > 0
          ? Math.max(0, Math.min(prev.active, matches.length - 1))
          : matches.length > 0
            ? 0
            : -1;
      sourceQueryRef.current = signature;
      const next = { matches, active, query };
      sourceFindRef.current = next;
      setSourceFind(next);
      view.dispatch({
        effects: [setSourceFindHighlight.of(active >= 0 ? { query, active } : null)],
      });
      // Only a new query moves the selection (and scrolls) to the active
      // match; a doc edit with the same query leaves the caret alone.
      if (!sameQuery && active >= 0) selectSourceMatch(view, matches[active]);
      return;
    }

    // findEngine === "wysiwyg": the source engine is idle.
    sourceQueryRef.current = "";
    sourceFindRef.current = null;
    setSourceFind(null);
    const idleSrcView = currentSourceFindView();
    if (idleSrcView) idleSrcView.dispatch({ effects: [setSourceFindHighlight.of(null)] });
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
  }, [
    findPanel.open,
    findPanel.term,
    findPanel.matchCase,
    findPanel.wholeWord,
    findPanel.useRegex,
    activeDoc,
    findEngine,
  ]);

  // The result summary the panel renders: the active engine's match count and
  // active index, the shared engine's error for an invalid regex term
  // (compileSearch reports it in either engine; the matchers suppress the
  // search), and the cross-block flag of the active match (WYSIWYG only — it
  // disables the Replace button; source matches never span blocks, so it is
  // always false there).
  const findPanelResult: FindPanelResult = useMemo(() => {
    const error = findPanel.open && findPanel.useRegex ? compileSearch(findPanel).error : null;
    if (findEngine === "source") {
      return {
        count: sourceFind?.matches.length ?? 0,
        active: sourceFind?.active ?? -1,
        error,
        activeCrossBlock: false,
      };
    }
    const active =
      findState && findState.active >= 0 && findState.active < findState.matches.length
        ? findState.matches[findState.active]
        : undefined;
    return {
      count: findState?.matches.length ?? 0,
      active: findState?.active ?? -1,
      error,
      activeCrossBlock: active?.crossBlock ?? false,
    };
  }, [findPanel, findEngine, findState, sourceFind]);

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
      } else if (id.startsWith("view-editor-font-size-")) {
        // View > Editor font (plan 04 task 4.5, issue #51): the size picks
        // parse to a px value; unknown sizes are dropped.
        const size = parseInt(id.slice("view-editor-font-size-".length), 10);
        if (isEditorFontSize(size)) changeEditorFont({ size });
      } else if (id.startsWith("view-editor-font-")) {
        const family = id.slice("view-editor-font-".length);
        if (isEditorFontFamily(family)) changeEditorFont({ family });
      } else if (id.startsWith(THEME_DEFAULT_MENU_ID_PREFIX)) {
        // View > Default theme (plan 05 task 5.3, issue #56): the app-wide
        // default pick. Documents with their own override are unaffected.
        const theme = id.slice(THEME_DEFAULT_MENU_ID_PREFIX.length);
        if (isThemeId(theme)) changeAppTheme(theme);
      } else if (id === THEME_RESET_MENU_ID) {
        // View > Theme > Use App Default: clears the active doc's per-doc
        // override so it follows the app-wide default again.
        changeDocTheme(null);
      } else if (id.startsWith(THEME_MENU_ID_PREFIX)) {
        // View > Theme: the active doc's per-doc override. View-only — the
        // data-theme attribute on the content container changes the look
        // without dispatching an editor command, so currentText is untouched.
        const theme = id.slice(THEME_MENU_ID_PREFIX.length);
        if (isThemeId(theme)) changeDocTheme(theme);
      } else if (id === "format-font-family-custom") {
        // Free-text family (plan 04 §2.1): the native menu has no input
        // field, so the pick prompts and then dispatches the same fontFamily
        // command the toolbar's Custom… option uses.
        const name = window.prompt("Custom font family") ?? "";
        if (name.trim() !== "") dispatchEditorCommand("fontFamily", name);
      } else if (id.startsWith("format-font-") || id.startsWith("format-highlight-color-")) {
        // Format > Font submenu (plan 04 task 4.4, issue #50): every family,
        // size, and color swatch is its own menu id; fontMenuCommand resolves
        // it back to the (registry command, param) pair so the menu dispatches
        // the identical commands the toolbar font cluster does.
        const action = fontMenuCommand(id);
        if (action) dispatchEditorCommand(action.command, action.param);
      } else if (id === MODIFY_STYLE_MENU_ID) {
        // Format > Styles > "Modify…" (plan 05 task 5.4, issue #57): opens
        // the in-app Modify Style dialog, preselecting the style under the
        // cursor. The override is view-only CSS in the app config dir — the
        // document bytes are never touched.
        openModifyStyle();
      } else if (id.startsWith("format-style-")) {
        // Format > Styles submenu (plan 05 task 5.2, issue #55): every
        // built-in style is its own menu id; styleMenuCommand resolves it
        // back to the style's registry command (and its `with` follow-up —
        // Intense Quote's blockquote + bold) so the menu applies the
        // identical styles the toolbar's style gallery does. Unknown ids
        // resolve to null and are a no-op.
        const action = styleMenuCommand(id);
        if (action) {
          dispatchEditorCommand(action.command, action.param);
          if (action.with) dispatchEditorCommand(action.with);
        }
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
      changeEditorFont,
      changeDocTheme,
      changeAppTheme,
      openModifyStyle,
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

  // Style overrides (plan 05 task 5.4, issue #57): load the stored overrides
  // once on mount (Rust app config dir under Tauri, localStorage in browser
  // dev). A missing or corrupt file normalizes to an empty set.
  useEffect(() => {
    let disposed = false;
    void loadStyleOverrides().then((overrides) => {
      if (!disposed) setStyleOverrides(overrides);
    });
    return () => {
      disposed = true;
    };
  }, []);

  // Style inspector (plan 05 task 5.5, issue #58): the WYSIWYG editor
  // publishes the built-in style that owns the block under the cursor (null
  // when it unmounts or the block has no built-in style); the state feeds the
  // status-bar indicator.
  useEffect(() => {
    return registerBlockStyleListener(setBlockStyleLabel);
  }, []);

  // OS dark-mode default (plan 05 task 5.3, issue #56, AC5): while the user
  // has not saved an explicit app-wide theme, follow the OS preference live —
  // Dark when the OS reports dark mode, Quill otherwise. An explicit pick
  // (View > Default theme) saves the choice and stops the tracking.
  useEffect(() => {
    let media: MediaQueryList | undefined;
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const update = () => {
      if (!hasSavedThemeDefault()) setAppTheme(media?.matches ? "dark" : "quill");
    };
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  // Drag & drop (plan 01 task 1.6, issue #27; image insert per plan 08 task
  // 8.6, issue #81): Tauri emits tauri://drag-* events to the webview by
  // default; on drop each .md file opens as a tab, each folder switches the
  // Explorer root, each image file is routed through the from-file flow
  // (asset copy + insert at the active editor's caret), and every dropped
  // item gets its own status-bar line (skipped files included). In browser
  // dev the Tauri event stream does not exist, so this listener is never
  // set up.
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
          insertImage: async (path) => {
            // The drop lands on the webview, not a specific editor: the
            // active WYSIWYG editor is the target (currentFindEditor is
            // null outside it, and the handler reports a skip line).
            const editor = currentFindEditor();
            if (!editor) return false;
            return insertImageFromPathRef.current(editor, path);
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
            onOpenInWysiwyg={() => setMode("wysiwyg")}
          />
        );
        break;
      case "split":
        editorView = (
          <SplitView
            value={currentText}
            onChange={setActiveText}
            settings={activeDoc.settings}
            theme={activeTheme}
            onOpenInWysiwyg={() => setMode("wysiwyg")}
          />
        );
        break;
      case "preview":
        // The theme drives the mermaid SVGs (plan 11 task 11.4, issue #103):
        // preview fences render through the shared render service with the
        // mapped light/dark theme, like the WYSIWYG cards.
        editorView = (
          <PreviewView
            value={currentText}
            theme={activeTheme}
            onOpenInWysiwyg={() => setMode("wysiwyg")}
            onEditLink={editPreviewLink}
            onRemoveLink={removePreviewLink}
          />
        );
        break;
      default:
        editorView = (
          <Editor
            value={currentText}
            onChange={setActiveText}
            settings={activeDoc.settings}
            missingImages={missingImages}
            onReLinkImage={stableReLinkImage}
            theme={activeTheme}
          />
        );
        break;
    }
  }

  return (
    <main className="quillmd-app">
      {/* View-only style overrides (plan 05 task 5.4, issue #57): restyles
          the WYSIWYG/preview content without touching the document bytes. */}
      <style>{overridesCss}</style>
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
              data-theme={activeTheme}
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
                  position={findPanelPos}
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
                  onPositionToggle={toggleFindPanelPos}
                />
              )}
              {linkDialog && (
                <LinkDialog
                  prefill={linkDialog.prefill}
                  onApply={applyLinkDialog}
                  onRemove={removeLinkDialog}
                  onOpen={(href) => void openLinkDialogUrl(href)}
                  onClose={closeLinkDialog}
                />
              )}
              {imageDialog && (
                <ImageDialog onApply={applyImageDialog} onClose={closeImageDialog} />
              )}
              {imageEditDialog && (
                <ImageEditDialog
                  prefill={imageEditDialog.prefill}
                  focusField={imageEditDialog.focus}
                  onApply={applyImageEditDialog}
                  onClose={closeImageEditDialog}
                />
              )}
              {tableDialog && (
                <InsertTableDialog onApply={applyTableDialog} onClose={closeTableDialog} />
              )}
              {modifyStyleKey !== null && (
                <ModifyStyleDialog
                  initialKey={modifyStyleKey}
                  overrides={styleOverrides}
                  onApply={applyModifyStyle}
                  onResetAll={resetAllStyleOverrides}
                  onClose={() => setModifyStyleKey(null)}
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
              blockStyleLabel={blockStyleLabel}
              onJumpToStyle={jumpToStyle}
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
