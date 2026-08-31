// @vitest-environment jsdom
// Image submenu + from-URL (plan 08 task 8.2, issue #77): URL validation,
// the image insert, the From file src computation, the registry wiring that
// splits the old prompt flow into the two insert requests, and the dialog
// component's keyboard model.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { createDocument, encodeDocument, saveDocument } from "../pipeline";
import {
  EDITOR_COMMANDS,
  registerImageEditDialogListener,
  registerImageInsertListener,
  requestImageEditDialog,
  requestImageInsert,
  runEditorCommand,
  type ImageInsertSource,
} from "../editorCommands";
import {
  applyImageEdit,
  imageAtCaret,
  imageSrcForPickedFile,
  insertImage,
  normalizeImageWidth,
  readImagePrefill,
  validateImageUrl,
  validateImageWidth,
} from "../images";
import ImageDialog from "../../components/ImageDialog";
import type { ImageDialogProps } from "../../components/ImageDialog";
import ImageEditDialog from "../../components/ImageEditDialog";
import type { ImageEditDialogProps } from "../../components/ImageEditDialog";
import { ImageWithWidth } from "../../components/Editor";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Same image extension as the app editor (Editor.tsx): inline, so inserted
// images land in a paragraph and survive tiptapToMarkdown.
function makeEditor(markdown = "Hello world"): Editor {
  return new Editor({
    extensions: [StarterKit, Image.configure({ inline: true })],
    content: markdownToTiptap(markdown),
  });
}

// The width-carrying image node (plan 08 task 8.4, issue #79): the same
// ImageWithWidth extension the app editor uses, so the width attribute is
// present for the edit-dialog tests.
function makeWidthEditor(markdown = "Hello world"): Editor {
  return new Editor({
    extensions: [StarterKit, ImageWithWidth.configure({ inline: true })],
    content: markdownToTiptap(markdown),
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

describe("validateImageUrl (plan 08 §2.4)", () => {
  it("accepts http/https destinations", () => {
    for (const url of [
      "http://example.com/photo.png",
      "https://example.com/path?q=1#f",
      "HTTPS://EXAMPLE.COM/UPPER.PNG",
    ]) {
      expect(validateImageUrl(url), url).toBeNull();
    }
  });

  it("accepts relative destinations and Windows drive paths", () => {
    for (const url of [
      "photo.png",
      "images/photo.png",
      "./assets/pic.jpg",
      "../other/photo.png",
      "c:\\photos\\a.png",
      "C:/Users/me/photos/a.png",
    ]) {
      expect(validateImageUrl(url), url).toBeNull();
    }
  });

  it("rejects disallowed schemes", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:image/png;base64,AAA",
      "vbscript:msgbox 1",
      "ftp://files.example.com/x.png",
    ]) {
      const err = validateImageUrl(url);
      expect(err, url).not.toBeNull();
      expect(err).toContain("scheme");
    }
  });

  it("rejects empty and whitespace-only URLs", () => {
    expect(validateImageUrl("")).toBe("Enter a URL");
    expect(validateImageUrl("   ")).toBe("Enter a URL");
  });

  it("rejects whitespace inside the URL (the serializer cannot express it)", () => {
    expect(validateImageUrl("https://x.com/a b.png")).not.toBeNull();
    expect(validateImageUrl("https://x.com/a\nb.png")).not.toBeNull();
  });
});

describe("insertImage (images.ts)", () => {
  it("inserts a bare image for an empty alt", () => {
    const editor = trackedEditor();
    editor.chain().setTextSelection(0).run();
    expect(insertImage(editor, { src: "https://a.com/p.png", alt: "" })).toBe(true);
    expect(md(editor)).toBe("![](https://a.com/p.png)Hello world\n");
  });

  it("writes the alt text into the markdown", () => {
    const editor = trackedEditor();
    editor.chain().setTextSelection(0).run();
    insertImage(editor, { src: "images/p.png", alt: "A cat" });
    expect(md(editor)).toBe("![A cat](images/p.png)Hello world\n");
  });

  it("trims the fields", () => {
    const editor = trackedEditor();
    editor.chain().setTextSelection(0).run();
    insertImage(editor, { src: "  https://a.com/p.png  ", alt: "  Padded  " });
    expect(md(editor)).toBe("![Padded](https://a.com/p.png)Hello world\n");
  });

  it("rejects an invalid URL and leaves the document untouched", () => {
    const editor = trackedEditor();
    editor.chain().setTextSelection(0).run();
    expect(insertImage(editor, { src: "javascript:alert(1)", alt: "" })).toBe(false);
    expect(md(editor)).toBe("Hello world\n");
  });
});

describe("imageSrcForPickedFile (plan 08 §3 relative-path invariant)", () => {
  it("relativizes a pick against the doc folder", () => {
    expect(imageSrcForPickedFile("/docs/notes.md", "/docs/assets/photo.png")).toBe(
      "assets/photo.png",
    );
    expect(imageSrcForPickedFile("/docs/notes.md", "/docs/photo.png")).toBe("photo.png");
  });

  it("climbs out of the doc folder with .. segments", () => {
    expect(imageSrcForPickedFile("/docs/nested/notes.md", "/docs/photo.png")).toBe(
      "../photo.png",
    );
    expect(imageSrcForPickedFile("/docs/notes.md", "/other/photo.png")).toBe(
      "../other/photo.png",
    );
  });

  it("uses forward slashes for Windows paths, case-insensitively", () => {
    expect(imageSrcForPickedFile("C:\\docs\\notes.md", "C:\\docs\\assets\\p.png")).toBe(
      "assets/p.png",
    );
    expect(imageSrcForPickedFile("c:\\docs\\notes.md", "C:\\docs\\p.png")).toBe("p.png");
  });

  it("falls back to the file name when the doc has no folder", () => {
    expect(imageSrcForPickedFile("", "/docs/assets/photo.png")).toBe("photo.png");
    expect(imageSrcForPickedFile(":new:1", "C:\\photos\\a.png")).toBe("a.png");
  });

  it("passes through browser-dev picks keyed by bare name", () => {
    expect(imageSrcForPickedFile("/docs/notes.md", "photo.png")).toBe("photo.png");
  });
});

describe("registry wiring (issue #77)", () => {
  it("the image command requests the dialog for the live editor", () => {
    const editor = trackedEditor();
    const seen: { editor: Editor; source: ImageInsertSource }[] = [];
    const dispose = registerImageInsertListener((e, source) =>
      seen.push({ editor: e, source }),
    );
    disposers.push(dispose);

    expect(runEditorCommand(editor, "image")).toBe(true);
    expect(seen).toEqual([{ editor, source: "url" }]);
    // The command itself edits nothing; the dialog's result does.
    expect(md(editor)).toBe("Hello world\n");
  });

  it("the imageFromFile command requests the file flow", () => {
    const editor = trackedEditor();
    const seen: ImageInsertSource[] = [];
    const dispose = registerImageInsertListener((_e, source) => seen.push(source));
    disposers.push(dispose);

    expect(runEditorCommand(editor, "imageFromFile")).toBe(true);
    expect(seen).toEqual(["file"]);
  });

  it("both commands are no-ops without a renderer", () => {
    const editor = trackedEditor();
    expect(requestImageInsert(editor, "url")).toBe(false);
    expect(requestImageInsert(editor, "file")).toBe(false);
    expect(md(editor)).toBe("Hello world\n");
  });

  it("the registry carries both image entries", () => {
    const ids = EDITOR_COMMANDS.map((cmd) => cmd.id);
    expect(ids).toContain("image");
    expect(ids).toContain("imageFromFile");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the legacy window.prompt image flow is gone from the registry", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "editorCommands.ts"), "utf8");
    expect(src).not.toContain('window.prompt("Image URL")');
    expect(src).not.toContain('window.prompt("Alt text (optional)")');
  });

  // Regression guard: a block-level image node is dropped by
  // tiptapToMarkdown, so the app editor must keep images inline.
  it("the app editor keeps images inline", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "..", "components", "Editor.tsx"), "utf8");
    expect(src).toContain("ImageWithWidth.configure({ inline: true })");
  });
});

describe("ImageDialog component", () => {
  interface Harness {
    container: HTMLDivElement;
    props: {
      onApply: ReturnType<typeof vi.fn>;
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

  function renderDialog(): Harness {
    const props = {
      onApply: vi.fn(),
      onClose: vi.fn(),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      const dialogProps = props as unknown as ImageDialogProps;
      root.render(<ImageDialog {...dialogProps} />);
    });
    return {
      container,
      props,
      type,
      input: (label) => {
        const field = Array.from(
          container.querySelectorAll<HTMLLabelElement>(".quillmd-image-field"),
        ).find((l) => l.querySelector(".quillmd-image-label")?.textContent === label);
        return field!.querySelector("input") as HTMLInputElement;
      },
      button: (text) =>
        Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
          (b) => b.textContent === text
        )!,
    };
  }

  it("opens with the URL focused and selected", () => {
    const { container } = renderDialog();
    const url = container.querySelector<HTMLInputElement>(".quillmd-image-input")!;
    expect(container.querySelector(".quillmd-image-title")!.textContent).toBe(
      "Insert Image",
    );
    expect(document.activeElement).toBe(url);
    expect(url.selectionStart).toBe(0);
    expect(url.selectionEnd).toBe(0);
  });

  it("inserts on Enter with the field values", async () => {
    const h = renderDialog();
    act(() => {
      h.type(h.input("URL"), "https://a.com/p.png");
    });
    act(() => {
      h.type(h.input("Alt text"), "A cat");
    });
    act(() => {
      h.input("URL").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
      );
    });
    expect(h.props.onApply).toHaveBeenCalledTimes(1);
    expect(h.props.onApply).toHaveBeenCalledWith({
      src: "https://a.com/p.png",
      alt: "A cat",
    });
  });

  it("cancels on Esc", () => {
    const h = renderDialog();
    act(() => {
      h.input("Alt text").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
    });
    expect(h.props.onClose).toHaveBeenCalledTimes(1);
    expect(h.props.onApply).not.toHaveBeenCalled();
  });

  it("refuses an invalid scheme and shows the error", async () => {
    const h = renderDialog();
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
    expect(h.container.querySelector(".quillmd-image-error")!.textContent).toContain(
      "scheme"
    );
  });

  it("keeps an empty URL from submitting", async () => {
    const h = renderDialog();
    act(() => {
      h.input("URL").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
      );
    });
    expect(h.props.onApply).not.toHaveBeenCalled();
    expect(h.container.querySelector(".quillmd-image-error")!.textContent).toBe(
      "Enter a URL"
    );
  });

  it("a backdrop press cancels; a press inside the dialog does not", () => {
    const h = renderDialog();
    act(() => {
      h.container
        .querySelector(".quillmd-image-overlay")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h.props.onClose).toHaveBeenCalledTimes(1);

    const h2 = renderDialog();
    act(() => {
      h2.container
        .querySelector(".quillmd-image-dialog")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h2.props.onClose).not.toHaveBeenCalled();
  });
});

// --- image edit dialog (plan 08 task 8.4, issue #79) -------------------------

describe("normalizeImageWidth / validateImageWidth (plan 08 §2.5)", () => {
  it("normalizes pixel widths to a bare number", () => {
    for (const [input, expected] of [
      ["320", "320"],
      [" 320 ", "320"],
      ["320px", "320"],
      ["320PX", "320"],
      ["0.5", "0.5"],
      ["32.5px", "32.5"],
      ["", ""],
    ] as const) {
      expect(normalizeImageWidth(input), input).toBe(expected);
    }
  });

  it("normalizes percent widths, keeping the percent sign", () => {
    expect(normalizeImageWidth("50%")).toBe("50%");
    expect(normalizeImageWidth(" 50% ")).toBe("50%");
    expect(normalizeImageWidth("33.5%")).toBe("33.5%");
  });

  it("rejects anything that is not pixels or a percent", () => {
    for (const input of ["abc", "32 px", "50 %", "100em", "-5", "3.2.1", "32%px"]) {
      expect(normalizeImageWidth(input), input).toBeNull();
    }
  });

  it("validateImageWidth reports null for accepted widths", () => {
    for (const input of ["", "320", "320px", "50%", "0.5"]) {
      expect(validateImageWidth(input), input).toBeNull();
    }
  });

  it("validateImageWidth names the error for rejected widths", () => {
    const err = validateImageWidth("32 px");
    expect(err).not.toBeNull();
    expect(err).toContain("pixels");
    expect(err).toContain("percent");
  });
});

describe("<img> HTML serialization (plan 08 §3, issue #79)", () => {
  it("serializes a width-carrying image to canonical <img> HTML", () => {
    const out = tiptapToMarkdown(
      markdownToTiptap('<img src="sized.png" alt="Sized" width="320">\n'),
    );
    expect(out).toBe('<img src="sized.png" alt="Sized" width="320">\n');
  });

  it("round-trips an inline <img> with a percent width byte-identically", () => {
    const src = 'Before <img src="a.png" alt="A" width="50%"> after.\n';
    expect(tiptapToMarkdown(markdownToTiptap(src))).toBe(src);
  });

  it("re-applies the width on reopen (parse keeps the width attribute)", () => {
    const json = markdownToTiptap('<img src="a.png" alt="A" width="320">\n') as {
      content?: Array<{ content?: Array<{ type: string; attrs?: Record<string, unknown> }> }>;
    };
    const paragraph = json.content?.[0];
    const image = paragraph?.content?.find((n) => n.type === "image");
    expect(image?.type).toBe("image");
    expect(image?.attrs?.src).toBe("a.png");
    expect(image?.attrs?.alt).toBe("A");
    expect(image?.attrs?.width).toBe("320");
  });

  it("keeps a plain markdown image as markdown when it has no width", () => {
    const src = "![Alt](a.png)\n";
    expect(tiptapToMarkdown(markdownToTiptap(src))).toBe(src);
  });

  it("keeps a markdown image with a title as markdown (no width)", () => {
    const src = '![Alt](a.png "A title")\n';
    expect(tiptapToMarkdown(markdownToTiptap(src))).toBe(src);
  });

  // The AC8 document shape (links + 2 images, 1 relative + 1 HTML-width) must
  // survive the WYSIWYG converter byte-identically so the save pipeline keeps
  // every block verbatim on a no-op save.
  it("round-trips the task 8.4 fixture through the WYSIWYG converter", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(here, "..", "..", "..", "fixtures", "clean", "images-edit-width.md"),
      "utf8",
    );
    expect(tiptapToMarkdown(markdownToTiptap(src))).toBe(src);
  });

  // Golden rule 4 (Windows first-class): the task 8.4 document must also
  // survive a CRLF source byte-identically through the real save pipeline
  // (editor re-serializes to LF, encodeDocument restores the CRLF ending).
  it("round-trips the task 8.4 fixture byte-identically on CRLF (save pipeline)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const lf = readFileSync(
      join(here, "..", "..", "..", "fixtures", "clean", "images-edit-width.md"),
      "utf8",
    );
    const crlf = lf.replace(/\n/g, "\r\n");
    const model = createDocument(crlf);
    // Simulate the WYSIWYG editor's output for an untouched doc (LF).
    const editorText = tiptapToMarkdown(markdownToTiptap(crlf));
    const result = saveDocument(model, editorText);
    const bytes = encodeDocument(result.text, { eol: "crlf", bom: false });
    expect(bytes).toEqual(new TextEncoder().encode(crlf));
  });
});

describe("imageAtCaret / readImagePrefill (plan 08 §2.5)", () => {
  it("reads the image under the caret as an editing prefill", () => {
    const editor = trackedEditorFrom(
      makeWidthEditor('<img src="a.png" alt="A" width="320">\n'),
    );
    // Place a node selection over the image.
    const imageNode = findImageNode(editor);
    editor.chain().setNodeSelection(imageNode.pos).run();
    const prefill = readImagePrefill(editor);
    expect(prefill.isEditing).toBe(true);
    expect(prefill.src).toBe("a.png");
    expect(prefill.alt).toBe("A");
    expect(prefill.width).toBe("320");
    expect(prefill.title).toBe("");
  });

  it("returns empty non-editing values when the caret is on plain text", () => {
    const editor = trackedEditorFrom(makeWidthEditor("Hello world"));
    editor.chain().setTextSelection(1).run();
    const prefill = readImagePrefill(editor);
    expect(prefill).toEqual({ src: "", alt: "", title: "", width: "", isEditing: false });
  });

  it("finds the image adjacent to a collapsed caret (click boundary)", () => {
    const editor = trackedEditorFrom(
      makeWidthEditor('<img src="a.png" width="100"> and text\n'),
    );
    // Collapse the caret just after the image (on the boundary).
    const imageNode = findImageNode(editor);
    editor.chain().setTextSelection(imageNode.pos + imageNode.node.nodeSize).run();
    const target = imageAtCaret(editor);
    expect(target).not.toBeNull();
    expect(target?.node.attrs.src).toBe("a.png");
  });
});

describe("applyImageEdit (plan 08 task 8.4, issue #79)", () => {
  it("sets the width, turning the image into HTML form", () => {
    const editor = trackedEditorFrom(makeWidthEditor("![A](a.png)\n"));
    const imageNode = findImageNode(editor);
    editor.chain().setNodeSelection(imageNode.pos).run();
    expect(applyImageEdit(editor, { src: "a.png", alt: "A", width: "320", title: "" })).toBe(
      true,
    );
    expect(md(editor)).toBe('<img src="a.png" alt="A" width="320">\n');
  });

  it("clears the width, returning the image to markdown form", () => {
    const editor = trackedEditorFrom(
      makeWidthEditor('<img src="a.png" alt="A" width="320">\n'),
    );
    const imageNode = findImageNode(editor);
    editor.chain().setNodeSelection(imageNode.pos).run();
    expect(applyImageEdit(editor, { src: "a.png", alt: "A", width: "", title: "" })).toBe(true);
    expect(md(editor)).toBe("![A](a.png)\n");
  });

  it("updates the URL and alt in place", () => {
    const editor = trackedEditorFrom(makeWidthEditor('<img src="a.png" alt="A" width="50%">\n'));
    const imageNode = findImageNode(editor);
    editor.chain().setNodeSelection(imageNode.pos).run();
    applyImageEdit(editor, { src: "b.png", alt: "B", width: "50%", title: "" });
    expect(md(editor)).toBe('<img src="b.png" alt="B" width="50%">\n');
  });

  it("normalizes a px width before writing", () => {
    const editor = trackedEditorFrom(makeWidthEditor("![A](a.png)\n"));
    const imageNode = findImageNode(editor);
    editor.chain().setNodeSelection(imageNode.pos).run();
    applyImageEdit(editor, { src: "a.png", alt: "A", width: "320px", title: "" });
    expect(md(editor)).toBe('<img src="a.png" alt="A" width="320">\n');
  });

  it("carries the title through unedited", () => {
    const editor = trackedEditorFrom(
      makeWidthEditor('<img src="a.png" alt="A" title="T" width="320">\n'),
    );
    const imageNode = findImageNode(editor);
    editor.chain().setNodeSelection(imageNode.pos).run();
    applyImageEdit(editor, { src: "a.png", alt: "A", width: "640", title: "T" });
    expect(md(editor)).toBe('<img src="a.png" alt="A" title="T" width="640">\n');
  });

  it("refuses an invalid URL and leaves the document untouched", () => {
    const editor = trackedEditorFrom(makeWidthEditor('<img src="a.png" width="320">\n'));
    const imageNode = findImageNode(editor);
    editor.chain().setNodeSelection(imageNode.pos).run();
    expect(
      applyImageEdit(editor, { src: "javascript:alert(1)", alt: "A", width: "320", title: "" }),
    ).toBe(false);
    expect(md(editor)).toBe('<img src="a.png" width="320">\n');
  });

  it("refuses an invalid width and leaves the document untouched", () => {
    const editor = trackedEditorFrom(makeWidthEditor('<img src="a.png" width="320">\n'));
    const imageNode = findImageNode(editor);
    editor.chain().setNodeSelection(imageNode.pos).run();
    expect(
      applyImageEdit(editor, { src: "a.png", alt: "A", width: "32 px", title: "" }),
    ).toBe(false);
    expect(md(editor)).toBe('<img src="a.png" width="320">\n');
  });
});

describe("imageEdit registry wiring (issue #79)", () => {
  it("the imageEdit command requests the dialog for the live editor", () => {
    const editor = trackedEditorFrom(makeWidthEditor('<img src="a.png" width="320">\n'));
    const seen: Editor[] = [];
    const dispose = registerImageEditDialogListener((e) => seen.push(e));
    disposers.push(dispose);

    expect(runEditorCommand(editor, "imageEdit")).toBe(true);
    expect(seen).toEqual([editor]);
    // The command itself edits nothing; the dialog's result does.
    expect(md(editor)).toBe('<img src="a.png" width="320">\n');
  });

  it("imageEdit is a no-op without a renderer", () => {
    const editor = trackedEditorFrom(makeWidthEditor("Hello world"));
    expect(requestImageEditDialog(editor)).toBe(false);
    expect(md(editor)).toBe("Hello world\n");
  });

  it("the registry carries the imageEdit entry", () => {
    const ids = EDITOR_COMMANDS.map((cmd) => cmd.id);
    expect(ids).toContain("imageEdit");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("ImageEditDialog component", () => {
  interface Harness {
    container: HTMLDivElement;
    props: {
      prefill: {
        src: string;
        alt: string;
        width: string;
        title: string;
        isEditing: boolean;
      };
      onApply: ReturnType<typeof vi.fn>;
      onClose: ReturnType<typeof vi.fn>;
    };
    type: (el: HTMLInputElement, value: string) => void;
    input: (label: string) => HTMLInputElement;
  }

  function type(el: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function renderDialog(prefill?: Partial<ImageEditDialogProps["prefill"]>): Harness {
    const props = {
      prefill: {
        src: "",
        alt: "",
        width: "",
        title: "",
        isEditing: false,
        ...prefill,
      },
      onApply: vi.fn(),
      onClose: vi.fn(),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<ImageEditDialog {...(props as unknown as ImageEditDialogProps)} />);
    });
    return {
      container,
      props,
      type,
      input: (label) => {
        const field = Array.from(
          container.querySelectorAll<HTMLLabelElement>(".quillmd-image-field"),
        ).find((l) => l.querySelector(".quillmd-image-label")?.textContent === label);
        return field!.querySelector("input") as HTMLInputElement;
      },
    };
  }

  it("opens with the URL focused and the prefill values in the fields", () => {
    const h = renderDialog({ src: "a.png", alt: "A", width: "320", isEditing: true });
    const url = h.input("URL");
    expect(h.container.querySelector(".quillmd-image-title")!.textContent).toBe("Edit Image");
    expect(document.activeElement).toBe(url);
    expect(url.value).toBe("a.png");
    expect(h.input("Alt text").value).toBe("A");
    expect(h.input("Width").value).toBe("320");
  });

  it("submits on Enter with the field values and the carried title", () => {
    const h = renderDialog({ src: "a.png", alt: "A", width: "", title: "T", isEditing: true });
    act(() => {
      h.type(h.input("Width"), "320");
    });
    act(() => {
      h.input("Width").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(h.props.onApply).toHaveBeenCalledTimes(1);
    expect(h.props.onApply).toHaveBeenCalledWith({
      src: "a.png",
      alt: "A",
      width: "320",
      title: "T",
    });
  });

  it("cancels on Esc", () => {
    const h = renderDialog();
    act(() => {
      h.input("Alt text").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(h.props.onClose).toHaveBeenCalledTimes(1);
    expect(h.props.onApply).not.toHaveBeenCalled();
  });

  it("refuses an invalid width and shows the error", () => {
    const h = renderDialog({ src: "a.png" });
    act(() => {
      h.type(h.input("Width"), "32 px");
    });
    expect(h.input("Width").classList.contains("error")).toBe(true);
    act(() => {
      h.input("Width").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(h.props.onApply).not.toHaveBeenCalled();
    expect(h.container.querySelector(".quillmd-image-error")!.textContent).toContain("pixels");
  });

  it("refuses an invalid URL scheme and shows the error", () => {
    const h = renderDialog({ src: "javascript:alert(1)" });
    act(() => {
      h.input("URL").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(h.props.onApply).not.toHaveBeenCalled();
    expect(h.container.querySelector(".quillmd-image-error")!.textContent).toContain("scheme");
  });

  it("keeps an empty URL from submitting", () => {
    const h = renderDialog();
    act(() => {
      h.input("URL").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(h.props.onApply).not.toHaveBeenCalled();
    expect(h.container.querySelector(".quillmd-image-error")!.textContent).toBe("Enter a URL");
  });
});

// Helpers for the image edit tests: wrap an editor in the tracked list and
// locate the image node's position for a node selection.
function trackedEditorFrom(editor: Editor): Editor {
  editors.push(editor);
  return editor;
}

function findImageNode(
  editor: Editor,
): { pos: number; node: import("@tiptap/pm/model").Node } {
  let found: { pos: number; node: import("@tiptap/pm/model").Node } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (!found && node.type.name === "image") found = { pos, node };
    return true;
  });
  return found!;
}
