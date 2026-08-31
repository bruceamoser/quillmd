// @vitest-environment jsdom
// Open links + broken-image placeholder (plan 08 task 8.5, issue #80):
// middle-click in the WYSIWYG editor and the preview opens links through
// plugin-opener (AC7), and a local image whose file is gone renders as the
// named placeholder with a working "Re-link…" button while the document
// bytes stay untouched (AC6).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { currentFindEditor } from "../find";
import EditorComponent, {
  handleEditorMiddleClick,
  imagePlaceholderRuntime,
  ImageWithWidth,
  linkHrefAt,
  LinkWithTitle,
} from "../../components/Editor";
import { middleClickLinkHref, openLinkUrl } from "../links";

// The placeholder node view and the middle-click handler both open through
// links.ts's openLinkUrl (plugin-opener under Tauri); spy on it so the tests
// never touch the real opener.
vi.mock("../links", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../links")>();
  return { ...actual, openLinkUrl: vi.fn(async () => {}) };
});

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];
let editors: Editor[] = [];

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  for (const root of roots) root.unmount();
  roots = [];
  for (const editor of editors) editor.destroy();
  editors = [];
  imagePlaceholderRuntime.missing = new Set();
  imagePlaceholderRuntime.onReLink = null;
  vi.mocked(openLinkUrl).mockClear();
});

// The same link extension config as the app editor (Editor.tsx): autolink on
// keeps the link mark inclusive, which is what linkHrefAt's boundary
// resolution (marks() at the click position) relies on.
function makeLinkEditor(markdown = "Hello world"): Editor {
  const editor = new Editor({
    extensions: [StarterKit, LinkWithTitle.configure({ openOnClick: false, autolink: true })],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  return editor;
}

// The position of the first occurrence of `text`.
function posOf(editor: Editor, text: string): number {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null || !node.isText) return true;
    const idx = node.text!.indexOf(text);
    if (idx !== -1) found = pos + idx;
    return true;
  });
  if (found === null) throw new Error(`text not found: ${text}`);
  return found;
}

describe("linkHrefAt (plan 08 task 8.5, issue #80)", () => {
  it("reads the href of the link mark at a position", () => {
    const editor = makeLinkEditor("[site](https://example.com/page) end\n");
    const pos = posOf(editor, "site");
    expect(linkHrefAt(editor.view, pos)).toBe("https://example.com/page");
    expect(linkHrefAt(editor.view, pos + 1)).toBe("https://example.com/page");
  });

  it("is null at positions without a link", () => {
    const editor = makeLinkEditor("[site](https://example.com) end\n");
    const pos = posOf(editor, "end");
    expect(linkHrefAt(editor.view, pos)).toBeNull();
  });
});

describe("handleEditorMiddleClick (plan 08 task 8.5, issue #80, AC7)", () => {
  it("opens the link at the click position and consumes the event", () => {
    const editor = makeLinkEditor("[site](https://example.com/page) end\n");
    const pos = posOf(editor, "site");
    editor.view.posAtCoords = vi.fn(() => ({ pos })) as never;
    const event = new MouseEvent("auxclick", { button: 1, clientX: 10, clientY: 10 });
    expect(handleEditorMiddleClick(editor.view, event)).toBe(true);
    expect(openLinkUrl).toHaveBeenCalledWith("https://example.com/page");
  });

  it("leaves non-middle buttons alone", () => {
    const editor = makeLinkEditor("[site](https://example.com) end\n");
    const pos = posOf(editor, "site");
    editor.view.posAtCoords = vi.fn(() => ({ pos })) as never;
    for (const button of [0, 2]) {
      const event = new MouseEvent("auxclick", { button, clientX: 10, clientY: 10 });
      expect(handleEditorMiddleClick(editor.view, event), `button ${button}`).toBe(false);
    }
    expect(openLinkUrl).not.toHaveBeenCalled();
  });

  it("leaves middle clicks off links alone", () => {
    const editor = makeLinkEditor("plain text only\n");
    const pos = posOf(editor, "text");
    editor.view.posAtCoords = vi.fn(() => ({ pos })) as never;
    const event = new MouseEvent("auxclick", { button: 1, clientX: 10, clientY: 10 });
    expect(handleEditorMiddleClick(editor.view, event)).toBe(false);
    expect(openLinkUrl).not.toHaveBeenCalled();
  });
});

describe("middleClickLinkHref (plan 08 task 8.5, issue #80, AC7 preview)", () => {
  // The preview renders real HTML, so the anchor itself carries the href.
  function previewDom(): { root: HTMLDivElement; anchor: HTMLAnchorElement } {
    const root = document.createElement("div");
    root.innerHTML =
      '<p>plain and <a href="https://ex.com/deep">a link</a> and <a name="anchor">no href</a></p>';
    return { root, anchor: root.querySelector("a")! };
  }

  it("reads the anchor's href on a middle click", () => {
    const { root, anchor } = previewDom();
    const event = new MouseEvent("auxclick", { button: 1 });
    anchor.dispatchEvent(event);
    expect(middleClickLinkHref(event, root)).toBe("https://ex.com/deep");
  });

  it("is null for other buttons, non-anchor targets, and anchors without href", () => {
    const { root, anchor } = previewDom();
    const left = new MouseEvent("auxclick", { button: 0 });
    anchor.dispatchEvent(left);
    expect(middleClickLinkHref(left, root)).toBeNull();

    const paragraph = root.querySelector("p")!;
    const onText = new MouseEvent("auxclick", { button: 1 });
    const textNode = paragraph.firstChild! as Text;
    textNode.dispatchEvent(onText);
    expect(middleClickLinkHref(onText, root)).toBeNull();

    const nameAnchor = root.querySelector("a[name]")!;
    const noHref = new MouseEvent("auxclick", { button: 1 });
    nameAnchor.dispatchEvent(noHref);
    expect(middleClickLinkHref(noHref, root)).toBeNull();
  });

  it("is null for anchors outside the root", () => {
    const { root } = previewDom();
    const other = document.createElement("div");
    other.innerHTML = '<a href="https://other.com">x</a>';
    const foreign = other.querySelector("a")!;
    const event = new MouseEvent("auxclick", { button: 1 });
    foreign.dispatchEvent(event);
    expect(middleClickLinkHref(event, root)).toBeNull();
    expect(middleClickLinkHref(event, other)).toBe("https://other.com");
  });
});

describe("broken-image placeholder node view (plan 08 task 8.5, issue #80, AC6)", () => {
  interface Harness {
    container: HTMLDivElement;
    rerender: (missing: ReadonlySet<string>) => void;
  }

  // The full Editor component: its effect points the placeholder node view
  // at the missingImages prop, so these tests exercise the real wiring.
  function renderEditor(value: string, missing: ReadonlySet<string>): Harness {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    let current = missing;
    act(() => {
      root.render(
        <EditorComponent
          value={value}
          onChange={() => {}}
          missingImages={current}
          onReLinkImage={(src, pos) => imagePlaceholderRuntime.onReLink?.(src, pos)}
        />,
      );
    });
    return {
      container,
      rerender: (next) => {
        current = next;
        act(() => {
          root.render(
            <EditorComponent
              value={value}
              onChange={() => {}}
              missingImages={current}
              onReLinkImage={(src, pos) => imagePlaceholderRuntime.onReLink?.(src, pos)}
            />,
          );
        });
      },
    };
  }

  it("renders an existing local image as a plain img", () => {
    const { container } = renderEditor("Hello ![](ok.png) world\n", new Set());
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("ok.png");
    expect(container.querySelector(".quillmd-img-missing")).toBeNull();
  });

  it("renders a missing local image as a named placeholder with the Re-link button", () => {
    const { container } = renderEditor("Hello ![](gone.png) world\n", new Set(["gone.png"]));
    expect(container.querySelector("img[src='gone.png']")).toBeNull();
    const chip = container.querySelector(".quillmd-img-missing");
    expect(chip).not.toBeNull();
    expect(chip?.querySelector(".quillmd-img-missing-label")?.textContent).toBe(
      "gone.png (missing)",
    );
    expect(chip?.querySelector(".quillmd-img-relink")?.textContent).toBe("Re-link…");
  });

  it("leaves the document bytes untouched while the placeholder is shown", () => {
    renderEditor("Hello ![](gone.png) world\n", new Set(["gone.png"]));
    const editor = currentFindEditor();
    expect(editor).not.toBeNull();
    expect(tiptapToMarkdown(editor!.getJSON())).toBe("Hello ![](gone.png) world\n");
  });

  it("calls the re-link handler with the src and doc position on click", () => {
    const { container } = renderEditor("Hello ![](gone.png) world\n", new Set(["gone.png"]));
    const onReLink = vi.fn();
    imagePlaceholderRuntime.onReLink = onReLink;
    const button = container.querySelector(".quillmd-img-relink") as HTMLButtonElement;
    act(() => {
      button.click();
    });
    expect(onReLink).toHaveBeenCalledTimes(1);
    expect(onReLink).toHaveBeenCalledWith("gone.png", expect.any(Number));
  });

  it("swaps back to the img when the file is restored (set cleared, no doc change)", () => {
    const { container, rerender } = renderEditor(
      "Hello ![](gone.png) world\n",
      new Set(["gone.png"]),
    );
    expect(container.querySelector(".quillmd-img-missing")).not.toBeNull();
    rerender(new Set());
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("gone.png");
    expect(container.querySelector(".quillmd-img-missing")).toBeNull();
  });

  it("still renders the placeholder when the src is a width-carrying <img>", () => {
    const { container } = renderEditor(
      'Before <img src="sized.png" width="320"> after\n',
      new Set(["sized.png"]),
    );
    expect(
      container.querySelector(".quillmd-img-missing-label")?.textContent,
    ).toBe("sized.png (missing)");
  });

  it("keeps a normal image normal when only a different src is missing", () => {
    const { container } = renderEditor(
      "![a](ok.png) and ![b](gone.png)\n",
      new Set(["gone.png"]),
    );
    // Exclude ProseMirror's invisible end-of-block spacer image.
    const imgs = [...container.querySelectorAll("img")].filter(
      (i) => !i.classList.contains("ProseMirror-separator"),
    );
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("src")).toBe("ok.png");
    expect(container.querySelector(".quillmd-img-missing")).not.toBeNull();
  });
});

// The width-carrying node view renders the width attribute on the img.
describe("ImageWithWidth node view width (plan 08 §2.5)", () => {
  it("sets the width attribute from the node attribute", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      extensions: [StarterKit, ImageWithWidth.configure({ inline: true })],
      content: markdownToTiptap('<img src="sized.png" width="320">\n'),
      element,
    });
    editors.push(editor);
    const img = element.querySelector("img");
    expect(img?.getAttribute("src")).toBe("sized.png");
    expect(img?.getAttribute("width")).toBe("320");
  });
});
