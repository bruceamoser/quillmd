import Editor from "./Editor";
import SourceView from "./SourceView";

interface SplitViewProps {
  value: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
}

export default function SplitView({ value, onChange, readOnly = false }: SplitViewProps) {
  return (
    <div className="quillmd-split">
      <div className="quillmd-split-pane">
        <Editor value={value} onChange={onChange} readOnly={readOnly} />
      </div>
      <div className="quillmd-split-pane">
        <SourceView value={value} onChange={onChange} readOnly={readOnly} />
      </div>
    </div>
  );
}
