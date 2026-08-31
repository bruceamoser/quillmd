// @vitest-environment jsdom
// Mermaid card NodeView (plan 11 task 11.3, issue #102): a mermaidBlock in
// the WYSIWYG view renders a live SVG in preview mode, swaps to the editable
// source in edit mode, shows the error badge + footer on a failed render,
// and re-renders on source and theme changes. The edit surface is the node's
// own ProseMirror text, so typing flows through normal transactions — undo
// restores the prior fence text exactly (plan 11 AC7) — and the SVG is a
// view artifact that never touches the document bytes.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorContent } from "@tiptap/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { MermaidBlock } from "../../components/Editor";
import { mermaidCardRuntime, setMermaidCardTheme } from "../../components/MermaidCard";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { MERMAID_STARTER_TEMPLATE } from "../editorCommands";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom implements no SVG geometry API; the shims below make mermaid's
// layout math total (the same shims mermaidRender.test.ts installs).
const svgProto = SVGElement.prototype as unknown as Record<string, unknown>;
if (typeof svgProto.getBBox !== "function") {
  svgProto.getBBox = () => new DOMRect(0, 0, 100, 20);
}
if (typeof svgProto.getComputedTextLength !== "function") {
  svgProto.getComputedTextLength = () => 100;
}
if (typeof svgProto.getTotalLength !== "function") {
  svgProto.getTotalLength = () => 100;
}

const FENCE = "```mermaid\n" + MERMAID_STARTER_TEMPLATE + "\n```";
const BROKEN = "```mermaid\ngraph TD\n  A -->\n```\n";

// The render id is unique per render call and embedded in element ids;
// normalize it away so two renders of the same source + theme compare equal.
function normalizeIds(svg: string): string {
  return svg.replace(/quillmd-mermaid-\d+/g, "id");
}

interface Mounted {
  container: HTMLDivElement;
  editor: Editor;
  unmount: () => void;
}

async function waitFor(cond: () => boolean, what: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}

function cardOf(container: HTMLDivElement): HTMLDivElement {
  const card = container.querySelector(".quillmd-mermaid-card");
  if (!card) throw new Error("mermaid card not mounted");
  return card as HTMLDivElement;
}

// Mounts the card the app way: a real editor whose mermaidBlock node view is
// portaled into the DOM by EditorContent (ReactNodeViewRenderer). The card
// then renders for real through the render service, debounced ~300 ms.
async function mountDoc(markdown: string): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const editor = new Editor({
    extensions: [StarterKit.configure({ codeBlock: false }), MermaidBlock],
    content: markdownToTiptap(markdown),
  });
  await act(async () => {
    root.render(<EditorContent editor={editor} />);
  });
  // The node view's React tree lands in a microtask after mount.
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

beforeEach(() => {
  // Known theme state between tests (the card's module holder is global).
  mermaidCardRuntime.theme = "quill";
});

afterEach(() => {
  while (mounted.length > 0) mounted.pop()!.unmount();
});

describe("mermaid card: preview (issue #102)", () => {
  it("renders the fence source as a live, responsive SVG", async () => {
    const m = await mountDoc(FENCE + "\n");
    mounted.push(m);
    await waitFor(() => m.container.querySelector(".quillmd-mermaid-card svg") !== null, "svg");
    const card = cardOf(m.container);
    expect(card.dataset.mode).toBe("preview");
    const svg = card.querySelector("svg")!;
    // mermaid emits width="100%" with a viewBox, so the diagram scales to
    // the card width (fit); the overflow-x container is the scroll fallback.
    expect(svg.getAttribute("viewBox")).not.toBeNull();
    expect(svg.getAttribute("width")).toBe("100%");
    expect(card.querySelector(".quillmd-mermaid-svg")).not.toBeNull();
    // The diagram labels came through the render.
    expect(card.textContent).toContain("Start");
    expect(card.textContent).toContain("Decision");
    // The SVG is a view artifact: the document still holds exactly the fence.
    expect(tiptapToMarkdown(m.editor.getJSON())).toBe(FENCE + "\n");
  }, 30000);

  it("clicking the SVG drops into edit mode", async () => {
    const m = await mountDoc(FENCE + "\n");
    mounted.push(m);
    await waitFor(() => m.container.querySelector(".quillmd-mermaid-card svg") !== null, "svg");
    const svgBox = cardOf(m.container).querySelector(".quillmd-mermaid-svg")!;
    await act(async () => {
      svgBox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const card = cardOf(m.container);
    expect(card.dataset.mode).toBe("edit");
    expect(card.querySelector(".quillmd-mermaid-source-code")).not.toBeNull();
  }, 30000);
});

describe("mermaid card: error state (issue #102)", () => {
  it("shows the badge and footer, with the source visible (never blank)", async () => {
    const m = await mountDoc(BROKEN);
    mounted.push(m);
    await waitFor(
      () => cardOf(m.container).querySelector(".quillmd-mermaid-badge") !== null,
      "error badge",
    );
    const card = cardOf(m.container);
    expect(card.classList.contains("quillmd-mermaid-error")).toBe(true);
    const badge = card.querySelector(".quillmd-mermaid-badge")!;
    expect(badge.textContent).toBe("Error");
    // The full message is preserved on the badge and the footer.
    expect(badge.getAttribute("title")).toContain("Parse error");
    const footer = card.querySelector(".quillmd-mermaid-footer")!;
    expect(footer.getAttribute("title")).toContain("Parse error");
    expect(footer.textContent?.length ?? 0).toBeGreaterThan(0);
    // No SVG, but the source stays visible so the user can fix it.
    expect(card.querySelector("svg")).toBeNull();
    expect(card.querySelector(".quillmd-mermaid-source-code")?.textContent).toContain("A -->");
    // The document bytes are untouched by the failed render.
    expect(tiptapToMarkdown(m.editor.getJSON())).toBe(BROKEN);
  }, 30000);
});

describe("mermaid card: edit mode (issue #102)", () => {
  it("edits flow through the document; undo restores the prior fence text", async () => {
    const m = await mountDoc(FENCE + "\n");
    mounted.push(m);
    await waitFor(() => m.container.querySelector(".quillmd-mermaid-card svg") !== null, "svg");

    // Enter edit mode through the toggle.
    const buttons = [...cardOf(m.container).querySelectorAll(".quillmd-mermaid-actions button")];
    const edit = buttons.find((b) => b.textContent === "Edit")!;
    const preview = buttons.find((b) => b.textContent === "Preview")!;
    await act(async () => {
      edit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const card = cardOf(m.container);
    expect(card.dataset.mode).toBe("edit");
    expect(edit.classList.contains("quillmd-mermaid-active")).toBe(true);
    const code = card.querySelector(".quillmd-mermaid-source-code")!;
    expect(code.textContent).toBe(MERMAID_STARTER_TEMPLATE);

    // Type into the source: one ProseMirror transaction on the node's own
    // text — append a valid node line so the next render succeeds.
    const state = m.editor.state;
    const insertAt = state.doc.content.size - 1; // end of the fence text
    m.editor.view.dispatch(state.tr.insertText("\n  E[New]", insertAt));
    expect(tiptapToMarkdown(m.editor.getJSON())).toContain("E[New]");
    // The source surface shows the edited text immediately.
    expect(code.textContent).toContain("E[New]");

    // Back to preview: the edit re-armed the debounced re-render, and the
    // SVG picks up the new node.
    await act(async () => {
      preview.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(cardOf(m.container).dataset.mode).toBe("preview");
    await waitFor(
      () => (cardOf(m.container).querySelector("svg")?.textContent ?? "").includes("New"),
      "re-render with the edited source",
    );

    // Undo (plan 11 AC7): the fence text comes back byte-identical, and the
    // card re-renders the restored source.
    m.editor.commands.undo();
    expect(tiptapToMarkdown(m.editor.getJSON())).toBe(FENCE + "\n");
    await waitFor(
      () => !(cardOf(m.container).querySelector("svg")?.textContent ?? "").includes("New"),
      "re-render of the restored source",
    );
  }, 30000);
});

describe("mermaid card: theme (issue #102, AC3)", () => {
  it("re-renders with the mapped mermaid theme when the QuillMD theme changes", async () => {
    const m = await mountDoc(FENCE + "\n");
    mounted.push(m);
    await waitFor(() => m.container.querySelector(".quillmd-mermaid-card svg") !== null, "svg");
    const lightSvg = normalizeIds(cardOf(m.container).querySelector("svg")!.outerHTML);

    // Switch to a dark QuillMD theme; the card re-renders on the next
    // debounce with mermaid's dark theme (a genuinely different rendering,
    // not just a fresh render id).
    setMermaidCardTheme("dark");
    await waitFor(
      () => normalizeIds(cardOf(m.container).querySelector("svg")!.outerHTML) !== lightSvg,
      "dark re-render",
    );
    const darkSvg = normalizeIds(cardOf(m.container).querySelector("svg")!.outerHTML);
    expect(darkSvg).not.toBe(lightSvg);

    // Back to light: the rendering returns to the light form (not stuck on
    // dark) and the document never changes with a theme switch.
    setMermaidCardTheme("quill");
    await waitFor(
      () => normalizeIds(cardOf(m.container).querySelector("svg")!.outerHTML) === lightSvg,
      "light re-render",
     );
    expect(tiptapToMarkdown(m.editor.getJSON())).toBe(FENCE + "\n");
  }, 30000);
});
