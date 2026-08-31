// @vitest-environment jsdom
// Clear formatting extension (plan 04 task 4.5, issue #51, AC4): the
// clearFormatting registry command strips every character mark — the font
// family/size/color marks and the colored highlight among them — while
// keeping bold and italic (Word behavior), and still unwraps block-level
// formatting through clearNodes(). The Format menu's top-level item
// (format-clear) and the Font submenu's pick (format-font-clear) both
// dispatch this same command (fontmenu.test.tsx covers the id resolution).
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import {
  FontColorMark,
  FontFamilyMark,
  FontSizeMark,
  QuillHighlight,
} from "../../components/Editor";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { runEditorCommand } from "../editorCommands";
import type { EditorCommandId } from "../editorCommands";

// The same inline-mark extensions the app editor (Editor.tsx) registers.
function makeEditor(markdown = "Hello world"): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      Underline,
      Subscript,
      Superscript,
      FontFamilyMark,
      FontSizeMark,
      FontColorMark,
      QuillHighlight,
    ],
    content: markdownToTiptap(markdown),
  });
}

// Select the first occurrence of `text` so the command acts deterministically.
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

describe("clearFormatting (issue #51, plan 04 AC4)", () => {
  it("removes family/size/color while keeping bold/italic", () => {
    const e = makeEditor(
      `<span class="quillmd-font" style="font-family: Georgia; font-size: 14pt; color: #c00000">***Hello***</span> world\n`,
    );
    selectText(e, "Hello");
    expect(runEditorCommand(e, "clearFormatting")).toBe(true);
    expect(md(e)).toBe("***Hello*** world\n");
  });

  it("keeps bold and italic independently", () => {
    const e = makeEditor(
      `<span class="quillmd-font" style="font-family: Georgia; color: #c00000">**Hello**</span>\n`,
    );
    selectText(e, "Hello");
    expect(runEditorCommand(e, "clearFormatting")).toBe(true);
    expect(md(e)).toBe("**Hello**\n");

    const e2 = makeEditor(
      `<span class="quillmd-font" style="font-size: 24pt">*Hello*</span>\n`,
    );
    selectText(e2, "Hello");
    expect(runEditorCommand(e2, "clearFormatting")).toBe(true);
    expect(md(e2)).toBe("*Hello*\n");
  });

  it("strips underline, strike, subscript, and superscript along with the font marks", () => {
    const e = makeEditor("**Hello** world\n");
    selectText(e, "Hello");
    const ids: EditorCommandId[] = ["underline", "strike", "subscript", "superscript"];
    for (const id of ids) {
      expect(runEditorCommand(e, id), id).toBe(true);
    }
    // The range now carries bold plus the marks above; clear keeps bold only.
    expect(runEditorCommand(e, "clearFormatting")).toBe(true);
    expect(md(e)).toBe("**Hello** world\n");
  });

  it("strips inline code (which is exclusive of the other marks)", () => {
    const e = makeEditor("**Hello** world\n");
    selectText(e, "Hello");
    expect(runEditorCommand(e, "code")).toBe(true);
    // Inline code excludes the other marks, so the range is code-only.
    expect(runEditorCommand(e, "clearFormatting")).toBe(true);
    expect(md(e)).toBe("Hello world\n");
  });

  it("strips a font span over a colored highlight, keeping the emphasis", () => {
    const e = makeEditor(
      `<span class="quillmd-font" style="color: #0000ff"><span class="quillmd-highlight" style="background-color: #ffff00">**x**</span></span>\n`,
    );
    selectText(e, "x");
    expect(runEditorCommand(e, "clearFormatting")).toBe(true);
    expect(md(e)).toBe("**x**\n");
  });

  it("still unwraps block-level formatting (clearNodes) while keeping the marks", () => {
    const e = makeEditor(`# **Hello** world\n`);
    selectText(e, "Hello");
    expect(runEditorCommand(e, "clearFormatting")).toBe(true);
    expect(md(e)).toBe("**Hello** world\n");
  });

  it("leaves an unstyled selection untouched", () => {
    const e = makeEditor("Hello world\n");
    selectText(e, "Hello");
    expect(runEditorCommand(e, "clearFormatting")).toBe(true);
    expect(md(e)).toBe("Hello world\n");
  });
});
