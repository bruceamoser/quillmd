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
}: StatusBarProps) {
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
