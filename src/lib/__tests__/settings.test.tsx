// @vitest-environment jsdom
// App settings (plan 10 task 10.1, issue #93): the settings.json schema +
// defaults module and its storage bridge. The frontend owns the schema
// (AppSettings / DEFAULT_SETTINGS) and default-merges any stored payload;
// the Rust read_settings/write_settings commands guard the file shape and
// write atomically in the app config dir (mirrored by a localStorage
// fallback in browser dev). The upgrade rules under test (plan 10 AC3):
// unknown keys are preserved on write (forward-compat) and a newly added
// key appears with its default on read (default-merge) — plus the
// useSettings hook (read once, follow the settings-changed event, update
// and reset).
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import {
  DEFAULT_SETTINGS,
  SETTINGS_CHANGED_EVENT,
  buildSettingsPayload,
  loadRawSettings,
  loadSettings,
  normalizeSettings,
  onSettingsChanged,
  resetSettings,
  updateSettings,
  useSettings,
  isAssetCollisionBehavior,
  isAssetFolderSetting,
  isDefaultEol,
  isTabKeyBehavior,
  isUiScale,
} from "../settings";
import type { AppSettings } from "../settings";
import { DEFAULT_THEME } from "../theme";
import { DEFAULT_EDITOR_FONT } from "../editorFont";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- normalizeSettings: default-merge + corruption tolerance -----------------

describe("normalizeSettings (issue #93)", () => {
  it("returns the full defaults for a missing or non-object payload", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("nope")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns the full defaults for an empty object", () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("merges a valid partial record onto the defaults", () => {
    const out = normalizeSettings({ theme: "dark", uiScale: 125, spellcheck: false });
    expect(out.theme).toBe("dark");
    expect(out.uiScale).toBe(125);
    expect(out.spellcheck).toBe(false);
    expect(out.defaultViewMode).toBe(DEFAULT_SETTINGS.defaultViewMode);
    expect(out.defaultEol).toBe(DEFAULT_SETTINGS.defaultEol);
    expect(out.editorFont).toEqual(DEFAULT_EDITOR_FONT);
  });

  it("drops invalid values per key (corruption tolerance)", () => {
    const out = normalizeSettings({
      defaultViewMode: "zen",
      defaultEol: "cr",
      spellcheck: "yes",
      assetFolder: "assets/",
      assetCollision: "maybe",
      theme: "neon",
      editorFont: "big",
      showSourceLineNumbers: 1,
      uiScale: 90,
      tabKey: "newline",
      autoCloseMarkers: "no",
      pasteAsPlainText: 0,
    });
    expect(out).toEqual(DEFAULT_SETTINGS);
  });

  it("normalizes the editor font through the font rules (clamp + drop)", () => {
    expect(normalizeSettings({ editorFont: { family: "serif", size: 400 } }).editorFont).toEqual({
      family: "serif",
      size: 24,
    });
    expect(
      normalizeSettings({ editorFont: { family: "cursive", size: 1 } }).editorFont,
    ).toEqual({
      family: "sans-serif",
      size: 12,
    });
  });

  it("drops unknown keys on normalize (consumption); the write keeps them", () => {
    const out = normalizeSettings({ theme: "dark", futureKey: { deep: true } });
    expect(out.theme).toBe("dark");
    expect("futureKey" in out).toBe(false);
  });

  it("the defaults are the app's current hardcoded behavior", () => {
    expect(DEFAULT_SETTINGS.defaultViewMode).toBe("wysiwyg");
    expect(DEFAULT_SETTINGS.defaultEol).toBe("auto");
    expect(DEFAULT_SETTINGS.spellcheck).toBe(true);
    expect(DEFAULT_SETTINGS.assetFolder).toBe("assets");
    expect(DEFAULT_SETTINGS.assetCollision).toBe("suffix");
    expect(DEFAULT_SETTINGS.theme).toBe(DEFAULT_THEME);
    expect(DEFAULT_SETTINGS.editorFont).toEqual(DEFAULT_EDITOR_FONT);
    expect(DEFAULT_SETTINGS.showSourceLineNumbers).toBe(false);
    expect(DEFAULT_SETTINGS.uiScale).toBe(100);
    expect(DEFAULT_SETTINGS.tabKey).toBe("spaces");
    expect(DEFAULT_SETTINGS.autoCloseMarkers).toBe(true);
    expect(DEFAULT_SETTINGS.pasteAsPlainText).toBe(false);
  });
});

// --- guards --------------------------------------------------------------------

describe("setting guards (issue #93)", () => {
  it("accept exactly their closed sets", () => {
    expect(isDefaultEol("lf")).toBe(true);
    expect(isDefaultEol("crlf")).toBe(true);
    expect(isDefaultEol("auto")).toBe(true);
    expect(isDefaultEol("cr")).toBe(false);
    expect(isDefaultEol(null)).toBe(false);

    expect(isAssetFolderSetting("assets")).toBe(true);
    expect(isAssetFolderSetting("doc")).toBe(true);
    expect(isAssetFolderSetting("Assets")).toBe(false);
    expect(isAssetFolderSetting("")).toBe(false);

    expect(isAssetCollisionBehavior("never")).toBe(true);
    expect(isAssetCollisionBehavior("suffix")).toBe(true);
    expect(isAssetCollisionBehavior("always")).toBe(false);

    expect(isUiScale(100)).toBe(true);
    expect(isUiScale(110)).toBe(true);
    expect(isUiScale(125)).toBe(true);
    expect(isUiScale(90)).toBe(false);
    expect(isUiScale("100")).toBe(false);

    expect(isTabKeyBehavior("indent")).toBe(true);
    expect(isTabKeyBehavior("spaces")).toBe(true);
    expect(isTabKeyBehavior("tab")).toBe(false);
  });
});

// --- buildSettingsPayload: forward-compat + heal-on-save -------------------------

describe("buildSettingsPayload (issue #93)", () => {
  it("applies the patch over the defaults when nothing is stored", () => {
    const payload = buildSettingsPayload({}, { theme: "dark" });
    expect(payload.theme).toBe("dark");
    expect(payload.uiScale).toBe(DEFAULT_SETTINGS.uiScale);
  });

  it("includes every known key so an upgraded app writes the full schema", () => {
    const payload = buildSettingsPayload({});
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      expect(key in payload, `key ${key} must be present`).toBe(true);
    }
  });

  it("preserves unknown top-level keys verbatim (forward-compat)", () => {
    const raw = { theme: "dark", futureKey: { deep: [1, 2] } };
    const payload = buildSettingsPayload(raw, { uiScale: 110 });
    expect(payload.futureKey).toEqual({ deep: [1, 2] });
    expect(payload.theme).toBe("dark");
    expect(payload.uiScale).toBe(110);
  });

  it("preserves unknown keys even when the patch touches nothing else", () => {
    const payload = buildSettingsPayload({ futureKey: "keep me" });
    expect(payload.futureKey).toBe("keep me");
  });

  it("heals corrupted known values on save", () => {
    const payload = buildSettingsPayload({ theme: "neon", spellcheck: "yes", uiScale: 77 });
    expect(payload.theme).toBe(DEFAULT_THEME);
    expect(payload.spellcheck).toBe(true);
    expect(payload.uiScale).toBe(DEFAULT_SETTINGS.uiScale);
  });

  it("applies the patch over the stored values", () => {
    const payload = buildSettingsPayload({ theme: "dark" }, { theme: "serif" });
    expect(payload.theme).toBe("serif");
  });

  it("treats a non-object raw record as empty (defaults + patch)", () => {
    const payload = buildSettingsPayload("corrupt", { theme: "dark" });
    expect(payload.theme).toBe("dark");
    expect(payload.uiScale).toBe(DEFAULT_SETTINGS.uiScale);
  });
});

// --- storage bridge: Tauri invoke + localStorage dev fallback ---------------------

describe("storage bridge (issue #93)", () => {
  const g = globalThis as Record<string, unknown>;

  afterEach(() => {
    clearMocks();
    delete g.isTauri;
    localStorage.clear();
  });

  it("round-trips through localStorage in browser dev (no Rust layer)", async () => {
    const next = await updateSettings({ theme: "dark" });
    expect(next.theme).toBe("dark");
    const stored = JSON.parse(localStorage.getItem("quillmd.settings")!);
    expect(stored.theme).toBe("dark");

    const loaded = await loadSettings();
    expect(loaded).toEqual(next);
  });

  it("reads defaults when nothing is stored or the payload is corrupt (dev)", async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem("quillmd.settings", "not json {");
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem("quillmd.settings", "[1, 2]");
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("talks to the Rust commands under Tauri (read_settings/write_settings)", async () => {
    g.isTauri = true;
    const store = { json: '{"theme":"serif","futureKey":42}' };
    mockIPC((cmd, payload) => {
      if (cmd === "read_settings") return store.json;
      if (cmd === "write_settings") {
        store.json = (payload as { json: string }).json;
        return undefined;
      }
      return undefined;
    });

    const loaded = await loadSettings();
    expect(loaded.theme).toBe("serif");

    const next = await updateSettings({ uiScale: 125 });
    expect(next.uiScale).toBe(125);
    const written = JSON.parse(store.json);
    expect(written.uiScale).toBe(125);
    expect(written.theme).toBe("serif");
    // Unknown keys must survive the write (forward-compat, plan 10 AC3).
    expect(written.futureKey).toBe(42);
  });

  it("a corrupt Tauri payload normalizes instead of throwing", async () => {
    g.isTauri = true;
    mockIPC((cmd) => {
      if (cmd === "read_settings") return "{ definitely not json";
      return undefined;
    });
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("loadRawSettings preserves unknown keys and drops non-objects", async () => {
    g.isTauri = true;
    const store = { json: '{"theme":"dark","futureKey":{"deep":[1,2]}}' };
    mockIPC((cmd) => {
      if (cmd === "read_settings") return store.json;
      return undefined;
    });
    const raw = await loadRawSettings();
    expect(raw.futureKey).toEqual({ deep: [1, 2] });

    store.json = "42";
    expect(await loadRawSettings()).toEqual({});
  });
});

// --- updateSettings / resetSettings: write + event ---------------------------------

describe("updateSettings / resetSettings (issue #93)", () => {
  const g = globalThis as Record<string, unknown>;

  afterEach(() => {
    clearMocks();
    delete g.isTauri;
    localStorage.clear();
  });

  it("emits settings-changed with the merged, normalized settings (Tauri)", async () => {
    g.isTauri = true;
    const store = { json: '{"theme":"serif"}' };
    const emitted: AppSettings[] = [];
    mockIPC(
      (cmd, payload) => {
        if (cmd === "read_settings") return store.json;
        if (cmd === "write_settings") {
          store.json = (payload as { json: string }).json;
          return undefined;
        }
        return undefined;
      },
      { shouldMockEvents: true },
    );
    // The event bus under the mocks is real: subscribe and watch the emit.
    const unlisten = await onSettingsChanged((settings) => emitted.push(settings));

    const next = await updateSettings({ uiScale: 110 });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(next);
    expect(emitted[0].theme).toBe("serif");
    expect(emitted[0].uiScale).toBe(110);
    unlisten();
  });

  it("does not emit in browser dev (no event bus)", async () => {
    const next = await updateSettings({ theme: "dark" });
    expect(next.theme).toBe("dark");
    // No throw, no Tauri invoke — the dev path is localStorage only.
    expect(JSON.parse(localStorage.getItem("quillmd.settings")!).theme).toBe("dark");
  });

  it("resetSettings restores every known default and preserves unknown keys", async () => {
    g.isTauri = true;
    const store = { json: '{"theme":"dark","uiScale":125,"futureKey":"keep me"}' };
    mockIPC((cmd, payload) => {
      if (cmd === "read_settings") return store.json;
      if (cmd === "write_settings") {
        store.json = (payload as { json: string }).json;
        return undefined;
      }
      return undefined;
    });

    const next = await resetSettings();
    expect(next).toEqual(DEFAULT_SETTINGS);

    const written = JSON.parse(store.json);
    expect(written.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(written.uiScale).toBe(DEFAULT_SETTINGS.uiScale);
    expect(written.futureKey).toBe("keep me");
  });
});

// --- useSettings hook -----------------------------------------------------------------

describe("useSettings (issue #93)", () => {
  const g = globalThis as Record<string, unknown>;
  let container: HTMLDivElement;
  let root: Root | null = null;

  afterEach(() => {
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    container.remove();
    clearMocks();
    delete g.isTauri;
    localStorage.clear();
  });

  function renderHook(): { result: { current: ReturnType<typeof useSettings> | null } } {
    const result: { current: ReturnType<typeof useSettings> | null } = { current: null };
    function Probe() {
      result.current = useSettings();
      return null;
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    const r = createRoot(container);
    root = r;
    act(() => {
      r.render(<Probe />);
    });
    return { result };
  }

  it("loads the merged settings once", async () => {
    g.isTauri = true;
    mockIPC((cmd) => {
      if (cmd === "read_settings") return '{"theme":"serif"}';
      return undefined;
    });

    const { result } = renderHook();
    expect(result.current!.settings).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current!.settings!.theme).toBe("serif");
    expect(result.current!.settings!.uiScale).toBe(DEFAULT_SETTINGS.uiScale);
  });

  it("update() writes through the bridge and refreshes the hook state", async () => {
    g.isTauri = true;
    const store = { json: "{}" };
    mockIPC(
      (cmd, payload) => {
        if (cmd === "read_settings") return store.json;
        if (cmd === "write_settings") {
          store.json = (payload as { json: string }).json;
          return undefined;
        }
        return undefined;
      },
      { shouldMockEvents: true },
    );

    const { result } = renderHook();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    await act(async () => {
      await result.current!.update({ theme: "dark", uiScale: 125 });
    });
    expect(result.current!.settings!.theme).toBe("dark");
    expect(result.current!.settings!.uiScale).toBe(125);
    const written = JSON.parse(store.json);
    expect(written.theme).toBe("dark");
    expect(written.uiScale).toBe(125);
  });

  it("reset() restores the defaults", async () => {
    g.isTauri = true;
    mockIPC((cmd) => {
      if (cmd === "read_settings") return '{"theme":"dark","uiScale":125}';
      return undefined;
    });

    const { result } = renderHook();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current!.settings!.theme).toBe("dark");

    await act(async () => {
      await result.current!.reset();
    });
    expect(result.current!.settings!).toEqual(DEFAULT_SETTINGS);
  });

  it("follows external settings-changed events (cross-window sync)", async () => {
    g.isTauri = true;
    mockIPC(
      (cmd) => {
        if (cmd === "read_settings") return '{"theme":"quill"}';
        return undefined;
      },
      { shouldMockEvents: true },
    );

    const { result } = renderHook();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current!.settings!.theme).toBe("quill");

    const external: AppSettings = { ...DEFAULT_SETTINGS, theme: "dark" };
    await act(async () => {
      await emit(SETTINGS_CHANGED_EVENT, external);
    });
    expect(result.current!.settings!.theme).toBe("dark");
  });

  it("works in browser dev without the event bus", async () => {
    const { result } = renderHook();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current!.settings).toEqual(DEFAULT_SETTINGS);

    await act(async () => {
      await result.current!.update({ spellcheck: false });
    });
    expect(result.current!.settings!.spellcheck).toBe(false);
  });
});
