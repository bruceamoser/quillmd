import type { ViewMode } from "./viewModes";

const MODES: ViewMode[] = ["wysiwyg", "source", "split", "preview"];

interface StatusBarProps {
  mode: ViewMode;
  wordCount: number;
  charCount: number;
  eol: "lf" | "crlf";
  dirty: boolean;
  fileName: string | null;
  onModeChange?: (mode: ViewMode) => void;
}

export default function StatusBar({
  mode,
  wordCount,
  charCount,
  eol,
  dirty,
  fileName,
  onModeChange,
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
      <span>{wordCount} words</span>
      <span className="quillmd-status-sep">|</span>
      <span>{charCount} chars</span>
    </div>
  );
}
