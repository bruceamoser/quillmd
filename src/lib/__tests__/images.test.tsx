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
import {
  EDITOR_COMMANDS,
  registerImageInsertListener,
  requestImageInsert,
  runEditorCommand,
  type ImageInsertSource,
} from "../editorCommands";
import { imageSrcForPickedFile, insertImage, validateImageUrl } from "../images";
import ImageDialog from "../../components/ImageDialog";
import type { ImageDialogProps } from "../../components/ImageDialog";

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
    expect(src).toContain("Image.configure({ inline: true })");
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
