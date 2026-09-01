// App settings (plan 10 task 10.1, issue #93): the app-wide preferences the
// Settings dialog edits — default view mode, EOL, spellcheck, asset
// handling, theme, editor font, UI scale, and editor key behavior.
//
// Storage is a single JSON file in the Tauri app config dir
// (~/.config/quillmd/settings.json) written through the Rust
// read_settings / write_settings commands — machine-local by design, the
// same posture as the style overrides. In browser dev there is no Rust
// layer, so the same payload falls back to localStorage.
//
// The frontend owns the schema (AppSettings / DEFAULT_SETTINGS below) and
// normalizes any stored payload onto the defaults; the Rust side only guards
// the file shape (a JSON object) and writes atomically. Two upgrade rules
// (plan 10 AC3): unknown keys are preserved on write so a newer app's
// settings survive an older app's save (forward-compat), and default-merge
// on read means a newly added key appears with its default after an upgrade
// with no migration.
//
// Settings are app/view behavior only: they never touch the markdown, the
// save pipeline, or the round-trip contract.

import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { DEFAULT_THEME, isThemeId, type ThemeId } from "./theme";
import {
  DEFAULT_EDITOR_FONT,
  normalizeEditorFont,
  type EditorFontSettings,
} from "./editorFont";
import type { ViewMode } from "../components/viewModes";

// --- schema ------------------------------------------------------------------

// EOL for new (untitled) documents; existing documents keep their per-doc
// detection (plan 10 §3: the default applies to new docs only).
export type DefaultEol = "lf" | "crlf" | "auto";

// Where copied assets land relative to the document (plan 08 §2.3): the
// `assets/` subfolder, or the doc's own folder.
export type AssetFolderSetting = "assets" | "doc";

// Asset name-collision behavior on copy: "never" keeps the picked (fixed)
// name, "suffix" appends -1/-2/... until the name is free (the current
// copy_asset behavior, plan 08).
export type AssetCollisionBehavior = "never" | "suffix";

// UI scale applied as the root font-size (plan 10 §2.2 Appearance).
export type UiScale = 100 | 110 | 125;

// Tab key in the editor: "indent" (nest lists/quotes, the WYSIWYG's current
// in-context behavior) or "spaces" (insert four spaces, the current
// plain-insert behavior).
export type TabKeyBehavior = "indent" | "spaces";

export interface AppSettings {
  // General
  defaultViewMode: ViewMode;
  defaultEol: DefaultEol;
  spellcheck: boolean;
  assetFolder: AssetFolderSetting;
  assetCollision: AssetCollisionBehavior;
  // Appearance
  theme: ThemeId;
  editorFont: EditorFontSettings;
  showSourceLineNumbers: boolean;
  uiScale: UiScale;
  // Editor
  tabKey: TabKeyBehavior;
  autoCloseMarkers: boolean;
  pasteAsPlainText: boolean;
}

// The defaults are the app's current hardcoded behavior, so adopting the
// settings file changes nothing for existing users.
export const DEFAULT_SETTINGS: AppSettings = {
  defaultViewMode: "wysiwyg",
  defaultEol: "auto",
  spellcheck: true,
  assetFolder: "assets",
  assetCollision: "suffix",
  theme: DEFAULT_THEME,
  editorFont: { ...DEFAULT_EDITOR_FONT },
  showSourceLineNumbers: false,
  uiScale: 100,
  tabKey: "spaces",
  autoCloseMarkers: true,
  pasteAsPlainText: false,
};

// --- guards ------------------------------------------------------------------

export function isDefaultEol(value: unknown): value is DefaultEol {
  return value === "lf" || value === "crlf" || value === "auto";
}

export function isAssetFolderSetting(value: unknown): value is AssetFolderSetting {
  return value === "assets" || value === "doc";
}

export function isAssetCollisionBehavior(value: unknown): value is AssetCollisionBehavior {
  return value === "never" || value === "suffix";
}

export function isUiScale(value: unknown): value is UiScale {
  return value === 100 || value === 110 || value === 125;
}

export function isTabKeyBehavior(value: unknown): value is TabKeyBehavior {
  return value === "indent" || value === "spaces";
}

function isViewMode(value: unknown): value is ViewMode {
  return (
    value === "wysiwyg" || value === "source" || value === "split" || value === "preview"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// --- normalization (default-merge) --------------------------------------------

// Merge a possibly-partial, unknown-keyed, or corrupted stored record onto
// the defaults so a bad payload can never take down the app (same posture as
// docSettings.ts). Invalid values fall back to the default per key; unknown
// keys are dropped here (normalize is for consumption) but preserved on write
// by buildSettingsPayload.
export function normalizeSettings(raw: unknown): AppSettings {
  const out: AppSettings = {
    ...DEFAULT_SETTINGS,
    editorFont: { ...DEFAULT_SETTINGS.editorFont },
  };
  if (!isRecord(raw)) return out;
  if (isViewMode(raw.defaultViewMode)) out.defaultViewMode = raw.defaultViewMode;
  if (isDefaultEol(raw.defaultEol)) out.defaultEol = raw.defaultEol;
  if (typeof raw.spellcheck === "boolean") out.spellcheck = raw.spellcheck;
  if (isAssetFolderSetting(raw.assetFolder)) out.assetFolder = raw.assetFolder;
  if (isAssetCollisionBehavior(raw.assetCollision)) out.assetCollision = raw.assetCollision;
  if (isThemeId(raw.theme)) out.theme = raw.theme;
  out.editorFont = normalizeEditorFont(raw.editorFont);
  if (typeof raw.showSourceLineNumbers === "boolean") {
    out.showSourceLineNumbers = raw.showSourceLineNumbers;
  }
  if (isUiScale(raw.uiScale)) out.uiScale = raw.uiScale;
  if (isTabKeyBehavior(raw.tabKey)) out.tabKey = raw.tabKey;
  if (typeof raw.autoCloseMarkers === "boolean") out.autoCloseMarkers = raw.autoCloseMarkers;
  if (typeof raw.pasteAsPlainText === "boolean") out.pasteAsPlainText = raw.pasteAsPlainText;
  return out;
}

// The settings.json payload a write persists: the defaults merged with the
// current raw record and the patch applied on top. Starting from the
// normalized record (never the raw one) means corrupted values are healed on
// save, and copying the raw record's unknown keys verbatim is what keeps a
// newer app's settings through an older app's save (plan 10 AC3).
export function buildSettingsPayload(
  raw: unknown,
  patch: Partial<AppSettings> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...normalizeSettings(raw) };
  if (isRecord(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (!(key in out)) out[key] = value;
    }
  }
  return { ...out, ...patch };
}

// --- storage bridge ------------------------------------------------------------

// The browser-dev fallback key; under Tauri the file lives in the app config
// dir and this key is unused.
const SETTINGS_STORAGE_KEY = "quillmd.settings";

// The Tauri event updateSettings emits after a successful write. The payload
// carries the merged, normalized settings so listeners never re-read the
// file.
export const SETTINGS_CHANGED_EVENT = "settings-changed";

export async function emitSettingsChanged(settings: AppSettings): Promise<void> {
  if (!isTauri()) return;
  try {
    await emit(SETTINGS_CHANGED_EVENT, settings);
  } catch {
    // Emitting is best-effort; the write already landed.
  }
}

// Subscribes to SETTINGS_CHANGED_EVENT; resolves to the unlisten function.
// In browser dev (no Tauri) there is no event bus, so it resolves to a no-op
// and updates flow through the same-tab state instead.
export async function onSettingsChanged(
  callback: (settings: AppSettings) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  try {
    return await listen<AppSettings>(SETTINGS_CHANGED_EVENT, (event) => {
      callback(event.payload);
    });
  } catch {
    return () => {};
  }
}

// The raw stored record, preserving unknown keys (a first run or a
// hand-deleted file is a clean state, not an error).
export async function loadRawSettings(): Promise<Record<string, unknown>> {
  if (isTauri()) {
    try {
      const raw = await invoke<string>("read_settings");
      const parsed: unknown = JSON.parse(raw || "{}");
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function loadSettings(): Promise<AppSettings> {
  return normalizeSettings(await loadRawSettings());
}

async function persistRawSettings(payload: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify(payload);
  if (isTauri()) {
    await invoke("write_settings", { json });
    return;
  }
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, json);
  } catch {
    // localStorage may be unavailable (private mode); settings are best-effort.
  }
}

// Merges `patch` into the stored settings, persists the result (unknown keys
// preserved), emits settings-changed, and resolves to the new settings.
export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const raw = await loadRawSettings();
  const payload = buildSettingsPayload(raw, patch);
  await persistRawSettings(payload);
  const settings = normalizeSettings(payload);
  await emitSettingsChanged(settings);
  return settings;
}

// "Reset to defaults" (plan 10 §2.2 Advanced): every known setting returns
// to its default while unknown keys survive (forward-compat), then the same
// write + event path as updateSettings runs.
export async function resetSettings(): Promise<AppSettings> {
  return updateSettings({ ...DEFAULT_SETTINGS, editorFont: { ...DEFAULT_SETTINGS.editorFont } });
}

// --- React hook ------------------------------------------------------------------

export interface UseSettingsResult {
  // The merged, normalized settings; null until the first read resolves.
  settings: AppSettings | null;
  // updateSettings as a stable callback.
  update: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  // resetSettings as a stable callback.
  reset: () => Promise<AppSettings>;
}

// Reads the settings once, then follows the settings-changed event (other
// windows / future surfaces) so every consumer of the hook stays in sync
// without re-reading the file.
export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    let active = true;
    let unlisten: UnlistenFn | null = null;
    void (async () => {
      const initial = await loadSettings();
      if (!active) return;
      setSettings(initial);
      unlisten = await onSettingsChanged((next) => {
        if (active) setSettings(next);
      });
    })();
    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, []);

  // updateSettings/resetSettings also emit the event the effect subscribes
  // to, so the state lands either way; setting it directly here keeps the
  // hook fresh in browser dev, where there is no event bus.
  const update = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await updateSettings(patch);
    setSettings(next);
    return next;
  }, []);
  const reset = useCallback(async () => {
    const next = await resetSettings();
    setSettings(next);
    return next;
  }, []);

  return { settings, update, reset };
}
