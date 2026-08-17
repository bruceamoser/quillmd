import type { ViewMode } from "./viewModes";

interface StatusBarProps {
  mode: ViewMode;
  wordCount: number;
  charCount: number;
  eol: "lf" | "crlf";
  dirty: boolean;
  fileName: string | null;
}

export default function StatusBar({
  mode,
  wordCount,
  charCount,
  eol,
  dirty,
  fileName,
}: StatusBarProps) {
  return (
    <div className="quillmd-statusbar">
      <span className="quillmd-status-mode">{mode}</span>
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
