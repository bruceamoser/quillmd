import { formatBytes, formatTimestamp } from "../lib/docInfo";
import type { DocInfo } from "../lib/docInfo";

interface DocInfoPanelProps {
  info: DocInfo | null;
  loading: boolean;
  onClose: () => void;
}

interface Row {
  label: string;
  value: string;
  mono?: boolean;
}

// Read-only label/value rows for the properties (plan 01 §2.6, issue #26).
// Null values (untitled/browser-dev docs have no file_stat) render as an
// em dash so the row set is stable across document kinds.
function buildRows(info: DocInfo): Row[] {
  return [
    { label: "Path", value: info.path, mono: true },
    { label: "Size on disk", value: formatBytes(info.size) },
    { label: "Words", value: String(info.words) },
    { label: "Characters", value: String(info.chars) },
    { label: "Lines", value: String(info.lines) },
    { label: "Encoding", value: info.encoding },
    { label: "Line endings", value: info.eol.toUpperCase() },
    { label: "BOM", value: info.bom ? "yes" : "no" },
    { label: "Created", value: formatTimestamp(info.created) },
    { label: "Modified", value: formatTimestamp(info.modified) },
    { label: "Snapshot", value: info.snapshotSize !== null ? formatBytes(info.snapshotSize) : "none" },
    { label: "Changes", value: info.dirty ? "unsaved" : "saved" },
  ];
}

export default function DocInfoPanel({ info, loading, onClose }: DocInfoPanelProps) {
  return (
    <aside className="quillmd-docinfo" aria-label="Document properties">
      <div className="quillmd-docinfo-header">
        <span>Document Properties</span>
        <button type="button" onClick={onClose} aria-label="Close document properties">
          ×
        </button>
      </div>
      {loading || !info ? (
        <div className="quillmd-docinfo-empty">Loading…</div>
      ) : (
        <dl className="quillmd-docinfo-rows">
          {buildRows(info).map((row) => (
            <div className="quillmd-docinfo-row" key={row.label}>
              <dt>{row.label}</dt>
              <dd className={row.mono ? "quillmd-docinfo-mono" : ""}>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </aside>
  );
}
