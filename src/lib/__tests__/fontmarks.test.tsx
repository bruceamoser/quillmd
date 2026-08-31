// @vitest-environment jsdom
// Fonts, sizes & color — marks + serializer/parser (plan 04 task 4.1,
// issue #47): the three font marks (fontFamily / fontSize / fontColor) and
// the highlight color attribute, the canonical
// <span class="quillmd-font" style="..."> / <span class="quillmd-highlight"
// style="background-color: ..."> forms, stable attribute order, the
// ==text== backward-compat syntax, and the per-attribute toggle semantics.
// The on-disk format lives in fixtures/clean/font-*.md (clean-path corpus);
// the WYSIWYG converter round-trip is asserted here.
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import {
  FontColorMark,
  FontFamilyMark,
  FontSizeMark,
  QuillHighlight,
} from "../../components/Editor";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";

const rt = (md: string): string => tiptapToMarkdown(markdownToTiptap(md));

// --- serializer / parser (pm.ts) ------------------------------------------

describe("font/highlight spans (pm.ts)", () => {
  it("round-trips a single font-family span", () => {
    const src = `<span class="quillmd-font" style="font-family: Georgia">styled</span>\n`;
    expect(rt(src)).toBe(src);
  });

  it("emits attributes in a fixed order (family, size, color) regardless of input order", () => {
    const shuffled = `<span class="quillmd-font" style="color: #c00000; font-size: 14pt; font-family: Georgia">styled</span>\n`;
    expect(rt(shuffled)).toBe(
      `<span class="quillmd-font" style="font-family: Georgia; font-size: 14pt; color: #c00000">styled</span>\n`,
    );
  });

  it("round-trips a span over mixed bold and plain text", () => {
    const src = `<span class="quillmd-font" style="font-family: Georgia">**bold** and plain</span>\n`;
    expect(rt(src)).toBe(src);
  });

  it("round-trips a colored highlight span", () => {
    const src = `<span class="quillmd-highlight" style="background-color: #ffff00">hl</span>\n`;
    expect(rt(src)).toBe(src);
  });

  it("round-trips a font span wrapping a colored highlight", () => {
    const src = `<span class="quillmd-font" style="color: #0000ff"><span class="quillmd-highlight" style="background-color: #ffff00">x</span></span>\n`;
    expect(rt(src)).toBe(src);
  });

  it("keeps the ==text== syntax for a colorless highlight (backward compat)", () => {
    const src = `para ==text== more\n`;
    expect(rt(src)).toBe(src);
  });

  it("round-trips a colored highlight over ==text==-style input mid-paragraph", () => {
    // The == syntax is only the colorless form; a colored highlight always
    // round-trips as the span form.
    const src = `<span class="quillmd-highlight" style="background-color: #c00000">note</span> tail\n`;
    expect(rt(src)).toBe(src);
  });

  it("treats non-quillmd inline spans as opaque text (never a font span)", () => {
    const src = `a <span class="hl">x</span> b\n`;
    // Unknown class: stays literal; the serializer escapes the < as text.
    const out = rt(src);
    expect(out).not.toContain("quillmd-font");
    expect(out).toContain("hl");
  });

  it("parses a font span into the three independent marks", () => {
    const json = markdownToTiptap(
      `<span class="quillmd-font" style="font-family: Georgia; font-size: 14pt; color: #c00000">x</span>\n`,
    );
    const text = (json.content?.[0]?.content ?? [])[0];
    const marks = text?.marks ?? [];
    expect(marks).toEqual(
      expect.arrayContaining([
        { type: "fontFamily", attrs: { fontFamily: "Georgia" } },
        { type: "fontSize", attrs: { fontSize: "14pt" } },
        { type: "fontColor", attrs: { color: "#c00000" } },
      ]),
    );
  });

  it("parses a colored highlight span into a highlight mark with a color", () => {
    const json = markdownToTiptap(
      `<span class="quillmd-highlight" style="background-color: #ff0000">x</span>\n`,
    );
    const text = (json.content?.[0]?.content ?? [])[0];
    expect(text?.marks).toEqual([{ type: "highlight", attrs: { color: "#ff0000" } }]);
  });

  it("parses ==text== into a colorless highlight mark", () => {
    const json = markdownToTiptap(`a ==b== c\n`);
    const texts = json.content?.[0]?.content ?? [];
    const hl = texts.find((n) => n.marks?.some((m) => m.type === "highlight"));
    expect(hl?.marks).toEqual([{ type: "highlight" }]);
  });

  it("drops a font attribute from the span when its mark is removed", () => {
    const json = markdownToTiptap(
      `<span class="quillmd-font" style="font-family: Georgia; font-size: 14pt">x</span>\n`,
    );
    const text = (json.content?.[0]?.content ?? [])[0];
    text.marks = (text.marks ?? []).filter((m) => m.type !== "fontFamily");
    expect(tiptapToMarkdown(json)).toBe(
      `<span class="quillmd-font" style="font-size: 14pt">x</span>\n`,
    );
  });

  it("drops the whole font span when the last attribute is removed", () => {
    const json = markdownToTiptap(`<span class="quillmd-font" style="color: #c00000">x</span>\n`);
    const text = (json.content?.[0]?.content ?? [])[0];
    text.marks = [];
    expect(tiptapToMarkdown(json)).toBe("x\n");
  });

  it("turns a colored highlight into ==text== when the color is cleared", () => {
    // The highlight sits mid-paragraph: remark escapes a line-leading '=' so a
    // paragraph-start ==text== is not a stable form.
    const json = markdownToTiptap(
      `a <span class="quillmd-highlight" style="background-color: #ffff00">x</span> y\n`,
    );
    const texts = json.content?.[0]?.content ?? [];
    const hl = texts.find((n) => n.marks?.some((m) => m.type === "highlight"));
    if (!hl) throw new Error("expected a highlighted text node");
    hl.marks = (hl.marks ?? []).map((m) =>
      m.type === "highlight" ? { type: "highlight" } : m,
    );
    expect(tiptapToMarkdown(json)).toBe("a ==x== y\n");
  });

  it("round-trips a CRLF font document (the editor emits LF)", () => {
    const crlf = `<span class="quillmd-font" style="font-family: Georgia">x</span>\r\n`;
    expect(tiptapToMarkdown(markdownToTiptap(crlf))).toBe(
      `<span class="quillmd-font" style="font-family: Georgia">x</span>\n`,
    );
  });
});

// --- editor schema ---------------------------------------------------------

function makeEditor(markdown: string): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      Underline,
      QuillHighlight,
      FontFamilyMark,
      FontSizeMark,
      FontColorMark,
    ],
    content: markdownToTiptap(markdown),
  });
}

function selectAll(editor: Editor): void {
  const { doc } = editor.state;
  editor.chain().setTextSelection({ from: 1, to: doc.content.size - 1 }).run();
}

function selectText(editor: Editor, text: string): void {
  const { doc } = editor.state;
  let from = -1;
  let to = -1;
  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (node.isText) {
      const start = node.text?.indexOf(text) ?? -1;
      if (start >= 0) {
        from = pos + start;
        to = from + text.length;
      }
    }
  });
  expect([from, to]).not.toEqual([-1, -1]);
  editor.chain().setTextSelection({ from, to }).run();
}

function md(editor: Editor): string {
  return tiptapToMarkdown(editor.getJSON());
}

describe("font/highlight editor schema", () => {
  let editors: Editor[] = [];
  afterEach(() => {
    for (const e of editors) e.destroy();
    editors = [];
  });
  const editor = (markdown: string): Editor => {
    const e = makeEditor(markdown);
    editors.push(e);
    return e;
  };

  it("applies a font family as a quillmd-font span", () => {
    const e = editor("Hello");
    selectAll(e);
    e.chain().setMark("fontFamily", { fontFamily: "Georgia" }).run();
    expect(md(e)).toBe(`<span class="quillmd-font" style="font-family: Georgia">Hello</span>\n`);
  });

  it("applies size and color as additional span attributes (fixed order)", () => {
    const e = editor("Hello");
    selectAll(e);
    e.chain().setMark("fontColor", { color: "#c00000" }).run();
    e.chain().setMark("fontSize", { fontSize: "14pt" }).run();
    e.chain().setMark("fontFamily", { fontFamily: "Georgia" }).run();
    expect(md(e)).toBe(
      `<span class="quillmd-font" style="font-family: Georgia; font-size: 14pt; color: #c00000">Hello</span>\n`,
    );
  });

  it("composes bold + italic + font + color on one range (AC3)", () => {
    const e = editor("Hello");
    selectAll(e);
    e.chain().toggleMark("bold").run();
    e.chain().toggleMark("italic").run();
    e.chain().setMark("fontFamily", { fontFamily: "Georgia" }).run();
    e.chain().setMark("fontColor", { color: "#c00000" }).run();
    expect(md(e)).toBe(
      `<span class="quillmd-font" style="font-family: Georgia; color: #c00000">***Hello***</span>\n`,
    );
  });

  it("toggles a font attribute off independently, keeping the others (AC3)", () => {
    const e = editor("Hello");
    selectAll(e);
    e.chain().setMark("fontFamily", { fontFamily: "Georgia" }).run();
    e.chain().setMark("fontSize", { fontSize: "14pt" }).run();
    e.chain().setMark("fontColor", { color: "#c00000" }).run();
    // Deselect the size only.
    e.chain().unsetMark("fontSize").run();
    expect(md(e)).toBe(
      `<span class="quillmd-font" style="font-family: Georgia; color: #c00000">Hello</span>\n`,
    );
    // Deselect the rest: the span disappears entirely.
    e.chain().unsetMark("fontFamily").run();
    e.chain().unsetMark("fontColor").run();
    expect(md(e)).toBe("Hello\n");
  });

  it("keeps bold when only the font attributes are cleared (AC4 direction)", () => {
    const e = editor("Hello");
    selectAll(e);
    e.chain().toggleMark("bold").run();
    e.chain().setMark("fontFamily", { fontFamily: "Georgia" }).run();
    e.chain().setMark("fontColor", { color: "#c00000" }).run();
    e.chain().unsetMark("fontFamily").run();
    e.chain().unsetMark("fontColor").run();
    expect(md(e)).toBe("**Hello**\n");
  });

  it("sets a highlight color as a quillmd-highlight span (AC5)", () => {
    const e = editor("Mark");
    selectAll(e);
    e.chain().setMark("highlight", { color: "#ff00ff" }).run();
    expect(md(e)).toBe(
      `<span class="quillmd-highlight" style="background-color: #ff00ff">Mark</span>\n`,
    );
  });

  it("keeps the default (colorless) highlight as ==text== (AC5 backward compat)", () => {
    // Mid-paragraph: a line-leading '=' is escaped by remark, so the stable
    // ==text== form requires surrounding text.
    const e = editor("say Mark now");
    selectText(e, "Mark");
    e.chain().setMark("highlight").run();
    expect(md(e)).toBe("say ==Mark== now\n");
  });

  it("round-trips a loaded colored highlight and re-serializes it stably", () => {
    const src = `<span class="quillmd-highlight" style="background-color: #00ff00">note</span>\n`;
    const e = editor(src);
    expect(md(e)).toBe(src);
  });

  it("round-trips a loaded font span with bold through the editor", () => {
    const src = `<span class="quillmd-font" style="font-family: Georgia">**bold** and plain</span>\n`;
    const e = editor(src);
    expect(md(e)).toBe(src);
  });
});
