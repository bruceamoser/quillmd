import Editor from "./Editor";
import SourceView from "./SourceView";
import type { DocSettings } from "../lib/docSettings";
import type { ThemeId } from "../lib/theme";

interface SplitViewProps {
  value: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
  // Per-doc view settings (plan 02 task 2.5) forwarded to both panes: the
  // WYSIWYG editor applies line spacing/wrap/marks to its DOM, the source
  // pane honors word wrap.
  settings?: DocSettings;
  // The active document theme (plan 11 task 11.3, issue #102): forwarded to
  // the WYSIWYG editor so its mermaid cards render with the mapped theme.
  theme?: ThemeId;
  // The source pane's context menu "Open in WYSIWYG" item (plan 03 task
  // 3.2, issue #40): switches the view mode to the full WYSIWYG editor.
  // (The WYSIWYG pane's own text menu needs no switch — it is already the
  // WYSIWYG surface.)
  onOpenInWysiwyg?: () => void;
}

export default function SplitView({
  value,
  onChange,
  readOnly = false,
  settings,
  theme,
  onOpenInWysiwyg,
}: SplitViewProps) {
  return (
    <div className="quillmd-split">
      <div className="quillmd-split-pane">
        <Editor
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          settings={settings}
          theme={theme}
        />
      </div>
      <div className="quillmd-split-pane">
        <SourceView
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          wrap={settings?.wordWrap ?? true}
          onOpenInWysiwyg={onOpenInWysiwyg}
        />
      </div>
    </div>
  );
}
