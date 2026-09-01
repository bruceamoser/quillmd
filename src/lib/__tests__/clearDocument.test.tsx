// @vitest-environment jsdom
// Tools > Clear Document (plan 09 task 9.7, issue #90).
//
// The command (editorCommands.ts) replaces the whole document with a single
// empty paragraph in ONE transaction, so a single Ctrl+Z restores the full
// prior text exactly — the acceptance criterion compares the restored text
// byte-for-byte against the pre-clear text (plan 09 AC7). The destructive
// native confirm is the app shell's job (App.tsx gates the menu event before
// dispatching), so this suite exercises the command itself.

import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { PageBreak } from "../../components/Editor";
import { markdownToTiptap, tiptapToMarkdown, PAGE_BREAK_HTML } from "../pm";
import { EDITOR_COMMANDS, runEditorCommand } from "../editorCommands";

const DOC =
  "# Title\n" +
  "\n" +
  "First paragraph with **bold** text.\n" +
  "\n" +
  "## Section\n" +
  "\n" +
  "- item one\n" +
  "- item two\n" +
  "\n" +
  '<div class="quillmd-page-break"></div>\n' +
  "\n" +
  "Last paragraph.\n";

function makeEditor(markdown: string): Editor {
  // Same extensions the app editor loads so the schema matches production
  // (the pageBreak atom included, since real documents carry the block).
  return new Editor({
    extensions: [StarterKit, PageBreak],
    content: markdownToTiptap(markdown),
  });
}

describe("clearDocument (plan 09 AC7)", () => {
  it("clears a full document to a single empty paragraph", () => {
    const editor = makeEditor(DOC);
    expect(runEditorCommand(editor, "clearDocument")).toBe(true);
    expect(editor.state.doc.textContent).toBe("");
    expect(editor.state.doc.content.childCount).toBe(1);
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    editor.destroy();
  });

  it("one undo restores the full prior text exactly (byte compare)", () => {
    const editor = makeEditor(DOC);
    expect(runEditorCommand(editor, "clearDocument")).toBe(true);
    expect(editor.state.doc.textContent).toBe("");
    // The single Ctrl+Z equivalent: one undo step.
    editor.commands.undo();
    const restored = tiptapToMarkdown(editor.getJSON());
    expect(restored).toBe(DOC);
    // And the block line survived the round trip byte-identical.
    expect(restored).toContain("\n" + PAGE_BREAK_HTML + "\n");
    editor.destroy();
  });

  it("clear → undo → redo → undo cycles deterministically", () => {
    const editor = makeEditor(DOC);
    expect(runEditorCommand(editor, "clearDocument")).toBe(true);
    // A single empty paragraph serializes to the empty string.
    const clearedMd = tiptapToMarkdown(editor.getJSON());
    expect(clearedMd).toBe("");

    editor.commands.undo();
    expect(tiptapToMarkdown(editor.getJSON())).toBe(DOC);

    editor.commands.redo();
    expect(tiptapToMarkdown(editor.getJSON())).toBe(clearedMd);

    editor.commands.undo();
    expect(tiptapToMarkdown(editor.getJSON())).toBe(DOC);
    editor.destroy();
  });

  it("clearing an empty document is a no-op that leaves one empty paragraph", () => {
    const editor = makeEditor("\n");
    expect(runEditorCommand(editor, "clearDocument")).toBe(true);
    expect(editor.state.doc.textContent).toBe("");
    expect(editor.state.doc.content.childCount).toBe(1);
    editor.destroy();
  });

  it("is registered once in the command registry", () => {
    // The registry is imported by the App shell; the id must exist exactly
    // once so the Tools menu routes to a single implementation.
    expect(EDITOR_COMMANDS.filter((c) => c.id === "clearDocument")).toHaveLength(1);
    expect(EDITOR_COMMANDS.filter((c) => c.id === "pageBreak")).toHaveLength(1);
  });
});
