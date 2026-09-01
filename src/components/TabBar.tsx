import { useState } from "react";
import { isUntitledPath, untitledDisplayName } from "../lib/newDoc";
import {
  buildTabMenu,
  toTabContextEntries,
  type TabMenuItem,
} from "../lib/tabMenu";
import ContextMenu from "./ContextMenu";
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
  // Tab context menu (plan 03 task 3.6, issue #44): Close Others keeps the
  // right-clicked tab; Close All closes every tab. Both confirm dirty tabs
  // through the App's shared close flows (same dialogs as the File menu).
  onCloseOthers: (keepPath: string) => void;
  onCloseAll: () => void;
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

// The open tab menu: the right-clicked tab's path plus the cursor position.
interface TabMenuState {
  x: number;
  y: number;
  path: string;
}

export default function TabBar({
  tabs,
  activePath,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseAll,
  onNewTab,
}: TabBarProps) {
  const [menu, setMenu] = useState<TabMenuState | null>(null);

  const dispatch = (item: TabMenuItem) => {
    if (!menu) return;
    if (item.action === "close") onClose(menu.path);
    else if (item.action === "close-others") onCloseOthers(menu.path);
    else if (item.action === "close-all") onCloseAll();
  };

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
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, path: tab.path });
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="Tab menu"
          items={toTabContextEntries(
            buildTabMenu(tabs.map((t) => t.path), menu.path),
            dispatch,
          )}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
