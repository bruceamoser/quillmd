// @vitest-environment jsdom
// Full screen (plan 10 task 10.3, issue #95): View > Full Screen (F11) hides
// the menu bar, toolbar, status bar, and side rails, leaving the editor only;
// F11 or Esc exits. Enter applies the quillmd-fullscreen class on the app
// root (the chrome-hide CSS) and requests the fullscreen API so the OS takes
// the window (and the native menu bar) with it; when the API is absent or
// blocked the mode falls back to chrome-hide-only and the frontend keydown
// handles Esc. The menu item lives in menu.rs (F11 accelerator), the routing
// in App.tsx (menu event + browser-dev keydown + fullscreenchange listener),
// and the chrome hide in App.css. This suite pins the menu.rs item, the
// App.tsx routing, the CSS selectors, and a full-App e2e of every exit path
// (F11, the browser's Esc via fullscreenchange, the frontend Esc fallback,
// and the blocked-API fallback) plus that the document bytes never move.
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

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- helpers ----------------------------------------------------------------

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

// A controllable stand-in for the browser fullscreen API (jsdom does not
// implement it). The mock mirrors the real contract: requestFullscreen
// resolves after setting document.fullscreenElement and firing
// fullscreenchange, exitFullscreen does the reverse, and browserExit is the
// OS/browser handling Esc on its own.
interface FullscreenApiMock {
  requestFullscreen: ReturnType<typeof vi.fn>;
  exitFullscreen: ReturnType<typeof vi.fn>;
  browserExit: () => void;
  settleEnter: () => void;
  restore: () => void;
}

function installFullscreenApi(
  options: { reject?: boolean; defer?: boolean } = {},
): FullscreenApiMock {
  let element: HTMLElement | null = null;
  let pendingEnter: (() => void) | null = null;
  const dispatch = () => document.dispatchEvent(new Event("fullscreenchange"));
  const enter = () => {
    element = document.documentElement;
    dispatch();
    pendingEnter = null;
  };
  const requestFullscreen = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        if (options.reject) {
          reject(new DOMException("blocked", "NotAllowedError"));
          return;
        }
        if (options.defer) {
          // Hold the request in flight until the test settles it (the rapid
          // F11-F11 race).
          pendingEnter = () => {
            enter();
            resolve();
          };
          return;
        }
        enter();
        resolve();
      }),
  );
  const exitFullscreen = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        element = null;
        dispatch();
        resolve();
      }),
  );
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => element,
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });
  Object.defineProperty(document.documentElement, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });
  return {
    requestFullscreen,
    exitFullscreen,
    browserExit: () => {
      element = null;
      dispatch();
    },
    settleEnter: () => {
      pendingEnter?.();
    },
    restore: () => {
      delete (document as unknown as Record<string, unknown>).fullscreenElement;
      delete (document as unknown as Record<string, unknown>).exitFullscreen;
      delete (document.documentElement as unknown as Record<string, unknown>)
        .requestFullscreen;
    },
  };
}

// --- menu.rs wiring ----------------------------------------------------------

describe("View > Full Screen menu wiring (issue #95)", () => {
  it("menu.rs carries the Full Screen item with the F11 accelerator in the View menu", () => {
    const src = repoFile("../../../src-tauri/src/menu.rs");
    expect(src).toContain(
      'MenuItem::with_id(app, "view-fullscreen", "Full Screen", true, Some("F11"))',
    );
    expect(src).toContain(".items(&[&explorer, &navigation, &statusbar, &full_screen])");
  });
});

// --- App.tsx routing ---------------------------------------------------------

describe("App.tsx full screen routing (issue #95)", () => {
  it("routes the menu id, F11, and the Esc fallback; requests the API with fallback", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('id === "view-fullscreen"');
    expect(app).toContain('e.key === "F11"');
    expect(app).toContain("requestFullscreen");
    expect(app).toContain('"fullscreenchange"');
    expect(app).toContain("document.exitFullscreen");
    expect(app).toContain('"quillmd-app quillmd-fullscreen"');
  });
});

// --- App.css chrome hide -----------------------------------------------------

describe("full screen CSS chrome hide (issue #95)", () => {
  it("hides the header, tab bar, status bar, both side rails, and the toolbar", () => {
    const css = repoFile("../../App.css");
    for (const selector of [
      ".quillmd-app.quillmd-fullscreen .quillmd-header",
      ".quillmd-app.quillmd-fullscreen .quillmd-tabbar",
      ".quillmd-app.quillmd-fullscreen .quillmd-statusbar",
      ".quillmd-app.quillmd-fullscreen .quillmd-explorer",
      ".quillmd-app.quillmd-fullscreen .quillmd-outline",
      ".quillmd-app.quillmd-fullscreen .quillmd-toolbar",
    ]) {
      expect(css, `App.css must hide ${selector}`).toContain(selector);
    }
  });
});

// --- helpers shared by the full-App e2e blocks --------------------------------

let container: HTMLDivElement;
let root: Root | null = null;

// A document that round-trips byte-identically through the pipeline (the
// suite's "bytes untouched" assertions compare against this exact string).
const DOC = "# Full screen\n\nBody text.\n";

function beforeEachApp(): void {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
}

function afterEachApp(): void {
  const r = root;
  if (r) act(() => r.unmount());
  root = null;
  container.remove();
}

async function renderApp(): Promise<void> {
  const r = createRoot(container);
  root = r;
  await act(async () => {
    r.render(<App />);
  });
}

// Opens a file through the app's hidden <input type="file"> (the browser-dev
// Open path, which works in jsdom).
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

function key(target: EventTarget, keyName: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: keyName,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

function appMain(): HTMLElement {
  const el = container.querySelector<HTMLElement>("main.quillmd-app");
  if (!el) throw new Error("app root not found");
  return el;
}

function isFullscreen(): boolean {
  return appMain().classList.contains("quillmd-fullscreen");
}

function docMd(): string {
  const editor = currentFindEditor();
  if (!editor) throw new Error("no live editor");
  return tiptapToMarkdown(editor.getJSON());
}

async function renderDoc(): Promise<void> {
  await renderApp();
  await openFile("full.md", DOC);
  await waitFor(() => currentFindEditor() !== null, "live editor");
}

// --- full-App e2e: browser dev (no fullscreen API in jsdom) -------------------

describe("App full screen e2e, browser dev (issue #95)", () => {
  beforeEach(beforeEachApp);
  afterEach(afterEachApp);

  it("F11 enters, Esc exits, F11 toggles back; Esc never enters; bytes untouched", async () => {
    await renderDoc();
    expect(docMd()).toBe(DOC);
    expect(isFullscreen()).toBe(false);

    // Esc with the mode off is a no-op (nothing to exit, no find panel).
    key(window, "Escape");
    expect(isFullscreen()).toBe(false);

    // F11 enters: jsdom has no fullscreen API, so this is the chrome-hide-only
    // path — the class lands and the editor keeps working.
    key(window, "F11");
    await waitFor(isFullscreen, "fullscreen class on");
    expect(docMd()).toBe(DOC);

    // Esc exits.
    key(window, "Escape");
    await waitFor(() => !isFullscreen(), "fullscreen exit via Esc");
    expect(docMd()).toBe(DOC);

    // F11 enters again, F11 exits again.
    key(window, "F11");
    await waitFor(isFullscreen, "fullscreen class again");
    key(window, "F11");
    await waitFor(() => !isFullscreen(), "fullscreen exit via F11");
    expect(docMd()).toBe(DOC);
  });

  it("F11 is app-level: it toggles even with no document open", async () => {
    await renderApp();
    key(window, "F11");
    await waitFor(isFullscreen, "fullscreen class on");
    key(window, "F11");
    await waitFor(() => !isFullscreen(), "fullscreen exit");
  });

  it("repeated Esc presses stay a no-op when the mode is off", async () => {
    await renderDoc();
    key(window, "Escape");
    key(window, "Escape");
    expect(isFullscreen()).toBe(false);
    expect(docMd()).toBe(DOC);
  });
});

// --- full-App e2e: fullscreen API present --------------------------------------

describe("App full screen e2e, fullscreen API (issue #95)", () => {
  beforeEach(beforeEachApp);
  afterEach(() => {
    afterEachApp();
    vi.restoreAllMocks();
  });

  it("F11 requests the API fullscreen; the browser's own Esc exits the mode", async () => {
    const api = installFullscreenApi();
    await renderDoc();

    key(window, "F11");
    await waitFor(isFullscreen, "fullscreen class on");
    await waitFor(() => document.fullscreenElement === document.documentElement, "API fullscreen");
    expect(api.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(docMd()).toBe(DOC);

    // The browser consumes the Esc itself: fullscreenchange with a null
    // fullscreenElement settles the app state.
    api.browserExit();
    await waitFor(() => !isFullscreen(), "fullscreen exit via fullscreenchange");
    expect(document.fullscreenElement).toBeNull();
    expect(api.exitFullscreen).not.toHaveBeenCalled();
    expect(docMd()).toBe(DOC);
    api.restore();
  });

  it("F11 while active exits through document.exitFullscreen", async () => {
    const api = installFullscreenApi();
    await renderDoc();

    key(window, "F11");
    await waitFor(isFullscreen, "fullscreen class on");
    await waitFor(() => document.fullscreenElement === document.documentElement, "API fullscreen");

    key(window, "F11");
    await waitFor(() => !isFullscreen(), "fullscreen exit via F11");
    await waitFor(() => document.fullscreenElement === null, "API fullscreen left");
    expect(api.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(docMd()).toBe(DOC);
    api.restore();
  });

  it("a blocked API request falls back to chrome-hide-only and Esc still exits", async () => {
    const api = installFullscreenApi({ reject: true });
    await renderDoc();

    key(window, "F11");
    await waitFor(isFullscreen, "fullscreen class on (fallback)");
    expect(api.requestFullscreen).toHaveBeenCalledTimes(1);
    // The API exists but never granted: no fullscreen element.
    expect(document.fullscreenElement).toBeNull();

    // No API fullscreen means the browser will not consume the Esc; the
    // frontend keydown exits instead.
    key(window, "Escape");
    await waitFor(() => !isFullscreen(), "fullscreen exit via frontend Esc");
    expect(docMd()).toBe(DOC);
    api.restore();
  });

  it("a rapid F11-F11 before the request settles does not strand the API fullscreen", async () => {
    const api = installFullscreenApi({ defer: true });
    await renderDoc();

    key(window, "F11");
    await waitFor(isFullscreen, "fullscreen class on");
    // The request is still in flight; F11 again exits the mode.
    key(window, "F11");
    await waitFor(() => !isFullscreen(), "fullscreen exit before settlement");
    expect(api.exitFullscreen).not.toHaveBeenCalled();

    // The request settles after the app already left: the settlement rolls the
    // API fullscreen back so webview state and app state agree.
    api.settleEnter();
    await waitFor(() => document.fullscreenElement === null, "rolled-back API fullscreen");
    expect(isFullscreen()).toBe(false);
    expect(api.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(docMd()).toBe(DOC);
    api.restore();
  });
});

// --- full-App menu-event e2e (Tauri mock) ---------------------------------------

describe("App View > Full Screen menu e2e (issue #95)", () => {
  const g = globalThis as Record<string, unknown>;

  beforeEach(() => {
    beforeEachApp();
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
  });

  afterEach(() => {
    afterEachApp();
    clearMocks();
    delete g.isTauri;
    vi.restoreAllMocks();
  });

  async function emitMenu(id: string): Promise<void> {
    await act(async () => {
      await emit("menu-event", id);
    });
  }

  it("the view-fullscreen menu id toggles the mode; bytes untouched", async () => {
    await renderDoc();
    expect(docMd()).toBe(DOC);
    expect(isFullscreen()).toBe(false);

    await emitMenu("view-fullscreen");
    await waitFor(isFullscreen, "fullscreen class on");
    expect(docMd()).toBe(DOC);

    // jsdom has no fullscreen API: the Tauri build relies on the native F11
    // accelerator + webview fullscreen; here the class is the observable.
    await emitMenu("view-fullscreen");
    await waitFor(() => !isFullscreen(), "fullscreen class off");
    expect(docMd()).toBe(DOC);
  });
});
