// @vitest-environment jsdom
// Color palette component (plan 04 task 4.2, issue #48): the shared 24-color
// grid + Auto + custom popover, the fontColor / highlightColor registry
// commands behind the two pickers, and the toolbar wiring that renders both
// pickers through the one shared component.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { FontColorMark, QuillHighlight } from "../../components/Editor";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import {
  COLOR_AUTO,
  COLOR_PALETTE,
  COLOR_PALETTE_COLUMNS,
  isPaletteColor,
  normalizeColor,
} from "../colors";
import type { ColorPick } from "../colors";
import {
  editorCommandActive,
  fontColorOf,
  highlightColorOf,
  runEditorCommand,
} from "../editorCommands";
import ColorPalette from "../../components/ColorPalette";
import type { ColorPaletteProps } from "../../components/ColorPalette";
import Toolbar from "../../components/Toolbar";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];

function makeEditor(markdown = "Hello world"): Editor {
  return new Editor({
    // The same inline-mark extensions the app editor (Editor.tsx) registers
    // for this feature: the fontColor mark and the colored highlight.
    extensions: [StarterKit, QuillHighlight, FontColorMark],
    content: markdownToTiptap(markdown),
  });
}

// Select the first occurrence of `text` so the color command acts
// deterministically.
function selectText(editor: Editor, text: string): void {
  let found = false;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    found = true;
    editor.chain().setTextSelection({ from: pos + idx, to: pos + idx + text.length }).run();
    return false;
  });
  expect(found).toBe(true);
}

function md(editor: Editor): string {
  return tiptapToMarkdown(editor.getJSON());
}

function click(element: HTMLElement): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// jsdom (and some browsers) serialize CSS colors as rgb(...) rather than the
// hex we set; read the expected color through the same CSSOM so the compare
// is environment-stable.
function cssColor(hex: string): string {
  const el = document.createElement("span");
  el.style.background = hex;
  return el.style.background;
}

// Set a controlled input's value the way the browser does when the native
// color picker commits: via the native value setter (so React's value tracker
// sees a real change) + an input event (what React's onChange listens to).
function setInputValue(input: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// --- colors.ts: palette data + helpers -------------------------------------

describe("colors.ts palette", () => {
  it("offers the 24 standard swatches in rows of 6", () => {
    expect(COLOR_PALETTE).toHaveLength(24);
    expect(COLOR_PALETTE_COLUMNS).toBe(6);
    expect(24 % COLOR_PALETTE_COLUMNS).toBe(0);
    for (const color of COLOR_PALETTE) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(new Set(COLOR_PALETTE).size).toBe(COLOR_PALETTE.length);
  });

  it("normalizes hex to lowercase and accepts browser rgb()", () => {
    expect(normalizeColor("#C00000")).toBe("#c00000");
    expect(normalizeColor("#c00000")).toBe("#c00000");
    expect(normalizeColor("rgb(192, 0, 0)")).toBe("#c00000");
    expect(normalizeColor("rgb( 192 , 0 , 0 )")).toBe("#c00000");
  });

  it("rejects values that are not colors", () => {
    for (const value of ["", "red", "#abc", "#1234567", "rgb(300, 0, 0)", "12px"]) {
      expect(normalizeColor(value)).toBeNull();
    }
  });

  it("isPaletteColor only accepts the standard swatches (normalized)", () => {
    expect(isPaletteColor("#c00000")).toBe(true);
    expect(isPaletteColor("#C00000")).toBe(false);
    expect(isPaletteColor("#ff00ff")).toBe(false);
    expect(isPaletteColor(null)).toBe(false);
    expect(isPaletteColor(COLOR_AUTO)).toBe(false);
  });
});

// --- fontColor / highlightColor registry commands --------------------------

describe("fontColor / highlightColor registry commands", () => {
  let editors: Editor[] = [];
  afterEach(() => {
    for (const e of editors) e.destroy();
    editors = [];
  });
  const editor = (markdown?: string): Editor => {
    const e = makeEditor(markdown);
    editors.push(e);
    return e;
  };

  it("fontColor sets the quillmd-font span's color attribute", () => {
    const e = editor();
    selectText(e, "Hello");
    expect(runEditorCommand(e, "fontColor", "#c00000")).toBe(true);
    expect(md(e)).toBe(
      `<span class="quillmd-font" style="color: #c00000">Hello</span> world\n`,
    );
  });

  it("fontColor normalizes a custom (uppercase) hex before it touches the mark", () => {
    const e = editor();
    selectText(e, "Hello");
    expect(runEditorCommand(e, "fontColor", "#C0FFEE")).toBe(true);
    expect(md(e)).toBe(
      `<span class="quillmd-font" style="color: #c0ffee">Hello</span> world\n`,
    );
  });

  it("fontColor 'auto' (null) clears the color back to inherit", () => {
    const e = editor();
    selectText(e, "Hello");
    runEditorCommand(e, "fontColor", "#c00000");
    selectText(e, "Hello");
    expect(runEditorCommand(e, "fontColor", COLOR_AUTO)).toBe(true);
    expect(md(e)).toBe("Hello world\n");
  });

  it("fontColor without a param or with an invalid color is a no-op", () => {
    const e = editor();
    selectText(e, "Hello");
    expect(runEditorCommand(e, "fontColor")).toBe(false);
    selectText(e, "Hello");
    expect(runEditorCommand(e, "fontColor", "not-a-color")).toBe(false);
    expect(md(e)).toBe("Hello world\n");
  });

  it("highlightColor sets a colored quillmd-highlight span", () => {
    const e = editor();
    selectText(e, "Hello");
    expect(runEditorCommand(e, "highlightColor", "#ff00ff")).toBe(true);
    expect(md(e)).toBe(
      `<span class="quillmd-highlight" style="background-color: #ff00ff">Hello</span> world\n`,
    );
  });

  it("highlightColor 'auto' (null) removes the highlight entirely", () => {
    const e = editor();
    selectText(e, "Hello");
    runEditorCommand(e, "highlightColor", "#ff00ff");
    selectText(e, "Hello");
    expect(runEditorCommand(e, "highlightColor", COLOR_AUTO)).toBe(true);
    expect(md(e)).toBe("Hello world\n");
  });

  it("fontColor composes with other marks (bold keeps its own syntax)", () => {
    const e = editor();
    selectText(e, "Hello");
    runEditorCommand(e, "bold");
    runEditorCommand(e, "fontColor", "#c00000");
    expect(md(e)).toBe(
      `<span class="quillmd-font" style="color: #c00000">**Hello**</span> world\n`,
    );
  });

  it("reports active only at a colored selection", () => {
    const e = editor();
    selectText(e, "Hello");
    runEditorCommand(e, "fontColor", "#c00000");
    selectText(e, "Hello");
    expect(editorCommandActive(e, "fontColor")).toBe(true);
    selectText(e, "world");
    expect(editorCommandActive(e, "fontColor")).toBe(false);
    expect(editorCommandActive(e, "highlightColor")).toBe(false);
  });

  it("fontColorOf / highlightColorOf read the color at the selection", () => {
    const e = editor();
    selectText(e, "Hello");
    runEditorCommand(e, "fontColor", "#c00000");
    selectText(e, "world");
    runEditorCommand(e, "highlightColor", "#ff00ff");

    selectText(e, "Hello");
    expect(fontColorOf(e)).toBe("#c00000");
    expect(highlightColorOf(e)).toBeNull();

    selectText(e, "world");
    expect(fontColorOf(e)).toBeNull();
    expect(highlightColorOf(e)).toBe("#ff00ff");
  });
});

// --- ColorPalette component -------------------------------------------------

function renderPalette(props: Partial<ColorPaletteProps>): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      <ColorPalette title="Font color" trigger="A" current={null} onPick={() => {}} {...props} />,
    );
  });
  return container;
}

function swatch(container: HTMLDivElement, color: string): HTMLButtonElement | null {
  return container.querySelector(
    `.quillmd-color-grid button[title="${color}"]`,
  );
}

function openPalette(container: HTMLDivElement): void {
  click(container.querySelector<HTMLButtonElement>('button[title="Font color"]')!);
}

describe("ColorPalette component", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    for (const root of roots) root.unmount();
    roots = [];
  });

  it("renders the trigger closed, and opens the 24-swatch grid + Auto + custom", () => {
    const container = renderPalette({});
    expect(container.querySelector(".quillmd-color-popover")).toBeNull();

    openPalette(container);

    const popover = container.querySelector<HTMLElement>(".quillmd-color-popover");
    expect(popover).not.toBeNull();
    expect(popover!.querySelectorAll(".quillmd-color-grid button")).toHaveLength(24);
    expect(popover!.querySelector('button[title="Auto"]')).not.toBeNull();
    expect(popover!.querySelector('.quillmd-color-custom input[type="color"]')).not.toBeNull();
  });

  it("a swatch pick applies the color and closes the popover", () => {
    const picks: ColorPick[] = [];
    const container = renderPalette({ onPick: (c) => picks.push(c) });
    openPalette(container);
    click(swatch(container, "#c00000")!);
    expect(picks).toEqual(["#c00000"]);
    expect(container.querySelector(".quillmd-color-popover")).toBeNull();
  });

  it("the Auto cell picks null (inherit / no color)", () => {
    const picks: ColorPick[] = [];
    const container = renderPalette({ onPick: (c) => picks.push(c) });
    openPalette(container);
    click(container.querySelector<HTMLButtonElement>('button[title="Auto"]')!);
    expect(picks).toEqual([null]);
  });

  it("marks the swatch matching the current color (the Auto cell when null)", () => {
    const container = renderPalette({ current: "#c00000" });
    openPalette(container);
    const active = container.querySelectorAll(".quillmd-color-active");
    expect(active).toHaveLength(1);
    expect(active[0]).toBe(swatch(container, "#c00000"));

    // current === null marks the Auto cell instead.
    const c2 = renderPalette({ current: COLOR_AUTO });
    openPalette(c2);
    const auto2 = c2.querySelector<HTMLButtonElement>('button[title="Auto"]')!;
    expect(auto2.classList.contains("quillmd-color-active")).toBe(true);
    expect(c2.querySelectorAll(".quillmd-color-active")).toHaveLength(1);
  });

  it("shows the current color as a bar under the trigger glyph", () => {
    const container = renderPalette({ current: "#c00000" });
    const bar = container.querySelector<HTMLElement>(".quillmd-color-bar");
    expect(bar).not.toBeNull();
    expect(bar!.style.background).toBe(cssColor("#c00000"));

    const c2 = renderPalette({ current: null });
    expect(c2.querySelector(".quillmd-color-bar")).toBeNull();
  });

  it("the custom row applies the native color input's value", () => {
    const picks: ColorPick[] = [];
    const container = renderPalette({ onPick: (c) => picks.push(c) });
    openPalette(container);
    const input = container.querySelector<HTMLInputElement>(".quillmd-color-custom input")!;
    setInputValue(input, "#123456");
    expect(picks).toEqual(["#123456"]);
    expect(container.querySelector(".quillmd-color-popover")).toBeNull();
  });

  it("closes on an outside click and on Escape (without picking)", () => {
    const picks: ColorPick[] = [];
    const container = renderPalette({ onPick: (c) => picks.push(c) });
    openPalette(container);
    expect(container.querySelector(".quillmd-color-popover")).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(container.querySelector(".quillmd-color-popover")).toBeNull();
    expect(picks).toEqual([]);

    // Re-open, then close with Escape.
    openPalette(container);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector(".quillmd-color-popover")).toBeNull();
    expect(picks).toEqual([]);
  });
});

// --- toolbar wiring ---------------------------------------------------------

describe("toolbar color pickers (issue #48)", () => {
  let editors: Editor[] = [];
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    for (const root of roots) root.unmount();
    roots = [];
    for (const e of editors) e.destroy();
    editors = [];
  });
  const editor = (markdown = "Hello world"): Editor => {
    const e = makeEditor(markdown);
    editors.push(e);
    return e;
  };

  function renderToolbar(e: Editor): HTMLDivElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<Toolbar editor={e} />);
    });
    return container;
  }

  it("renders both pickers after the inline marks, and no plain Highlight toggle", () => {
    const container = renderToolbar(editor());
    const titles = Array.from(container.querySelectorAll("button")).map((b) =>
      b.getAttribute("title"),
    );
    const fontIdx = titles.indexOf("Font color");
    const hlIdx = titles.indexOf("Highlight color");
    expect(fontIdx).toBeGreaterThan(-1);
    expect(hlIdx).toBe(fontIdx + 1);
    // The pickers sit between the inline-mark group and the block group.
    expect(titles[fontIdx - 1]).toBe("Superscript");
    expect(titles[hlIdx + 1]).toBe("Link (Ctrl+K)");
    // The old plain highlight toggle button is gone from the toolbar.
    expect(titles).not.toContain("Highlight");
  });

  it("picking a swatch through the font palette applies a colored font span", async () => {
    const e = editor();
    selectText(e, "Hello");
    const container = renderToolbar(e);
    click(container.querySelector<HTMLButtonElement>('button[title="Font color"]')!);
    expect(md(e)).toBe("Hello world\n");

    click(swatch(container, "#c00000")!);
    expect(md(e)).toBe(
      `<span class="quillmd-font" style="color: #c00000">Hello</span> world\n`,
    );
    expect(container.querySelector(".quillmd-color-popover")).toBeNull();
  });

  it("picking a swatch through the highlight palette applies a colored highlight", async () => {
    const e = editor();
    selectText(e, "world");
    const container = renderToolbar(e);
    click(container.querySelector<HTMLButtonElement>('button[title="Highlight color"]')!);
    click(swatch(container, "#ffc000")!);
    expect(md(e)).toBe(
      `Hello <span class="quillmd-highlight" style="background-color: #ffc000">world</span>\n`,
    );
  });

  it("the trigger bar shows the color at the caret (and none for auto)", () => {
    const e = editor();
    selectText(e, "Hello");
    runEditorCommand(e, "fontColor", "#c00000");
    const container = renderToolbar(e);
    const bars = container.querySelectorAll<HTMLElement>(".quillmd-color-bar");
    expect(bars).toHaveLength(1);
    expect(bars[0].style.background).toBe(cssColor("#c00000"));
  });
});
