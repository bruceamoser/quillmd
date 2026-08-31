// @vitest-environment jsdom
// Style registry + gallery popover (plan 05 task 5.1, issue #54): the
// QuillStyle data model, the built-in style set (every style an alias of an
// existing registry command, so no new markdown meaning), the apply/active
// helpers behind the gallery, and the StyleGallery popover component itself
// (top-6 swatches, More styles list with the markdown mapping, active-state
// highlight that follows the cursor).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { EDITOR_COMMANDS, runEditorCommand } from "../editorCommands";
import {
  BUILT_IN_STYLES,
  STYLES_BY_ID,
  TOP_GALLERY_STYLES,
  activeStyles,
  applyStyle,
  styleActive,
  styleById,
} from "../styles";
import StyleGallery from "../../components/StyleGallery";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];

function makeEditor(markdown = "Hello world"): Editor {
  return new Editor({
    // Same extensions as the app editor (Editor.tsx); TaskItem is nested so
    // the schema matches production.
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

// Select the first occurrence of `text` so mark styles act deterministically.
function selectText(editor: Editor, text: string): void {
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    editor.chain().setTextSelection({ from: pos + idx, to: pos + idx + text.length }).run();
    return false;
  });
}

function md(editor: Editor): string {
  return tiptapToMarkdown(editor.getJSON());
}

function click(element: HTMLElement): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// --- the registry data model ------------------------------------------------

describe("style registry data model", () => {
  it("offers at least 12 built-in styles with unique ids", () => {
    expect(BUILT_IN_STYLES.length).toBeGreaterThanOrEqual(12);
    const ids = BUILT_IN_STYLES.map((style) => style.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const style of BUILT_IN_STYLES) {
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.previewCSS.length).toBeGreaterThan(0);
      expect(style.markdown.length).toBeGreaterThan(0);
      expect(["block", "mark"]).toContain(style.kind);
    }
  });

  it("every style aliases an existing registry command (no new markdown meaning)", () => {
    const commandIds = new Set(EDITOR_COMMANDS.map((cmd) => cmd.id));
    for (const style of BUILT_IN_STYLES) {
      expect(commandIds.has(style.command), `${style.id} -> ${style.command}`).toBe(true);
      if (style.with) {
        expect(commandIds.has(style.with), `${style.id} -> with ${style.with}`).toBe(true);
      }
    }
  });

  it("maps the Word/Docs names onto the registry commands (plan 05 §2.1, AC1)", () => {
    const expectCommand = (id: string, command: string, with_?: string) => {
      const style = styleById(id);
      expect(style, id).not.toBeNull();
      expect(style!.command).toBe(command);
      expect(style!.with ?? undefined).toBe(with_);
    };
    expectCommand("normal", "paragraph");
    expectCommand("title", "h1");
    expectCommand("heading1", "h1");
    expectCommand("heading2", "h2");
    expectCommand("heading3", "h3");
    expectCommand("heading4", "h4");
    expectCommand("heading5", "h5");
    expectCommand("heading6", "h6");
    expectCommand("subtitle", "h2");
    expectCommand("quote", "blockquote");
    expectCommand("intense-quote", "blockquote", "bold");
    expectCommand("list-paragraph", "bulletList");
    expectCommand("no-spacing", "paragraph");
    expectCommand("source-code", "codeBlock");
    expectCommand("code", "code");
    expectCommand("emphasis", "italic");
    expectCommand("strong", "bold");
  });

  it("keeps the six top-gallery styles resolvable and distinct", () => {
    expect(TOP_GALLERY_STYLES).toHaveLength(6);
    expect(new Set(TOP_GALLERY_STYLES).size).toBe(TOP_GALLERY_STYLES.length);
    for (const id of TOP_GALLERY_STYLES) {
      expect(STYLES_BY_ID.has(id), id).toBe(true);
    }
  });

  it("documents the markdown equivalent for every style", () => {
    const expectMarkdown = (id: string, markdown: string) => {
      expect(styleById(id)!.markdown).toBe(markdown);
    };
    expectMarkdown("normal", "plain paragraph");
    expectMarkdown("title", "# Heading");
    expectMarkdown("subtitle", "## Heading");
    expectMarkdown("quote", "> Quote");
    expectMarkdown("intense-quote", "> **Quote**");
    expectMarkdown("list-paragraph", "- Item");
    expectMarkdown("source-code", "``` fenced block");
    expectMarkdown("code", "`code`");
    expectMarkdown("emphasis", "*text*");
    expectMarkdown("strong", "**text**");
  });
});

// --- applying styles (AC1) ---------------------------------------------------

describe("applying styles through the registry", () => {
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

  it("selecting 'Heading 2' on a paragraph sets H2 (registry command h2)", () => {
    const e = editor();
    cursorAfter(e, "Hello");
    const style = styleById("heading2")!;
    expect(applyStyle(e, style)).toBe(true);
    expect(md(e)).toBe("## Hello world\n");
  });

  it("each style writes the markdown its mapping documents", () => {
    const cases: Array<[string, string]> = [
      ["title", "# Hello world\n"],
      ["heading3", "### Hello world\n"],
      ["quote", "> Hello world\n"],
      ["list-paragraph", "- Hello world\n"],
      ["source-code", "```\nHello world\n```\n"],
    ];
    for (const [id, expected] of cases) {
      const e = editor();
      cursorAfter(e, "Hello");
      expect(applyStyle(e, styleById(id)!), id).toBe(true);
      expect(md(e), id).toBe(expected);
    }
  });

  it("quoting a heading keeps the heading inside the quote", () => {
    const e = editor("# Head\n");
    cursorAfter(e, "Head");
    expect(applyStyle(e, styleById("quote")!)).toBe(true);
    expect(md(e)).toBe("> # Head\n");
  });

  it("mark styles apply to the selected run", () => {
    const e = editor();
    selectText(e, "Hello");
    expect(applyStyle(e, styleById("strong")!)).toBe(true);
    expect(md(e)).toBe("**Hello** world\n");

    selectText(e, "world");
    expect(applyStyle(e, styleById("emphasis")!)).toBe(true);
    expect(md(e)).toBe("**Hello** *world*\n");

    selectText(e, "Hello");
    expect(applyStyle(e, styleById("code")!)).toBe(true);
    // The code mark replaces bold (the marks do not compose in the schema).
    expect(md(e)).toBe("`Hello` *world*\n");
  });

  it("Intense Quote wraps in a blockquote and bolds the text", () => {
    const e = editor();
    selectText(e, "Hello");
    expect(applyStyle(e, styleById("intense-quote")!)).toBe(true);
    expect(md(e)).toBe("> **Hello** world\n");
  });

  it("Normal and No Spacing return a styled block to a plain paragraph", () => {
    const e = editor("## Titled\n\n- Listed\n");
    cursorAfter(e, "Titled");
    expect(applyStyle(e, styleById("normal")!)).toBe(true);
    expect(md(e)).toBe("Titled\n\n- Listed\n");

    cursorAfter(e, "Listed");
    expect(applyStyle(e, styleById("no-spacing")!)).toBe(true);
    expect(md(e)).toBe("Titled\n\nListed\n");
  });

  it("picking an already-applied style toggles it back (registry semantics)", () => {
    const e = editor("## Titled\n");
    cursorAfter(e, "Titled");
    expect(applyStyle(e, styleById("heading2")!)).toBe(true);
    expect(md(e)).toBe("Titled\n");
  });

  it("styles dispatch the identical commands the registry surfaces", () => {
    const e = editor();
    cursorAfter(e, "Hello");
    expect(applyStyle(e, styleById("heading2")!)).toBe(true);
    expect(md(e)).toBe("## Hello world\n");
    // The registry command and the style alias produce the same document.
    expect(runEditorCommand(e, "paragraph")).toBe(true);
    expect(md(e)).toBe("Hello world\n");
  });
});

// --- active-state tracking (AC1: the gallery follows the cursor) -------------

describe("style active-state at the selection", () => {
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

  const activeIds = (e: Editor): string[] => activeStyles(e).map((style) => style.id);

  it("a plain paragraph activates Normal and No Spacing (both alias setParagraph)", () => {
    const e = editor();
    cursorAfter(e, "Hello");
    expect(activeIds(e).sort()).toEqual(["no-spacing", "normal"]);
  });

  it("headings activate their level style, Title and Subtitle their aliases", () => {
    const e = editor("# T\n\n## S\n\n### H3\n\nPara\n");
    cursorAfter(e, "T");
    expect(activeIds(e).sort()).toEqual(["heading1", "title"]);
    cursorAfter(e, "S");
    expect(activeIds(e).sort()).toEqual(["heading2", "subtitle"]);
    cursorAfter(e, "H3");
    expect(activeIds(e)).toEqual(["heading3"]);
    cursorAfter(e, "Para");
    expect(activeIds(e).sort()).toEqual(["no-spacing", "normal"]);
  });

  it("quotes activate Quote; a bold quote also Intense Quote", () => {
    const e = editor("> Plain quote\n\n> **Bold quote**\n");
    cursorAfter(e, "Plain");
    expect(activeIds(e)).toEqual(["quote"]);
    cursorAfter(e, "Bold");
    // The bold run also reports its character style (Strong).
    expect(activeIds(e).sort()).toEqual(["intense-quote", "quote", "strong"]);
  });

  it("list items activate List Paragraph (task items included), not Normal", () => {
    const e = editor("- Bulleted\n\n- [ ] Tasked\n");
    cursorAfter(e, "Bulleted");
    expect(activeIds(e)).toEqual(["list-paragraph"]);
    cursorAfter(e, "Tasked");
    expect(activeIds(e)).toEqual(["list-paragraph"]);
    expect(activeIds(e)).not.toContain("normal");
  });

  it("mark styles follow the selected run (on top of the paragraph style)", () => {
    const e = editor("plain **bolded** *emph* `coded` text\n");
    // A mark selection also reports its paragraph style (Word: a run carries
    // both a character style and the paragraph's style).
    selectText(e, "bolded");
    expect(activeIds(e).sort()).toEqual(["no-spacing", "normal", "strong"]);
    selectText(e, "emph");
    expect(activeIds(e).sort()).toEqual(["emphasis", "no-spacing", "normal"]);
    selectText(e, "coded");
    expect(activeIds(e).sort()).toEqual(["code", "no-spacing", "normal"]);
    selectText(e, "text");
    expect(activeIds(e).sort()).toEqual(["no-spacing", "normal"]);
    expect(styleActive(styleById("strong")!, e)).toBe(false);
  });

  it("styleActive agrees with the registry command's active() where it defaults", () => {
    const e = editor("## Head\n");
    cursorAfter(e, "Head");
    const heading2 = styleById("heading2")!;
    expect(styleActive(heading2, e)).toBe(true);
    const title = styleById("title")!;
    expect(styleActive(title, e)).toBe(false);
  });
});

// --- the gallery popover component -------------------------------------------

function renderGallery(editor: Editor): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(<StyleGallery editor={editor} />);
  });
  return container;
}

function openGallery(container: HTMLDivElement): void {
  click(container.querySelector<HTMLButtonElement>('button[title="Styles"]')!);
}

function swatch(container: HTMLDivElement, id: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`.quillmd-style-grid button[data-style-id="${id}"]`);
}

function row(container: HTMLDivElement, id: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`.quillmd-style-group > button[data-style-id="${id}"]`);
}

describe("StyleGallery component", () => {
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
  const editor = (markdown?: string): Editor => {
    const e = makeEditor(markdown);
    editors.push(e);
    return e;
  };

  it("renders closed, and opens the six top-style swatches", () => {
    const container = renderGallery(editor());
    expect(container.querySelector(".quillmd-styles-popover")).toBeNull();

    openGallery(container);

    const grid = container.querySelector(".quillmd-style-grid");
    expect(grid).not.toBeNull();
    expect(grid!.querySelectorAll("button")).toHaveLength(6);
    for (const id of TOP_GALLERY_STYLES) {
      expect(swatch(container, id), id).not.toBeNull();
    }
    expect(container.querySelector(".quillmd-style-more")!.textContent).toContain("More styles");
  });

  it("a swatch pick applies the style through the registry and closes", () => {
    const e = editor();
    cursorAfter(e, "Hello");
    const container = renderGallery(e);
    openGallery(container);
    click(swatch(container, "heading2")!);
    expect(md(e)).toBe("## Hello world\n");
    expect(container.querySelector(".quillmd-styles-popover")).toBeNull();
  });

  it("a mark style from the More list applies to the selected run", () => {
    const e = editor();
    selectText(e, "Hello");
    const container = renderGallery(e);
    openGallery(container);
    click(container.querySelector<HTMLButtonElement>(".quillmd-style-more")!);
    click(row(container, "strong")!);
    expect(md(e)).toBe("**Hello** world\n");
    expect(container.querySelector(".quillmd-styles-popover")).toBeNull();
  });

  it("More styles lists every built-in style grouped by kind with the markdown mapping", () => {
    const container = renderGallery(editor());
    openGallery(container);
    click(container.querySelector<HTMLButtonElement>(".quillmd-style-more")!);

    const titles = Array.from(container.querySelectorAll(".quillmd-style-group-title")).map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(["Paragraph styles", "Character styles"]);

    const rows = container.querySelectorAll(".quillmd-style-group > button");
    expect(rows).toHaveLength(BUILT_IN_STYLES.length);
    for (const style of BUILT_IN_STYLES) {
      const el = row(container, style.id);
      expect(el, style.id).not.toBeNull();
      expect(el!.querySelector(".quillmd-style-row-name")!.textContent).toBe(style.label);
      expect(el!.querySelector(".quillmd-style-row-md")!.textContent).toBe(style.markdown);
    }
  });

  it("the All styles button returns to the top grid", () => {
    const container = renderGallery(editor());
    openGallery(container);
    click(container.querySelector<HTMLButtonElement>(".quillmd-style-more")!);
    expect(container.querySelector(".quillmd-style-grid")).toBeNull();

    click(container.querySelector<HTMLButtonElement>(".quillmd-style-more")!);
    expect(container.querySelector(".quillmd-style-grid")).not.toBeNull();
  });

  it("highlights the active style as the cursor moves (AC1 selection state)", () => {
    const e = editor("## Titled\n\nPara\n");
    const container = renderGallery(e);
    openGallery(container);

    act(() => {
      cursorAfter(e, "Para");
    });
    expect(swatch(container, "normal")!.classList.contains("quillmd-style-active")).toBe(true);
    expect(swatch(container, "heading2")!.classList.contains("quillmd-style-active")).toBe(false);

    act(() => {
      cursorAfter(e, "Titled");
    });
    expect(swatch(container, "heading2")!.classList.contains("quillmd-style-active")).toBe(true);
    expect(swatch(container, "normal")!.classList.contains("quillmd-style-active")).toBe(false);
    // Subtitle aliases H2, so it highlights alongside Heading 2.
    expect(swatch(container, "subtitle")!.classList.contains("quillmd-style-active")).toBe(true);
  });

  it("marks the active mark style in the More list", () => {
    const e = editor("plain **bolded** text\n");
    selectText(e, "bolded");
    const container = renderGallery(e);
    openGallery(container);
    click(container.querySelector<HTMLButtonElement>(".quillmd-style-more")!);
    expect(row(container, "strong")!.classList.contains("quillmd-style-active")).toBe(true);
    expect(row(container, "emphasis")!.classList.contains("quillmd-style-active")).toBe(false);
  });

  it("closes on an outside click and on Escape (without applying)", () => {
    const e = editor();
    cursorAfter(e, "Hello");
    const container = renderGallery(e);
    openGallery(container);
    expect(container.querySelector(".quillmd-styles-popover")).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(container.querySelector(".quillmd-styles-popover")).toBeNull();
    expect(md(e)).toBe("Hello world\n");

    openGallery(container);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector(".quillmd-styles-popover")).toBeNull();
    expect(md(e)).toBe("Hello world\n");
  });

  it("re-opens on the top grid (the More list is not sticky)", () => {
    const container = renderGallery(editor());
    openGallery(container);
    click(container.querySelector<HTMLButtonElement>(".quillmd-style-more")!);
    expect(container.querySelector(".quillmd-style-grid")).toBeNull();

    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    openGallery(container);
    expect(container.querySelector(".quillmd-style-grid")).not.toBeNull();
  });

  it("renders nothing without an editor", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<StyleGallery editor={null} />);
    });
    expect(container.firstChild).toBeNull();
  });
});
