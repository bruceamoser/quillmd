// @vitest-environment jsdom
// Font toolbar cluster (plan 04 task 4.3, issue #49): the fontFamily /
// fontSize registry commands behind the family and size selects, and the
// toolbar wiring that renders the selects (Normal + the curated families +
// Custom…, Normal + Word's 14 sizes) right of the heading select, before
// the inline-mark group. The color/highlight pickers in the same cluster
// are covered by colorpalette.test.tsx (issue #48).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { FontColorMark, FontFamilyMark, FontSizeMark } from "../../components/Editor";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import {
  EDITOR_COMMANDS,
  FONT_FAMILY_CUSTOM,
  FONT_FAMILIES,
  FONT_SIZES,
  editorCommandActive,
  fontFamilyOf,
  fontSizeOf,
  runEditorCommand,
} from "../editorCommands";
import Toolbar from "../../components/Toolbar";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];
let editors: Editor[] = [];

function makeEditor(markdown = "Hello world"): Editor {
  return new Editor({
    // The same font marks the app editor (Editor.tsx) registers.
    extensions: [StarterKit, FontFamilyMark, FontSizeMark, FontColorMark],
    content: markdownToTiptap(markdown),
  });
}

// Select the first occurrence of `text` so the commands act deterministically.
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

// Set a controlled <select>'s value the way the browser does on a pick:
// assign the value, then fire the change event React listens to.
function setSelectValue(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function trackedEditor(markdown = "Hello world"): Editor {
  const editor = makeEditor(markdown);
  editors.push(editor);
  return editor;
}

function renderToolbar(editor: Editor): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(<Toolbar editor={editor} />);
  });
  return container;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  for (const root of roots) root.unmount();
  roots = [];
  for (const editor of editors) editor.destroy();
  editors = [];
});

// --- fontFamily / fontSize registry commands -------------------------------

describe("fontFamily / fontSize registry commands", () => {
  it("registers both command ids exactly once", () => {
    const ids = EDITOR_COMMANDS.map((cmd) => cmd.id);
    expect(ids.filter((x) => x === "fontFamily")).toHaveLength(1);
    expect(ids.filter((x) => x === "fontSize")).toHaveLength(1);
  });

  it("fontFamily sets the quillmd-font span's font-family attribute", () => {
    const e = trackedEditor();
    selectText(e, "Hello");
    expect(runEditorCommand(e, "fontFamily", "Georgia")).toBe(true);
    expect(md(e)).toBe(
      `<span class="quillmd-font" style="font-family: Georgia">Hello</span> world\n`,
    );
  });

  it("fontFamily trims the name and rejects empty or missing values", () => {
    const e = trackedEditor();
    selectText(e, "Hello");
    expect(runEditorCommand(e, "fontFamily", "  Georgia  ")).toBe(true);
    expect(md(e)).toBe(
      `<span class="quillmd-font" style="font-family: Georgia">Hello</span> world\n`,
    );
    selectText(e, "Hello");
    expect(runEditorCommand(e, "fontFamily", "   ")).toBe(false);
    selectText(e, "Hello");
    expect(runEditorCommand(e, "fontFamily")).toBe(false);
    expect(md(e)).toBe(
      `<span class="quillmd-font" style="font-family: Georgia">Hello</span> world\n`,
    );
  });

  it("fontFamily 'Normal' (null) clears the attribute", () => {
    const e = trackedEditor();
    selectText(e, "Hello");
    runEditorCommand(e, "fontFamily", "Georgia");
    selectText(e, "Hello");
    expect(runEditorCommand(e, "fontFamily", null)).toBe(true);
    expect(md(e)).toBe("Hello world\n");
  });

  it("fontSize accepts a number, a bare count, and an Npt string (canonical Npt)", () => {
    const e = trackedEditor();
    selectText(e, "Hello");
    expect(runEditorCommand(e, "fontSize", 14)).toBe(true);
    expect(md(e)).toBe(
      `<span class="quillmd-font" style="font-size: 14pt">Hello</span> world\n`,
    );
    selectText(e, "Hello");
    expect(runEditorCommand(e, "fontSize", "11")).toBe(true);
    expect(md(e)).toBe(
      `<span class="quillmd-font" style="font-size: 11pt">Hello</span> world\n`,
    );
    selectText(e, "Hello");
    expect(runEditorCommand(e, "fontSize", " 24pt ")).toBe(true);
    expect(md(e)).toBe(
      `<span class="quillmd-font" style="font-size: 24pt">Hello</span> world\n`,
    );
  });

  it("fontSize rejects values that are not a point count", () => {
    const e = trackedEditor();
    for (const param of ["", "abc", "1.5pt", "pt", 0, -4, 1.5]) {
      selectText(e, "Hello");
      expect(runEditorCommand(e, "fontSize", param)).toBe(false);
    }
    expect(md(e)).toBe("Hello world\n");
  });

  it("fontSize 'Normal' (null) clears the attribute", () => {
    const e = trackedEditor();
    selectText(e, "Hello");
    runEditorCommand(e, "fontSize", 14);
    selectText(e, "Hello");
    expect(runEditorCommand(e, "fontSize", null)).toBe(true);
    expect(md(e)).toBe("Hello world\n");
  });

  it("composes family + size + color in the fixed attribute order", () => {
    const e = trackedEditor();
    selectText(e, "Hello");
    runEditorCommand(e, "fontColor", "#c00000");
    runEditorCommand(e, "fontSize", 14);
    runEditorCommand(e, "fontFamily", "Georgia");
    expect(md(e)).toBe(
      `<span class="quillmd-font" style="font-family: Georgia; font-size: 14pt; color: #c00000">Hello</span> world\n`,
    );
  });

  it("reports active only at a selection carrying the attribute", () => {
    const e = trackedEditor();
    selectText(e, "Hello");
    runEditorCommand(e, "fontFamily", "Georgia");
    runEditorCommand(e, "fontSize", 14);
    selectText(e, "Hello");
    expect(editorCommandActive(e, "fontFamily")).toBe(true);
    expect(editorCommandActive(e, "fontSize")).toBe(true);
    selectText(e, "world");
    expect(editorCommandActive(e, "fontFamily")).toBe(false);
    expect(editorCommandActive(e, "fontSize")).toBe(false);
  });

  it("fontFamilyOf / fontSizeOf read the attribute at the selection", () => {
    const e = trackedEditor();
    selectText(e, "Hello");
    runEditorCommand(e, "fontFamily", "Georgia");
    runEditorCommand(e, "fontSize", 14);
    selectText(e, "Hello");
    expect(fontFamilyOf(e)).toBe("Georgia");
    expect(fontSizeOf(e)).toBe("14pt");
    selectText(e, "world");
    expect(fontFamilyOf(e)).toBeNull();
    expect(fontSizeOf(e)).toBeNull();
  });
});

// --- toolbar font cluster ---------------------------------------------------

describe("toolbar font cluster (issue #49)", () => {
  it("offers Normal + the curated families + Custom, and Normal + the 14 Word sizes", () => {
    expect(FONT_FAMILIES).toHaveLength(23);
    expect(new Set(FONT_FAMILIES).size).toBe(FONT_FAMILIES.length);
    expect(FONT_SIZES).toEqual([8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48]);

    const container = renderToolbar(trackedEditor());
    const familySelect = container.querySelector<HTMLSelectElement>(
      'select[title="Font family"]',
    )!;
    const familyValues = Array.from(familySelect.options).map((o) => o.value);
    expect(familyValues[0]).toBe("");
    expect(familyValues.slice(1, -1)).toEqual([...FONT_FAMILIES]);
    expect(familyValues[familyValues.length - 1]).toBe(FONT_FAMILY_CUSTOM);

    const sizeSelect = container.querySelector<HTMLSelectElement>(
      'select[title="Font size"]',
    )!;
    const sizeValues = Array.from(sizeSelect.options).map((o) => o.value);
    expect(sizeValues[0]).toBe("");
    expect(sizeValues.slice(1)).toEqual(FONT_SIZES.map((n) => `${n}pt`));
  });

  it("sits right of the heading select and left of the inline-mark group", () => {
    const container = renderToolbar(trackedEditor());
    const controls = Array.from(
      container.querySelectorAll<HTMLElement>("select, button"),
    ).map((el) => el.getAttribute("title"));
    const headingIdx = controls.indexOf("Paragraph / heading level");
    const familyIdx = controls.indexOf("Font family");
    const sizeIdx = controls.indexOf("Font size");
    const boldIdx = controls.indexOf("Bold (Ctrl+B)");
    expect(headingIdx).toBeGreaterThan(-1);
    expect(familyIdx).toBe(headingIdx + 1);
    expect(sizeIdx).toBe(familyIdx + 1);
    expect(boldIdx).toBe(sizeIdx + 1);
  });

  it("picking a family applies the span; Normal clears it", () => {
    const e = trackedEditor();
    selectText(e, "Hello");
    const container = renderToolbar(e);
    const familySelect = container.querySelector<HTMLSelectElement>(
      'select[title="Font family"]',
    )!;
    setSelectValue(familySelect, "Georgia");
    expect(md(e)).toBe(
      `<span class="quillmd-font" style="font-family: Georgia">Hello</span> world\n`,
    );
    // The select tracks the selection: the picked family stays shown.
    expect(familySelect.value).toBe("Georgia");
    setSelectValue(familySelect, "");
    expect(md(e)).toBe("Hello world\n");
  });

  it("picking a size applies font-size: Npt; Normal clears it", () => {
    const e = trackedEditor();
    selectText(e, "world");
    const container = renderToolbar(e);
    const sizeSelect = container.querySelector<HTMLSelectElement>(
      'select[title="Font size"]',
    )!;
    setSelectValue(sizeSelect, "14pt");
    expect(md(e)).toBe(
      `Hello <span class="quillmd-font" style="font-size: 14pt">world</span>\n`,
    );
    setSelectValue(sizeSelect, "");
    expect(md(e)).toBe("Hello world\n");
  });

  // Replaces window.prompt for the duration of the block and records the
  // message the toolbar passes (the editor module resolves window.prompt
  // through the global window object).
  function withPrompt(
    reply: string | null,
    fn: (message: { current: string | undefined }) => void,
  ): void {
    const original = window.prompt;
    const message: { current: string | undefined } = { current: undefined };
    window.prompt = (msg?: string) => {
      message.current = msg;
      return reply;
    };
    try {
      fn(message);
    } finally {
      window.prompt = original;
    }
  }

  it("Custom… prompts for a free-text family and applies it", () => {
    const e = trackedEditor();
    selectText(e, "Hello");
    const container = renderToolbar(e);
    const familySelect = container.querySelector<HTMLSelectElement>(
      'select[title="Font family"]',
    )!;
    withPrompt("My Custom Font", (message) => {
      setSelectValue(familySelect, FONT_FAMILY_CUSTOM);
      expect(message.current).toBe("Custom font family");
      expect(md(e)).toBe(
        `<span class="quillmd-font" style="font-family: My Custom Font">Hello</span> world\n`,
      );
    });
  });

  it("a dismissed or blank Custom… prompt leaves the document untouched", () => {
    const e = trackedEditor();
    selectText(e, "Hello");
    const container = renderToolbar(e);
    const familySelect = container.querySelector<HTMLSelectElement>(
      'select[title="Font family"]',
    )!;
    withPrompt(null, () => {
      setSelectValue(familySelect, FONT_FAMILY_CUSTOM);
      expect(md(e)).toBe("Hello world\n");
    });
    withPrompt("   ", () => {
      setSelectValue(familySelect, FONT_FAMILY_CUSTOM);
      expect(md(e)).toBe("Hello world\n");
    });
  });

  it("shows a loaded off-list family as a dynamic option (the select never lies)", () => {
    const e = trackedEditor(
      `<span class="quillmd-font" style="font-family: Papyrus">Hello</span> world\n`,
    );
    selectText(e, "Hello");
    const container = renderToolbar(e);
    const familySelect = container.querySelector<HTMLSelectElement>(
      'select[title="Font family"]',
    )!;
    expect(familySelect.value).toBe("Papyrus");
    const values = Array.from(familySelect.options).map((o) => o.value);
    expect(values).toContain("Papyrus");
  });
});
