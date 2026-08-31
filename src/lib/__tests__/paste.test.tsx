// @vitest-environment jsdom
// Paste handling (plan 02 task 2.9, issue #36, acceptance #6): a rich Word
// paste keeps bold/italic/links/headings (ProseMirror's native HTML parser),
// while Ctrl+Shift+V strips the clipboard to plain text through the
// pasteAsText registry command. Both paths are driven by one captured
// Word-exported clipboard payload (text/plain + text/html).
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { handleEditorPaste } from "../../components/Editor";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";

// Captured Word-exported clipboard payload: the text/html part is what Word
// puts on the clipboard (mso namespaces, MsoNormal classes), and the
// text/plain part is the same content flattened.
const WORD_HTML = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
</head>
<body lang=EN-US link=blue vlink=purple>
<div class=WordSection1>
<p class=MsoNormal><b>bold text</b> and <i>italic text</i> end</p>
<p class=MsoNormal><a href="https://example.com/page">linked text</a> stays</p>
<h2 style='font-size:16.0pt'>Section heading</h2>
</div>
</body>
</html>`;

const WORD_TEXT = "bold text and italic text end\nlinked text stays\nSection heading\n";

function makeEditor(markdown = "Start"): Editor {
  // Wire the same handlePaste hook the app editor installs (Editor.tsx
  // editorProps), so view.pasteHTML runs the full production paste path:
  // ProseMirror parses the clipboard, then the hook gets first refusal.
  let editor: Editor;
  editor = new Editor({
    // StarterKit + Link covers every mark/construct in the Word sample the
    // same way the app editor does (bold/italic/heading/paragraph/link).
    extensions: [StarterKit, Link.configure({ openOnClick: false, autolink: true })],
    content: markdownToTiptap(markdown),
    editorProps: {
      handlePaste: (_view, event): boolean => handleEditorPaste(editor, event),
    },
  });
  return editor;
}

// Put the cursor right after the first occurrence of `text` in the document
// so the paste lands at a deterministic position.
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

// jsdom has no ClipboardEvent/DataTransfer, so the captured clipboard payload
// is attached to a plain cancelable Event — the same shape
// handleEditorPaste reads (modifier keys + clipboardData.getData). By default
// the event reports the modifiers through getModifierState, exactly like a
// browser ClipboardEvent (a UIEvent with no ctrlKey/shiftKey properties).
function pasteEvent(opts: {
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  text?: string;
  html?: string;
  /** Omit the getModifierState method to exercise the property fallback. */
  propertyModifiersOnly?: boolean;
}): Event {
  const ctrl = opts.ctrl ?? false;
  const meta = opts.meta ?? false;
  const shift = opts.shift ?? false;
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.assign(event, {
    ctrlKey: ctrl,
    metaKey: meta,
    shiftKey: shift,
    clipboardData: {
      getData: (type: string) => {
        if (type === "text/plain") return opts.text ?? "";
        if (type === "text/html") return opts.html ?? "";
        return "";
      },
    },
  });
  if (!opts.propertyModifiersOnly) {
    Object.assign(event, {
      getModifierState: (key: string) =>
        key === "Control" ? ctrl : key === "Meta" ? meta : key === "Shift" ? shift : false,
    });
  }
  return event;
}

let editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

describe("paste as text, Ctrl+Shift+V (plan 02 task 2.9, issue #36)", () => {
  it("strips the captured Word payload to plain text only", () => {
    const editor = makeEditor("Start");
    editors.push(editor);
    cursorAfter(editor, "Start");
    const event = pasteEvent({ ctrl: true, shift: true, text: WORD_TEXT, html: WORD_HTML });

    // The full production path: ProseMirror's paste logic parses the
    // clipboard and hands the event to the handlePaste hook, which
    // intercepts the shifted paste before the rich slice is inserted.
    expect(editor.view.pasteHTML(WORD_HTML, event as unknown as ClipboardEvent)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    // The plain-text parts survive as their own paragraphs; none of the
    // Word markup (bold/italic/link/heading) makes it into the document.
    expect(md(editor)).toBe(
      "Start\n\nbold text and italic text end\n\nlinked text stays\n\nSection heading\n",
    );
    expect(md(editor)).not.toContain("**");
    expect(md(editor)).not.toContain("*");
    expect(md(editor)).not.toContain("](");
    expect(md(editor)).not.toContain("## ");
  });

  it("honors Cmd+Shift+V on macOS", () => {
    const editor = makeEditor("Start");
    editors.push(editor);
    cursorAfter(editor, "Start");
    const event = pasteEvent({ meta: true, shift: true, text: "plain" });

    expect(handleEditorPaste(editor, event as unknown as ClipboardEvent)).toBe(true);
    expect(md(editor)).toBe("Start\n\nplain\n");
  });

  it("leaves a plain Ctrl+V to the native rich paste", () => {
    const editor = makeEditor("Start");
    editors.push(editor);
    cursorAfter(editor, "Start");
    const event = pasteEvent({ ctrl: true, text: WORD_TEXT, html: WORD_HTML });

    // Returning false is what keeps ProseMirror's built-in HTML paste.
    expect(handleEditorPaste(editor, event as unknown as ClipboardEvent)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores a paste with no clipboard text", () => {
    const editor = makeEditor("Start");
    editors.push(editor);
    cursorAfter(editor, "Start");
    const event = pasteEvent({ ctrl: true, shift: true, text: "" });

    expect(handleEditorPaste(editor, event as unknown as ClipboardEvent)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(md(editor)).toBe("Start\n");
  });

  it("ignores an unmodified paste", () => {
    const editor = makeEditor("Start");
    editors.push(editor);
    cursorAfter(editor, "Start");
    const event = pasteEvent({ text: "x" });

    expect(handleEditorPaste(editor, event as unknown as ClipboardEvent)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(md(editor)).toBe("Start\n");
  });

  it("still intercepts when the event only exposes modifier properties", () => {
    // Synthetic events (and older webviews) may lack getModifierState; the
    // ctrlKey/shiftKey property fallback keeps the shortcut working there.
    const editor = makeEditor("Start");
    editors.push(editor);
    cursorAfter(editor, "Start");
    const event = pasteEvent({ ctrl: true, shift: true, text: "plain", propertyModifiersOnly: true });

    expect(handleEditorPaste(editor, event as unknown as ClipboardEvent)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(md(editor)).toBe("Start\n\nplain\n");
  });
});

describe("rich Word paste keeps markup (acceptance #6)", () => {
  it("keeps bold/italic/links/headings from the captured clipboard payload", () => {
    // Paste into an empty doc so the Word blocks land verbatim (pasting at
    // the end of a text run merges the first pasted paragraph into it, per
    // ProseMirror's standard replaceSelection behavior).
    const editor = makeEditor("");
    editors.push(editor);
    editor.chain().setTextSelection(1).run();
    // The same code path ProseMirror's built-in paste handler runs for a
    // plain Ctrl+V: parse the clipboard's text/html into the schema. The
    // handlePaste hook sees the unmodified event, declines it, and the
    // parsed rich slice is inserted.
    const event = pasteEvent({ ctrl: true, text: WORD_TEXT, html: WORD_HTML });
    expect(editor.view.pasteHTML(WORD_HTML, event as unknown as ClipboardEvent)).toBe(true);
    expect(event.defaultPrevented).toBe(false);

    expect(md(editor)).toBe(
      "**bold text** and *italic text* end\n\n[linked text](https://example.com/page) stays\n\n## Section heading\n",
    );
  });
});
