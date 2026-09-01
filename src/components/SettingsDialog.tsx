// Settings dialog (plan 10 task 10.2, issue #94): Tools > Settings… (Ctrl+,).
// A tabbed, in-app editor for the app-wide preferences (AppSettings in
// settings.ts): General / Appearance / Editor / Advanced. Every pick calls
// onChange with a partial patch, which App.tsx persists through the 10.1
// settings store (settings.json) and live-applies where possible (theme,
// editor font, UI scale, source line numbers). Settings are app/view
// behavior only — they never touch the markdown or the round-trip contract.
//
// Keyboard model (plan 08 §3 convention):
//   Esc            close
//   autofocus      the first tab (General)
// Unlike the read-only dialogs, Enter does not close: the body is a form of
// selects/checkboxes, so Enter is left to the focused control.

import { useEffect, useRef, useState } from "react";
import type { AppSettings } from "../lib/settings";
import type { ViewMode } from "./viewModes";
import {
  EDITOR_FONT_FAMILIES,
  EDITOR_FONT_SIZES,
  type EditorFontFamily,
} from "../lib/editorFont";
import { THEMES, type ThemeId } from "../lib/theme";
import type {
  AssetCollisionBehavior,
  AssetFolderSetting,
  DefaultEol,
  TabKeyBehavior,
  UiScale,
} from "../lib/settings";

// The app info the Advanced tab shows (plan 10 §2.2: version/paths). App
// resolves it through the Rust get_app_info command (version + config dir).
export interface AppInfo {
  version: string;
  configDir: string;
}

export interface SettingsDialogProps {
  // The merged, normalized settings to edit.
  settings: AppSettings;
  // Persist a partial patch (App applies it + live-applies theme/font/scale).
  onChange: (patch: Partial<AppSettings>) => void;
  // "Reset to defaults" (plan 10 §2.2 Advanced).
  onReset: () => void;
  // Close (Esc or the Close button).
  onClose: () => void;
  // The app info for the Advanced tab; null until it resolves.
  appInfo: AppInfo | null;
  // Open the app config dir in the OS file manager (Advanced tab).
  onOpenConfigDir: () => void;
}

type Tab = "general" | "appearance" | "editor" | "advanced";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "editor", label: "Editor" },
  { id: "advanced", label: "Advanced" },
];

const VIEW_MODES: Array<{ value: ViewMode; label: string }> = [
  { value: "wysiwyg", label: "WYSIWYG" },
  { value: "source", label: "Source" },
  { value: "split", label: "Split" },
  { value: "preview", label: "Preview" },
];

const EOLS: Array<{ value: DefaultEol; label: string }> = [
  { value: "auto", label: "Auto (platform)" },
  { value: "lf", label: "LF (\\n)" },
  { value: "crlf", label: "CRLF (\\r\\n)" },
];

const ASSET_FOLDERS: Array<{ value: AssetFolderSetting; label: string }> = [
  { value: "assets", label: "assets/ subfolder" },
  { value: "doc", label: "Same folder as the document" },
];

const ASSET_COLLISIONS: Array<{ value: AssetCollisionBehavior; label: string }> = [
  { value: "suffix", label: "Append a suffix (photo-1.png)" },
  { value: "never", label: "Keep the picked name (overwrite)" },
];

const UI_SCALES: Array<UiScale> = [100, 110, 125];

const TAB_KEYS: Array<{ value: TabKeyBehavior; label: string }> = [
  { value: "spaces", label: "Insert four spaces" },
  { value: "indent", label: "Indent (nest lists/quotes)" },
];

// A labeled control row: the label on the left, the control on the right.
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="quillmd-settings-row">
      <div className="quillmd-settings-rowtext">
        <span className="quillmd-settings-label">{label}</span>
        {hint && <span className="quillmd-settings-hint">{hint}</span>}
      </div>
      <div className="quillmd-settings-control">{children}</div>
    </div>
  );
}

export default function SettingsDialog({
  settings,
  onChange,
  onReset,
  onClose,
  appInfo,
  onOpenConfigDir,
}: SettingsDialogProps) {
  const [tab, setTab] = useState<Tab>("general");
  const firstTabRef = useRef<HTMLButtonElement>(null);

  // Autofocus the first tab on open so keyboard navigation starts inside the
  // dialog (Esc is caught by the dialog's onKeyDown).
  useEffect(() => {
    firstTabRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="quillmd-settings-overlay"
      onMouseDown={(e) => {
        // A backdrop press closes; the dialog itself keeps the event.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="quillmd-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="quillmd-settings-title">Settings</div>

        <div className="quillmd-settings-tabs" role="tablist" aria-label="Settings sections">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={i === 0 ? firstTabRef : undefined}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={
                "quillmd-settings-tab" + (tab === t.id ? " quillmd-settings-tab-active" : "")
              }
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="quillmd-settings-body" role="tabpanel">
          {tab === "general" && (
            <>
              <Row label="Default view mode" hint="New and unremembered documents">
                <select
                  className="quillmd-settings-select"
                  value={settings.defaultViewMode}
                  onChange={(e) => onChange({ defaultViewMode: e.target.value as ViewMode })}
                >
                  {VIEW_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Default line endings" hint="Applies to new documents">
                <select
                  className="quillmd-settings-select"
                  value={settings.defaultEol}
                  onChange={(e) => onChange({ defaultEol: e.target.value as DefaultEol })}
                >
                  {EOLS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Spellcheck" hint="Default for new documents">
                <input
                  type="checkbox"
                  className="quillmd-settings-checkbox"
                  checked={settings.spellcheck}
                  onChange={(e) => onChange({ spellcheck: e.target.checked })}
                />
              </Row>
              <Row label="Asset folder" hint="Where copied images land">
                <select
                  className="quillmd-settings-select"
                  value={settings.assetFolder}
                  onChange={(e) => onChange({ assetFolder: e.target.value as AssetFolderSetting })}
                >
                  {ASSET_FOLDERS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Asset name collision" hint="When the name already exists">
                <select
                  className="quillmd-settings-select"
                  value={settings.assetCollision}
                  onChange={(e) =>
                    onChange({ assetCollision: e.target.value as AssetCollisionBehavior })
                  }
                >
                  {ASSET_COLLISIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Row>
            </>
          )}

          {tab === "appearance" && (
            <>
              <Row label="Theme" hint="Applies live">
                <select
                  className="quillmd-settings-select"
                  value={settings.theme}
                  onChange={(e) => onChange({ theme: e.target.value as ThemeId })}
                >
                  {THEMES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Editor font">
                <select
                  className="quillmd-settings-select"
                  value={settings.editorFont.family}
                  onChange={(e) =>
                    onChange({
                      editorFont: {
                        ...settings.editorFont,
                        family: e.target.value as EditorFontFamily,
                      },
                    })
                  }
                >
                  {EDITOR_FONT_FAMILIES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Editor font size" hint="Points">
                <select
                  className="quillmd-settings-select"
                  value={String(settings.editorFont.size)}
                  onChange={(e) =>
                    onChange({
                      editorFont: {
                        ...settings.editorFont,
                        size: Number(e.target.value),
                      },
                    })
                  }
                >
                  {EDITOR_FONT_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Show line numbers in source" hint="The source pane gutter">
                <input
                  type="checkbox"
                  className="quillmd-settings-checkbox"
                  checked={settings.showSourceLineNumbers}
                  onChange={(e) => onChange({ showSourceLineNumbers: e.target.checked })}
                />
              </Row>
              <Row label="UI scale" hint="Applied as the root font size">
                <select
                  className="quillmd-settings-select"
                  value={String(settings.uiScale)}
                  onChange={(e) => onChange({ uiScale: Number(e.target.value) as UiScale })}
                >
                  {UI_SCALES.map((s) => (
                    <option key={s} value={s}>
                      {s}%
                    </option>
                  ))}
                </select>
              </Row>
            </>
          )}

          {tab === "editor" && (
            <>
              <Row label="Tab key" hint="Outside lists, quotes, and tables">
                <select
                  className="quillmd-settings-select"
                  value={settings.tabKey}
                  onChange={(e) => onChange({ tabKey: e.target.value as TabKeyBehavior })}
                >
                  {TAB_KEYS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Auto-close brackets/markers" hint="TipTap input rules">
                <input
                  type="checkbox"
                  className="quillmd-settings-checkbox"
                  checked={settings.autoCloseMarkers}
                  onChange={(e) => onChange({ autoCloseMarkers: e.target.checked })}
                />
              </Row>
              <Row label="Paste as plain text by default" hint="Ctrl+V inserts plain text">
                <input
                  type="checkbox"
                  className="quillmd-settings-checkbox"
                  checked={settings.pasteAsPlainText}
                  onChange={(e) => onChange({ pasteAsPlainText: e.target.checked })}
                />
              </Row>
            </>
          )}

          {tab === "advanced" && (
            <>
              <div className="quillmd-settings-info">
                <div className="quillmd-settings-info-row">
                  <span className="quillmd-settings-label">Version</span>
                  <span className="quillmd-settings-info-value">
                    {appInfo ? appInfo.version : "…"}
                  </span>
                </div>
                <div className="quillmd-settings-info-row">
                  <span className="quillmd-settings-label">Config dir</span>
                  <span className="quillmd-settings-info-value quillmd-settings-path">
                    {appInfo ? appInfo.configDir : "…"}
                  </span>
                </div>
              </div>
              <div className="quillmd-settings-advanced-actions">
                <button
                  type="button"
                  className="quillmd-settings-button"
                  onClick={onOpenConfigDir}
                  disabled={appInfo === null}
                >
                  Open app config dir
                </button>
                <button
                  type="button"
                  className="quillmd-settings-button danger"
                  onClick={onReset}
                >
                  Reset to defaults
                </button>
              </div>
            </>
          )}
        </div>

        <div className="quillmd-settings-actions">
          <button type="button" className="quillmd-settings-button primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
