// @vitest-environment jsdom
// OutlinePane component (plan 09 task 9.3, issue #86): the right-hand
// navigation pane lists the document's H1-H4 headings, highlights the entry
// at the top of the visible area (scroll tracking), and jumps to an entry on
// click (select + scroll in the WYSIWYG, scrollIntoView in the preview).
// The shared entry/active-index math is covered in outline.test.ts; the
// DocSettings persistence of the toggle is covered in docSettings.test.ts;
// the App wiring (View menu + Ctrl+Shift+8) is covered in
// navigationPaneWiring.test.tsx.
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { registerFindEditor } from "../find";
import OutlinePane from "../../components/OutlinePane";
import PreviewView from "../../components/PreviewView";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const DOC =
  "# Title\n" +
  "\n" +
  "Intro.\n" +
  "\n" +
  "## One\n" +
  "\n" +
  "Body one.\n" +
  "\n" +
  "### Deep\n" +
  "\n" +
  "Body deep.\n" +
  "\n" +
  "#### Deeper\n" +
  "\n" +
  "Body deeper.\n" +
  "\n" +
  "##### Too deep\n" +
  "\n" +
  "Body too deep.\n";

let roots: Root[] = [];
let unregisters: Array<() => void> = [];
let editors: Editor[] = [];
// Scroll containers added to the body for the WYSIWYG surface tests.
let scrollEls: HTMLElement[] = [];

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

afterEach(() => {
  for (const un of unregisters.splice(0)) un();
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const e of editors.splice(0)) {
    try {
      e.destroy();
    } catch {
      // A view whose document is already gone can throw on teardown.
    }
  }
  for (const el of scrollEls.splice(0)) el.remove();
});

function paneOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".quillmd-outline");
  if (!el) throw new Error("outline pane not mounted");
  return el as HTMLElement;
}

function links(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(".quillmd-outline-link"),
  );
}

function makeScrollEl(metrics: {
  top?: number;
  scrollTop?: number;
  clientHeight?: number;
  scrollHeight?: number;
}): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "quillmd-editor-body";
  document.body.appendChild(el);
  scrollEls.push(el);
  const { top = 0, scrollTop = 0, clientHeight = 300, scrollHeight = 1000 } = metrics;
  Object.defineProperty(el, "scrollTop", {
    value: scrollTop,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => new DOMRect(0, top, 800, clientHeight),
    configurable: true,
  });
  return el;
}

// Mounts a WYSIWYG editor (registered with the find bridge, the way the real
// Editor does) inside a fake .quillmd-editor-body scroll container, and returns
// the editor plus the scroll element. `coordsAtPos` is stubbed to resolve each
// heading's position to a deterministic viewport top (jsdom has no layout).
async function mountWysiwygSurface(markdown: string) {
  const editor = new Editor({
    extensions: [StarterKit],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  const scroll = makeScrollEl({ top: 0, scrollTop: 0, clientHeight: 300, scrollHeight: 1000 });
  scroll.appendChild(editor.view.dom);

  // Map each heading position to a viewport top; the test mutates `tops` to
  // simulate scrolling (the headings' viewport tops move up).
  let tops: number[] = [];
  const posToIndex = new Map<number, number>();
  const refresh = () => {
    posToIndex.clear();
    tops = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading" && node.attrs.level <= 4) {
        posToIndex.set(pos, tops.length);
        tops.push(0);
      }
      return true;
    });
  };
  refresh();
  // Initial tops: heading i at i * 100.
  const applyTops = (values: number[]) => {
    tops = values;
  };
  (editor.view as unknown as { coordsAtPos: (p: number) => { top: number } }).coordsAtPos = (
    pos: number,
  ) => {
    const idx = posToIndex.get(pos);
    return { top: idx === undefined ? 0 : (tops[idx] ?? 0) };
  };
  applyTops(Array.from(posToIndex.keys(), (_, i) => i * 100));

  const un = registerFindEditor(() => editor);
  unregisters.push(un);
  return { editor, scroll, posToIndex, applyTops };
}

describe("OutlinePane list (issue #86)", () => {
  it("lists the H1-H4 headings (markdown-derived) and excludes deeper ones", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(<OutlinePane value={DOC} mode="source" open width={240} onResize={() => {}} />);
    });
    await settle();
    const pane = paneOf(container);
    const items = Array.from(pane.querySelectorAll<HTMLElement>(".quillmd-outline-item"));
    // H1 (Title), H2 (One), H3 (Deep), H4 (Deeper). The H5 is excluded.
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.getAttribute("data-level"))).toEqual(["1", "2", "3", "4"]);
    expect(pane.textContent).toContain("Title");
    expect(pane.textContent).toContain("Deeper");
    expect(pane.textContent).not.toContain("Too deep");
    container.remove();
  });

  it("shows the empty state when there are no headings", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <OutlinePane value="just text\n" mode="source" open width={240} onResize={() => {}} />,
      );
    });
    await settle();
    expect(paneOf(container).querySelector(".quillmd-outline-empty")).not.toBeNull();
    expect(paneOf(container).querySelectorAll(".quillmd-outline-item")).toHaveLength(0);
    container.remove();
  });

  it("renders nothing when closed", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(<OutlinePane value={DOC} mode="source" open={false} width={240} onResize={() => {}} />);
    });
    await settle();
    expect(container.querySelector(".quillmd-outline")).toBeNull();
    container.remove();
  });
});

describe("OutlinePane in the WYSIWYG (issue #86)", () => {
  it("lists the live document's headings and updates on edit", async () => {
    const { editor } = await mountWysiwygSurface(DOC);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(<OutlinePane value={DOC} mode="wysiwyg" open width={240} onResize={() => {}} />);
    });
    await settle();
    let items = Array.from(paneOf(container).querySelectorAll<HTMLElement>(".quillmd-outline-item"));
    expect(items).toHaveLength(4);

    // Append a new H2 heading; the pane re-renders from the live doc.
    const state = editor.state;
    await act(async () => {
      editor.view.dispatch(
        state.tr.insert(
          state.doc.content.size,
          state.schema.node("heading", { level: 2 }, [state.schema.text("Live added")]),
        ),
      );
    });
    await settle();
    items = Array.from(paneOf(container).querySelectorAll<HTMLElement>(".quillmd-outline-item"));
    expect(items).toHaveLength(5);
    expect(items[4].getAttribute("data-level")).toBe("2");
    expect(paneOf(container).textContent).toContain("Live added");
    container.remove();
  });

  it("clicking an entry selects the heading without changing the bytes", async () => {
    const { editor } = await mountWysiwygSurface(DOC);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(<OutlinePane value={DOC} mode="wysiwyg" open width={240} onResize={() => {}} />);
    });
    await settle();
    const before = tiptapToMarkdown(editor.getJSON());
    // Click "One" (the H2, index 1).
    await act(async () => {
      links(container)[1].click();
    });
    const sel = editor.state.selection;
    const selected = editor.state.doc.nodeAt(sel.from);
    expect(selected?.type.name).toBe("heading");
    expect(selected?.textContent).toBe("One");
    // Selecting changes no bytes.
    expect(tiptapToMarkdown(editor.getJSON())).toBe(before);
    container.remove();
  });

  it("tracks the active entry as the scroll moves", async () => {
    const { editor, scroll, applyTops } = await mountWysiwygSurface(DOC);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(<OutlinePane value={DOC} mode="wysiwyg" open width={240} onResize={() => {}} />);
    });
    await settle();
    // Initial tops [0,100,200,300], threshold 48 → heading 0 active.
    let btns = links(container);
    expect(btns[0].classList.contains("quillmd-outline-active")).toBe(true);
    expect(btns[1].classList.contains("quillmd-outline-active")).toBe(false);

    // Scroll down: the first heading leaves the top, the second reaches it.
    applyTops([-100, 0, 100, 200]);
    await act(async () => {
      scroll.dispatchEvent(new Event("scroll"));
    });
    await settle(50);
    btns = links(container);
    expect(btns[0].classList.contains("quillmd-outline-active")).toBe(false);
    expect(btns[1].classList.contains("quillmd-outline-active")).toBe(true);
    expect(editor.view.dom.isConnected).toBe(true);
    container.remove();
  });
});

describe("OutlinePane in the preview (issue #86)", () => {
  it("clicking an entry scrolls the preview to the matching heading", async () => {
    // The preview renders .quillmd-preview with the headings; the pane (in
    // preview mode) resolves that surface for click-to-jump.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <>
          <PreviewView value={DOC} />
          <OutlinePane value={DOC} mode="preview" open width={240} onResize={() => {}} />
        </>,
      );
    });
    await settle(50);
    let scrolled: string | null = null;
    const headings = container.querySelectorAll("h1, h2, h3, h4");
    for (const h of Array.from(headings)) {
      (h as HTMLElement).scrollIntoView = () => {
        scrolled = (h as HTMLElement).textContent;
      };
    }
    // Click "One" (the H2, index 1).
    await act(async () => {
      links(container)[1].click();
    });
    expect(scrolled).toBe("One");
    container.remove();
  });

  it("lists the preview's H1-H4 headings and excludes deeper ones", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <>
          <PreviewView value={DOC} />
          <OutlinePane value={DOC} mode="preview" open width={240} onResize={() => {}} />
        </>,
      );
    });
    await settle(50);
    const items = Array.from(
      paneOf(container).querySelectorAll<HTMLElement>(".quillmd-outline-item"),
    );
    expect(items).toHaveLength(4);
    expect(paneOf(container).textContent).not.toContain("Too deep");
    container.remove();
  });
});
