// @vitest-environment jsdom
// App-level wiring for the find & replace menu + shortcuts (plan 07 task 7.5,
// issue #73): Ctrl+F / Ctrl+H open the panel in find / replace mode, F3 /
// Shift+F3 cycle the active match, Esc closes, the search term is remembered
// per document (restored on a tab switch), and the panel position (top /
// bottom) is a persisted global setting. This renders the full App in jsdom
// and drives it through the same hidden file input and window keydowns the
// browser-dev build uses (no Tauri).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "../../App";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const MEMORY_KEY = "quillmd.findMemory";
const POSITION_KEY = "quillmd.findPanelPosition";

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

// Emits a keydown the way the browser delivers it (bubbling, cancelable) so
// both the panel's own handler and the App's window-level handler see it.
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

// Sets a controlled <input>'s value the way React expects (native value
// setter + input event) so the onChange handler fires.
function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// Opens a file through the app's hidden <input type="file">, the same path the
// browser-dev "Open" uses (fileIo.openFromFile, which works in jsdom).
async function openFile(name: string, content: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input not found");
  const file = new File([content], name, { type: "text/markdown" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

// Polls (inside act, so async state updates flush) until cond() is true.
async function waitFor(cond: () => boolean, what: string) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > 4000) throw new Error(`timeout waiting for ${what}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

function findPanel() {
  return container.querySelector<HTMLElement>(".quillmd-find-panel");
}
function findInput() {
  return container.querySelector<HTMLInputElement>('input[aria-label="Find"]');
}
function findCounter() {
  return container.querySelector<HTMLElement>(".quillmd-find-counter");
}
function modeToggle() {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label="Toggle replace row"]',
  );
}
function tabByName(name: string) {
  return Array.from(container.querySelectorAll<HTMLElement>(".quillmd-tab")).find(
    (t) => t.querySelector(".quillmd-tab-name")?.textContent === name,
  );
}
function clickTab(name: string) {
  const tab = tabByName(name);
  if (!tab) throw new Error(`tab ${name} not found`);
  act(() => {
    tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("App find & replace wiring (plan 07 task 7.5, issue #73)", () => {
  it("Ctrl+F opens the panel in find mode, Ctrl+H in replace mode, Esc closes", async () => {
    await renderApp();
    await openFile("a.md", "hello world hello\n");
    await waitFor(() => !!tabByName("a.md"), "doc a.md tab");
    // The panel is closed before any shortcut.
    expect(findPanel()).toBeNull();

    key(window, "f", { ctrlKey: true });
    await waitFor(() => !!findPanel(), "panel after Ctrl+F");
    expect(modeToggle()?.getAttribute("aria-expanded")).toBe("false");

    key(window, "h", { ctrlKey: true });
    await waitFor(
      () => modeToggle()?.getAttribute("aria-expanded") === "true",
      "replace mode after Ctrl+H",
    );
    // The replace row is now present.
    expect(container.querySelector('input[aria-label="Replace with"]')).not.toBeNull();

    key(window, "Escape");
    await waitFor(() => !findPanel(), "panel closed after Esc");
    expect(findPanel()).toBeNull();
  });

  it("F3 / Shift+F3 move through the active doc's matches (wrapping)", async () => {
    await renderApp();
    await openFile("a.md", "one two one three one\n");
    await waitFor(() => !!tabByName("a.md"), "doc a.md tab");

    key(window, "f", { ctrlKey: true });
    await waitFor(() => !!findInput(), "find input");
    typeInto(findInput()!, "one");
    await waitFor(() => findCounter()?.textContent === "1 of 3", "first match active");

    key(window, "F3");
    await waitFor(() => findCounter()?.textContent === "2 of 3", "second match after F3");
    key(window, "F3");
    await waitFor(() => findCounter()?.textContent === "3 of 3", "third match after F3");
    key(window, "F3");
    await waitFor(() => findCounter()?.textContent === "1 of 3", "wrap to first match");

    key(window, "F3", { shiftKey: true });
    await waitFor(() => findCounter()?.textContent === "3 of 3", "back to third on Shift+F3");
  });

  it("remembers the search term per document and restores it on a tab switch", async () => {
    await renderApp();
    await openFile("a.md", "alpha beta alpha\n");
    await openFile("b.md", "gamma delta gamma\n");
    await waitFor(() => !!tabByName("a.md") && !!tabByName("b.md"), "both doc tabs");

    // b.md was opened last, so it is active. Switch to a.md and search there.
    clickTab("a.md");
    key(window, "f", { ctrlKey: true });
    await waitFor(() => !!findInput(), "find input on a.md");
    typeInto(findInput()!, "alpha");
    await waitFor(() => findInput()!.value === "alpha", "term typed on a.md");
    // a.md now remembers the term; b.md has no memory yet.
    const stored = JSON.parse(localStorage.getItem(MEMORY_KEY)!) as Record<
      string,
      { term: string }
    >;
    expect(stored["a.md"]?.term).toBe("alpha");
    expect(stored["b.md"]?.term ?? "").toBe("");

    // Switch to b.md: its (empty) memory restores, so the term clears.
    clickTab("b.md");
    await waitFor(() => findInput() !== null && findInput()!.value === "", "term cleared on b.md");

    // Switch back to a.md: its remembered term restores.
    clickTab("a.md");
    await waitFor(
      () => findInput() !== null && findInput()!.value === "alpha",
      "term restored on a.md",
    );
    expect(findInput()!.value).toBe("alpha");
  });

  it("persists the panel position and restores it on a fresh render", async () => {
    await renderApp();
    await openFile("a.md", "hello hello\n");
    await waitFor(() => !!tabByName("a.md"), "doc a.md tab");

    key(window, "f", { ctrlKey: true });
    await waitFor(() => !!findPanel(), "find panel");
    // Default: docked at the top (no bottom class).
    expect(findPanel()!.classList.contains("bottom")).toBe(false);
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Move find panel to bottom"]'),
    ).not.toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Move find panel to bottom"]')!
        .click();
    });
    await waitFor(() => findPanel()!.classList.contains("bottom"), "bottom class applied");
    expect(localStorage.getItem(POSITION_KEY)).toBe('"bottom"');
    // The button now offers to move back to the top.
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Move find panel to top"]'),
    ).not.toBeNull();

    // A fresh App instance restores the bottom position from localStorage.
    act(() => root!.unmount());
    root = null;
    await renderApp();
    await openFile("a.md", "hello hello\n");
    await waitFor(() => !!tabByName("a.md"), "doc a.md tab (fresh instance)");
    key(window, "f", { ctrlKey: true });
    await waitFor(() => !!findPanel(), "find panel (fresh instance)");
    expect(findPanel()!.classList.contains("bottom")).toBe(true);
  });
});
