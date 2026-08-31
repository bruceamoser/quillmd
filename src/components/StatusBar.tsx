import { useEffect, useRef, useState } from "react";
import type { ViewMode } from "./viewModes";

const MODES: ViewMode[] = ["wysiwyg", "source", "split", "preview"];

interface StatusBarProps {
  mode: ViewMode;
  wordCount: number;
  charCount: number;
  eol: "lf" | "crlf";
  dirty: boolean;
  // Content zoom percent (plan 02 task 2.6, issue #35); 100 is the default.
  zoom: number;
  // WYSIWYG spellcheck state (plan 02 §2.8, issue #36); on by default.
  spellcheck?: boolean;
  fileName: string | null;
  onModeChange?: (mode: ViewMode) => void;
  // When provided, the zoom readout is a button that resets to 100% (Word
  // behavior). Absent (tests, embedded) it renders as a plain label.
  onZoomReset?: () => void;
  // When provided, the spellcheck indicator is a button that toggles it
  // (View > Spellcheck). Absent (tests, embedded) it renders as a plain
  // label.
  onSpellcheckToggle?: () => void;
  // Style inspector (plan 05 task 5.5, issue #58): the built-in style that
  // owns the block under the cursor (e.g. "Heading 2"), published by the
  // WYSIWYG editor. Null outside WYSIWYG or for a block with no built-in
  // style hides the indicator entirely.
  blockStyleLabel?: string | null;
  // When provided, the block-style indicator is a button that opens the
  // inspector popover; its "Jump to style" action invokes this (the app
  // routes it to the toolbar's style gallery). Absent (tests, embedded) the
  // indicator renders as a plain label.
  onJumpToStyle?: () => void;
}

export default function StatusBar({
  mode,
  wordCount,
  charCount,
  eol,
  dirty,
  zoom,
  spellcheck = true,
  fileName,
  onModeChange,
  onZoomReset,
  onSpellcheckToggle,
  blockStyleLabel = null,
  onJumpToStyle,
}: StatusBarProps) {
  // The inspector popover's open state (toggled by the block-style button).
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const styleRootRef = useRef<HTMLSpanElement>(null);

  // Close the inspector popover on an outside click or an Escape press (the
  // same model as the style gallery and the toolbar's image dropdown).
  useEffect(() => {
    if (!inspectorOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!styleRootRef.current?.contains(e.target as Node)) setInspectorOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInspectorOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [inspectorOpen]);

  return (
    <div className="quillmd-statusbar">
      {onModeChange ? (
        <span className="quillmd-status-modes">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={m === mode ? "quillmd-mode-active" : ""}
              onClick={() => onModeChange(m)}
            >
              {m}
            </button>
          ))}
        </span>
      ) : (
        <span className="quillmd-status-mode">{mode}</span>
      )}
      <span className="quillmd-status-sep">|</span>
      <span>{fileName ?? "untitled"}</span>
      {dirty && <span className="quillmd-status-dirty">*</span>}
      {blockStyleLabel !== null && (
        <>
          <span className="quillmd-status-sep">|</span>
          <span className="quillmd-status-style" ref={styleRootRef}>
            {onJumpToStyle ? (
              <button
                type="button"
                className={inspectorOpen ? "quillmd-status-style-btn open" : "quillmd-status-style-btn"}
                title="Current block style — click to inspect"
                onClick={() => setInspectorOpen((open) => !open)}
              >
                {blockStyleLabel}
              </button>
            ) : (
              <span className="quillmd-status-style-label">{blockStyleLabel}</span>
            )}
            {inspectorOpen && onJumpToStyle && (
              <span className="quillmd-status-style-popover" role="dialog">
                <span className="quillmd-status-style-popover-text">
                  This block is: {blockStyleLabel}
                </span>
                <button
                  type="button"
                  className="quillmd-status-style-jump"
                  onClick={() => {
                    setInspectorOpen(false);
                    onJumpToStyle();
                  }}
                >
                  Jump to style…
                </button>
              </span>
            )}
          </span>
        </>
      )}
      <span className="quillmd-status-spacer" />
      <span>EOL: {eol.toUpperCase()}</span>
      <span className="quillmd-status-sep">|</span>
      {onZoomReset ? (
        <button
          type="button"
          className="quillmd-status-zoom"
          title="Zoom — click to reset to 100% (Ctrl+0)"
          onClick={onZoomReset}
        >
          {zoom}%
        </button>
      ) : (
        <span className="quillmd-status-zoom">{zoom}%</span>
      )}
      <span className="quillmd-status-sep">|</span>
      {onSpellcheckToggle ? (
        <button
          type="button"
          className={spellcheck ? "quillmd-status-spellcheck" : "quillmd-status-spellcheck off"}
          title="Spellcheck — click to toggle (View > Spellcheck)"
          onClick={onSpellcheckToggle}
        >
          {spellcheck ? "Spellcheck: on" : "Spellcheck: off"}
        </button>
      ) : (
        <span
          className={spellcheck ? "quillmd-status-spellcheck" : "quillmd-status-spellcheck off"}
        >
          {spellcheck ? "Spellcheck: on" : "Spellcheck: off"}
        </span>
      )}
      <span className="quillmd-status-sep">|</span>
      <span>{wordCount} words</span>
      <span className="quillmd-status-sep">|</span>
      <span>{charCount} chars</span>
    </div>
  );
}
