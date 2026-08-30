import { isUntitledPath, untitledDisplayName } from "../lib/newDoc";
import type { ViewMode } from "./viewModes";

export interface TabInfo {
  path: string;
  dirty: boolean;
  viewMode: ViewMode;
}

interface TabBarProps {
  tabs: TabInfo[];
  activePath: string;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onNewTab: () => void;
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

// Synthetic untitled tabs (:new:<n>) show as "Untitled <n>"; real files show
// their base name.
function tabName(path: string): string {
  return isUntitledPath(path) ? untitledDisplayName(path) : baseName(path);
}

export default function TabBar({ tabs, activePath, onSelect, onClose, onNewTab }: TabBarProps) {
  return (
    <div className="quillmd-tabbar">
      {tabs.map((tab) => (
        <div
          key={tab.path}
          className={`quillmd-tab ${tab.path === activePath ? "quillmd-tab-active" : ""}`}
          title={`${tab.path} (${tab.viewMode})`}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              onClose(tab.path);
            }
          }}
          onClick={() => onSelect(tab.path)}
        >
          <span className="quillmd-tab-name">{tabName(tab.path)}</span>
          {tab.dirty && (
            <span className="quillmd-tab-dirty" title="Unsaved changes">
              {"\u2022"}
            </span>
          )}
          <button
            type="button"
            className="quillmd-tab-close"
            title="Close"
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.path);
            }}
          >
            {"\u00D7"}
          </button>
        </div>
      ))}
      <button type="button" className="quillmd-tab-new" title="Open file" onClick={onNewTab}>
        +
      </button>
    </div>
  );
}
