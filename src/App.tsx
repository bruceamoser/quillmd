import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createDocument, encodeDocument, saveDocument } from "./lib/pipeline";
import {
  checkExternal,
  downloadBytes,
  openFromFile,
  openPath,
  runningInTauri,
  saveAs,
  saveFile,
} from "./lib/fileIo";
import type { OpenFileResult } from "./lib/fileIo";
import Editor from "./components/Editor";
import SourceView from "./components/SourceView";
import SplitView from "./components/SplitView";
import PreviewView from "./components/PreviewView";
import StatusBar from "./components/StatusBar";
import { loadViewMode, saveViewMode } from "./components/viewModes";
import type { ViewMode } from "./components/viewModes";
import "./App.css";

function isAbsolutePath(p: string): boolean {
  return /^([a-zA-Z]:[\\/]|\/)/.test(p);
}

export default function App() {
  const [doc, setDoc] = useState<OpenFileResult | null>(null);
  const [currentText, setCurrentText] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("wysiwyg");
  const [status, setStatus] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const model = useMemo(() => (doc ? createDocument(doc.source) : null), [doc]);
  const dirty = doc !== null && currentText !== doc.source;

  const wordCount = useMemo(() => {
    const trimmed = currentText.trim();
    return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  }, [currentText]);

  const charCount = currentText.length;

  const applyOpened = useCallback((opened: OpenFileResult) => {
    setDoc(opened);
    setCurrentText(opened.source);
    setViewMode(loadViewMode(opened.path));
    setStatus(`Opened ${opened.path} (${opened.eol.toUpperCase()})`);
    if (opened.snapshot && opened.snapshot.length > 0) {
      const restore = window.confirm(
        "A crash-recovery snapshot exists with unsaved edits. Restore it?",
      );
      if (restore) {
        const restored = new TextDecoder("utf-8").decode(opened.snapshot);
        setCurrentText(restored);
        setStatus("Restored unsaved edits from snapshot");
      }
    }
  }, []);

  const handleOpenInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const opened = await openFromFile(file);
      applyOpened(opened);
      if (e.target) e.target.value = "";
    },
    [applyOpened],
  );

  const openByPath = useCallback(
    async (path: string) => {
      const opened = await openPath(path);
      applyOpened(opened);
    },
    [applyOpened],
  );

  const doSave = useCallback(async () => {
    if (!doc || !model) return;
    const result = saveDocument(model, currentText);
    let bytes: Uint8Array;
    if (result.kind === "verbatim") {
      bytes = doc.originalBytes;
    } else {
      bytes = encodeDocument(result.text, { eol: doc.eol, bom: doc.bom });
    }

    if (runningInTauri() && isAbsolutePath(doc.path)) {
      const external = await checkExternal(doc.path, doc.hash);
      if (external === "Modified") {
        const reload = window.confirm(
          "File changed on disk. Reload it? (OK = reload, Cancel = keep my edits)",
        );
        if (reload) {
          const opened = await openPath(doc.path);
          applyOpened(opened);
        }
        return;
      }
      if (external === "Deleted") {
        window.alert("The file was deleted on disk. Use Save As to recreate it.");
        return;
      }
      const newHash = await saveFile(doc.path, bytes, doc.hash);
      setDoc({
        ...doc,
        source: result.text,
        originalBytes: bytes,
        hash: newHash,
      });
      setStatus("Saved");
      return;
    }

    downloadBytes(doc.path || "document.md", bytes);
    setDoc({
      ...doc,
      source: result.text,
      originalBytes: bytes,
    });
    setStatus("Saved (downloaded)");
  }, [doc, model, currentText, applyOpened]);

  const doSaveAs = useCallback(async () => {
    if (!doc || !model) return;
    const result = saveDocument(model, currentText);
    const bytes =
      result.kind === "verbatim"
        ? doc.originalBytes
        : encodeDocument(result.text, { eol: doc.eol, bom: doc.bom });
    if (runningInTauri()) {
      const name = window.prompt("Save as path", doc.path) ?? "";
      if (!name) return;
      await saveAs(name, bytes);
      setStatus(`Saved as ${name}`);
    } else {
      downloadBytes(doc.path || "document.md", bytes);
      setStatus("Saved (downloaded)");
    }
  }, [doc, model, currentText]);

  const toggleMode = useCallback(() => {
    setViewMode((mode) => {
      const next: ViewMode = mode === "wysiwyg" ? "source" : "wysiwyg";
      if (doc) saveViewMode(doc.path, next);
      return next;
    });
  }, [doc]);

  const setMode = useCallback(
    (mode: ViewMode) => {
      setViewMode(mode);
      if (doc) saveViewMode(doc.path, mode);
    },
    [doc],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "/") {
        e.preventDefault();
        toggleMode();
      } else if (key === "s" && e.shiftKey) {
        e.preventDefault();
        void doSaveAs();
      } else if (key === "s") {
        e.preventDefault();
        void doSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleMode, doSave, doSaveAs]);

  if (!doc) {
    return (
      <main className="quillmd-empty">
        <h1>QuillMD</h1>
        <p>Open a Markdown file to begin editing.</p>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Open file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt,text/markdown"
          style={{ display: "none" }}
          onChange={handleOpenInput}
        />
      </main>
    );
  }

  const editor = (() => {
    switch (viewMode) {
      case "source":
        return <SourceView value={currentText} onChange={setCurrentText} />;
      case "split":
        return <SplitView value={currentText} onChange={setCurrentText} />;
      case "preview":
        return <PreviewView value={currentText} />;
      default:
        return <Editor value={currentText} onChange={setCurrentText} />;
    }
  })();

  return (
    <main className="quillmd-app">
      <header className="quillmd-header">
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Open
        </button>
        <button type="button" onClick={() => void doSave()}>
          Save
        </button>
        <button type="button" onClick={() => void doSaveAs()}>
          Save As
        </button>
        <div className="quillmd-modes">
          {(["wysiwyg", "source", "split", "preview"] as ViewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={m === viewMode ? "quillmd-mode-active" : ""}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <span className="quillmd-path">{doc.path}</span>
      </header>

      <div className="quillmd-content">
        {editor}
      </div>

      <StatusBar
        mode={viewMode}
        wordCount={wordCount}
        charCount={charCount}
        eol={doc.eol}
        dirty={dirty}
        fileName={doc.path}
      />

      {status && <div className="quillmd-status-toast">{status}</div>}

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown"
        style={{ display: "none" }}
        onChange={handleOpenInput}
      />
      {!runningInTauri() && (
        <div className="quillmd-path-hint">
          Native path open (M1 fs layer):{" "}
          <button
            type="button"
            onClick={() => {
              const path = window.prompt("Enter absolute file path");
              if (path) void openByPath(path);
            }}
          >
            open by path
          </button>
        </div>
      )}
    </main>
  );
}
