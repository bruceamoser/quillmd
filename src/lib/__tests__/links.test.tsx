// @vitest-environment jsdom
// Link dialog (plan 08 task 8.1, issue #76): URL validation, the link mark
// operations (insert/edit/remove), the title round-trip through the
// converter, the registry wiring that opens the dialog, and the dialog
// component's keyboard model.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import {
  EDITOR_COMMANDS,
  registerLinkDialogListener,
  requestLinkDialog,
  runEditorCommand,
} from "../editorCommands";
import {
  applyLink,
  coveringLinkRange,
  readLinkPrefill,
  removeLink,
  validateLinkUrl,
} from "../links";
import type { LinkPrefill } from "../links";
import { LinkWithTitle } from "../../components/Editor";
import LinkDialog from "../../components/LinkDialog";
import type { LinkDialogProps } from "../../components/LinkDialog";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Same link extension as the app editor (Editor.tsx): the title attribute is
// what the tooltip field round-trips through.
function makeEditor(markdown = "Hello world"): Editor {
  return new Editor({
    extensions: [StarterKit, LinkWithTitle.configure({ openOnClick: false, autolink: false })],
    content: markdownToTiptap(markdown),
  });
}

// Collapses the caret to the first occurrence of `text`.
function caretAt(editor: Editor, text: string): void {
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    const p = pos + idx;
    editor.chain().setTextSelection(p).run();
    return false;
  });
}

// Selects the first occurrence of `text`.
function selectText(editor: Editor, text: string): void {
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx === -1) return true;
    editor
      .chain()
      .setTextSelection({ from: pos + idx, to: pos + idx + text.length })
      .run();
    return false;
  });
}

function md(editor: Editor): string {
  return tiptapToMarkdown(editor.getJSON());
}

let roots: Root[] = [];
let editors: Editor[] = [];
let disposers: (() => void)[] = [];

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  for (const root of roots) root.unmount();
  roots = [];
  for (const editor of editors) editor.destroy();
  editors = [];
  for (const dispose of disposers) dispose();
  disposers = [];
});

function trackedEditor(markdown = "Hello world"): Editor {
  const editor = makeEditor(markdown);
  editors.push(editor);
  return editor;
}

describe("validateLinkUrl (plan 08 §2.1)", () => {
  it("accepts the allowed schemes", () => {
    for (const url of [
      "http://example.com",
      "https://example.com/path?query=1#frag",
      "mailto:hello@example.com",
      "tel:+15551234567",
      "https://user:pass@example.com/deep/path",
    ]) {
      expect(validateLinkUrl(url), url).toBeNull();
    }
  });

  it("accepts relative destinations and Windows drive paths", () => {
    for (const url of [
      "notes.md",
      "./notes/2026.md",
      "../other.md",
      "/abs/path.md",
      "#section",
      "//cdn.example.com/lib.js",
      "c:\\notes\\draft.md",
      "C:/Users/me/notes.md",
      "D:/data/report.md",
    ]) {
      expect(validateLinkUrl(url), url).toBeNull();
    }
  });

  it("rejects disallowed schemes", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "vbscript:msgbox 1",
      "ftp://files.example.com/x",
    ]) {
      const err = validateLinkUrl(url);
      expect(err, url).not.toBeNull();
      expect(err).toContain("scheme");
    }
  });

  it("rejects empty and whitespace-only URLs", () => {
    expect(validateLinkUrl("")).toBe("Enter a URL");
    expect(validateLinkUrl("   ")).toBe("Enter a URL");
  });

  it("rejects whitespace inside the URL (the serializer cannot express it)", () => {
    expect(validateLinkUrl("https://x.com/a b")).not.toBeNull();
    expect(validateLinkUrl("https://x.com/a\nb")).not.toBeNull();
  });
});

describe("link title round-trip (pm converter)", () => {
  it("parses [text](url \"title\") into the link mark attrs", () => {
    const json = markdownToTiptap('[with title](https://example.org "Title")\n');
    const text = json.content![0].content![0];
    const mark = text.marks!.find((m) => m.type === "link");
    expect(mark?.attrs).toEqual({ href: "https://example.org", title: "Title" });
  });

  it("round-trips the title byte-identically", () => {
    const src = '[with title](https://example.org "Title").\n';
    expect(tiptapToMarkdown(markdownToTiptap(src))).toBe(src);
  });

  it("round-trips a title-less link and keeps its attr null", () => {
    const json = markdownToTiptap("[x](https://y.com)\n");
    const text = json.content![0].content![0];
    const mark = text.marks!.find((m) => m.type === "link");
    expect(mark?.attrs).toEqual({ href: "https://y.com", title: null });
    expect(tiptapToMarkdown(markdownToTiptap("[x](https://y.com)\n"))).toBe(
      "[x](https://y.com)\n",
    );
  });
});

describe("link mark operations (links.ts)", () => {
  it("applyLink inserts a link over a plain selection", () => {
    const editor = trackedEditor();
    selectText(editor, "Hello");
    expect(applyLink(editor, { href: "https://a.com", title: "", text: "" })).toBe(true);
    expect(md(editor)).toBe("[Hello](https://a.com) world\n");
  });

  it("applyLink replaces the covered text when the text field changed", () => {
    const editor = trackedEditor();
    selectText(editor, "Hello");
    applyLink(editor, { href: "https://a.com", title: "", text: "Hi" });
    expect(md(editor)).toBe("[Hi](https://a.com) world\n");
  });

  it("applyLink uses the URL as the display text for an empty caret", () => {
    const editor = trackedEditor();
    editor.chain().setTextSelection(0).run();
    applyLink(editor, { href: "https://a.com", title: "", text: "" });
    // Display text equal to the URL serializes in the mdast autolink form.
    expect(md(editor)).toBe("<https://a.com>Hello world\n");
  });

  it("applyLink writes the tooltip into the markdown title", () => {
    const editor = trackedEditor();
    selectText(editor, "Hello");
    applyLink(editor, { href: "https://a.com", title: "Tip", text: "" });
    expect(md(editor)).toBe('[Hello](https://a.com "Tip") world\n');
  });

  it("applyLink edits the link under the caret", () => {
    const editor = trackedEditor("[old](https://old.com)\n");
    caretAt(editor, "old");
    applyLink(editor, { href: "https://new.com", title: "T", text: "" });
    expect(md(editor)).toBe('[old](https://new.com "T")\n');
  });

  it("applyLink rejects an invalid URL and leaves the document untouched", () => {
    const editor = trackedEditor();
    selectText(editor, "Hello");
    expect(applyLink(editor, { href: "javascript:alert(1)", title: "", text: "" })).toBe(false);
    expect(md(editor)).toBe("Hello world\n");
  });

  it("removeLink strips the mark and keeps the text", () => {
    const editor = trackedEditor("[old](https://old.com)\n");
    caretAt(editor, "old");
    expect(removeLink(editor)).toBe(true);
    expect(md(editor)).toBe("old\n");
  });

  it("removeLink is a no-op outside a link", () => {
    const editor = trackedEditor();
    caretAt(editor, "Hello");
    expect(removeLink(editor)).toBe(false);
    expect(md(editor)).toBe("Hello world\n");
  });

  it("coveringLinkRange grows a partial selection to the full link", () => {
    const editor = trackedEditor("[old link text](https://old.com)\n");
    selectText(editor, "d l"); // "d l" inside "old link text"
    const range = coveringLinkRange(editor);
    expect(range).not.toBeNull();
    expect(editor.state.doc.textBetween(range!.from, range!.to)).toBe("old link text");
  });

  it("readLinkPrefill prefills the link under the caret", () => {
    const editor = trackedEditor('[old](https://old.com "Tip")\n');
    caretAt(editor, "old");
    expect(readLinkPrefill(editor)).toEqual({
      href: "https://old.com",
      title: "Tip",
      text: "old",
      isEditing: true,
    });
  });

  it("readLinkPrefill prefills a plain selection as display text", () => {
    const editor = trackedEditor();
    selectText(editor, "Hello");
    expect(readLinkPrefill(editor)).toEqual({
      href: "",
      title: "",
      text: "Hello",
      isEditing: false,
    });
  });

  it("readLinkPrefill is empty for a caret with no selection", () => {
    const editor = trackedEditor();
    editor.chain().setTextSelection(0).run();
    expect(readLinkPrefill(editor)).toEqual({
      href: "",
      title: "",
      text: "",
      isEditing: false,
    });
  });
});

describe("plain-URL paste (plan 08 scope 2)", () => {
  it("pasting a bare URL over a selection turns the selection into a link", () => {
    const editor = trackedEditor("click here now\n");
    selectText(editor, "click here");

    // The link extension's paste handler reads event.clipboardData, so a
    // synthetic paste event carries the clipboard payload.
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: (type: string) => (type === "text/plain" ? "https://example.com" : ""),
      },
    });
    act(() => {
      editor.view.dom.dispatchEvent(event);
    });
    expect(md(editor)).toBe("[click here](https://example.com) now\n");
  });
});

describe("registry wiring (issue #76)", () => {
  it("the link command requests the dialog for the live editor", () => {
    const editor = trackedEditor();
    const seen: Editor[] = [];
    const dispose = registerLinkDialogListener((e) => seen.push(e));
    disposers.push(dispose);

    selectText(editor, "Hello");
    expect(runEditorCommand(editor, "link")).toBe(true);
    expect(seen).toEqual([editor]);
    // The command itself edits nothing; the dialog's result does.
    expect(md(editor)).toBe("Hello world\n");
  });

  it("the link command is a no-op without a dialog renderer", () => {
    const editor = trackedEditor();
    selectText(editor, "Hello");
    expect(requestLinkDialog(editor)).toBe(false);
    expect(md(editor)).toBe("Hello world\n");
  });

  it("the registry entry keeps its label and shortcut", () => {
    const link = EDITOR_COMMANDS.filter((cmd) => cmd.id === "link");
    expect(link).toHaveLength(1);
    expect(link[0].label).toBe("Link");
    expect(link[0].shortcut).toBe("Ctrl+K");
  });

  it("the legacy window.prompt link flow is gone from the registry", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "editorCommands.ts"), "utf8");
    expect(src).not.toContain('window.prompt("Link URL")');
  });
});

describe("LinkDialog component", () => {
  interface Harness {
    container: HTMLDivElement;
    props: {
      prefill: LinkPrefill;
      onApply: ReturnType<typeof vi.fn>;
      onRemove: ReturnType<typeof vi.fn>;
      onOpen: ReturnType<typeof vi.fn>;
      onClose: ReturnType<typeof vi.fn>;
    };
    type: (el: HTMLInputElement, value: string) => void;
    input: (label: string) => HTMLInputElement;
    button: (text: string) => HTMLButtonElement;
  }

  // Types into a React-controlled input: the native value setter is used so
  // React's value tracker sees the change and the input event is processed.
  function type(el: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function renderDialog(
    prefill: LinkPrefill = {
      href: "https://old.com",
      title: "Old",
      text: "old",
      isEditing: true,
    },
  ): Harness {
    const props = {
      prefill,
      onApply: vi.fn(),
      onRemove: vi.fn(),
      onOpen: vi.fn(),
      onClose: vi.fn(),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      const dialogProps = props as unknown as LinkDialogProps;
      root.render(<LinkDialog {...dialogProps} />);
    });
    return {
      container,
      props,
      type,
      input: (label) => {
        const field = Array.from(
          container.querySelectorAll<HTMLLabelElement>(".quillmd-link-field"),
        ).find((l) => l.querySelector(".quillmd-link-label")?.textContent === label);
        return field!.querySelector("input") as HTMLInputElement;
      },
      button: (text) =>
        Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
          (b) => b.textContent === text
        )!,
    };
  }

  it("opens prefilled in edit mode with the URL focused and selected", () => {
    const { container } = renderDialog();
    const url = container.querySelector<HTMLInputElement>(".quillmd-link-input")!;
    expect(url.value).toBe("https://old.com");
    expect(container.querySelector(".quillmd-link-title")!.textContent).toBe("Edit Link");
    expect(document.activeElement).toBe(url);
    expect(url.selectionStart).toBe(0);
    expect(url.selectionEnd).toBe(url.value.length);
  });

  it("saves on Enter with the field values", async () => {
    const h = renderDialog();
    act(() => {
      h.input("URL").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
      );
    });
    expect(h.props.onApply).toHaveBeenCalledTimes(1);
    expect(h.props.onApply).toHaveBeenCalledWith({
      href: "https://old.com",
      title: "Old",
      text: "old",
    });
  });

  it("cancels on Esc", () => {
    const h = renderDialog();
    act(() => {
      h.input("Tooltip").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
    });
    expect(h.props.onClose).toHaveBeenCalledTimes(1);
    expect(h.props.onApply).not.toHaveBeenCalled();
  });

  it("refuses an invalid scheme and shows the error", async () => {
    const h = renderDialog({ href: "", title: "", text: "x", isEditing: false });
    act(() => {
      h.type(h.input("URL"), "javascript:alert(1)");
    });
    // Live validation flags the field; Enter still refuses to submit.
    expect(h.input("URL").classList.contains("error")).toBe(true);
    act(() => {
      h.input("URL").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
      );
    });
    expect(h.props.onApply).not.toHaveBeenCalled();
    expect(h.container.querySelector(".quillmd-link-error")!.textContent).toContain(
      "scheme"
    );
  });

  it("keeps an empty URL from submitting", async () => {
    const h = renderDialog({ href: "", title: "", text: "", isEditing: false });
    act(() => {
      h.input("URL").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
      );
    });
    expect(h.props.onApply).not.toHaveBeenCalled();
    expect(h.container.querySelector(".quillmd-link-error")!.textContent).toBe(
      "Enter a URL"
    );
  });

  it("shows Remove link only when editing, and calls onRemove", () => {
    const h = renderDialog();
    const remove = h.button("Remove link");
    expect(remove).toBeTruthy();
    act(() => {
      remove!.click();
    });
    expect(h.props.onRemove).toHaveBeenCalledTimes(1);
    expect(h.props.onApply).not.toHaveBeenCalled();

    const fresh = renderDialog({ href: "", title: "", text: "x", isEditing: false });
    expect(fresh.button("Remove link")).toBeUndefined();
  });

  it("Open calls onOpen with the URL and leaves Save available", () => {
    const h = renderDialog();
    act(() => {
      h.button("Open").click();
    });
    expect(h.props.onOpen).toHaveBeenCalledWith("https://old.com");
  });

  it("a backdrop press cancels; a press inside the dialog does not", () => {
    const h = renderDialog();
    act(() => {
      h.container
        .querySelector(".quillmd-link-overlay")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h.props.onClose).toHaveBeenCalledTimes(1);

    const h2 = renderDialog();
    act(() => {
      h2.container
        .querySelector(".quillmd-link-dialog")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h2.props.onClose).not.toHaveBeenCalled();
  });
});
