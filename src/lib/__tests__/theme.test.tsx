// @vitest-environment jsdom
// Theme system (plan 05 task 5.3, issue #56): the five built-in document
// themes as CSS variable sheets scoped to the document content container.
// This suite covers the theme registry, the per-app default persistence
// (including the OS-dark first-run default), the per-doc override stored in
// DocSettings.theme, the CSS variable sheets, the menu.rs list sync +
// submenu structure, the App.tsx routing, and a full-App menu-event e2e
// asserting a theme pick changes the rendered data-theme attribute without
// touching the document bytes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import App from "../../App";
import { tiptapToMarkdown } from "../pm";
import { currentFindEditor } from "../find";
import {
  DEFAULT_THEME,
  THEME_DEFAULT_MENU_ID_PREFIX,
  THEME_MENU_ID_PREFIX,
  THEME_RESET_MENU_ID,
  THEMES,
  hasSavedThemeDefault,
  isThemeId,
  loadThemeDefault,
  osPrefersDark,
  resolveTheme,
  saveThemeDefault,
  themeById,
  type ThemeId,
} from "../theme";
import { loadDocSettings } from "../docSettings";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const DEFAULT_KEY = "quillmd.theme.default";
const DOC_SETTINGS_KEY = "quillmd.docSettings";

// --- helpers ----------------------------------------------------------------

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

function setOsDark(dark: boolean): void {
  const mql = {
    matches: dark,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn(() => mql),
    writable: true,
    configurable: true,
  });
}

// The (id, label) pairs of the `pub const THEMES: &[(&str, &str)]` literal in
// menu.rs — the list the View > Theme / View > Default theme submenus are
// built from.
function rustThemeList(): Array<[string, string]> {
  const src = repoFile("../../../src-tauri/src/menu.rs");
  const start = src.indexOf("pub const THEMES: ");
  expect(start, "menu.rs must define THEMES").toBeGreaterThan(-1);
  const assign = src.indexOf("= &[", start);
  const open = src.indexOf("[", assign);
  const close = src.indexOf("];", open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return [...src.slice(open, close).matchAll(/\("([^"]*)",\s*"([^"]*)"\)/g)].map(
    (m) => [m[1], m[2]] as [string, string],
  );
}

// --- registry ----------------------------------------------------------------

describe("theme registry (issue #56)", () => {
  it("offers the five built-in themes with their plan names", () => {
    expect(THEMES.map((theme) => [theme.id, theme.label])).toEqual([
      ["quill", "Quill"],
      ["minimal", "Minimal"],
      ["serif", "Serif / Book"],
      ["dark", "Dark"],
      ["high-contrast", "High Contrast"],
    ]);
    expect(DEFAULT_THEME).toBe("quill");
  });

  it("isThemeId accepts exactly the built-in ids", () => {
    for (const theme of THEMES) expect(isThemeId(theme.id), theme.id).toBe(true);
    for (const value of ["nope", "Quill", "dark ", " DARK", "", null, undefined, 42]) {
      expect(isThemeId(value), String(value)).toBe(false);
    }
  });

  it("themeById resolves each id", () => {
    for (const theme of THEMES) expect(themeById(theme.id)).toEqual(theme);
    expect(themeById("nope")).toBeUndefined();
  });

  it("resolveTheme prefers a per-doc override and falls back to the app default", () => {
    expect(resolveTheme("quill", null)).toBe("quill");
    expect(resolveTheme("dark", null)).toBe("dark");
    expect(resolveTheme("dark", "serif")).toBe("serif");
    expect(resolveTheme("quill", "high-contrast")).toBe("high-contrast");
  });
});

// --- per-app default persistence + OS-dark first-run default -----------------

describe("theme default persistence (issue #56, AC5)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to Quill when there is no saved choice and the OS is light", () => {
    setOsDark(false);
    expect(hasSavedThemeDefault()).toBe(false);
    expect(loadThemeDefault()).toBe("quill");
  });

  it("defaults to Dark when there is no saved choice and the OS is dark", () => {
    setOsDark(true);
    expect(osPrefersDark()).toBe(true);
    expect(loadThemeDefault()).toBe("dark");
  });

  it("round-trips an explicit app-wide choice", () => {
    setOsDark(true);
    saveThemeDefault("serif");
    expect(hasSavedThemeDefault()).toBe(true);
    expect(loadThemeDefault()).toBe("serif");
  });

  it("an explicit saved choice wins over the OS preference", () => {
    setOsDark(true);
    saveThemeDefault("minimal");
    expect(loadThemeDefault()).toBe("minimal");
    setOsDark(false);
    expect(loadThemeDefault()).toBe("minimal");
  });

  it("recovers the OS-based default from a corrupted or wrong-shaped payload", () => {
    setOsDark(true);
    for (const raw of ["{not json", "[]", "null", '"nope"', "42"]) {
      localStorage.setItem(DEFAULT_KEY, raw);
      expect(hasSavedThemeDefault(), raw).toBe(false);
      expect(loadThemeDefault(), raw).toBe("dark");
    }
    setOsDark(false);
    localStorage.setItem(DEFAULT_KEY, "{not json");
    expect(loadThemeDefault()).toBe("quill");
  });
});

// --- CSS variable sheets -----------------------------------------------------

describe("theme CSS variable sheets (issue #56)", () => {
  const REQUIRED_VARS = [
    "--bg:",
    "--text:",
    "--text-bright:",
    "--quillmd-link:",
    "--quillmd-code-bg:",
    "--quillmd-code-text:",
    "--quillmd-heading-weight:",
    "--quillmd-h1:",
    "--quillmd-h2:",
    "--quillmd-base-size:",
    "--quillmd-line-height:",
  ];

  it.each(THEMES.map((theme) => [theme.id] as [string]))(
    "defines a scoped variable sheet for the %s theme",
    (id) => {
      const css = repoFile(`../../themes/${id}.css`);
      expect(css, `${id}.css must be scoped to the content container`).toContain(
        `.quillmd-content[data-theme="${id}"]`,
      );
      for (const variable of REQUIRED_VARS) {
        expect(css, `${id}.css must set ${variable}`).toContain(variable);
      }
    },
  );

  it("imports every theme sheet from themes/index.css", () => {
    const index = repoFile("../../themes/index.css");
    for (const theme of THEMES) {
      expect(index, `index.css must import ${theme.id}.css`).toContain(
        `@import "./${theme.id}.css";`,
      );
    }
  });

  it("App.css consumes the theme variables in the editor and preview surfaces", () => {
    const css = repoFile("../../App.css");
    for (const needle of [
      ".quillmd-prosemirror",
      ".quillmd-preview-content",
      "var(--quillmd-base-size, 15px)",
      "var(--quillmd-line-height, 1.7)",
      "var(--quillmd-heading-weight, 600)",
      "var(--quillmd-h1, 2em)",
      "var(--quillmd-h2, 1.6em)",
      "var(--quillmd-link, #4fc1ff)",
      "var(--quillmd-code-bg, rgba(128, 128, 128, 0.16))",
      "var(--quillmd-code-text, #f0a070)",
    ]) {
      expect(css, `App.css must reference ${needle}`).toContain(needle);
    }
  });

  it("App.tsx renders the active theme as data-theme on the content container", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('data-theme={activeTheme}');
    expect(app).toContain("resolveTheme(appTheme, activeDoc.settings.theme)");
    expect(app).toContain('import "./themes/index.css";');
  });
});

// --- menu.rs sync + submenu structure -----------------------------------------

describe("menu.rs Theme submenus (issue #56)", () => {
  it("mirrors the frontend theme set (menu offers the same themes)", () => {
    expect(rustThemeList()).toEqual(
      THEMES.map((theme) => [theme.id, theme.label] as [string, string]),
    );
  });

  it("builds View > Theme and View > Default theme with the stable id scheme", () => {
    const src = repoFile("../../../src-tauri/src/menu.rs");
    for (const needle of [
      'SubmenuBuilder::new(app, "Theme")',
      'SubmenuBuilder::new(app, "Default theme")',
      'format!("view-theme-{id}")',
      'format!("view-theme-default-{id}")',
      'MenuItem::with_id(app, "view-theme-reset", "Use App Default", true, None::<&str>)',
      ".item(&theme)",
      ".item(&default_theme)",
    ]) {
      expect(src, `menu.rs must contain ${needle}`).toContain(needle);
    }
  });
});

// --- App.tsx routing -----------------------------------------------------------

describe("App.tsx Theme routing (issue #56)", () => {
  it("routes the per-doc, reset, and app-default menu ids", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain("id.startsWith(THEME_DEFAULT_MENU_ID_PREFIX)");
    expect(app).toContain("id === THEME_RESET_MENU_ID");
    expect(app).toContain("id.startsWith(THEME_MENU_ID_PREFIX)");
    expect(app).toContain("changeDocTheme(null)");
    expect(app).toContain("changeDocTheme(theme)");
    expect(app).toContain("changeAppTheme(theme)");
    expect(app).toContain("saveThemeDefault(theme)");
  });
});

// --- full App menu-event e2e (Tauri mock) --------------------------------------

describe("App menu-event e2e (issue #56)", () => {
  const g = globalThis as Record<string, unknown>;
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    localStorage.clear();
    setOsDark(false);
    g.isTauri = true;
    // The Tauri-side commands the App touches under Tauri on mount; the event
    // plugin is mocked so emit("menu-event", ...) reaches App's listener.
    mockIPC(
      (cmd) => {
        if (cmd === "get_recent_files") return [];
        return undefined;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
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

  async function openFile(name: string, content: string): Promise<void> {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("file input not found");
    const file = new File([content], name, { type: "text/markdown" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
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
  }

  function contentEl(): HTMLElement {
    const el = container.querySelector<HTMLElement>(".quillmd-content");
    if (!el) throw new Error("content container not found");
    return el;
  }

  function docMd(): string {
    const editor = currentFindEditor();
    if (!editor) throw new Error("no live editor");
    return tiptapToMarkdown(editor.getJSON());
  }

  function storedDocTheme(path = "styled.md"): ThemeId | null | undefined {
    const raw = localStorage.getItem(DOC_SETTINGS_KEY);
    if (!raw) return undefined;
    const map = JSON.parse(raw) as Record<string, { theme?: ThemeId | null }>;
    return map[path]?.theme;
  }

  function storedAppTheme(): ThemeId | null {
    const raw = localStorage.getItem(DEFAULT_KEY);
    if (!raw) return null;
    return isThemeId(JSON.parse(raw)) ? (JSON.parse(raw) as ThemeId) : null;
  }

  async function emitMenu(id: string): Promise<void> {
    await act(async () => {
      await emit("menu-event", id);
    });
  }

  async function renderDoc(markdown = "Hello world\n"): Promise<void> {
    await renderApp();
    await openFile("styled.md", markdown);
    await waitFor(() => currentFindEditor() !== null, "live editor");
  }

  async function remount(): Promise<void> {
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    await renderApp();
  }

  it.each(THEMES.map((theme) => [theme.id, theme.label] as [string, string]))(
    "a View > Theme pick renders the %s sheet without touching the bytes",
    async (id, label) => {
      await renderDoc();
      expect(docMd()).toBe("Hello world\n");
      await emitMenu(`${THEME_MENU_ID_PREFIX}${id}`);
      expect(contentEl().dataset.theme).toBe(id);
      // AC: a theme switch changes only the rendered look; currentText stays
      // byte-identical.
      expect(docMd()).toBe("Hello world\n");
      // The pick is the active doc's per-doc override, persisted per path.
      expect(storedDocTheme()).toBe(id);
      expect(label.length).toBeGreaterThan(0);
    },
  );

  it("Use App Default clears the active doc's per-doc override", async () => {
    await renderDoc();
    await emitMenu(`${THEME_MENU_ID_PREFIX}minimal`);
    expect(contentEl().dataset.theme).toBe("minimal");
    await emitMenu(THEME_RESET_MENU_ID);
    expect(contentEl().dataset.theme).toBe("quill");
    expect(storedDocTheme()).toBeNull();
    expect(docMd()).toBe("Hello world\n");
  });

  it("View > Default theme changes the app default without clobbering a doc override", async () => {
    await renderDoc();
    await emitMenu(`${THEME_MENU_ID_PREFIX}minimal`);
    expect(contentEl().dataset.theme).toBe("minimal");
    await emitMenu(`${THEME_DEFAULT_MENU_ID_PREFIX}dark`);
    // The doc's own override still wins...
    expect(contentEl().dataset.theme).toBe("minimal");
    expect(storedAppTheme()).toBe("dark");
    // ...until the override is cleared, when the new default takes over.
    await emitMenu(THEME_RESET_MENU_ID);
    expect(contentEl().dataset.theme).toBe("dark");
    expect(docMd()).toBe("Hello world\n");
  });

  it("an unknown theme id is a no-op", async () => {
    await renderDoc();
    await emitMenu(`${THEME_MENU_ID_PREFIX}nope`);
    expect(contentEl().dataset.theme).toBe("quill");
    expect(storedDocTheme()).toBeUndefined();
    await emitMenu(`${THEME_DEFAULT_MENU_ID_PREFIX}nope`);
    expect(storedAppTheme()).toBeNull();
    expect(docMd()).toBe("Hello world\n");
  });

  it("the persisted per-doc override and app default survive a remount", async () => {
    await renderDoc();
    await emitMenu(`${THEME_MENU_ID_PREFIX}serif`);
    await emitMenu(`${THEME_DEFAULT_MENU_ID_PREFIX}dark`);
    expect(contentEl().dataset.theme).toBe("serif");

    await remount();
    await openFile("styled.md", "Hello world\n");
    await waitFor(() => currentFindEditor() !== null, "live editor");
    // The per-doc override wins on re-open; the app default is still Dark.
    expect(contentEl().dataset.theme).toBe("serif");
    expect(storedDocTheme()).toBe("serif");
    expect(storedAppTheme()).toBe("dark");
    await emitMenu(THEME_RESET_MENU_ID);
    expect(contentEl().dataset.theme).toBe("dark");
  });

  it("a new install with no saved choice follows the OS dark-mode preference", async () => {
    setOsDark(true);
    await renderApp();
    expect(hasSavedThemeDefault()).toBe(false);
    expect(contentEl().dataset.theme).toBe("dark");
  });

  it("a new install with no saved choice defaults to Quill when the OS is light", async () => {
    setOsDark(false);
    await renderApp();
    expect(hasSavedThemeDefault()).toBe(false);
    expect(contentEl().dataset.theme).toBe("quill");
  });

  it("an explicit saved app default wins over the OS preference on re-open", async () => {
    saveThemeDefault("serif");
    setOsDark(true);
    await renderApp();
    expect(contentEl().dataset.theme).toBe("serif");
    await openFile("styled.md", "Hello world\n");
    await waitFor(() => currentFindEditor() !== null, "live editor");
    expect(contentEl().dataset.theme).toBe("serif");
    // loadDocSettings still reports no per-doc override for the fresh doc.
    expect(loadDocSettings("styled.md").theme).toBeNull();
  });
});
