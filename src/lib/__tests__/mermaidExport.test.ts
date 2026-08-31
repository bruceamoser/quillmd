// @vitest-environment jsdom
// Mermaid PNG export pipeline (plan 11 task 11.5, issue #104): fence
// discovery through the same parser + lang test as the editor, the fence
// swap (every other byte verbatim), SVG -> canvas PNG at 2x with
// deterministic stubs (jsdom has no canvas or image loading), and the
// all-or-nothing export orchestration (render everything first, name the
// failing diagrams, write the temp assets, hand the temp markdown to the
// conversion service, clean up on every path).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import {
  DIAGRAM_PNG_PREFIX,
  TEMP_EXPORT_MARKDOWN,
  exportCurrentDocument,
  findMermaidDiagrams,
  renderDiagramToPng,
  svgToPngBytes,
  swapMermaidFences,
} from "../mermaidExport";
import type { MermaidRenderResult } from "../mermaidRender";

vi.mock("../mermaidRender", () => ({
  renderMermaid: vi.fn(async (source: string): Promise<MermaidRenderResult> => {
    if (source.includes("BROKEN")) {
      return { svg: null, error: "Parse error on line 2: BROKEN" };
    }
    return {
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text>ok</text></svg>',
      error: null,
    };
  }),
}));

// --- canvas/image stubs -----------------------------------------------------
// jsdom implements no canvas rasterizer or image loading. The stubs record
// the geometry the pipeline computes (viewBox x scale) and emit a
// deterministic byte pattern so the PNG path is testable end to end.

interface CanvasRecord {
  width: number;
  height: number;
  drawn: { dw: number; dh: number }[];
  blobMimes: string[];
}

const canvasRecords: CanvasRecord[] = [];

class FakeImage {
  onload: (() => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  private _src = "";
  get src(): string {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    // The data URL must carry the SVG payload.
    if (v.startsWith("data:image/svg+xml;charset=utf-8,")) {
      queueMicrotask(() => this.onload?.());
    } else {
      queueMicrotask(() => this.onerror?.(new Error("bad src")));
    }
  }
}

function installCanvasStubs(): void {
  vi.stubGlobal("Image", FakeImage);
  HTMLCanvasElement.prototype.getContext = (function (
    this: HTMLCanvasElement,
  ): CanvasRenderingContext2D {
    const record: CanvasRecord = {
      width: this.width,
      height: this.height,
      drawn: [],
      blobMimes: [],
    };
    canvasRecords.push(record);
    return {
      drawImage: (
        _img: unknown,
        _dx: number,
        _dy: number,
        dw: number,
        dh: number,
      ): void => {
        record.drawn.push({ dw, dh });
      },
    } as unknown as CanvasRenderingContext2D;
  }) as unknown as HTMLCanvasElement["getContext"];
  HTMLCanvasElement.prototype.toBlob = function (
    this: HTMLCanvasElement,
    cb: (blob: Blob | null) => void,
    mime: string,
  ): void {
    canvasRecords[canvasRecords.length - 1].blobMimes.push(mime);
    cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, this.width, this.height])], { type: mime }));
  };
}

beforeEach(() => {
  canvasRecords.length = 0;
  installCanvasStubs();
});

afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// --- fixture documents -------------------------------------------------------

const TWO_DIAGRAMS = [
  "# Report",
  "",
  "```mermaid",
  "graph TD",
  "  A[Start] --> B[End]",
  "```",
  "",
  "Body text in between.",
  "",
  "```mermaid",
  "sequenceDiagram",
  "  A->>B: hi",
  "```",
  "",
  "The end.",
  "",
].join("\n");

// --- findMermaidDiagrams ------------------------------------------------------

describe("findMermaidDiagrams (issue #104)", () => {
  it("finds a top-level mermaid fence with span, source, and file name", () => {
    const md = "# T\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nAfter.\n";
    const found = findMermaidDiagrams(md);
    expect(found).toHaveLength(1);
    expect(found[0].index).toBe(1);
    expect(found[0].fileName).toBe("diagram-1.png");
    expect(md.slice(found[0].start, found[0].end)).toBe(
      "```mermaid\ngraph TD\n  A --> B\n```",
    );
    expect(found[0].source).toBe("graph TD\n  A --> B");
  });

  it("numbers multiple fences in document order", () => {
    const found = findMermaidDiagrams(TWO_DIAGRAMS);
    expect(found).toHaveLength(2);
    expect(found.map((d) => d.fileName)).toEqual(["diagram-1.png", "diagram-2.png"]);
    expect(found[0].source).toBe("graph TD\n  A[Start] --> B[End]");
    expect(found[1].source).toBe("sequenceDiagram\n  A->>B: hi");
  });

  it("ignores non-mermaid fences and case variants (editor parity)", () => {
    const md = [
      "```js",
      "console.log('```mermaid' is just text)",
      "```",
      "",
      "```Mermaid",
      "graph TD",
      "```",
      "",
      "```python",
      "print(1)",
      "```",
      "",
    ].join("\n");
    expect(findMermaidDiagrams(md)).toHaveLength(0);
  });

  it("accepts tilde fences and extra fence characters", () => {
    const md = "~~~mermaid\ngraph TD\n~~~\n\n````mermaid\ngraph LR\n````\n";
    const found = findMermaidDiagrams(md);
    expect(found).toHaveLength(2);
    expect(found[0].source).toBe("graph TD");
    expect(found[1].source).toBe("graph LR");
  });

  it("finds fences nested in blockquotes and lists", () => {
    const md = [
      "> ```mermaid",
      "> graph TD",
      "> ```",
      "",
      "- item",
      "",
      "  ```mermaid",
      "  graph LR",
      "  ```",
      "",
      "after",
      "",
    ].join("\n");
    const found = findMermaidDiagrams(md);
    expect(found).toHaveLength(2);
    expect(found[0].source).toBe("graph TD");
    expect(found[1].source).toBe("graph LR");
  });

  it("reports an unclosed fence at EOF (the editor shows it as a broken diagram)", () => {
    const md = "```mermaid\ngraph TD\n  A --> B";
    const found = findMermaidDiagrams(md);
    expect(found).toHaveLength(1);
    expect(found[0].end).toBe(md.length);
    expect(found[0].source).toBe("graph TD\n  A --> B");
  });

  it("finds nothing in a document without diagrams", () => {
    expect(findMermaidDiagrams("# Plain\n\nNo diagrams here.\n")).toHaveLength(0);
    expect(findMermaidDiagrams("")).toHaveLength(0);
  });
});

// --- swapMermaidFences --------------------------------------------------------

describe("swapMermaidFences (issue #104)", () => {
  it("swaps a top-level fence for a column-0 image ref, keeping the rest verbatim", () => {
    const md = "# T\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nAfter.\n";
    const out = swapMermaidFences(md, findMermaidDiagrams(md));
    expect(out).toBe("# T\n\n![diagram](diagram-1.png)\n\nAfter.\n");
  });

  it("swaps both fences of the two-diagram document in order", () => {
    const out = swapMermaidFences(TWO_DIAGRAMS, findMermaidDiagrams(TWO_DIAGRAMS));
    expect(out).toBe(
      [
        "# Report",
        "",
        "![diagram](diagram-1.png)",
        "",
        "Body text in between.",
        "",
        "![diagram](diagram-2.png)",
        "",
        "The end.",
        "",
      ].join("\n"),
    );
  });

  it("keeps the blockquote/list marker around nested fences", () => {
    const md = "> ```mermaid\n> graph TD\n> ```\n\n- item\n\n  ```mermaid\n  graph LR\n  ```\n";
    const out = swapMermaidFences(md, findMermaidDiagrams(md));
    expect(out).toBe(
      "> ![diagram](diagram-1.png)\n\n- item\n\n  ![diagram](diagram-2.png)\n",
    );
  });

  it("handles a fence at EOF without a trailing newline", () => {
    const md = "a\n\n```mermaid\nx\n```";
    const out = swapMermaidFences(md, findMermaidDiagrams(md));
    expect(out).toBe("a\n\n![diagram](diagram-1.png)");
  });

  it("leaves every non-fence byte untouched", () => {
    const diagrams = findMermaidDiagrams(TWO_DIAGRAMS);
    const out = swapMermaidFences(TWO_DIAGRAMS, diagrams);
    // The text outside the fence spans is identical.
    const origSpans = [TWO_DIAGRAMS.slice(0, diagrams[0].start), TWO_DIAGRAMS.slice(diagrams[1].end)];
    const outLines = out.split("\n");
    expect(outLines).toContain("# Report");
    expect(outLines).toContain("Body text in between.");
    expect(outLines).toContain("The end.");
    expect(origSpans[0]).toBe("# Report\n\n");
    expect(origSpans[1]).toBe("\n\nThe end.\n");
  });
});

// --- svgToPngBytes -------------------------------------------------------------

const VIEWBOX_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text>t</text></svg>';
const ATTRS_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><text>t</text></svg>';

describe("svgToPngBytes (issue #104)", () => {
  it("sizes the canvas from the viewBox at 2x and encodes PNG", async () => {
    const bytes = await svgToPngBytes(VIEWBOX_SVG);
    expect(canvasRecords).toHaveLength(1);
    expect(canvasRecords[0].width).toBe(200);
    expect(canvasRecords[0].height).toBe(100);
    expect(canvasRecords[0].drawn).toEqual([{ dw: 200, dh: 100 }]);
    expect(canvasRecords[0].blobMimes).toEqual(["image/png"]);
    // The stub blob embeds the canvas dimensions as its payload tail.
    expect(Array.from(bytes.slice(-2))).toEqual([200, 100]);
  });

  it("falls back to the width/height attributes without a viewBox", async () => {
    await svgToPngBytes(ATTRS_SVG, 1);
    expect(canvasRecords[0].width).toBe(60);
    expect(canvasRecords[0].height).toBe(30);
  });

  it("honors an explicit scale", async () => {
    await svgToPngBytes(VIEWBOX_SVG, 4);
    expect(canvasRecords[0].width).toBe(400);
    expect(canvasRecords[0].height).toBe(200);
  });

  it("rejects an SVG that does not parse", async () => {
    await expect(svgToPngBytes("not an svg at all")).rejects.toThrow(/could not be parsed/);
  });

  it("rejects an SVG with no usable size", async () => {
    const noSize = '<svg xmlns="http://www.w3.org/2000/svg"><text>t</text></svg>';
    await expect(svgToPngBytes(noSize)).rejects.toThrow(/no usable viewBox/);
  });

  it("rejects when toBlob returns no blob", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(null));
    await expect(svgToPngBytes(VIEWBOX_SVG)).rejects.toThrow(/PNG encoding failed/);
  });
});

// --- renderDiagramToPng ---------------------------------------------------------

describe("renderDiagramToPng (issue #104)", () => {
  it("renders a good diagram to PNG bytes", async () => {
    const bytes = await renderDiagramToPng("graph TD\n  A --> B", "quill");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("rejects with the mermaid error for a broken diagram", async () => {
    await expect(renderDiagramToPng("graph TD\n  BROKEN", "dark")).rejects.toThrow(
      /Parse error on line 2: BROKEN/,
    );
  });
});

// --- exportCurrentDocument -------------------------------------------------------

interface IpcCall {
  cmd: string;
  payload: unknown;
}

// Records every IPC call and simulates the Rust side: the save dialog, the
// collision-safe asset writer (echoes <dir><name>), the conversion service,
// and the best-effort cleanup.
function tauriIpc(opts?: {
  failExport?: string;
  failAssetWrite?: string;
}): { calls: IpcCall[]; written: string[]; tempMd: (name: string) => unknown } {
  const calls: IpcCall[] = [];
  const written: string[] = [];
  mockIPC((cmd, payload) => {
    calls.push({ cmd, payload });
    if (cmd === "plugin:dialog|save") return "/out/notes.pdf";
    if (cmd === "export_write_asset") {
      const p = payload as { dir: string; name: string; bytes: number[] };
      if (opts?.failAssetWrite && p.name === opts.failAssetWrite) {
        throw new Error("export_asset:disk full");
      }
      const path = `${p.dir}${p.name}`;
      written.push(path);
      return path;
    }
    if (cmd === "export_document") {
      if (opts?.failExport) throw new Error(opts.failExport);
      return;
    }
    if (cmd === "export_remove_asset") {
      return (payload as { paths: string[] }).paths;
    }
    throw new Error(`unexpected IPC ${cmd}`);
  });
  const tempMd = (name: string): unknown =>
    calls.find((c) => c.cmd === "export_write_asset" && (c.payload as { name: string }).name === name)
      ?.payload;
  return { calls, written, tempMd };
}

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 200, 100];

describe("exportCurrentDocument: two diagrams (plan 11 AC5, issue #104)", () => {
  it("writes both PNGs + the swapped temp markdown, converts it, and cleans up", async () => {
    const { calls, written, tempMd } = tauriIpc();
    await exportCurrentDocument({
      markdown: TWO_DIAGRAMS,
      theme: "quill",
      format: "pdf",
      outPath: "/out/notes.pdf",
    });

    const cmds = calls.map((c) => c.cmd);
    expect(cmds).toEqual([
      "export_write_asset",
      "export_write_asset",
      "export_write_asset",
      "export_document",
      "export_remove_asset",
    ]);

    // The PNGs are written in document order with the rendered bytes.
    const [p1, p2, pMd] = calls.slice(0, 3).map((c) => c.payload as { name: string; bytes: number[] });
    expect(p1.name).toBe("diagram-1.png");
    expect(p2.name).toBe("diagram-2.png");
    expect(pMd.name).toBe(TEMP_EXPORT_MARKDOWN);
    expect(p1.bytes).toEqual(PNG_BYTES);
    expect(p2.bytes).toEqual(PNG_BYTES);

    // The temp markdown has the fences swapped; every other byte is intact.
    const mdPayload = tempMd(TEMP_EXPORT_MARKDOWN) as {
      dir: string;
      bytes: number[];
    };
    expect(mdPayload.dir).toBe("/out/");
    const exportMd = new TextDecoder().decode(Uint8Array.from(mdPayload.bytes));
    expect(exportMd).toBe(
      [
        "# Report",
        "",
        "![diagram](diagram-1.png)",
        "",
        "Body text in between.",
        "",
        "![diagram](diagram-2.png)",
        "",
        "The end.",
        "",
      ].join("\n"),
    );

    // The conversion service converts the temp markdown, not the document.
    const docCall = calls.find((c) => c.cmd === "export_document")!;
    expect(docCall.payload).toEqual({
      path: `/out/${TEMP_EXPORT_MARKDOWN}`,
      format: "pdf",
      outPath: "/out/notes.pdf",
    });

    // Every written asset is cleaned up afterwards.
    const removeCall = calls.find((c) => c.cmd === "export_remove_asset")!;
    expect((removeCall.payload as { paths: string[] }).paths).toEqual([
      "/out/diagram-1.png",
      "/out/diagram-2.png",
      `/out/${TEMP_EXPORT_MARKDOWN}`,
    ]);
    expect(written).toEqual([
      "/out/diagram-1.png",
      "/out/diagram-2.png",
      `/out/${TEMP_EXPORT_MARKDOWN}`,
    ]);
  });
});

describe("exportCurrentDocument: all-or-nothing (plan 11 AC5, issue #104)", () => {
  it("refuses the export and writes nothing when any diagram fails", async () => {
    const broken = TWO_DIAGRAMS.replace("A->>B: hi", "BROKEN line");
    const { calls } = tauriIpc();
    await expect(
      exportCurrentDocument({
        markdown: broken,
        theme: "quill",
        format: "docx",
        outPath: "/out/notes.docx",
      }),
    ).rejects.toThrow(/Mermaid export refused: diagram 2: Parse error on line 2: BROKEN/);

    // No asset was written and no conversion ran.
    expect(calls).toEqual([]);
  });

  it("names every failing diagram in the error", async () => {
    const md = [
      "```mermaid",
      "BROKEN one",
      "```",
      "",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "",
      "```mermaid",
      "BROKEN two",
      "```",
      "",
    ].join("\n");
    const { calls } = tauriIpc();
    await expect(
      exportCurrentDocument({ markdown: md, theme: "dark", format: "epub", outPath: "/out/e.epub" }),
    ).rejects.toThrow(/Mermaid export refused: diagram 1: Parse error on line 2: BROKEN; diagram 3: Parse error on line 2: BROKEN/);
    expect(calls).toEqual([]);
  });

  it("cleans up the written assets when the conversion itself fails", async () => {
    const { calls } = tauriIpc({ failExport: "convert_failed: pandoc exploded" });
    await expect(
      exportCurrentDocument({
        markdown: TWO_DIAGRAMS,
        theme: "quill",
        format: "pdf",
        outPath: "/out/notes.pdf",
      }),
    ).rejects.toThrow(/convert_failed: pandoc exploded/);

    const cmds = calls.map((c) => c.cmd);
    expect(cmds).toEqual([
      "export_write_asset",
      "export_write_asset",
      "export_write_asset",
      "export_document",
      "export_remove_asset",
    ]);
    const removeCall = calls.find((c) => c.cmd === "export_remove_asset")!;
    expect((removeCall.payload as { paths: string[] }).paths).toHaveLength(3);
  });

  it("cleans up the partial assets when an asset write fails", async () => {
    const { calls, written } = tauriIpc({ failAssetWrite: "diagram-2.png" });
    await expect(
      exportCurrentDocument({
        markdown: TWO_DIAGRAMS,
        theme: "quill",
        format: "pdf",
        outPath: "/out/notes.pdf",
      }),
    ).rejects.toThrow(/export_asset:disk full/);

    expect(written).toEqual(["/out/diagram-1.png"]);
    const removeCall = calls.find((c) => c.cmd === "export_remove_asset")!;
    expect((removeCall.payload as { paths: string[] }).paths).toEqual(["/out/diagram-1.png"]);
  });
});

describe("exportCurrentDocument: no diagrams (issue #104)", () => {
  it("exports the current text (unsaved edits) through the temp markdown", async () => {
    const { calls, tempMd } = tauriIpc();
    const currentText = "# Edited\n\nNot saved to disk yet.\n";
    await exportCurrentDocument({
      markdown: currentText,
      theme: "quill",
      format: "txt",
      outPath: "/out/notes.txt",
    });

    const cmds = calls.map((c) => c.cmd);
    expect(cmds).toEqual(["export_write_asset", "export_document", "export_remove_asset"]);

    const mdPayload = tempMd(TEMP_EXPORT_MARKDOWN) as { bytes: number[] };
    expect(new TextDecoder().decode(Uint8Array.from(mdPayload.bytes))).toBe(currentText);

    const docCall = calls.find((c) => c.cmd === "export_document")!;
    expect(docCall.payload).toEqual({
      path: `/out/${TEMP_EXPORT_MARKDOWN}`,
      format: "txt",
      outPath: "/out/notes.txt",
    });
  });
});

// The on-disk fixture from the plan (task 11.5: "fixture export test
// (2 diagrams + 1 broken)"). It is also part of the round-trip corpus, so
// the broken mermaid fence must stay byte-identical through the editor.
const HERE = dirname(fileURLToPath(import.meta.url));
const EXPORT_FIXTURE = readFileSync(
  join(HERE, "..", "..", "..", "fixtures", "clean", "mermaid-export.md"),
  "utf-8",
);

describe("fixture export: 2 diagrams + 1 broken (plan 11 task 11.5, issue #104)", () => {
  it("finds all three fences in document order", () => {
    const found = findMermaidDiagrams(EXPORT_FIXTURE);
    expect(found).toHaveLength(3);
    expect(found.map((d) => d.fileName)).toEqual([
      "diagram-1.png",
      "diagram-2.png",
      "diagram-3.png",
    ]);
    expect(found[2].source).toBe("graph TD\n  A[Start] --> B[End BROKEN");
  });

  it("refuses the export, names the broken diagram, and writes nothing", async () => {
    const { calls, written } = tauriIpc();
    await expect(
      exportCurrentDocument({
        markdown: EXPORT_FIXTURE,
        theme: "quill",
        format: "pdf",
        outPath: "/out/report.pdf",
      }),
    ).rejects.toThrow("Mermaid export refused: diagram 3: Parse error on line 2: BROKEN");
    expect(calls).toEqual([]);
    expect(written).toEqual([]);
  });
});

// The exported PNG name pattern is stable (the plan 11 contract:
// diagram-N.png next to the temp export markdown).
describe("asset naming (issue #104)", () => {
  it("uses the diagram-N.png prefix and the hidden temp markdown name", () => {
    expect(DIAGRAM_PNG_PREFIX).toBe("diagram-");
    expect(TEMP_EXPORT_MARKDOWN.startsWith(".")).toBe(true);
  });
});
