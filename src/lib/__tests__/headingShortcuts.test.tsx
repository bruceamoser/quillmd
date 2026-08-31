// @vitest-environment jsdom
// Heading keyboard ergonomics (plan 02 §4 AC3, issue #37): Ctrl+1..6 sets the
// heading level of the block under the cursor in the WYSIWYG view, dispatched
// through the shared registry (the h1..h6 toggle commands), so the shortcut
// and the toolbar/menu paths exercise identical behavior. The Help > Shortcuts
// dialog content and the native menu wiring are covered by the p1-editor
// section of tests/acceptance-test.sh.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { handleEditorKeyDown } from "../../components/Editor";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { EDITOR_COMMANDS } from "../editorCommands";

function makeEditor(markdown = "Hello world"): Editor {
  return new Editor({
    extensions: [StarterKit],
    content: markdownToTiptap(markdown),
  });
}

// Put the cursor right after the first occurrence of `text` in the document
// so the block commands act on a deterministic position.
function cursorAfter(editor: Editor, text: string): void {
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    editor.chain().setTextSelection(pos + idx + text.length).run();
    return false;
  });
}

function md(editor: Editor): string {
  return tiptapToMarkdown(editor.getJSON());
}

// Emits the keydown and runs it through the component's
// editorProps.handleKeyDown (handleEditorKeyDown), the same binding the
// WYSIWYG view installs.
function press(
  editor: Editor,
  key: string,
  opts: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    altKey: opts.alt ?? false,
    bubbles: true,
    cancelable: true,
  });
  handleEditorKeyDown(editor, event);
  return event;
}

let editors: Editor[] = [];

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

function trackedEditor(markdown = "Hello world"): Editor {
  const editor = makeEditor(markdown);
  editors.push(editor);
  return editor;
}

describe("Ctrl+1..6 heading shortcuts (plan 02 §4 AC3, issue #37)", () => {
  it("declare the h1..h6 commands in the shared registry", () => {
    const byId = new Map(EDITOR_COMMANDS.map((cmd) => [cmd.id, cmd]));
    const headingIds = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
    headingIds.forEach((id, index) => {
      expect(byId.get(id)?.label).toBe(`Heading ${index + 1}`);
    });
  });

  it("Ctrl+1..6 set the heading level of the block under the cursor", () => {
    const editor = trackedEditor();
    cursorAfter(editor, "Hello");
    for (let level = 1; level <= 6; level += 1) {
      expect(press(editor, String(level), { ctrl: true }).defaultPrevented).toBe(true);
      expect(md(editor)).toBe(`${"#".repeat(level)} Hello world\n`);
    }
  });

  it("works from an existing heading to another level", () => {
    const editor = trackedEditor("## Hello world\n");
    cursorAfter(editor, "Hello");
    expect(press(editor, "4", { ctrl: true }).defaultPrevented).toBe(true);
    expect(md(editor)).toBe("#### Hello world\n");
  });

  it("pressing the current level's key returns the block to a paragraph", () => {
    const editor = trackedEditor("# Hello world\n");
    cursorAfter(editor, "Hello");
    expect(press(editor, "1", { ctrl: true }).defaultPrevented).toBe(true);
    expect(md(editor)).toBe("Hello world\n");
  });

  it("leaves Ctrl+Shift+1..6 and Ctrl+Alt+1..6 to the browser", () => {
    const editor = trackedEditor();
    cursorAfter(editor, "Hello");
    expect(press(editor, "1", { ctrl: true, shift: true }).defaultPrevented).toBe(false);
    expect(md(editor)).toBe("Hello world\n");
    expect(press(editor, "2", { ctrl: true, alt: true }).defaultPrevented).toBe(false);
    expect(md(editor)).toBe("Hello world\n");
  });
});
