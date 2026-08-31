// @vitest-environment jsdom
// Style inspector (plan 05 task 5.5, issue #58): the status-bar block-type
// indicator. currentBlockStyle resolves the built-in style that owns the
// block under the cursor (the same "first active wins" rule the Modify Style
// preselect uses); the StatusBar renders the label as a button that opens an
// inspector popover with the "jump to style" action; the toolbar's
// StyleGallery opens on requestStylesGallery so the jump lands on the
// highlighted current style.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { markdownToTiptap } from "../pm";
import { registerStylesGalleryListener, requestStylesGallery } from "../editorCommands";
import { currentBlockStyle } from "../styles";
import StatusBar from "../../components/StatusBar";
import StyleGallery from "../../components/StyleGallery";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Same extensions as the app editor (Editor.tsx); TaskItem is nested so the
// schema matches production.
function makeEditor(markdown = "Hello world"): Editor {
  return new Editor({
    extensions: [StarterKit, Underline, TaskList, TaskItem.configure({ nested: true })],
    content: markdownToTiptap(markdown),
  });
}

// Put the cursor right after the first occurrence of `text` so block styles
// act on a deterministic position.
function cursorAfter(editor: Editor, text: string): void {
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    editor.chain().setTextSelection(pos + idx + text.length).run();
    return false;
  });
}

// --- currentBlockStyle (the block under the cursor) -------------------------

describe("currentBlockStyle (issue #58)", () => {
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

  const label = (e: Editor): string | null => currentBlockStyle(e)?.label ?? null;

  it("a plain paragraph is Normal", () => {
    const e = editor();
    cursorAfter(e, "Hello");
    expect(label(e)).toBe("Normal");
  });

  it("headings resolve to the first active alias in registry order", () => {
    const e = editor("# T\n\n## S\n\n### H3\n");
    cursorAfter(e, "T");
    expect(label(e)).toBe("Title");
    cursorAfter(e, "S");
    expect(label(e)).toBe("Heading 2");
    cursorAfter(e, "H3");
    expect(label(e)).toBe("Heading 3");
  });

  it("a plain quote is Quote; a bold quote is also Quote (registry order)", () => {
    const e = editor("> Plain\n\n> **Bold**\n");
    cursorAfter(e, "Plain");
    expect(label(e)).toBe("Quote");
    cursorAfter(e, "Bold");
    expect(label(e)).toBe("Quote");
  });

  it("list and task items are List Paragraph, not Normal", () => {
    const e = editor("- Bulleted\n\n- [ ] Tasked\n");
    cursorAfter(e, "Bulleted");
    expect(label(e)).toBe("List Paragraph");
    cursorAfter(e, "Tasked");
    expect(label(e)).toBe("List Paragraph");
  });

  it("a fenced code block is Source Code", () => {
    const e = editor("```\ncode\n```\n");
    cursorAfter(e, "code");
    expect(label(e)).toBe("Source Code");
  });

  it("an empty document (no blocks) is null — no block under the cursor", () => {
    // A 0-byte file loads as a childless doc with an AllSelection; there is no
    // paragraph to own a style, so the indicator hides (the first keystroke
    // creates the paragraph and the label becomes "Normal").
    const e = editor("");
    expect(label(e)).toBeNull();
  });

  it("a horizontal rule (no built-in style) is null", () => {
    const e = editor("Hello\n\n---\n\nWorld");
    let hrPos = -1;
    e.state.doc.descendants((node, pos) => {
      if (node.type.name === "horizontalRule") hrPos = pos;
    });
    expect(hrPos).toBeGreaterThan(-1);
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, hrPos)));
    expect(currentBlockStyle(e)).toBeNull();
  });
});

// --- the StatusBar block-type indicator + inspector popover ------------------

describe("statusBar block-style indicator (issue #58)", () => {
  let roots: Root[] = [];
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    for (const root of roots) root.unmount();
    roots = [];
    container.remove();
  });

  const render = (props: Parameters<typeof StatusBar>[0]) => {
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<StatusBar {...props} />);
    });
    return container;
  };

  const baseProps = {
    mode: "wysiwyg" as const,
    wordCount: 3,
    charCount: 12,
    eol: "lf" as const,
    dirty: false,
    fileName: "a.md",
    zoom: 100,
  };

  it("hides the indicator when the block style label is null", () => {
    render({ ...baseProps, blockStyleLabel: null });
    expect(container.querySelector(".quillmd-status-style")).toBeNull();
  });

  it("shows a plain label without a jump handler", () => {
    render({ ...baseProps, blockStyleLabel: "Heading 2" });
    const label = container.querySelector(".quillmd-status-style-label");
    expect(label?.textContent).toBe("Heading 2");
    expect(label?.tagName).not.toBe("BUTTON");
    expect(container.querySelector(".quillmd-status-style-popover")).toBeNull();
  });

  it("renders a button that opens the inspector popover naming the style", () => {
    render({ ...baseProps, blockStyleLabel: "Heading 2", onJumpToStyle: () => {} });
    const button = container.querySelector<HTMLButtonElement>("button.quillmd-status-style-btn");
    expect(button?.textContent).toBe("Heading 2");
    expect(container.querySelector(".quillmd-status-style-popover")).toBeNull();

    act(() => {
      button?.click();
    });
    expect(container.querySelector(".quillmd-status-style-popover")).not.toBeNull();
    expect(
      container.querySelector(".quillmd-status-style-popover-text")?.textContent,
    ).toBe("This block is: Heading 2");
  });

  it("Jump to style invokes onJumpToStyle and closes the popover", () => {
    let jumps = 0;
    render({ ...baseProps, blockStyleLabel: "Quote", onJumpToStyle: () => { jumps += 1; } });
    act(() => {
      container.querySelector<HTMLButtonElement>("button.quillmd-status-style-btn")?.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>(".quillmd-status-style-jump")?.click();
    });
    expect(jumps).toBe(1);
    expect(container.querySelector(".quillmd-status-style-popover")).toBeNull();
  });

  it("closes the popover on outside click and Escape (without jumping)", () => {
    let jumps = 0;
    render({ ...baseProps, blockStyleLabel: "Quote", onJumpToStyle: () => { jumps += 1; } });
    act(() => {
      container.querySelector<HTMLButtonElement>("button.quillmd-status-style-btn")?.click();
    });
    expect(container.querySelector(".quillmd-status-style-popover")).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(container.querySelector(".quillmd-status-style-popover")).toBeNull();
    expect(jumps).toBe(0);

    act(() => {
      container.querySelector<HTMLButtonElement>("button.quillmd-status-style-btn")?.click();
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector(".quillmd-status-style-popover")).toBeNull();
    expect(jumps).toBe(0);
  });
});

// --- the gallery-open request (the "jump to style" target) -------------------

describe("requestStylesGallery opens the toolbar gallery (issue #58)", () => {
  let roots: Root[] = [];
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

  const renderGallery = (editor: Editor): HTMLDivElement => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<StyleGallery editor={editor} />);
    });
    return container;
  };

  it("a mounted gallery opens on request and highlights the current style", () => {
    const e = makeEditor("## Titled\n\nPara\n");
    editors.push(e);
    cursorAfter(e, "Titled");
    const container = renderGallery(e);
    // Closed before the request.
    expect(container.querySelector(".quillmd-styles-popover")).toBeNull();

    let requested = false;
    act(() => {
      requested = requestStylesGallery(e);
    });
    expect(requested).toBe(true);
    expect(container.querySelector(".quillmd-styles-popover")).not.toBeNull();
    // The style active at the cursor (Heading 2) is highlighted.
    const swatch = container.querySelector<HTMLButtonElement>(
      '.quillmd-style-grid button[data-style-id="heading2"]',
    );
    expect(swatch?.classList.contains("quillmd-style-active")).toBe(true);
  });

  it("requestStylesGallery is a no-op (false) when no gallery is mounted", () => {
    const e = makeEditor("## Titled\n");
    editors.push(e);
    expect(requestStylesGallery(e)).toBe(false);
  });

  it("a registered listener that is replaced is not invoked (single subscriber)", () => {
    const e = makeEditor("## Titled\n");
    editors.push(e);
    let first = 0;
    let second = 0;
    const un1 = registerStylesGalleryListener(() => { first += 1; });
    const un2 = registerStylesGalleryListener(() => { second += 1; });
    requestStylesGallery(e);
    expect(first).toBe(0);
    expect(second).toBe(1);
    un1();
    un2();
    expect(requestStylesGallery(e)).toBe(false);
  });
});
