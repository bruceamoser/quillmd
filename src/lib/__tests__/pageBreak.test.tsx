// @vitest-environment jsdom
// pageBreak node + serializer block (plan 09 task 9.7, issue #90).
//
// The document stores a physical page break as the fixed HTML block
// `<div class="quillmd-page-break"></div>` (the source of truth, golden rule 1).
// The converter (pm.ts) maps that block to the pageBreak atom and back to the
// exact same bytes; the WYSIWYG renders the node as a visible labeled break
// line (PageBreakCard), the Preview renders the same line, and the PDF export
// maps the block to a raw ```{=typst} #pagebreak() fence (convert.rs, pinned
// by the cargo convert suite). The block is byte-stable: editing elsewhere
// must never rewrite the page-break line (plan 09 AC6).

import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorContent } from "@tiptap/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { PageBreak } from "../../components/Editor";
import PreviewView from "../../components/PreviewView";
import { createDocument, saveDocument } from "../pipeline";
import {
  markdownToTiptap,
  tiptapToMarkdown,
  PAGE_BREAK_HTML,
} from "../pm";
import { runEditorCommand } from "../editorCommands";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// A document with a page-break block between two headings so its position is
// unambiguous.
const DOC =
  "# Title\n" +
  "\n" +
  "## One\n" +
  "\n" +
  "Before the break.\n" +
  "\n" +
  '<div class="quillmd-page-break"></div>\n' +
  "\n" +
  "## Two\n" +
  "\n" +
  "After the break.\n";

describe("pageBreak serializer (pm.ts)", () => {
  it("parses the block to a pageBreak node", () => {
    const json = markdownToTiptap(DOC);
    const types = (json.content ?? []).map((n) => n.type);
    expect(types).toContain("pageBreak");
    // The node carries no content (an atom); it is the block, nothing else.
    const pb = (json.content ?? []).find((n) => n.type === "pageBreak");
    expect(pb?.content).toBeUndefined();
    expect(pb?.attrs).toBeUndefined();
  });

  it("serializes a pageBreak back to the exact block", () => {
    const json = {
      type: "doc",
      content: [{ type: "pageBreak" }],
    };
    expect(tiptapToMarkdown(json)).toBe(PAGE_BREAK_HTML + "\n");
  });

  it("round-trips a block-bearing document byte-identically", () => {
    const out = tiptapToMarkdown(markdownToTiptap(DOC));
    expect(out).toBe(DOC);
    // Fixed point: re-serializing the output changes nothing.
    expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
  });

  it("ignores surrounding whitespace when recognizing the block", () => {
    const json = markdownToTiptap("  <div class=\"quillmd-page-break\"></div>  \n");
    expect((json.content ?? []).some((n) => n.type === "pageBreak")).toBe(true);
  });

  it("does not treat a different html block as a pageBreak", () => {
    const json = markdownToTiptap('<div class="quillmd-toc"></div>\n');
    expect((json.content ?? []).some((n) => n.type === "pageBreak")).toBe(false);
  });
});

describe("pageBreak through the clean-path pipeline (plan 09 AC6 byte check)", () => {
  it("is an immutable html block: untouched document is verbatim", () => {
    const model = createDocument(DOC);
    const result = saveDocument(model, DOC);
    expect(result.kind).toBe("verbatim");
    expect(result.text).toBe(DOC);
  });

  it("classifies the block line as an html block", () => {
    const model = createDocument(DOC);
    const pbBlock = model.blocks.find((b) => b.text.trim() === PAGE_BREAK_HTML);
    expect(pbBlock).toBeDefined();
    expect(pbBlock?.kind).toBe("html");
  });

  it("editing body text leaves the block line untouched", () => {
    const model = createDocument(DOC);
    const json = markdownToTiptap(DOC);
    const p = (json.content ?? []).find(
      (n) =>
        n.type === "paragraph" &&
        (n.content ?? []).some(
          (c) => c.type === "text" && c.text === "Before the break.",
        ),
    );
    p!.content = [{ type: "text", text: "Before the break, edited." }];
    const result = saveDocument(model, tiptapToMarkdown(json));
    expect(result.text).toContain("Before the break, edited.");
    // The page-break line is byte-identical to the original.
    expect(result.text).toContain("\n" + PAGE_BREAK_HTML + "\n");
    expect(result.text).toContain("## Two");
  });
});

describe("pageBreak WYSIWYG node view (PageBreakCard)", () => {
  interface Mounted {
    container: HTMLDivElement;
    editor: Editor;
    unmount: () => void;
  }

  async function mountDoc(markdown: string): Promise<Mounted> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const editor = new Editor({
      extensions: [StarterKit, PageBreak],
      content: markdownToTiptap(markdown),
    });
    await act(async () => {
      root.render(<EditorContent editor={editor} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    return {
      container,
      editor,
      unmount: () => {
        act(() => root.unmount());
        editor.destroy();
        container.remove();
      },
    };
  }

  const mounted: Mounted[] = [];
  afterEach(() => {
    while (mounted.length > 0) mounted.pop()!.unmount();
  });

  function breakOf(container: HTMLDivElement): HTMLDivElement {
    const el = container.querySelector(".quillmd-page-break");
    if (!el) throw new Error("page break card not mounted");
    return el as HTMLDivElement;
  }

  it("renders a visible labeled break line at the block's position", async () => {
    const m = await mountDoc(DOC);
    mounted.push(m);
    const pb = breakOf(m.container);
    expect(pb.querySelector(".quillmd-page-break-line")).not.toBeNull();
    expect(pb.querySelector(".quillmd-page-break-label")?.textContent).toBe(
      "Page break",
    );
    // The card is a view artifact: the document still holds the exact block.
    expect(tiptapToMarkdown(m.editor.getJSON())).toBe(DOC);
  });

  it("Insert > Page Break inserts the block at the caret (byte-stable)", async () => {
    const m = await mountDoc("# Title\n\nBefore.\n\nAfter.\n");
    mounted.push(m);
    // Put the caret at the end of the "Before." paragraph.
    m.editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return true;
      const idx = node.text!.indexOf("Before.");
      if (idx === -1) return true;
      m.editor
        .chain()
        .setTextSelection(pos + idx + "Before.".length)
        .run();
      return false;
    });
    expect(runEditorCommand(m.editor, "pageBreak")).toBe(true);
    const md = tiptapToMarkdown(m.editor.getJSON());
    expect(md).toContain(PAGE_BREAK_HTML);
    // Exactly one block, between the two paragraphs.
    expect(md.split(PAGE_BREAK_HTML).length - 1).toBe(1);
    expect(md.indexOf("Before.")).toBeLessThan(md.indexOf(PAGE_BREAK_HTML));
    expect(md.indexOf(PAGE_BREAK_HTML)).toBeLessThan(md.indexOf("After."));
    // Round-trips byte-identically.
    expect(tiptapToMarkdown(markdownToTiptap(md))).toBe(md);
    // The card renders the new block.
    expect(breakOf(m.container)).not.toBeNull();
  });
});

describe("pageBreak in the Preview view", () => {
  interface Mounted {
    container: HTMLDivElement;
    root: Root;
    unmount: () => void;
  }

  async function mountPreview(value: string): Promise<Mounted> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(<PreviewView value={value} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    return {
      container,
      root,
      unmount: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  const mounted: Mounted[] = [];
  afterEach(() => {
    while (mounted.length > 0) mounted.pop()!.unmount();
  });

  function breakOf(container: HTMLDivElement): HTMLDivElement {
    const el = container.querySelector(".quillmd-page-break");
    if (!el) throw new Error("preview page break not mounted");
    return el as HTMLDivElement;
  }

  it("renders a visible break line at the block's position", async () => {
    const m = await mountPreview(DOC);
    mounted.push(m);
    const pb = breakOf(m.container);
    expect(pb.querySelector(".quillmd-page-break-line")).not.toBeNull();
    expect(pb.querySelector(".quillmd-page-break-label")?.textContent).toBe(
      "Page break",
    );
    // The raw fence placeholder is gone (swapped for the break block).
    expect(
      m.container.querySelector("pre > code.language-quillmd-page-break"),
    ).toBeNull();
    // The surrounding headings are intact.
    expect(m.container.textContent).toContain("Before the break.");
    expect(m.container.textContent).toContain("After the break.");
  });

  it("renders every break in a multi-break document", async () => {
    const m = await mountPreview(
      "A.\n\n" +
        '<div class="quillmd-page-break"></div>\n' +
        "\n" +
        "B.\n\n" +
        '<div class="quillmd-page-break"></div>\n' +
        "\n" +
        "C.\n",
    );
    mounted.push(m);
    expect(m.container.querySelectorAll(".quillmd-page-break")).toHaveLength(2);
    expect(
      m.container.querySelector("pre > code.language-quillmd-page-break"),
    ).toBeNull();
  });
});
