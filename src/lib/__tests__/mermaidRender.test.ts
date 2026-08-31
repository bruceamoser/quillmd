// @vitest-environment jsdom
// Mermaid render service (plan 11 task 11.2, issue #101): the real mermaid
// package renders through the service — theme mapping, the render/error API
// (a failure is data, never a throw), strict security (no executable
// content in the SVG), and offscreen-container cleanup (no temp DOM node
// leaks into the document). jsdom implements no SVG geometry API, so the
// shims below make mermaid's layout math total; assertions check SVG
// structure (tags, text, attributes), not coordinates.
import { describe, expect, it, vi } from "vitest";
import { debounce, mermaidThemeFor, renderMermaid } from "../mermaidRender";
import { MERMAID_STARTER_TEMPLATE } from "../editorCommands";

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

const FLOWCHART = "graph TD\n  A[Start] --> B[End]\n";

// The render id is unique per call and embedded in element ids; normalize
// it away so two renders of the same source + theme compare equal.
function normalizeIds(svg: string): string {
  return svg.replace(/quillmd-mermaid-\d+/g, "id");
}

describe("mermaidThemeFor (issue #101)", () => {
  it("maps the light QuillMD themes to mermaid's default theme", () => {
    expect(mermaidThemeFor("quill")).toBe("default");
    expect(mermaidThemeFor("minimal")).toBe("default");
    expect(mermaidThemeFor("serif")).toBe("default");
  });

  it("maps the dark QuillMD themes to mermaid's dark theme", () => {
    expect(mermaidThemeFor("dark")).toBe("dark");
    expect(mermaidThemeFor("high-contrast")).toBe("dark");
  });
});

describe("renderMermaid: render/error API (issue #101)", () => {
  it("renders the starter template to an SVG containing the node labels", async () => {
    const result = await renderMermaid(MERMAID_STARTER_TEMPLATE, "quill");
    expect(result.error).toBeNull();
    expect(result.svg).not.toBeNull();
    const svg = result.svg!;
    expect(svg.startsWith("<svg")).toBe(true);
    for (const label of ["Start", "Decision", "Done", "Retry"]) {
      expect(svg).toContain(label);
    }
  }, 30000);

  it("renders a sequence diagram", async () => {
    const result = await renderMermaid("sequenceDiagram\n  A->>B: hi\n", "quill");
    expect(result.error).toBeNull();
    expect(result.svg).toContain("hi");
  }, 30000);

  it("returns the error as data for a syntax error (never rejects)", async () => {
    const result = await renderMermaid("graph TD\n  A -->\n", "quill");
    expect(result.svg).toBeNull();
    expect(result.error).not.toBeNull();
    // The message names the offending line so the card can show it.
    expect(result.error).toContain("Parse error");
    expect(result.error).toContain("line");
  }, 30000);

  it("returns an error for empty source", async () => {
    const result = await renderMermaid("", "quill");
    expect(result.svg).toBeNull();
    expect(result.error).not.toBeNull();
  }, 30000);
});

describe("renderMermaid: theme mapping (issue #101)", () => {
  it("renders the same source differently for light vs dark (AC3)", async () => {
    const light = await renderMermaid(FLOWCHART, "quill");
    const dark = await renderMermaid(FLOWCHART, "dark");
    expect(light.error).toBeNull();
    expect(dark.error).toBeNull();
    expect(normalizeIds(dark.svg!)).not.toBe(normalizeIds(light.svg!));
  }, 60000);

  it("maps high-contrast to the same rendering as dark", async () => {
    const dark = await renderMermaid(FLOWCHART, "dark");
    const hc = await renderMermaid(FLOWCHART, "high-contrast");
    expect(normalizeIds(hc.svg!)).toBe(normalizeIds(dark.svg!));
  }, 60000);
});

describe("renderMermaid: strict security (issue #101)", () => {
  it("emits no executable content, even for a click-callback diagram", async () => {
    const source = 'graph TD\n  A[Start]\n  click A callback "evil(1)"\n';
    const result = await renderMermaid(source, "quill");
    expect(result.error).toBeNull();
    const svg = result.svg!;
    expect(svg).toContain("Start");
    // strict mode: no event handlers, no scripts, no js: URLs in the SVG.
    expect(svg).not.toContain("onclick");
    expect(svg.toLowerCase()).not.toContain("<script");
    expect(svg).not.toContain("javascript:");
  }, 30000);
});

describe("renderMermaid: offscreen container (issue #101)", () => {
  it("leaves no temporary nodes in the document on success", async () => {
    const before = document.body.innerHTML;
    await renderMermaid(FLOWCHART, "quill");
    expect(document.body.innerHTML).toBe(before);
  }, 30000);

  it("leaves no temporary nodes in the document on failure", async () => {
    const before = document.body.innerHTML;
    await renderMermaid("graph TD\n  A -->\n", "quill");
    expect(document.body.innerHTML).toBe(before);
  }, 30000);
});

describe("debounce (issue #101)", () => {
  it("invokes once, after the delay, with the latest arguments", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const d = debounce(fn, 300);
      d("a");
      d("b");
      d("c");
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(299);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("c");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancel() drops the pending call", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const d = debounce(fn, 300);
      d("a");
      d.cancel();
      vi.advanceTimersByTime(1000);
      expect(fn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
