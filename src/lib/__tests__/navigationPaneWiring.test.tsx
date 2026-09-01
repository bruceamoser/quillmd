// @vitest-environment jsdom
// App wiring for the navigation pane (plan 09 task 9.3, issue #86): the
// Ctrl+Shift+8 browser-dev shortcut toggles the pane for the active document,
// and the open state persists per path in the doc settings (like the view
// mode). The pane's list/tracking/jump behavior is covered in
// outlinePane.test.tsx; the shared math in outline.test.ts; the persistence
// of the settings field in docSettings.test.ts. This renders the full App in
// jsdom (no Tauri) and drives the same window keydown the browser build uses.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "../../App";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const SETTINGS_KEY = "quillmd.docSettings";
const FILE_NAME = "nav.md";

const DOC =
  "# Title\n" +
  "\n" +
  "Intro.\n" +
  "\n" +
  "## One\n" +
  "\n" +
  "Body.\n";

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  root = null;
  container.remove();
});

async function renderApp() {
  const r = createRoot(container);
  root = r;
  await act(async () => {
    r.render(<App />);
  });
}

function key(target: EventTarget, keyName: string, init: KeyboardEventInit = {}) {
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

// Opens a file through the app's hidden <input type="file"> (the browser-dev
// Open path, which works in jsdom).
async function openFile(name: string, content: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input not found");
  const file = new File([content], name, { type: "text/markdown" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function waitFor(cond: () => boolean, what: string) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > 4000) throw new Error(`timeout waiting for ${what}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

function paneOpen(): boolean {
  return container.querySelector(".quillmd-outline") !== null;
}

function storedNavigationPane(): boolean | undefined {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return undefined;
  const map = JSON.parse(raw) as Record<string, { navigationPane?: boolean }>;
  for (const [path, settings] of Object.entries(map)) {
    if (path.endsWith(FILE_NAME)) return settings.navigationPane;
  }
  return undefined;
}

describe("navigation pane App wiring (issue #86)", () => {
  it("Ctrl+Shift+8 toggles the pane for the active document and persists it", async () => {
    await renderApp();
    await openFile(FILE_NAME, DOC);
    await waitFor(() => container.querySelector(".quillmd-tab") !== null, "tab to open");

    // Default: the pane is closed.
    expect(paneOpen()).toBe(false);

    // Toggle on.
    key(window, "8", { ctrlKey: true, shiftKey: true });
    await waitFor(paneOpen, "pane to open");
    expect(paneOpen()).toBe(true);
    expect(storedNavigationPane()).toBe(true);

    // Toggle off.
    key(window, "8", { ctrlKey: true, shiftKey: true });
    await waitFor(() => !paneOpen(), "pane to close");
    expect(paneOpen()).toBe(false);
    expect(storedNavigationPane()).toBe(false);
  });

  it("is a no-op with no active document", async () => {
    await renderApp();
    // No document open: the shortcut must not throw or open a pane.
    key(window, "8", { ctrlKey: true, shiftKey: true });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(paneOpen()).toBe(false);
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
  });
});
