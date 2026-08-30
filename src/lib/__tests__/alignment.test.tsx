// @vitest-environment jsdom
// Text alignment (plan 02 task 2.3, issue #32): the quillmd-align-* HTML
// wrapper block in the serializer, the textAlign node attribute in the editor
// schema, the alignment commands (outermost-block semantics), the clean-path
// splice of aligned blocks, and the toolbar group. The on-disk format lives
// in fixtures/clean/align-*.md, which the round-trip corpus test covers.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { NodeSelection } from "@tiptap/pm/state";
import {
  AlignedBlockquote,
  AlignedHeading,
  AlignedParagraph,
  CodeBlockWithLang,
} from "../../components/Editor";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import {
  EDITOR_COMMANDS,
  editorCommandActive,
  runEditorCommand,
  textAlignOf,
} from "../editorCommands";
import { createDocument, saveDocument } from "../pipeline";
import Toolbar from "../../components/Toolbar";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CENTERED = [
  "# Alignment",
  "",
  "Left-aligned paragraph.",
  "",
  '<div class="quillmd-align-center">',
  "## Centered heading",
  "</div>",
  "",
  '<div class="quillmd-align-center">',
  "Centered paragraph with **bold**.",
  "</div>",
].join("\n") + "\n";

const RIGHT_QUOTE = [
  '<div class="quillmd-align-right">',
  "> Right-aligned quote",
  ">",
  "> second line",
  "</div>",
].join("\n") + "\n";

function appExtensions() {
  // Same block extensions as the app editor (Editor.tsx) so the textAlign
  // attribute exists on every alignable node type.
  return [
    StarterKit.configure({
      paragraph: false,
      heading: false,
      blockquote: false,
      codeBlock: false,
      strike: false,
    }),
    AlignedParagraph,
    AlignedHeading,
    AlignedBlockquote,
    CodeBlockWithLang,
  ];
}

function makeEditor(markdown: string): Editor {
  return new Editor({
    extensions: appExtensions(),
    content: markdownToTiptap(markdown),
  });
}

function cursorAfter(editor: Editor, text: string): void {
  let done = false;
  editor.state.doc.descendants((node, pos) => {
    if (done || !node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    editor.chain().setTextSelection(pos + idx + text.length).run();
    done = true;
    return false;
  });
}

function selectRange(editor: Editor, fromText: string, toText: string): void {
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText) {
      if (from === -1) {
        const idx = node.text!.indexOf(fromText);
        if (idx !== -1) from = pos + idx;
      } else if (to === -1) {
        const idx = node.text!.indexOf(toText);
        if (idx !== -1) to = pos + idx + toText.length;
      }
    }
    return from === -1 || to === -1;
  });
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  editor.chain().setTextSelection({ from, to }).run();
}

function md(editor: Editor): string {
  return tiptapToMarkdown(editor.getJSON());
}

function docJsonAligns(json: JSONContent): string[] {
  const out: string[] = [];
  const walk = (nodes: JSONContent[]): void => {
    for (const node of nodes) {
      if (node.attrs?.textAlign) out.push(String(node.attrs.textAlign));
      if (Array.isArray(node.content)) walk(node.content);
    }
  };
  walk(json.content ?? []);
  return out;
}

describe("alignment serializer (pm.ts)", () => {
  it("parses the center fixture into aligned nodes", () => {
    const json = markdownToTiptap(CENTERED);
    const content = json.content ?? [];
    const headings = content.filter((n) => n.type === "heading");
    const paras = content.filter((n) => n.type === "paragraph");
    // First heading/paragraph are left-aligned (no marker), the second of
    // each carries the center attribute from its wrapper.
    expect(headings).toHaveLength(2);
    expect(headings[0]?.attrs?.textAlign).toBeUndefined();
    expect(headings[1]?.attrs?.textAlign).toBe("center");
    expect(paras).toHaveLength(2);
    expect(paras[0]?.attrs?.textAlign).toBeUndefined();
    expect(paras[1]?.attrs?.textAlign).toBe("center");
  });

  it("parses a right-aligned multi-paragraph blockquote", () => {
    const json = markdownToTiptap(RIGHT_QUOTE);
    const quote = json.content?.[0];
    expect(quote?.type).toBe("blockquote");
    expect(quote?.attrs?.textAlign).toBe("right");
    expect(quote?.content).toHaveLength(2);
  });

  it("round-trips the fixtures through the converter byte-identically", () => {
    for (const src of [CENTERED, RIGHT_QUOTE]) {
      expect(tiptapToMarkdown(markdownToTiptap(src))).toBe(src);
    }
  });

  it("emits the wrapper only for center/right, never for left", () => {
    const md = tiptapToMarkdown(
      markdownToTiptap('<div class="quillmd-align-center">\n# C\n</div>\n'),
    );
    expect(md).toBe('<div class="quillmd-align-center">\n# C\n</div>\n');
    // Clearing the attribute drops the wrapper again.
    const json = markdownToTiptap('<div class="quillmd-align-center">\n# C\n</div>\n');
    json.content![0].attrs = { level: 1 };
    expect(tiptapToMarkdown(json)).toBe("# C\n");
  });

  it("leaves non-wrapper HTML blocks untouched", () => {
    const src = '<div class="note">\n  <p>x</p>\n</div>\n';
    const json = markdownToTiptap(src);
    const block = json.content?.[0];
    expect(block?.type).toBe("codeBlock");
    expect(block?.attrs?.language).toBe("html");
    expect(block?.attrs?.textAlign).toBeUndefined();
    expect(tiptapToMarkdown(json)).toBe(src);
  });

  it("parses the wrapper on CRLF input", () => {
    const crlf = '<div class="quillmd-align-center">\r\n# C\r\n</div>\r\n';
    const json = markdownToTiptap(crlf);
    expect(json.content?.[0]?.attrs?.textAlign).toBe("center");
    // The editor always emits LF; the pipeline normalizes EOL on save.
    expect(tiptapToMarkdown(json)).toBe('<div class="quillmd-align-center">\n# C\n</div>\n');
  });

  it("falls back to raw HTML for a malformed wrapper (never an aligned node)", () => {
    // A single-block div with a non-wrapping class is one raw html block and
    // round-trips byte-identically.
    const single = '<div class="quillmd-align-left">\n# C\n</div>\n';
    const js = markdownToTiptap(single);
    expect(js.content).toHaveLength(1);
    expect(js.content?.[0]?.type).toBe("codeBlock");
    expect(js.content?.[0]?.attrs?.language).toBe("html");
    expect(js.content?.[0]?.attrs?.textAlign).toBeUndefined();
    expect(tiptapToMarkdown(js)).toBe(single);

    // A div whose inner content is more than one block carries an inner blank
    // line, which the block model treats as a separator; it must still parse
    // as raw html (no textAlign attribute anywhere), not as an aligned node.
    // (Byte-exact preservation of such a div is the pipeline verbatim path's
    // job, not the converter's.)
    const multi = '<div class="quillmd-align-center">\n# A\n\nB\n</div>\n';
    const jm = markdownToTiptap(multi);
    for (const n of jm.content ?? []) {
      expect(n.attrs?.textAlign).toBeUndefined();
    }
    expect(jm.content?.some((n) => n.type === "codeBlock")).toBe(true);
  });

  it("round-trips a nested wrapper (aligned quote with an aligned inner block)", () => {
    const src =
      '<div class="quillmd-align-center">\n> <div class="quillmd-align-right">\n> para\n> </div>\n</div>\n';
    expect(tiptapToMarkdown(markdownToTiptap(src))).toBe(src);
  });
});

describe("alignment commands (editor schema)", () => {
  let editors: Editor[] = [];

  afterEach(() => {
    for (const editor of editors) editor.destroy();
    editors = [];
  });

  const editor = (markdown: string): Editor => {
    const e = makeEditor(markdown);
    editors.push(e);
    return e;
  };

  it("centers and re-lefts a paragraph through the registry", () => {
    const e = editor("Hello world");
    cursorAfter(e, "Hello");
    expect(runEditorCommand(e, "alignCenter")).toBe(true);
    expect(md(e)).toBe('<div class="quillmd-align-center">\nHello world\n</div>\n');
    expect(editorCommandActive(e, "alignCenter")).toBe(true);
    expect(editorCommandActive(e, "alignLeft")).toBe(false);
    expect(textAlignOf(e)).toBe("center");

    // Re-clicking the active alignment dispatches nothing.
    let transactions = 0;
    const onTransaction = () => {
      transactions += 1;
    };
    e.on("transaction", onTransaction);
    expect(runEditorCommand(e, "alignCenter")).toBe(true);
    e.off("transaction", onTransaction);
    expect(transactions).toBe(0);

    expect(runEditorCommand(e, "alignLeft")).toBe(true);
    expect(md(e)).toBe("Hello world\n");
    expect(editorCommandActive(e, "alignLeft")).toBe(true);
    expect(textAlignOf(e)).toBe("left");
  });

  it("aligns headings, blockquotes, and code blocks", () => {
    const e = editor("# Head\n\n> Quote\n\n```\ncode\n```\n");
    cursorAfter(e, "Head");
    expect(runEditorCommand(e, "alignRight")).toBe(true);
    cursorAfter(e, "Quote");
    expect(runEditorCommand(e, "alignCenter")).toBe(true);
    // Move into the code block.
    e.state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock") {
        e.chain().setTextSelection(pos + 1).run();
        return false;
      }
      return true;
    });
    expect(runEditorCommand(e, "alignRight")).toBe(true);

    const out = md(e);
    expect(out).toContain('<div class="quillmd-align-right">\n# Head\n</div>');
    expect(out).toContain('<div class="quillmd-align-center">\n> Quote\n</div>');
    expect(out).toContain(
      '<div class="quillmd-align-right">\n```\ncode\n```\n</div>',
    );
  });

  it("aligns the outermost block only (cursor in a paragraph inside a quote)", () => {
    const e = editor("> outer\n> inner\n");
    cursorAfter(e, "inner");
    expect(runEditorCommand(e, "alignCenter")).toBe(true);
    const out = md(e);
    // One wrapper around the whole quote, none around the inner paragraph.
    expect(out).toBe('<div class="quillmd-align-center">\n> outer\n> inner\n</div>\n');
    expect(docJsonAligns(e.getJSON())).toEqual(["center"]);
  });

  it("aligns every top-level block in a multi-block selection", () => {
    const e = editor("One\n\nTwo\n");
    selectRange(e, "One", "Two");
    expect(runEditorCommand(e, "alignRight")).toBe(true);
    expect(md(e)).toBe(
      '<div class="quillmd-align-right">\nOne\n</div>\n\n<div class="quillmd-align-right">\nTwo\n</div>\n',
    );
    expect(docJsonAligns(e.getJSON())).toEqual(["right", "right"]);
  });

  it("is a no-op outside alignable blocks", () => {
    // *** is the serializer's own hr form, so the re-serialized doc is stable.
    const e = editor("Hello\n\n***\n");
    let hrPos = -1;
    e.state.doc.descendants((node, pos) => {
      if (node.type.name === "horizontalRule") hrPos = pos;
    });
    expect(hrPos).toBeGreaterThan(-1);
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, hrPos)));
    expect(runEditorCommand(e, "alignCenter")).toBe(false);
    expect(md(e)).toBe("Hello\n\n***\n");
  });

  it("keeps the command registry entries resolvable", () => {
    for (const id of ["alignLeft", "alignCenter", "alignRight"] as const) {
      expect(EDITOR_COMMANDS.some((c) => c.id === id)).toBe(true);
    }
  });
});

describe("clean-path splice of aligned blocks", () => {
  it("splices an edited aligned block and keeps the rest verbatim", () => {
    const source =
      "Before.\n\n<div class=\"quillmd-align-center\">\n## Centered heading\n</div>\n\nAfter.\n";
    const model = createDocument(source);
    const current =
      "Before edited.\n\n<div class=\"quillmd-align-center\">\n## Renamed heading\n</div>\n\nAfter.\n";
    const result = saveDocument(model, current);
    expect(result.kind).toBe("splice");
    expect(result.text).toBe(current);
  });

  it("stays verbatim for an untouched aligned document", () => {
    const source =
      '<div class="quillmd-align-center">\n## Centered heading\n</div>\n\nAfter.\n';
    const model = createDocument(source);
    const result = saveDocument(model, source);
    expect(result.kind).toBe("verbatim");
    expect(result.text).toBe(source);
  });

  it("splices a new alignment applied through the editor", () => {
    const source = "Before.\n\n## Centered heading\n\nAfter.\n";
    const model = createDocument(source);
    const e = makeEditor(source);
    cursorAfter(e, "Centered");
    expect(runEditorCommand(e, "alignCenter")).toBe(true);
    const result = saveDocument(model, md(e));
    expect(result.kind).toBe("splice");
    expect(result.text).toBe(
      "Before.\n\n<div class=\"quillmd-align-center\">\n## Centered heading\n</div>\n\nAfter.\n",
    );
  });
});

describe("toolbar alignment group", () => {
  let roots: Root[] = [];
  let editors: Editor[] = [];

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    for (const root of roots) root.unmount();
    roots = [];
    for (const editor of editors) editor.destroy();
    editors = [];
  });

  it("renders the three alignment buttons and centers on click", () => {
    const e = makeEditor("Hello world");
    editors.push(e);
    cursorAfter(e, "Hello");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<Toolbar editor={e} />);
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    const byTitle = (title: string) => buttons.find((b) => b.title === title);
    expect(byTitle("Align left")?.textContent).toBe("L");
    expect(byTitle("Align center")?.textContent).toBe("C");
    expect(byTitle("Align right")?.textContent).toBe("R");
    // Left is the default, so its button starts active.
    expect(byTitle("Align left")?.className).toContain("quillmd-toolbar-active");

    act(() => {
      byTitle("Align center")?.click();
    });
    expect(md(e)).toBe('<div class="quillmd-align-center">\nHello world\n</div>\n');
    expect(byTitle("Align center")?.className).toContain("quillmd-toolbar-active");
  });
});
