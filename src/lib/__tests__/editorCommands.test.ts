// @vitest-environment jsdom
// Active-state detection for the registry commands added by plan 02 task 2.1.
// The editor is built with the same node types the app loads so isActive()
// lookups behave exactly as they do in the real component.
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { NodeSelection } from "@tiptap/pm/state";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import {
  EDITOR_COMMANDS,
  applyViewSettings,
  dispatchEditorCommand,
  editorCommandActive,
  lineSpacingOf,
  registerEditorCommandListener,
  runEditorCommand,
  spellcheckOf,
  textAlignOf,
  zoomPercentOf,
} from "../editorCommands";
import type { EditorCommandId, EditorCommandParam } from "../editorCommands";

const NEW_IDS: EditorCommandId[] = [
  "underline",
  "alignLeft",
  "alignCenter",
  "alignRight",
  "indent",
  "outdent",
  "lineSpacing",
  "showMarks",
  "zoom",
  "pasteAsText",
  "spellcheck",
];

function makeEditor(markdown = "Hello world") {
  return new Editor({
    // Same extensions as the app editor (Editor.tsx); TaskItem is nested so
    // the schema matches production.
    extensions: [StarterKit, Underline, TaskList, TaskItem.configure({ nested: true })],
    content: markdownToTiptap(markdown),
  });
}

// Put the cursor right after the first occurrence of `text` in the document
// so block commands act on a deterministic position.
function cursorAfter(editor: Editor, text: string): void {
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    editor.chain().setTextSelection(pos + idx + text.length).run();
    return false;
  });
}

// Select the first occurrence of `text`.
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

// djb2 over the editor's current markdown text. Acceptance #5 verifies the ¶
// toggle by hashing the document text before and after the toggle.
function hashText(text: string): number {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return hash;
}

describe("registry expansion (plan 02 task 2.1)", () => {
  it("registers all 10 new command ids exactly once", () => {
    const ids = EDITOR_COMMANDS.map((cmd) => cmd.id);
    for (const id of NEW_IDS) {
      expect(ids.filter((x) => x === id)).toHaveLength(1);
    }
    expect(new Set(ids).size).toBe(ids.length);
    for (const cmd of EDITOR_COMMANDS) {
      expect(typeof cmd.run).toBe("function");
      expect(cmd.label.length).toBeGreaterThan(0);
    }
  });

  describe("underline", () => {
    it("detects active state as the mark toggles", () => {
      const editor = makeEditor("Hello world");
      selectText(editor, "Hello");
      expect(editorCommandActive(editor, "underline")).toBe(false);
      expect(runEditorCommand(editor, "underline")).toBe(true);
      expect(editorCommandActive(editor, "underline")).toBe(true);
      expect(md(editor)).toBe("<u>Hello</u> world\n");
      expect(runEditorCommand(editor, "underline")).toBe(true);
      expect(editorCommandActive(editor, "underline")).toBe(false);
      expect(md(editor)).toBe("Hello world\n");
      editor.destroy();
    });
  });

  describe("alignment active-state detection", () => {
    it("reads the default (left) for every alignable block type", () => {
      const editor = makeEditor("# Head\n\nPara\n\n> Quote\n\n```\ncode\n```\n");
      for (const [text, id] of [
        ["Head", "heading"],
        ["Para", "paragraph"],
        ["Quote", "blockquote"],
      ] as const) {
        cursorAfter(editor, text);
        expect(editor.isActive(id as "heading")).toBe(true);
        expect(textAlignOf(editor)).toBe("left");
        expect(editorCommandActive(editor, "alignLeft")).toBe(true);
        expect(editorCommandActive(editor, "alignCenter")).toBe(false);
        expect(editorCommandActive(editor, "alignRight")).toBe(false);
      }
      // codeBlock: select into the block directly.
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "codeBlock") {
          editor.chain().setTextSelection(pos + 1).run();
          return false;
        }
        return true;
      });
      expect(editor.isActive("codeBlock")).toBe(true);
      expect(textAlignOf(editor)).toBe("left");
      expect(editorCommandActive(editor, "alignLeft")).toBe(true);
      expect(editorCommandActive(editor, "alignCenter")).toBe(false);
      expect(editorCommandActive(editor, "alignRight")).toBe(false);
      editor.destroy();
    });

    it("reports no alignable block for a non-alignable selection", () => {
      const editor = makeEditor("Hello\n\n---\n\nWorld");
      let hrPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "horizontalRule") hrPos = pos;
      });
      expect(hrPos).toBeGreaterThan(-1);
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, hrPos)),
      );
      expect(textAlignOf(editor)).toBe(null);
      expect(editorCommandActive(editor, "alignLeft")).toBe(false);
      expect(editorCommandActive(editor, "alignCenter")).toBe(false);
      expect(editorCommandActive(editor, "alignRight")).toBe(false);
      editor.destroy();
    });

    it("alignment runs are document no-ops until the 2.3 node attribute lands", () => {
      const editor = makeEditor("Hello world");
      cursorAfter(editor, "Hello");
      const before = md(editor);
      expect(runEditorCommand(editor, "alignCenter")).toBe(true);
      expect(md(editor)).toBe(before);
      // Re-clicking the current alignment dispatches nothing at all.
      let transactions = 0;
      const onTransaction = () => {
        transactions += 1;
      };
      editor.on("transaction", onTransaction);
      expect(runEditorCommand(editor, "alignLeft")).toBe(true);
      editor.off("transaction", onTransaction);
      expect(transactions).toBe(0);
      editor.destroy();
    });
  });

  describe("indent / outdent", () => {
    it("wraps a plain paragraph in a blockquote and lifts it back out", () => {
      const editor = makeEditor("Hello world");
      cursorAfter(editor, "Hello");
      expect(editorCommandActive(editor, "indent")).toBe(true);
      expect(editorCommandActive(editor, "outdent")).toBe(false);
      expect(runEditorCommand(editor, "indent")).toBe(true);
      expect(md(editor)).toBe("> Hello world\n");
      expect(editorCommandActive(editor, "outdent")).toBe(true);
      expect(runEditorCommand(editor, "outdent")).toBe(true);
      expect(md(editor)).toBe("Hello world\n");
      expect(editorCommandActive(editor, "outdent")).toBe(false);
      editor.destroy();
    });

    it("nests a non-first list item and lifts it back out", () => {
      const editor = makeEditor("- one\n- two\n");
      cursorAfter(editor, "two");
      expect(editorCommandActive(editor, "indent")).toBe(true);
      expect(editorCommandActive(editor, "outdent")).toBe(true);
      expect(runEditorCommand(editor, "indent")).toBe(true);
      expect(md(editor)).toBe("- one\n  - two\n");
      cursorAfter(editor, "two");
      expect(runEditorCommand(editor, "outdent")).toBe(true);
      expect(md(editor)).toBe("- one\n- two\n");
      editor.destroy();
    });

    it("does not offer indent for the first list item (native sink limit)", () => {
      const editor = makeEditor("- one\n- two\n");
      cursorAfter(editor, "one");
      expect(editorCommandActive(editor, "indent")).toBe(false);
      expect(runEditorCommand(editor, "indent")).toBe(false);
      expect(md(editor)).toBe("- one\n- two\n");
      // Outdent still applies: it lifts the item out of the list.
      expect(editorCommandActive(editor, "outdent")).toBe(true);
      expect(runEditorCommand(editor, "outdent")).toBe(true);
      expect(md(editor)).toBe("one\n\n- two\n");
      editor.destroy();
    });

    it("fails safely on file-loaded task lists (converter representation)", () => {
      // The PM converter loads task lists as bullet lists of task items, a
      // structure the native sink rejects. The command must report the
      // failure instead of throwing into the dispatching surface.
      const editor = makeEditor("- [ ] one\n- [ ] two\n");
      cursorAfter(editor, "two");
      expect(editor.isActive("taskItem")).toBe(true);
      expect(editorCommandActive(editor, "indent")).toBe(true);
      expect(runEditorCommand(editor, "indent")).toBe(false);
      expect(md(editor)).toBe("- [ ] one\n- [ ] two\n");
      expect(runEditorCommand(editor, "outdent")).toBe(false);
      expect(md(editor)).toBe("- [ ] one\n- [ ] two\n");
      editor.destroy();
    });

    it("nests a second quote level and lifts it back", () => {
      const editor = makeEditor("> Hello\n");
      cursorAfter(editor, "Hello");
      expect(editorCommandActive(editor, "indent")).toBe(true);
      expect(runEditorCommand(editor, "indent")).toBe(true);
      expect(md(editor)).toBe("> > Hello\n");
      expect(runEditorCommand(editor, "outdent")).toBe(true);
      expect(md(editor)).toBe("> Hello\n");
      editor.destroy();
    });

    it("is not applicable on a bare paragraph for outdent", () => {
      const editor = makeEditor("Hello world");
      cursorAfter(editor, "Hello");
      expect(editorCommandActive(editor, "outdent")).toBe(false);
      expect(runEditorCommand(editor, "outdent")).toBe(false);
      expect(md(editor)).toBe("Hello world\n");
      editor.destroy();
    });
  });

  describe("lineSpacing (view-level)", () => {
    it("applies the CSS variable and detects the active preset", () => {
      const editor = makeEditor("Hello world");
      expect(lineSpacingOf(editor)).toBe("single");
      expect(editorCommandActive(editor, "lineSpacing", "single")).toBe(true);
      expect(editorCommandActive(editor, "lineSpacing", "double")).toBe(false);

      expect(runEditorCommand(editor, "lineSpacing", "1.5")).toBe(true);
      expect(lineSpacingOf(editor)).toBe("1.5");
      expect(editorCommandActive(editor, "lineSpacing", "1.5")).toBe(true);
      expect(editorCommandActive(editor, "lineSpacing", "single")).toBe(false);
      expect(
        (editor.view.dom as HTMLElement).style.getPropertyValue("--quillmd-line-spacing"),
      ).toBe("1.5");

      expect(runEditorCommand(editor, "lineSpacing", "double")).toBe(true);
      expect(lineSpacingOf(editor)).toBe("double");
      editor.destroy();
    });

    it("rejects unknown presets", () => {
      const editor = makeEditor("Hello world");
      expect(runEditorCommand(editor, "lineSpacing", "triple" as EditorCommandParam)).toBe(false);
      expect(lineSpacingOf(editor)).toBe("single");
      editor.destroy();
    });
  });

  describe("showMarks (view-level)", () => {
    it("toggles the wrapper class without touching the document", () => {
      const editor = makeEditor("Hello world");
      const dom = editor.view.dom as HTMLElement;
      const before = md(editor);
      // Acceptance #5: the toggle is verified by hashing the current text
      // before and after — the hash must not change.
      const beforeHash = hashText(before);
      expect(editorCommandActive(editor, "showMarks")).toBe(false);
      expect(runEditorCommand(editor, "showMarks")).toBe(true);
      expect(dom.classList.contains("quillmd-show-marks")).toBe(true);
      expect(editorCommandActive(editor, "showMarks")).toBe(true);
      expect(md(editor)).toBe(before);
      expect(hashText(md(editor))).toBe(beforeHash);
      expect(runEditorCommand(editor, "showMarks")).toBe(true);
      expect(dom.classList.contains("quillmd-show-marks")).toBe(false);
      expect(editorCommandActive(editor, "showMarks")).toBe(false);
      expect(md(editor)).toBe(before);
      expect(hashText(md(editor))).toBe(beforeHash);
      editor.destroy();
    });
  });

  // wordWrap + applyViewSettings (plan 02 task 2.5, issue #34): the persisted
  // per-doc view settings land on the editor DOM as a CSS variable plus two
  // wrapper classes. All of it is view-only.
  describe("wordWrap (view-level)", () => {
    it("toggles the no-wrap class and reports wrap as active", () => {
      const editor = makeEditor("Hello world");
      const dom = editor.view.dom as HTMLElement;
      const before = md(editor);
      // Wrap is on by default: the no-wrap class is absent.
      expect(dom.classList.contains("quillmd-no-wrap")).toBe(false);
      expect(editorCommandActive(editor, "wordWrap")).toBe(true);
      expect(runEditorCommand(editor, "wordWrap")).toBe(true);
      expect(dom.classList.contains("quillmd-no-wrap")).toBe(true);
      expect(editorCommandActive(editor, "wordWrap")).toBe(false);
      expect(md(editor)).toBe(before);
      expect(runEditorCommand(editor, "wordWrap")).toBe(true);
      expect(dom.classList.contains("quillmd-no-wrap")).toBe(false);
      expect(editorCommandActive(editor, "wordWrap")).toBe(true);
      expect(md(editor)).toBe(before);
      editor.destroy();
    });
  });

  describe("applyViewSettings (plan 02 tasks 2.5/2.6)", () => {
    it("applies the line-spacing variable and both wrapper classes", () => {
      const editor = makeEditor("Hello world");
      const dom = editor.view.dom as HTMLElement;
      applyViewSettings(editor, {
        lineSpacing: "1.5",
        wordWrap: false,
        showMarks: true,
        zoom: 100,
        spellcheck: true,
      });
      expect(dom.style.getPropertyValue("--quillmd-line-spacing")).toBe("1.5");
      expect(lineSpacingOf(editor)).toBe("1.5");
      expect(dom.classList.contains("quillmd-show-marks")).toBe(true);
      expect(dom.classList.contains("quillmd-no-wrap")).toBe(true);

      // Re-applying the defaults clears the classes (idempotent restore).
      applyViewSettings(editor, {
        lineSpacing: "single",
        wordWrap: true,
        showMarks: false,
        zoom: 100,
        spellcheck: true,
      });
      expect(lineSpacingOf(editor)).toBe("single");
      expect(dom.classList.contains("quillmd-show-marks")).toBe(false);
      expect(dom.classList.contains("quillmd-no-wrap")).toBe(false);
      editor.destroy();
    });

    it("restores the persisted zoom on the content container (issue #35)", () => {
      const editor = makeEditor("Hello world");
      const dom = editor.view.dom as HTMLElement;
      // A reopened tab at 140% gets the variable applied on mount.
      applyViewSettings(editor, {
        lineSpacing: "single",
        wordWrap: true,
        showMarks: false,
        zoom: 140,
        spellcheck: true,
      });
      expect(dom.style.getPropertyValue("--quillmd-zoom")).toBe("140");
      expect(zoomPercentOf(editor)).toBe(140);

      // Reverting to the default restores 100 (idempotent).
      applyViewSettings(editor, {
        lineSpacing: "single",
        wordWrap: true,
        showMarks: false,
        zoom: 100,
        spellcheck: true,
      });
      expect(zoomPercentOf(editor)).toBe(100);

      // An out-of-range stored value is clamped when applied.
      applyViewSettings(editor, {
        lineSpacing: "single",
        wordWrap: true,
        showMarks: false,
        zoom: 999,
        spellcheck: true,
      });
      expect(zoomPercentOf(editor)).toBe(200);
      editor.destroy();
    });

    it("never mutates the document", () => {
      const editor = makeEditor("# Title\n\nHello **world**\n\n- a\n- b\n");
      const before = md(editor);
      cursorAfter(editor, "Hello");
      applyViewSettings(editor, {
        lineSpacing: "double",
        wordWrap: false,
        showMarks: true,
        zoom: 150,
        spellcheck: true,
      });
      runEditorCommand(editor, "wordWrap");
      expect(md(editor)).toBe(before);
      editor.destroy();
    });
  });

  describe("zoom (view-level)", () => {
    it("steps in and out in 10% increments with reset", () => {
      const editor = makeEditor("Hello world");
      expect(zoomPercentOf(editor)).toBe(100);

      expect(runEditorCommand(editor, "zoom", "in")).toBe(true);
      expect(zoomPercentOf(editor)).toBe(110);
      expect(editorCommandActive(editor, "zoom", 110)).toBe(true);
      expect(editorCommandActive(editor, "zoom", 100)).toBe(false);

      expect(runEditorCommand(editor, "zoom", "out")).toBe(true);
      expect(zoomPercentOf(editor)).toBe(100);

      expect(runEditorCommand(editor, "zoom", "out")).toBe(true);
      expect(zoomPercentOf(editor)).toBe(90);
      expect(runEditorCommand(editor, "zoom", "reset")).toBe(true);
      expect(zoomPercentOf(editor)).toBe(100);
      editor.destroy();
    });

    it("clamps to the 50-200 range and accepts explicit percents", () => {
      const editor = makeEditor("Hello world");
      expect(runEditorCommand(editor, "zoom", 250)).toBe(true);
      expect(zoomPercentOf(editor)).toBe(200);
      expect(runEditorCommand(editor, "zoom", 10)).toBe(true);
      expect(zoomPercentOf(editor)).toBe(50);
      expect(runEditorCommand(editor, "zoom", 150)).toBe(true);
      expect(zoomPercentOf(editor)).toBe(150);
      expect(editorCommandActive(editor, "zoom", 150)).toBe(true);
      editor.destroy();
    });

    it("rejects non-numeric params", () => {
      const editor = makeEditor("Hello world");
      expect(runEditorCommand(editor, "zoom", "huge" as EditorCommandParam)).toBe(false);
      expect(zoomPercentOf(editor)).toBe(100);
      editor.destroy();
    });
  });

  describe("pasteAsText", () => {
    it("inserts plain text across paragraphs", () => {
      const editor = makeEditor("Start");
      cursorAfter(editor, "Start");
      expect(runEditorCommand(editor, "pasteAsText", "a\nb")).toBe(true);
      expect(md(editor)).toBe("Start\n\na\n\nb\n");
      editor.destroy();
    });

    it("handles CRLF and lone CR line endings", () => {
      const editor = makeEditor("Start");
      cursorAfter(editor, "Start");
      expect(runEditorCommand(editor, "pasteAsText", "a\r\nb\rc")).toBe(true);
      expect(md(editor)).toBe("Start\n\na\n\nb\n\nc\n");
      editor.destroy();
    });

    it("does not add a trailing empty paragraph for a final newline", () => {
      const editor = makeEditor("Start");
      cursorAfter(editor, "Start");
      expect(runEditorCommand(editor, "pasteAsText", "a\n")).toBe(true);
      expect(md(editor)).toBe("Start\n\na\n");
      editor.destroy();
    });

    it("keeps an intentional blank line in the middle", () => {
      const editor = makeEditor("Start");
      cursorAfter(editor, "Start");
      expect(runEditorCommand(editor, "pasteAsText", "a\n\nb")).toBe(true);
      expect(md(editor)).toBe("Start\n\na\n\n\n\nb\n");
      editor.destroy();
    });

    it("inherits the destination marks", () => {
      const editor = makeEditor("Hello **bold**");
      cursorAfter(editor, "bold");
      expect(runEditorCommand(editor, "pasteAsText", "x")).toBe(true);
      let marked = false;
      editor.state.doc.descendants((node) => {
        if (node.isText && node.text === "x" && node.marks.some((m) => m.type.name === "bold")) {
          marked = true;
        }
      });
      expect(marked).toBe(true);
      expect(md(editor)).toBe("Hello **bold**\n\n**x**\n");
      editor.destroy();
    });

    it("rejects an empty payload", () => {
      const editor = makeEditor("Start");
      cursorAfter(editor, "Start");
      expect(runEditorCommand(editor, "pasteAsText", "")).toBe(false);
      expect(md(editor)).toBe("Start\n");
      editor.destroy();
    });
  });

  describe("spellcheck (plan 02 §2.8, issue #36)", () => {
    it("toggles the contenteditable attribute and reports active state", () => {
      const editor = makeEditor("Hello world");
      const dom = editor.view.dom as HTMLElement;
      // The app editor initializes the attribute from settings; a bare
      // editor (like this test) has no attribute, which reads as off.
      expect(spellcheckOf(editor)).toBe(false);
      expect(editorCommandActive(editor, "spellcheck")).toBe(false);

      expect(runEditorCommand(editor, "spellcheck")).toBe(true);
      expect(dom.getAttribute("spellcheck")).toBe("true");
      expect(spellcheckOf(editor)).toBe(true);
      expect(editorCommandActive(editor, "spellcheck")).toBe(true);

      expect(runEditorCommand(editor, "spellcheck")).toBe(true);
      expect(dom.getAttribute("spellcheck")).toBe("false");
      expect(spellcheckOf(editor)).toBe(false);
      editor.destroy();
    });

    it("applyViewSettings restores a persisted off state on mount", () => {
      const editor = makeEditor("Hello world");
      applyViewSettings(editor, {
        lineSpacing: "single",
        wordWrap: true,
        showMarks: false,
        zoom: 100,
        spellcheck: false,
      });
      expect((editor.view.dom as HTMLElement).getAttribute("spellcheck")).toBe("false");
      expect(spellcheckOf(editor)).toBe(false);
      expect(editorCommandActive(editor, "spellcheck")).toBe(false);
      editor.destroy();
    });

    it("never mutates the document", () => {
      const editor = makeEditor("# Title\n\nHello **world**\n\n- a\n- b\n");
      const before = md(editor);
      cursorAfter(editor, "Hello");
      runEditorCommand(editor, "spellcheck");
      runEditorCommand(editor, "spellcheck");
      expect(md(editor)).toBe(before);
      editor.destroy();
    });
  });

  describe("view-level commands never mutate the document", () => {
    it("round-trip stays identical after lineSpacing, showMarks, wordWrap, zoom, alignment", () => {
      const editor = makeEditor("# Title\n\nHello **world**\n\n- a\n- b\n");
      const before = md(editor);
      cursorAfter(editor, "Hello");
      runEditorCommand(editor, "lineSpacing", "double");
      runEditorCommand(editor, "showMarks");
      runEditorCommand(editor, "wordWrap");
      runEditorCommand(editor, "zoom", "in");
      runEditorCommand(editor, "alignCenter");
      runEditorCommand(editor, "spellcheck");
      expect(md(editor)).toBe(before);
      editor.destroy();
    });
  });

  describe("dispatch plumbing", () => {
    it("forwards the optional param through the listener", () => {
      const seen: Array<[EditorCommandId, EditorCommandParam?]> = [];
      const unregister = registerEditorCommandListener((id, param) => {
        seen.push([id, param]);
      });
      expect(dispatchEditorCommand("lineSpacing", "1.5")).toBe(true);
      expect(dispatchEditorCommand("zoom")).toBe(true);
      expect(seen).toEqual([
        ["lineSpacing", "1.5"],
        ["zoom", undefined],
      ]);
      unregister();
      expect(dispatchEditorCommand("zoom")).toBe(false);
      expect(seen).toHaveLength(2);
    });
  });
});
