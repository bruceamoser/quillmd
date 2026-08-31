// @vitest-environment jsdom
// Mermaid in the Preview view (plan 11 task 11.4, issue #103): a ```mermaid
// fence renders through the shared render service — the same one the WYSIWYG
// card and the PNG export use — and the fence is swapped in place for the SVG
// (a view artifact; the document bytes are never touched). A failed render
// leaves the fence as plain code (the source stays visible, the preview never
// breaks), and an already-rendered diagram re-renders on a theme switch so the
// preview follows the mapped light/dark mermaid theme (plan 11 AC3).
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import PreviewView from "../../components/PreviewView";
import { renderMermaid } from "../mermaidRender";
import type { ThemeId } from "../theme";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom implements no SVG geometry API; the shims below make mermaid's layout
// math total (the same shims mermaidRender.test.ts / mermaidCard.test.tsx use).
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

const SOURCE = "graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Done]";
const FENCE = "```mermaid\n" + SOURCE + "\n```";
// Markdown's code text is the fence body plus a trailing newline — the exact
// string the render service receives. Rendered from here (not the DOM) so the
// comparison holds even after the preview has swapped the fence for its SVG.
const FENCE_SOURCE = SOURCE + "\n";
const BROKEN_FENCE = "```mermaid\ngraph TD\n  A -->\n```";
const BROKEN_SOURCE = "graph TD\n  A -->\n";

// The render id is unique per render call and embedded in element ids;
// normalize it away so two renders of the same source + theme compare equal.
function normalizeIds(svg: string): string {
  return svg.replace(/quillmd-mermaid-\d+/g, "id");
}

async function waitFor(cond: () => boolean, what: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}

interface Mounted {
  container: HTMLDivElement;
  root: Root;
  setTheme: (theme: ThemeId) => void;
  unmount: () => void;
}

async function mountPreview(value: string, theme: ThemeId = "quill"): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let currentTheme = theme;
  await act(async () => {
    root.render(<PreviewView value={value} theme={currentTheme} />);
  });
  // Let the post-mount effect start the (async) render; the code element is
  // still in the DOM until the render resolves.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return {
    container,
    root,
    setTheme: (t: ThemeId) => {
      currentTheme = t;
      act(() => {
        root.render(<PreviewView value={value} theme={currentTheme} />);
      });
    },
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

function fenceCode(container: HTMLDivElement): HTMLElement | null {
  return container.querySelector("pre > code.language-mermaid");
}
function previewSvg(container: HTMLDivElement): SVGElement | null {
  return container.querySelector(".quillmd-mermaid-preview svg");
}

describe("Preview: mermaid rendering (issue #103)", () => {
  it("renders the fence as a live SVG and swaps it in place", async () => {
    const m = await mountPreview(FENCE);
    mounted.push(m);
    await waitFor(() => previewSvg(m.container) !== null, "svg");
    const svg = previewSvg(m.container)!;
    // A real mermaid render: a scalable SVG carrying the diagram labels.
    expect(svg.getAttribute("viewBox")).not.toBeNull();
    expect(m.container.textContent).toContain("Start");
    expect(m.container.textContent).toContain("Decision");
    // The fence was replaced by the holder: no raw code element remains.
    expect(fenceCode(m.container)).toBeNull();
    expect(m.container.querySelector(".quillmd-mermaid-preview")).not.toBeNull();
  }, 30000);

  it("renders through the shared render service (same SVG as the service)", async () => {
    const m = await mountPreview(FENCE);
    mounted.push(m);
    await waitFor(() => previewSvg(m.container) !== null, "svg");
    const domSvg = normalizeIds(previewSvg(m.container)!.outerHTML);
    // The shared service, given the fence's source (markdown's code text is
    // the fence body plus its trailing newline) + theme, produces the same
    // SVG (id-normalized): the preview is the service, not a separate render.
    // We render from the known source rather than reading the code element: by
    // the time the preview's render resolves the fence may already be swapped.
    const { svg, error } = await renderMermaid(FENCE_SOURCE, "quill");
    expect(error).toBeNull();
    expect(normalizeIds(svg!)).toBe(domSvg);
  }, 30000);

  it("a broken diagram leaves the fence as plain code (never blank)", async () => {
    const m = await mountPreview(BROKEN_FENCE);
    mounted.push(m);
    // Settle the render: it fails. The preview's own concurrent render
    // resolves with the same null svg and no-ops, keeping the fence.
    const { svg, error } = await renderMermaid(BROKEN_SOURCE, "quill");
    expect(svg).toBeNull();
    expect(error).not.toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // No SVG, but the source stays visible so the user can fix it.
    expect(previewSvg(m.container)).toBeNull();
    const code = fenceCode(m.container);
    expect(code).not.toBeNull();
    expect(code!.textContent).toContain("A -->");
  }, 30000);
});

describe("Preview: mermaid theme (issue #103, AC3)", () => {
  it("re-renders with the mapped mermaid theme on a theme switch", async () => {
    const m = await mountPreview(FENCE, "quill");
    mounted.push(m);
    await waitFor(() => previewSvg(m.container) !== null, "svg");
    const lightSvg = normalizeIds(previewSvg(m.container)!.outerHTML);

    // Switch to a dark QuillMD theme: the holder re-renders with mermaid's
    // dark theme (a genuinely different rendering, not just a fresh id).
    m.setTheme("dark");
    await waitFor(
      () => {
        const s = previewSvg(m.container);
        return s !== null && normalizeIds(s.outerHTML) !== lightSvg;
      },
      "dark re-render",
    );
    const darkSvg = normalizeIds(previewSvg(m.container)!.outerHTML);
    expect(darkSvg).not.toBe(lightSvg);

    // Back to light: the rendering returns to the light form (not stuck on
    // dark). The holder persists across the theme-only re-render, so the SVG
    // is never torn down — it re-renders in place.
    m.setTheme("quill");
    await waitFor(
      () => {
        const s = previewSvg(m.container);
        return s !== null && normalizeIds(s.outerHTML) === lightSvg;
      },
      "light re-render",
    );
  }, 60000);
});
