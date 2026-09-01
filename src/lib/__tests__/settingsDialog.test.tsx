// @vitest-environment jsdom
// Settings dialog (plan 10 task 10.2, issue #94): the tabbed dialog component
// (General / Appearance / Editor / Advanced, one control per AppSettings
// field), the Tools > Settings… menu item (Ctrl+,) in menu.rs, and the App
// wiring — the menu event and the shortcut open the dialog, a pick persists
// to settings.json through the 10.1 store, theme/scale live-apply, and
// "Reset to defaults" restores the defaults (plan 10 AC2).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import App from "../../App";
import SettingsDialog, { type AppInfo } from "../../components/SettingsDialog";
import { DEFAULT_SETTINGS } from "../settings";
import type { AppSettings } from "../settings";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

// --- structure -------------------------------------------------------------------

describe("menu.rs Tools > Settings… item (issue #94)", () => {
  it("offers the settings dialog with the Ctrl+, accelerator", () => {
    const src = repoFile("../../../src-tauri/src/menu.rs");
    expect(src).toContain(
      'MenuItem::with_id(app, "tools-settings", "Settings…", true, Some("Ctrl+,"))',
    );
    expect(src).toContain('SubmenuBuilder::new(app, "Tools")');
    // Tools sits between Format and Help on the menu bar.
    expect(src).toContain("[&file, &edit, &view, &insert, &format, &tools, &help]");
  });
});

describe("App.tsx Tools > Settings routing (issue #94)", () => {
  it("routes the menu id and the Ctrl+, shortcut to the dialog", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('id === "tools-settings"');
    expect(app).toContain('key === ","');
    expect(app).toContain("setSettingsDialogOpen(true)");
    expect(app).toContain("<SettingsDialog");
    expect(app).toContain("handleSettingsChange");
  });
});

// --- SettingsDialog component ------------------------------------------------------

const APP_INFO: AppInfo = {
  version: "0.10.2",
  buildHash: "444b672",
  configDir: "/home/user/.config/quillmd",
};

describe("SettingsDialog component (issue #94)", () => {
  interface Harness {
    container: HTMLDivElement;
    onChange: ReturnType<typeof vi.fn>;
    onReset: ReturnType<typeof vi.fn>;
    onClose: ReturnType<typeof vi.fn>;
    onOpenConfigDir: ReturnType<typeof vi.fn>;
    tab: (label: string) => HTMLButtonElement;
    rowSelect: (label: string) => HTMLSelectElement;
    rowCheckbox: (label: string) => HTMLInputElement;
    button: (text: string) => HTMLButtonElement;
    infoValue: (label: string) => string;
  }

  let roots: Root[] = [];

  function renderDialog(
    settings: AppSettings = DEFAULT_SETTINGS,
    appInfo: AppInfo | null = APP_INFO,
  ): Harness {
    const onChange = vi.fn();
    const onReset = vi.fn();
    const onClose = vi.fn();
    const onOpenConfigDir = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(
        <SettingsDialog
          settings={settings}
          onChange={onChange}
          onReset={onReset}
          onClose={onClose}
          appInfo={appInfo}
          onOpenConfigDir={onOpenConfigDir}
        />,
      );
    });
    const dialog = () => container.querySelector(".quillmd-settings-dialog")!;
    const row = (label: string): HTMLElement => {
      const el = Array.from(dialog().querySelectorAll(".quillmd-settings-label")).find(
        (l) => l.textContent === label,
      );
      expect(el, `row ${label}`).not.toBeNull();
      return el!.closest(".quillmd-settings-row")!;
    };
    return {
      container,
      onChange,
      onReset,
      onClose,
      onOpenConfigDir,
      tab: (label) => {
        const el = Array.from(dialog().querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
          (b) => b.textContent === label,
        );
        expect(el, `tab ${label}`).not.toBeNull();
        return el!;
      },
      rowSelect: (label) =>
        row(label).querySelector(".quillmd-settings-select") as HTMLSelectElement,
      rowCheckbox: (label) =>
        row(label).querySelector(".quillmd-settings-checkbox") as HTMLInputElement,
      button: (text) =>
        Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
          (b) => b.textContent === text,
        )!,
      infoValue: (label) => {
        const el = Array.from(
          dialog().querySelectorAll(".quillmd-settings-info .quillmd-settings-label"),
        ).find((l) => l.textContent === label);
        expect(el, `info ${label}`).not.toBeNull();
        return el!.parentElement!.querySelector(".quillmd-settings-info-value")!.textContent!;
      },
    };
  }

  function setSelectValue(select: HTMLSelectElement, value: string): void {
    act(() => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function clickCheckbox(checkbox: HTMLInputElement): void {
    // Clicking toggles the checkbox and fires React's onChange.
    act(() => {
      checkbox.click();
    });
  }

  function clickTab(h: Harness, label: string): void {
    act(() => {
      h.tab(label).click();
    });
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    roots = [];
  });

  afterEach(() => {
    for (const r of roots) act(() => r.unmount());
    roots = [];
    vi.restoreAllMocks();
  });

  it("renders the four tabs with General selected first and autofocused", () => {
    const h = renderDialog();
    const tabs = Array.from(h.container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs.map((t) => t.textContent)).toEqual([
      "General",
      "Appearance",
      "Editor",
      "Advanced",
    ]);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);
    // The first tab is autofocused so keyboard navigation starts inside the
    // dialog (Esc is caught by its onKeyDown).
    expect(document.activeElement).toBe(h.tab("General"));
  });

  it("the General tab exposes every general field with the current values", () => {
    const h = renderDialog();
    expect(h.rowSelect("Default view mode").value).toBe("wysiwyg");
    expect(h.rowSelect("Default line endings").value).toBe("auto");
    expect(h.rowCheckbox("Spellcheck").checked).toBe(true);
    expect(h.rowSelect("Asset folder").value).toBe("assets");
    expect(h.rowSelect("Asset name collision").value).toBe("suffix");
  });

  it("the Appearance tab exposes theme, editor font, line numbers, and UI scale", () => {
    const h = renderDialog();
    clickTab(h, "Appearance");
    expect(h.rowSelect("Theme").value).toBe(DEFAULT_SETTINGS.theme);
    expect(h.rowSelect("Editor font").value).toBe(DEFAULT_SETTINGS.editorFont.family);
    expect(h.rowSelect("Editor font size").value).toBe(
      String(DEFAULT_SETTINGS.editorFont.size),
    );
    expect(h.rowCheckbox("Show line numbers in source").checked).toBe(false);
    expect(h.rowSelect("UI scale").value).toBe("100");
  });

  it("the Editor tab exposes the tab key and the input/paste behaviors", () => {
    const h = renderDialog();
    clickTab(h, "Editor");
    expect(h.rowSelect("Tab key").value).toBe("spaces");
    expect(h.rowCheckbox("Auto-close brackets/markers").checked).toBe(true);
    expect(h.rowCheckbox("Paste as plain text by default").checked).toBe(false);
  });

  it("the Advanced tab shows the app info and the two actions", () => {
    const h = renderDialog();
    clickTab(h, "Advanced");
    expect(h.infoValue("Version")).toBe(APP_INFO.version);
    expect(h.infoValue("Config dir")).toBe(APP_INFO.configDir);
    expect(h.button("Open app config dir").disabled).toBe(false);
    expect(h.button("Reset to defaults")).toBeTruthy();
  });

  it("a select pick calls onChange with a single-field patch", () => {
    const h = renderDialog();
    clickTab(h, "Appearance");
    setSelectValue(h.rowSelect("UI scale"), "125");
    expect(h.onChange).toHaveBeenLastCalledWith({ uiScale: 125 });

    setSelectValue(h.rowSelect("Theme"), "dark");
    expect(h.onChange).toHaveBeenLastCalledWith({ theme: "dark" });

    clickTab(h, "Editor");
    setSelectValue(h.rowSelect("Tab key"), "indent");
    expect(h.onChange).toHaveBeenLastCalledWith({ tabKey: "indent" });
  });

  it("a checkbox pick calls onChange with the new boolean", () => {
    const h = renderDialog();
    clickCheckbox(h.rowCheckbox("Spellcheck"));
    expect(h.onChange).toHaveBeenLastCalledWith({ spellcheck: false });

    clickTab(h, "Editor");
    clickCheckbox(h.rowCheckbox("Auto-close brackets/markers"));
    expect(h.onChange).toHaveBeenLastCalledWith({ autoCloseMarkers: false });
  });

  it("an editor-font pick patches the whole editorFont object", () => {
    const h = renderDialog();
    clickTab(h, "Appearance");
    setSelectValue(h.rowSelect("Editor font size"), "14");
    expect(h.onChange).toHaveBeenLastCalledWith({
      editorFont: { ...DEFAULT_SETTINGS.editorFont, size: 14 },
    });
    // The settings prop is static here (no App re-render), so the second
    // patch still starts from the original size.
    setSelectValue(h.rowSelect("Editor font"), "serif");
    expect(h.onChange).toHaveBeenLastCalledWith({
      editorFont: { ...DEFAULT_SETTINGS.editorFont, family: "serif" },
    });
  });

  it("Esc closes the dialog", () => {
    const h = renderDialog();
    act(() => {
      h.container
        .querySelector(".quillmd-settings-dialog")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("the Close button closes; a backdrop press closes; a press inside the dialog does not", () => {
    const h = renderDialog();
    act(() => {
      h.button("Close").click();
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);

    const h2 = renderDialog();
    act(() => {
      h2.container
        .querySelector(".quillmd-settings-overlay")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h2.onClose).toHaveBeenCalledTimes(1);

    const h3 = renderDialog();
    act(() => {
      h3.container
        .querySelector(".quillmd-settings-dialog")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h3.onClose).not.toHaveBeenCalled();
  });

  it("the Advanced actions call their handlers", () => {
    const h = renderDialog();
    clickTab(h, "Advanced");
    act(() => {
      h.button("Open app config dir").click();
    });
    expect(h.onOpenConfigDir).toHaveBeenCalledTimes(1);
    act(() => {
      h.button("Reset to defaults").click();
    });
    expect(h.onReset).toHaveBeenCalledTimes(1);
  });

  it("without app info the Advanced tab shows placeholders and disables the open button", () => {
    const h = renderDialog(DEFAULT_SETTINGS, null);
    clickTab(h, "Advanced");
    expect(h.infoValue("Version")).toBe("…");
    expect(h.infoValue("Config dir")).toBe("…");
    expect(h.button("Open app config dir").disabled).toBe(true);
  });
});

// --- App e2e: menu event, shortcut, persist, live-apply, reset ---------------------

describe("App e2e: Tools > Settings… (issue #94)", () => {
  const g = globalThis as Record<string, unknown>;
  let container: HTMLDivElement;
  let root: Root | null = null;
  let store: { json: string };

  beforeEach(() => {
    localStorage.clear();
    g.isTauri = true;
    store = { json: "{}" };
    mockIPC(
      (cmd, payload) => {
        if (cmd === "get_recent_files") return [];
        if (cmd === "get_app_info")
          return { version: "0.10.2", config_dir: "/home/user/.config/quillmd" };
        if (cmd === "read_settings") return store.json;
        if (cmd === "write_settings") {
          store.json = (payload as { json: string }).json;
          return undefined;
        }
        return undefined;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Unmount before clearMocks: the App's effect cleanup unlistens through
    // the event-plugin internals the mock installed.
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    clearMocks();
    delete g.isTauri;
    container.remove();
    vi.restoreAllMocks();
  });

  async function renderApp(): Promise<void> {
    const r = createRoot(container);
    root = r;
    await act(async () => {
      r.render(<App />);
    });
  }

  async function waitFor(cond: () => boolean, what: string): Promise<void> {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > 4000) throw new Error(`timeout waiting for ${what}`);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    // Drain the hook state update that lands right after the awaited write
    // (useSettings' setSettings follows the settings.json persist).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  // Spins the event loop so in-flight settings writes and their hook state
  // updates settle before asserting.
  async function settle(ms = 25): Promise<void> {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  }

  async function emitMenu(id: string): Promise<void> {
    await act(async () => {
      await emit("menu-event", id);
    });
  }

  function settingsDialog(): HTMLDivElement {
    const el = container.querySelector<HTMLDivElement>(".quillmd-settings-dialog");
    expect(el, "settings dialog").not.toBeNull();
    return el!;
  }

  function dialogTab(label: string): HTMLButtonElement {
    const el = Array.from(settingsDialog().querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (b) => b.textContent === label,
    );
    expect(el, `tab ${label}`).not.toBeNull();
    return el!;
  }

  async function clickTab(label: string): Promise<void> {
    await act(async () => {
      dialogTab(label).click();
    });
  }

  function dialogSelect(label: string): HTMLSelectElement {
    const labelEl = Array.from(settingsDialog().querySelectorAll(".quillmd-settings-label")).find(
      (l) => l.textContent === label,
    );
    expect(labelEl, `row ${label}`).not.toBeNull();
    return labelEl!.closest(".quillmd-settings-row")!.querySelector(
      ".quillmd-settings-select",
    ) as HTMLSelectElement;
  }

  function setSelectValue(select: HTMLSelectElement, value: string): void {
    act(() => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function dialogButton(text: string): HTMLButtonElement {
    const el = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === text,
    );
    expect(el, `button ${text}`).not.toBeNull();
    return el!;
  }

  function dataTheme(): string | null {
    return container.querySelector(".quillmd-content")?.getAttribute("data-theme") ?? null;
  }

  it("the menu opens the tabbed dialog", async () => {
    await renderApp();
    expect(container.querySelector(".quillmd-settings-dialog")).toBeNull();
    await emitMenu("tools-settings");
    const tabs = Array.from(settingsDialog().querySelectorAll('[role="tab"]'));
    expect(tabs.map((t) => t.textContent)).toEqual([
      "General",
      "Appearance",
      "Editor",
      "Advanced",
    ]);
  });

  it("Ctrl+, opens the dialog", async () => {
    await renderApp();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(settingsDialog()).not.toBeNull();
  });

  it("a UI scale pick persists to settings.json and live-applies the root font size", async () => {
    await renderApp();
    await emitMenu("tools-settings");
    await clickTab("Appearance");
    setSelectValue(dialogSelect("UI scale"), "125");
    await waitFor(
      () => document.documentElement.style.fontSize === "125%",
      "uiScale live-applied",
    );
    expect(JSON.parse(store.json).uiScale).toBe(125);
  });

  it("a theme pick live-applies data-theme and syncs settings.json (AC2)", async () => {
    await renderApp();
    await emitMenu("tools-settings");
    await clickTab("Appearance");
    setSelectValue(dialogSelect("Theme"), "dark");
    // The live apply is synchronous (data-theme), but the settings.json sync
    // write is the changeAppTheme's async read-modify-write.
    await waitFor(() => JSON.parse(store.json).theme === "dark", "theme persisted");
    expect(dataTheme()).toBe("dark");
  });

  it("Reset to defaults restores the defaults in settings.json and live state (AC2)", async () => {
    await renderApp();
    await emitMenu("tools-settings");
    await clickTab("Appearance");
    setSelectValue(dialogSelect("UI scale"), "125");
    setSelectValue(dialogSelect("Theme"), "dark");
    await waitFor(() => dataTheme() === "dark", "theme live-applied");

    await clickTab("Advanced");
    await act(async () => {
      dialogButton("Reset to defaults").click();
    });
    await waitFor(() => document.documentElement.style.fontSize === "100%", "reset applied");
    // The reset is followed by the theme/font sync writes (each a
    // read-modify-write of the same store); let them settle before asserting.
    await settle();
    const written = JSON.parse(store.json);
    expect(written.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(written.uiScale).toBe(DEFAULT_SETTINGS.uiScale);
    expect(written.editorFont).toEqual(DEFAULT_SETTINGS.editorFont);
    expect(dataTheme()).toBe(DEFAULT_SETTINGS.theme);
  });
});
