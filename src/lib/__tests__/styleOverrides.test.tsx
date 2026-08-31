// @vitest-environment jsdom
// Modify Style + overrides storage (plan 05 task 5.4, issue #57): the
// Word-style "Modify Style" dialog over the built-in style registry. The
// override keys are markdown types (H2, paragraph, ...) rather than style
// names because several registry names alias one markdown construct; the
// dialog preselects the style under the cursor, previews the draft live
// through the same overridesToCss generator the app uses, and persists
// through the Rust read/write_style_overrides commands (app config dir,
// machine-local). The overrides are view-only CSS scoped to the WYSIWYG and
// preview content containers — the save pipeline never sees them, so a
// modified style can never change a byte of a document (plan 05 AC6).
//
// Coverage: the style-id -> markdown-key map (registry sync + alias
// sharing), the field validators (family free text, closed size enum,
// #rrggbb, weight/italic/spacing) and the corruption tolerance of
// normalizeOverride/normalizeOverrides, the overridesToCss generator
// (AC3's Georgia/18pt H2 rule, mark vs block keys, the inline-code
// selector), the storage bridge (Tauri invoke + localStorage dev
// fallback), the ModifyStyleDialog component (prefill, live preview,
// style switching, Enter/Esc, reset style / reset all), and a full-App
// menu-event e2e: AC3 (modify H2 to Georgia 18pt restyles every H2 live,
// document bytes untouched), restart persistence, and the reset-all flow.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import App from "../../App";
import ModifyStyleDialog from "../../components/ModifyStyleDialog";
import { currentFindEditor } from "../find";
import { tiptapToMarkdown } from "../pm";
import { BUILT_IN_STYLES } from "../styles";
import {
  BLOCK_OVERRIDE_KEYS,
  MODIFY_STYLE_MENU_ID,
  STYLE_OVERRIDE_KEYS,
  isOverrideKey,
  loadStyleOverrides,
  normalizeFontFamily,
  normalizeOverride,
  normalizeOverrides,
  overridesToCss,
  saveStyleOverrides,
  styleKeyForStyleId,
} from "../styleOverrides";
import type { StyleOverrides } from "../styleOverrides";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- helpers ----------------------------------------------------------------

function setControl(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  // React tracks controlled values through the native setter; dispatch the
  // event React's onChange normalizes from (input for text, change for
  // selects).
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}

function click(element: HTMLElement): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// --- styleKeyForStyleId: registry sync + alias sharing -----------------------

describe("styleKeyForStyleId (issue #57)", () => {
  it("maps every built-in style id to a markdown override key", () => {
    for (const style of BUILT_IN_STYLES) {
      const key = styleKeyForStyleId(style.id);
      expect(key, `style ${style.id} must map to a key`).not.toBeNull();
      expect(isOverrideKey(key!), `key for ${style.id} is a valid override key`).toBe(true);
    }
  });

  it("aliases of one markdown construct share its key (the honest mapping)", () => {
    // Title and Heading 1 are both H1; Subtitle and Heading 2 are both H2;
    // Normal and No Spacing are both plain paragraphs.
    expect(styleKeyForStyleId("title")).toBe("h1");
    expect(styleKeyForStyleId("heading1")).toBe("h1");
    expect(styleKeyForStyleId("subtitle")).toBe("h2");
    expect(styleKeyForStyleId("heading2")).toBe("h2");
    expect(styleKeyForStyleId("normal")).toBe("paragraph");
    expect(styleKeyForStyleId("no-spacing")).toBe("paragraph");
    expect(styleKeyForStyleId("quote")).toBe("blockquote");
    expect(styleKeyForStyleId("intense-quote")).toBe("intenseQuote");
    expect(styleKeyForStyleId("list-paragraph")).toBe("listItem");
    expect(styleKeyForStyleId("source-code")).toBe("codeBlock");
    expect(styleKeyForStyleId("code")).toBe("inlineCode");
    expect(styleKeyForStyleId("emphasis")).toBe("em");
    expect(styleKeyForStyleId("strong")).toBe("strong");
  });

  it("returns null for unknown style ids", () => {
    expect(styleKeyForStyleId("nope")).toBeNull();
    expect(styleKeyForStyleId("")).toBeNull();
  });
});

// --- normalizeFontFamily: validated free text --------------------------------

describe("normalizeFontFamily (issue #57)", () => {
  it("accepts bare names, names with spaces, quoted names, and stacks", () => {
    expect(normalizeFontFamily("Georgia")).toBe("Georgia");
    expect(normalizeFontFamily("  Georgia  ")).toBe("Georgia");
    expect(normalizeFontFamily("Comic Sans MS")).toBe("Comic Sans MS");
    expect(normalizeFontFamily('"Times New Roman"')).toBe('"Times New Roman"');
    expect(normalizeFontFamily("'Times New Roman'")).toBe("'Times New Roman'");
    expect(normalizeFontFamily('Georgia, "Times New Roman", serif')).toBe(
      'Georgia, "Times New Roman", serif',
    );
  });

  it("rejects empty, malformed, and CSS-injection payloads", () => {
    expect(normalizeFontFamily("")).toBeNull();
    expect(normalizeFontFamily("   ")).toBeNull();
    expect(normalizeFontFamily("a,")).toBeNull(); // empty part
    expect(normalizeFontFamily("a,,b")).toBeNull(); // empty part
    expect(normalizeFontFamily("x; } body { color: red")).toBeNull();
    expect(normalizeFontFamily("a{color:red}")).toBeNull();
    expect(normalizeFontFamily("a b; c")).toBeNull();
    expect(normalizeFontFamily("a".repeat(121))).toBeNull(); // overlong
  });
});

// --- normalizeOverride / normalizeOverrides: corruption tolerance -------------

describe("normalizeOverride (issue #57)", () => {
  it("keeps a valid full record for a block key", () => {
    expect(
      normalizeOverride("h2", {
        fontFamily: "Georgia",
        fontSize: "18pt",
        color: "#AA66CC",
        fontWeight: "bold",
        fontStyle: "italic",
        spacing: "relaxed",
      }),
    ).toEqual({
      fontFamily: "Georgia",
      fontSize: "18pt",
      color: "#aa66cc",
      fontWeight: "bold",
      fontStyle: "italic",
      spacing: "relaxed",
    });
  });

  it("drops invalid field values and unknown fields", () => {
    expect(
      normalizeOverride("h2", {
        fontFamily: "x; } body { color: red",
        fontSize: "99pt", // off the closed enum
        color: "red", // not #rrggbb
        fontWeight: "heavy",
        fontStyle: "oblique",
        spacing: "wide",
        bogus: 1,
      }),
    ).toEqual({});
  });

  it("drops spacing for mark keys (marks have no margins of their own)", () => {
    expect(normalizeOverride("em", { fontStyle: "italic", spacing: "compact" })).toEqual({
      fontStyle: "italic",
    });
    expect(normalizeOverride("paragraph", { spacing: "compact" })).toEqual({
      spacing: "compact",
    });
  });

  it("normalizes corrupt raw records to an empty override", () => {
    expect(normalizeOverride("h2", "nope")).toEqual({});
    expect(normalizeOverride("h2", null)).toEqual({});
    expect(normalizeOverride("h2", 42)).toEqual({});
  });
});

describe("normalizeOverrides (issue #57)", () => {
  it("keeps the known keys, drops unknown keys and empty records", () => {
    expect(
      normalizeOverrides({
        h2: { fontFamily: "Georgia" },
        em: {}, // empty record: nothing to apply
        bogus: { fontFamily: "X" },
        "h99": { fontSize: "12pt" },
      }),
    ).toEqual({ h2: { fontFamily: "Georgia" } });
  });

  it("normalizes non-object payloads to an empty set", () => {
    expect(normalizeOverrides(null)).toEqual({});
    expect(normalizeOverrides("nope")).toEqual({});
    expect(normalizeOverrides([1, 2])).toEqual({});
  });
});

// --- overridesToCss: the view-only stylesheet ---------------------------------

describe("overridesToCss (issue #57)", () => {
  const scopes = [".quillmd-prosemirror", ".quillmd-preview-content"];

  it("renders AC3's H2 override (Georgia 18pt) scoped to every content surface", () => {
    const css = overridesToCss(
      { h2: { fontFamily: "Georgia", fontSize: "18pt" } } satisfies StyleOverrides,
      scopes,
    );
    expect(css).toContain(
      ".quillmd-prosemirror h2, .quillmd-preview-content h2 { font-family: Georgia; font-size: 18pt; }",
    );
  });

  it("renders block spacing as margins and mark keys without margins", () => {
    const css = overridesToCss(
      {
        paragraph: { spacing: "compact" },
        h1: { spacing: "relaxed" },
        strong: { fontWeight: "bold" },
      } satisfies StyleOverrides,
      scopes,
    );
    expect(css).toContain("margin-top: 0.1em; margin-bottom: 0.1em;");
    expect(css).toContain("margin-top: 1.2em; margin-bottom: 1.2em;");
    const strongRule = css.split("\n").find((l) => l.includes("strong {"));
    expect(strongRule).toBeDefined();
    expect(strongRule!).not.toContain("margin");
  });

  it("uses the inline-code selector that excludes fenced code", () => {
    const css = overridesToCss(
      { inlineCode: { color: "#ff0000" } } satisfies StyleOverrides,
      scopes,
    );
    expect(css).toContain(":not(pre) > code { color: #ff0000; }");
  });

  it("renders nothing for an empty set or an all-default record", () => {
    expect(overridesToCss({}, scopes)).toBe("");
    expect(
      overridesToCss({ h2: { fontFamily: undefined, fontSize: undefined } } satisfies StyleOverrides, scopes),
    ).toBe("");
  });

  it("the closed size enum and every key have a selector (no dead keys)", () => {
    expect(STYLE_OVERRIDE_KEYS).toHaveLength(14);
    for (const key of STYLE_OVERRIDE_KEYS) {
      // Every key renders a rule when given a declaration.
      const css = overridesToCss({ [key]: { color: "#123456" } } as StyleOverrides, scopes);
      expect(css, `key ${key} renders a rule`).toContain("color: #123456;");
    }
    // The size enum is a closed set (18pt is AC3's pick).
    expect(BLOCK_OVERRIDE_KEYS.length).toBeLessThan(STYLE_OVERRIDE_KEYS.length);
  });
});

// --- storage bridge: Tauri invoke + localStorage dev fallback -----------------

describe("storage bridge (issue #57)", () => {
  const g = globalThis as Record<string, unknown>;

  afterEach(() => {
    clearMocks();
    delete g.isTauri;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("round-trips through localStorage in browser dev (no Rust layer)", async () => {
    const overrides: StyleOverrides = { h2: { fontFamily: "Georgia", fontSize: "18pt" } };
    await act(async () => {
      await saveStyleOverrides(overrides);
    });
    expect(JSON.parse(localStorage.getItem("quillmd.styleOverrides")!)).toEqual(overrides);

    const loaded = await act(async () => await loadStyleOverrides());
    expect(loaded).toEqual(overrides);
  });

  it("loads an empty set when nothing is stored or the payload is corrupt", async () => {
    expect(await loadStyleOverrides()).toEqual({});
    localStorage.setItem("quillmd.styleOverrides", "not json {");
    expect(await loadStyleOverrides()).toEqual({});
  });

  it("talks to the Rust commands under Tauri (read/write_style_overrides)", async () => {
    g.isTauri = true;
    const store = { json: '{"h2":{"fontFamily":"Georgia","fontSize":"18pt"}}' };
    mockIPC((cmd, payload) => {
      if (cmd === "read_style_overrides") return store.json;
      if (cmd === "write_style_overrides") {
        store.json = (payload as { json: string }).json;
        return undefined;
      }
      return undefined;
    });

    const loaded = await act(async () => await loadStyleOverrides());
    expect(loaded).toEqual({ h2: { fontFamily: "Georgia", fontSize: "18pt" } });

    await act(async () => {
      await saveStyleOverrides({ h1: { fontWeight: "bold" } });
    });
    expect(JSON.parse(store.json)).toEqual({ h1: { fontWeight: "bold" } });
  });

  it("a corrupt Tauri payload normalizes instead of throwing", async () => {
    g.isTauri = true;
    mockIPC((cmd) => {
      if (cmd === "read_style_overrides") return "{ definitely not json";
      return undefined;
    });
    expect(await loadStyleOverrides()).toEqual({});
  });
});

// --- ModifyStyleDialog component -----------------------------------------------

describe("ModifyStyleDialog (issue #57)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    container.remove();
    // Same jsdom stylesheet-leak guard as the e2e suite below.
    for (const s of Array.from(document.querySelectorAll("style"))) s.remove();
  });

  function renderDialog(
    props: Partial<React.ComponentProps<typeof ModifyStyleDialog>> = {},
  ): {
    onApply: ReturnType<typeof vi.fn>;
    onResetAll: ReturnType<typeof vi.fn>;
    onClose: ReturnType<typeof vi.fn>;
  } {
    const onApply = vi.fn();
    const onResetAll = vi.fn();
    const onClose = vi.fn();
    const r = createRoot(container);
    root = r;
    act(() => {
      r.render(
        <ModifyStyleDialog
          initialKey="h2"
          overrides={{}}
          onApply={onApply}
          onResetAll={onResetAll}
          onClose={onClose}
          {...props}
        />,
      );
    });
    return { onApply, onResetAll, onClose };
  }

  const dialog = () => container.querySelector(".quillmd-modify-dialog")!;
  const field = (name: string): HTMLElement | null =>
    container.querySelector<HTMLElement>(`[data-field="${name}"]`);
  const previewCss = (): string =>
    container.querySelector(".quillmd-modify-preview style")!.textContent ?? "";
  const buttonByLabel = (label: string): HTMLButtonElement => {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === label,
    );
    expect(button, `button "${label}"`).not.toBeUndefined();
    return button!;
  };

  it("opens on the style that owns the initial key (Heading 2 for h2)", () => {
    renderDialog();
    // heading2 precedes its alias subtitle in the registry order.
    expect((field("style") as HTMLSelectElement).value).toBe("heading2");
    expect(dialog().querySelector(".quillmd-modify-hint")!.textContent).toContain(
      "Heading 2 is H2 in markdown",
    );
    // Block keys offer spacing; the sample shows the H2 construct.
    expect(field("spacing")).not.toBeNull();
    expect(container.querySelector(".quillmd-modify-preview h2")!.textContent).toBe(
      "Heading two",
    );
  });

  it("mark keys hide the spacing field", () => {
    renderDialog({ initialKey: "em" });
    expect((field("style") as HTMLSelectElement).value).toBe("emphasis");
    expect(field("spacing")).toBeNull();
  });

  it("prefills the fields from the stored override", () => {
    renderDialog({
      overrides: {
        h2: { fontFamily: "Georgia", fontSize: "18pt", color: "#3c3c3c", fontStyle: "italic" },
      },
    });
    expect((field("family") as HTMLInputElement).value).toBe("Georgia");
    expect((field("size") as HTMLSelectElement).value).toBe("18pt");
    expect((field("use-color") as HTMLInputElement).checked).toBe(true);
    expect((field("italic") as HTMLInputElement).checked).toBe(true);
    expect(previewCss()).toContain("font-family: Georgia;");
  });

  it("previews the draft live: Georgia 18pt on H2 (AC3 preview)", () => {
    renderDialog();
    expect(previewCss()).not.toContain("font-family: Georgia;");
    setControl(field("family") as HTMLInputElement, "Georgia");
    setControl(field("size") as HTMLSelectElement, "18pt");
    expect(previewCss()).toContain(
      ".quillmd-modify-preview h2 { font-family: Georgia; font-size: 18pt; }",
    );
  });

  it("rejects an invalid family in the live draft (the preview matches what OK persists)", () => {
    renderDialog();
    setControl(field("family") as HTMLInputElement, "x; } body { color: red");
    expect(previewCss()).toBe("");
  });

  it("switching the style select loads that style's stored override", () => {
    renderDialog({
      overrides: {
        h2: { fontFamily: "Georgia" },
        h1: { fontWeight: "bold" },
      },
    });
    expect((field("family") as HTMLInputElement).value).toBe("Georgia");
    setControl(field("style") as HTMLSelectElement, "heading1");
    expect((field("family") as HTMLInputElement).value).toBe("");
    expect((field("weight") as HTMLSelectElement).value).toBe("bold");
    // The preview now shows the H1 sample with the bold draft.
    expect(container.querySelector(".quillmd-modify-preview h1")).not.toBeNull();
    expect(previewCss()).toContain("font-weight: bold;");
  });

  it("OK persists the normalized override (an empty draft resets the style)", () => {
    const first = renderDialog();
    setControl(field("family") as HTMLInputElement, "Georgia");
    setControl(field("size") as HTMLSelectElement, "18pt");
    click(container.querySelector('button[type="submit"]')!);
    expect(first.onApply).toHaveBeenCalledWith("h2", {
      fontFamily: "Georgia",
      fontSize: "18pt",
    });

    // Reset style then OK -> an empty override (the per-style reset flow).
    act(() => root!.unmount());
    root = null;
    const second = renderDialog({ overrides: { h2: { fontFamily: "Georgia" } } });
    click(buttonByLabel("Reset style"));
    expect((field("family") as HTMLInputElement).value).toBe("");
    click(container.querySelector('button[type="submit"]')!);
    expect(second.onApply).toHaveBeenCalledWith("h2", {});
  });

  it("Reset all only renders when overrides exist, and fires onResetAll", () => {
    const empty = renderDialog();
    expect(container.querySelector("button.quillmd-modify-button.danger")).toBeNull();
    expect(empty.onResetAll).not.toHaveBeenCalled();

    const withOverrides = renderDialog({ overrides: { h2: { fontFamily: "Georgia" } } });
    const danger = container.querySelector<HTMLElement>("button.quillmd-modify-button.danger")!;
    expect(danger.textContent).toBe("Reset all");
    click(danger);
    expect(withOverrides.onResetAll).toHaveBeenCalled();
  });

  it("Esc cancels; Enter submits (selects and buttons keep their Enter)", () => {
    const first = renderDialog();
    act(() => {
      dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(first.onClose).toHaveBeenCalled();
    expect(first.onApply).not.toHaveBeenCalled();

    const second = renderDialog();
    setControl(field("family") as HTMLInputElement, "Georgia");
    act(() => {
      dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(second.onApply).toHaveBeenCalledWith("h2", { fontFamily: "Georgia" });
    expect(second.onClose).not.toHaveBeenCalled();
  });

  it("Cancel closes without applying", () => {
    const { onApply, onClose } = renderDialog();
    setControl(field("family") as HTMLInputElement, "Georgia");
    click(buttonByLabel("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});

// --- full App menu-event e2e (Tauri mock) --------------------------------------

describe("App menu-event e2e: Modify Style (issue #57, plan 05 AC3)", () => {
  const g = globalThis as Record<string, unknown>;
  let container: HTMLDivElement;
  let root: Root | null = null;
  let store: { json: string };

  beforeEach(() => {
    localStorage.clear();
    g.isTauri = true;
    // The machine-local store the Rust commands would back: one payload
    // survives the app "restart" (remount) inside a single test.
    store = { json: "{}" };
    mockIPC(
      (cmd, payload) => {
        if (cmd === "get_recent_files") return [];
        if (cmd === "read_style_overrides") return store.json;
        if (cmd === "write_style_overrides") {
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
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    clearMocks();
    delete g.isTauri;
    container.remove();
    // jsdom keeps the CSSStyleSheet of a removed <style> element in
    // document.styleSheets (it does not re-walk the tree), so the AC3 test's
    // override rules would otherwise leak into this test's getComputedStyle
    // cascade. Purge every style node the shared document still holds.
    for (const s of Array.from(document.querySelectorAll("style"))) s.remove();
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

  function docMd(): string {
    const editor = currentFindEditor();
    if (!editor) throw new Error("no live editor");
    return tiptapToMarkdown(editor.getJSON());
  }

  function cursorAfterCurrentText(text: string): void {
    const editor = currentFindEditor();
    if (!editor) throw new Error("no live editor");
    let found = false;
    editor.state.doc.descendants((node, pos) => {
      if (found || !node.isText) return true;
      const idx = node.text!.indexOf(text);
      if (idx === -1) return true;
      found = true;
      editor.chain().setTextSelection(pos + idx + text.length).run();
      return false;
    });
    expect(found, `text ${text} not found in doc`).toBe(true);
  }

  async function emitMenu(id: string): Promise<void> {
    await act(async () => {
      await emit("menu-event", id);
    });
  }

  // The app's injected, view-only override stylesheet (the direct <style>
  // child of <main>; the dialog's preview style is nested deeper).
  function injectedCss(): string {
    return container.querySelector("main.quillmd-app > style")!.textContent ?? "";
  }

  async function openModifyDialog(): Promise<void> {
    await emitMenu(MODIFY_STYLE_MENU_ID);
    await waitFor(() => container.querySelector(".quillmd-modify-dialog") !== null, "dialog");
  }

  // NOTE: this test must run before the AC3 test below. jsdom keeps the
  // CSSStyleSheet of a <style> element whose subtree was removed from the
  // document in document.styleSheets (it never re-walks the tree), so the
  // AC3 test's ".quillmd-prosemirror h2 { Georgia }" sheet would otherwise
  // leak into this test's getComputedStyle cascade and fake a failed reset.
  // Within one test the App's <style> element is reused (React updates its
  // text), and jsdom tracks text updates on a live sheet correctly.
  it("Reset all clears every override (the global reset flow) and restores the defaults", async () => {
    await renderApp();
    await openFile("reset.md", "## Headed\n\nBody.\n");
    await waitFor(() => currentFindEditor() !== null, "live editor");
    const before = docMd();

    // Apply an H2 override first.
    cursorAfterCurrentText("Headed");
    await openModifyDialog();
    setControl(container.querySelector('[data-field="family"]') as HTMLInputElement, "Georgia");
    await act(async () => {
      click(container.querySelector('button[type="submit"]')!);
    });
    expect(injectedCss()).toContain("font-family: Georgia;");

    // Reset all (the app confirms; the mock default is true).
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await openModifyDialog();
    await act(async () => {
      click(container.querySelector("button.quillmd-modify-button.danger")!);
    });
    expect(JSON.parse(store.json)).toEqual({});
    expect(injectedCss()).toBe("");
    expect(container.querySelector(".quillmd-modify-dialog")).toBeNull();
    const h2 = container.querySelector(".quillmd-prosemirror h2")!;
    expect(window.getComputedStyle(h2).fontFamily).not.toBe("Georgia");
    expect(docMd()).toBe(before);
  });

  it("AC3: Modify Style on H2 (Georgia, 18pt) restyles every H2 live, leaves the document bytes untouched, and persists", async () => {
    await renderApp();
    await openFile("ac3.md", "## First heading\n\nSome text.\n\n## Second heading\n");
    await waitFor(() => currentFindEditor() !== null, "live editor");
    const before = docMd();
    expect(before).toBe("## First heading\n\nSome text.\n\n## Second heading\n");

    // Cursor on the first H2 -> the dialog opens on Heading 2.
    cursorAfterCurrentText("First heading");
    await openModifyDialog();
    expect((container.querySelector('[data-field="style"]') as HTMLSelectElement).value).toBe(
      "heading2",
    );

    // Georgia + 18pt + OK (AC3's exact pick).
    setControl(container.querySelector('[data-field="family"]') as HTMLInputElement, "Georgia");
    setControl(container.querySelector('[data-field="size"]') as HTMLSelectElement, "18pt");
    await act(async () => {
      click(container.querySelector('button[type="submit"]')!);
    });

    // The dialog closed and the override persisted through the Rust command.
    expect(container.querySelector(".quillmd-modify-dialog")).toBeNull();
    expect(JSON.parse(store.json)).toEqual({ h2: { fontFamily: "Georgia", fontSize: "18pt" } });

    // The view-only CSS is injected, scoped to both content surfaces.
    expect(injectedCss()).toContain(
      ".quillmd-prosemirror h2, .quillmd-preview-content h2 { font-family: Georgia; font-size: 18pt; }",
    );

    // Every H2 in the live editor is restyled (jsdom cascades the <style>).
    const headings = container.querySelectorAll(".quillmd-prosemirror h2");
    expect(headings.length).toBe(2);
    for (const h of headings) {
      const cs = window.getComputedStyle(h);
      expect(cs.fontFamily).toBe("Georgia");
      expect(cs.fontSize).toBe("24px"); // 18pt
    }

    // AC6: the document bytes never moved — no style markup on disk.
    expect(docMd()).toBe(before);

    // Restart persistence: remount the app, the override comes back from
    // read_style_overrides and restyles again.
    act(() => root!.unmount());
    root = null;
    await renderApp();
    await openFile("ac3.md", "## First heading\n\nSome text.\n\n## Second heading\n");
    await waitFor(() => currentFindEditor() !== null, "live editor");
    await waitFor(() => injectedCss().includes("font-family: Georgia"), "restored overrides");
    for (const h of container.querySelectorAll(".quillmd-prosemirror h2")) {
      expect(window.getComputedStyle(h).fontFamily).toBe("Georgia");
    }
    expect(docMd()).toBe(before);
  });

  it("opens on Normal when the cursor is on a plain paragraph", async () => {
    await renderApp();
    await openFile("para.md", "Just a paragraph.\n");
    await waitFor(() => currentFindEditor() !== null, "live editor");
    cursorAfterCurrentText("paragraph");
    await openModifyDialog();
    expect((container.querySelector('[data-field="style"]') as HTMLSelectElement).value).toBe(
      "normal",
    );
  });
});
