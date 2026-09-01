// @vitest-environment jsdom
// tocBlock node + serializer token (plan 09 task 9.1, issue #84).
//
// The document stores a table of contents as the fixed comment token
// `<!-- quillmd:toc -->` (the source of truth, golden rule 1). The converter
// (pm.ts) maps that token to the tocBlock node and back to the exact same
// token; the WYSIWYG renders the node as a live, clickable list of the
// document's H1-H4 headings (TocCard), and the preview renders the same list
// (PreviewView). The token is byte-stable: editing headings elsewhere must
// never rewrite the comment line (plan 09 AC1 byte check).

import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorContent } from "@tiptap/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TocBlock } from "../../components/Editor";
import PreviewView from "../../components/PreviewView";
import { createDocument, saveDocument } from "../pipeline";
import { markdownToTiptap, tiptapToMarkdown, TOC_TOKEN } from "../pm";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// A document with headings at several levels, a TOC token, and editable body
// text. The token sits between two headings so its position is unambiguous.
const DOC =
  "# Title\n" +
  "\n" +
  "Intro paragraph.\n" +
  "\n" +
  "<!-- quillmd:toc -->\n" +
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

describe("tocBlock serializer (pm.ts)", () => {
  it("parses the token to a tocBlock node", () => {
    const json = markdownToTiptap(DOC);
    const types = (json.content ?? []).map((n) => n.type);
    expect(types).toContain("tocBlock");
    // The node carries no content (an atom); it is the token, nothing else.
    const toc = (json.content ?? []).find((n) => n.type === "tocBlock");
    expect(toc?.content).toBeUndefined();
    expect(toc?.attrs).toBeUndefined();
  });

  it("serializes a tocBlock back to the exact token", () => {
    const json = {
      type: "doc",
      content: [{ type: "tocBlock" }],
    };
    expect(tiptapToMarkdown(json)).toBe(TOC_TOKEN + "\n");
  });

  it("round-trips a token-bearing document byte-identically", () => {
    const out = tiptapToMarkdown(markdownToTiptap(DOC));
    expect(out).toBe(DOC);
    // Fixed point: re-serializing the output changes nothing.
    expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
  });

  it("ignores surrounding whitespace when recognizing the token", () => {
    const json = markdownToTiptap("  <!-- quillmd:toc -->\n");
    expect((json.content ?? []).some((n) => n.type === "tocBlock")).toBe(true);
  });

  it("does not treat a different comment as a tocBlock", () => {
    const json = markdownToTiptap("<!-- quillmd:other -->\n");
    expect((json.content ?? []).some((n) => n.type === "tocBlock")).toBe(false);
  });
});

describe("tocBlock through the clean-path pipeline (plan 09 AC1 byte check)", () => {
  it("is an immutable html block: untouched document is verbatim", () => {
    const model = createDocument(DOC);
    const result = saveDocument(model, DOC);
    expect(result.kind).toBe("verbatim");
    expect(result.text).toBe(DOC);
  });

  it("classifies the token line as an html block", () => {
    const model = createDocument(DOC);
    const tocBlock = model.blocks.find((b) => b.text.trim() === TOC_TOKEN);
    expect(tocBlock).toBeDefined();
    expect(tocBlock?.kind).toBe("html");
  });

  // The plain text of a JSONContent node (recurses through block content; a
  // text node's own string is in `.text`, not `.textContent`).
  function textOf(node: { text?: string; content?: unknown[] }): string {
    if (typeof node.text === "string") return node.text;
    if (Array.isArray(node.content)) {
      return node.content.map((c) => textOf(c as Parameters<typeof textOf>[0])).join("");
    }
    return "";
  }

  // The acceptance criterion: adding or removing headings and re-saving must
  // not change the comment line. The editor re-serializes the whole document,
  // but the clean path splices only the dirty blocks — the token block is
  // never dirty, so its bytes pass through verbatim.
  function saveWithEditorEdit(
    mutate: (json: ReturnType<typeof markdownToTiptap>) => void,
  ): string {
    const model = createDocument(DOC);
    const json = markdownToTiptap(DOC);
    mutate(json);
    const result = saveDocument(model, tiptapToMarkdown(json));
    expect(result.kind).toBe("splice");
    return result.text;
  }

  function findHeading(json: ReturnType<typeof markdownToTiptap>, text: string) {
    return (json.content ?? []).find(
      (n) => n.type === "heading" && textOf(n) === text,
    );
  }

  it("adding a heading does not rewrite the token line", () => {
    // Adding a block changes the block count, so the clean path falls back to
    // a raw (full re-serialize) write rather than a splice. The token line is
    // still byte-stable because the serializer always emits the exact token.
    const model = createDocument(DOC);
    const json = markdownToTiptap(DOC);
    json.content = [
      ...(json.content ?? []),
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Added" }],
      },
    ];
    const result = saveDocument(model, tiptapToMarkdown(json));
    expect(result.kind).not.toBe("verbatim");
    expect(result.text).toContain("## Added");
    // The token line is byte-identical to the original.
    expect(result.text).toContain("\n" + TOC_TOKEN + "\n");
  });

  it("editing a heading's text leaves the token line untouched", () => {
    const out = saveWithEditorEdit((json) => {
      const h = findHeading(json, "One");
      h!.content = [{ type: "text", text: "One edited" }];
    });
    expect(out).toContain("## One edited");
    expect(out).toContain("\n" + TOC_TOKEN + "\n");
    // The rest of the document is intact.
    expect(out).toContain("##### Too deep");
  });

  it("editing body text leaves the token line untouched", () => {
    const out = saveWithEditorEdit((json) => {
      const p = (json.content ?? []).find(
        (n) => n.type === "paragraph" && textOf(n) === "Body one.",
      );
      p!.content = [{ type: "text", text: "Body one edited." }];
    });
    expect(out).toContain("Body one edited.");
    expect(out).toContain("\n" + TOC_TOKEN + "\n");
  });
});

describe("tocBlock WYSIWYG node view (TocCard)", () => {
  interface Mounted {
    container: HTMLDivElement;
    editor: Editor;
    unmount: () => void;
  }

  async function mountDoc(markdown: string): Promise<Mounted> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const editor = new Editor({
      extensions: [StarterKit, TocBlock],
      content: markdownToTiptap(markdown),
    });
    await act(async () => {
      root.render(<EditorContent editor={editor} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    return {
      container,
      editor,
      unmount: () => {
        act(() => root.unmount());
        editor.destroy();
        container.remove();
      },
    };
  }

  const mounted: Mounted[] = [];
  afterEach(() => {
    while (mounted.length > 0) mounted.pop()!.unmount();
  });

  function tocOf(container: HTMLDivElement): HTMLDivElement {
    const el = container.querySelector(".quillmd-toc");
    if (!el) throw new Error("toc card not mounted");
    return el as HTMLDivElement;
  }

  it("renders the H1-H4 headings as an indented list", async () => {
    const m = await mountDoc(DOC);
    mounted.push(m);
    const toc = tocOf(m.container);
    const items = [...toc.querySelectorAll<HTMLElement>(".quillmd-toc-item")];
    // H1 (Title), H2 (One), H3 (Deep), H4 (Deeper). H5 (Too deep) is excluded.
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.getAttribute("data-level"))).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(toc.textContent).toContain("Title");
    expect(toc.textContent).toContain("One");
    expect(toc.textContent).toContain("Deep");
    expect(toc.textContent).toContain("Deeper");
    // The H5 heading is not listed.
    expect(toc.textContent).not.toContain("Too deep");
    // The card is a view artifact: the document still holds the token.
    expect(tiptapToMarkdown(m.editor.getJSON())).toBe(DOC);
  });

  it("shows the empty state when there are no headings", async () => {
    const m = await mountDoc("<!-- quillmd:toc -->\n\njust text\n");
    mounted.push(m);
    const toc = tocOf(m.container);
    expect(toc.querySelector(".quillmd-toc-empty")).not.toBeNull();
    expect(toc.querySelectorAll(".quillmd-toc-item")).toHaveLength(0);
  });

  it("updates live when a heading is added (document token unchanged)", async () => {
    const m = await mountDoc(DOC);
    mounted.push(m);
    expect(tocOf(m.container).querySelectorAll(".quillmd-toc-item")).toHaveLength(4);

    // Append a new H2 heading at the end of the document.
    const state = m.editor.state;
    m.editor.view.dispatch(
      state.tr.insert(
        state.doc.content.size,
        state.schema.node("heading", { level: 2 }, [
          state.schema.text("Live added"),
        ]),
      ),
    );
    // The card re-renders on the update event and lists the new heading.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const items = [...tocOf(m.container).querySelectorAll<HTMLElement>(".quillmd-toc-item")];
    expect(items).toHaveLength(5);
    expect(items[4].getAttribute("data-level")).toBe("2");
    expect(tocOf(m.container).textContent).toContain("Live added");
    // The token is still the exact comment — adding a heading did not rewrite
    // the file's TOC line, only the rendered view.
    const md = tiptapToMarkdown(m.editor.getJSON());
    expect(md).toContain("\n" + TOC_TOKEN + "\n");
  });

  it("clicking an entry selects the heading", async () => {
    const m = await mountDoc(DOC);
    mounted.push(m);
    const links = [...tocOf(m.container).querySelectorAll<HTMLButtonElement>(".quillmd-toc-link")];
    // Click "One" (the H2, index 1).
    await act(async () => {
      links[1].click();
    });
    const sel = m.editor.state.selection;
    expect(sel).toBeInstanceOf(Object);
    // The selection is a NodeSelection on the "One" heading.
    const selected = m.editor.state.doc.nodeAt(sel.from);
    expect(selected?.type.name).toBe("heading");
    expect(selected?.textContent).toBe("One");
    // Selecting changes no bytes.
    expect(tiptapToMarkdown(m.editor.getJSON())).toBe(DOC);
  });
});

describe("tocBlock in the Preview view", () => {
  interface Mounted {
    container: HTMLDivElement;
    root: Root;
    unmount: () => void;
  }

  async function mountPreview(value: string): Promise<Mounted> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(<PreviewView value={value} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    return {
      container,
      root,
      unmount: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  const mounted: Mounted[] = [];
  afterEach(() => {
    while (mounted.length > 0) mounted.pop()!.unmount();
  });

  function tocOf(container: HTMLDivElement): HTMLDivElement {
    const el = container.querySelector(".quillmd-toc");
    if (!el) throw new Error("preview toc not mounted");
    return el as HTMLDivElement;
  }

  it("replaces the token with the live heading list at its position", async () => {
    const m = await mountPreview(DOC);
    mounted.push(m);
    const toc = tocOf(m.container);
    const items = [...toc.querySelectorAll<HTMLElement>(".quillmd-toc-item")];
    expect(items).toHaveLength(4);
    expect(toc.textContent).toContain("Title");
    expect(toc.textContent).toContain("Deeper");
    // H5 excluded.
    expect(toc.textContent).not.toContain("Too deep");
    // The raw fence placeholder is gone (swapped for the TOC block).
    expect(m.container.querySelector("pre > code.language-quillmd-toc")).toBeNull();
    // The token comment is not rendered as a visible comment either.
    expect(m.container.textContent).not.toContain("quillmd:toc");
  });

  it("shows the empty state when there are no headings", async () => {
    const m = await mountPreview("<!-- quillmd:toc -->\n\njust text\n");
    mounted.push(m);
    expect(tocOf(m.container).querySelector(".quillmd-toc-empty")).not.toBeNull();
  });

  it("clicking an entry scrolls the preview to the heading", async () => {
    const m = await mountPreview(DOC);
    mounted.push(m);
    // jsdom has no layout; scrollIntoView is a no-op unless defined. Spy on it.
    let scrolled: string | null = null;
    const headings = m.container.querySelectorAll("h1, h2, h3, h4");
    for (const h of Array.from(headings)) {
      (h as HTMLElement).scrollIntoView = () => {
        scrolled = (h as HTMLElement).textContent;
      };
    }
    const links = [...tocOf(m.container).querySelectorAll<HTMLButtonElement>(".quillmd-toc-link")];
    // Click "One" (the H2, index 1).
    await act(async () => {
      links[1].click();
    });
    expect(scrolled).toBe("One");
  });
});
