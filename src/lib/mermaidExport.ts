// Mermaid PNG export pipeline (plan 11 task 11.5, issue #104).
//
// On export, every mermaid diagram in the current document is rendered to a
// PNG client-side (SVG -> Image -> 2x canvas -> toBlob), written next to a
// temp export markdown through export_write_asset, and the fence is swapped
// for ![diagram](diagram-N.png) in a throwaway copy of the markdown that
// pandoc consumes (pandoc embeds the relative image refs into PDF/DOCX/EPUB).
// All-or-nothing: if any diagram fails to render, the export is refused with
// a named error and nothing is written (no silent drop, no half-export).
//
// The fence text in the document is never modified (golden rule 1): only the
// temp export copy carries the image references.

import type { Code, Node, Root } from "mdast";
import {
  exportDocument,
  exportRemoveAsset,
  exportWriteAsset,
  type ExportFormat,
} from "./fileIo";
import { parseToAst } from "./markdown";
import { renderMermaid } from "./mermaidRender";
import type { ThemeId } from "./theme";

// The asset names inside the export output directory. The temp markdown is a
// hidden dotfile so it can never collide with a real document name.
export const DIAGRAM_PNG_PREFIX = "diagram-";
export const TEMP_EXPORT_MARKDOWN = ".quillmd-export.md";

export interface MermaidDiagram {
  // 1-based position in document order (matches diagram-N.png).
  index: number;
  // Byte offset of the first fence character.
  start: number;
  // Byte offset just past the last character of the closing fence, or EOF
  // when the fence is unclosed (micromark positions).
  end: number;
  // The diagram source (the fence body).
  source: string;
  // The exported PNG file name (diagram-N.png).
  fileName: string;
}

// Finds every mermaid code fence in the document using the same parser and
// the same lang test as the editor (pm.ts maps `lang === "mermaid"` to the
// diagram card), so the export treats exactly the blocks the editor shows as
// diagrams — including fences nested in blockquotes and lists.
export function findMermaidDiagrams(markdown: string): MermaidDiagram[] {
  const root = parseToAst(markdown) as Root;
  const found: MermaidDiagram[] = [];
  const visit = (node: Node): void => {
    if (node.type === "code" && (node as Code).lang === "mermaid") {
      const code = node as Code;
      const start = code.position?.start?.offset;
      const end = code.position?.end?.offset;
      if (start !== undefined && end !== undefined) {
        found.push({
          index: found.length + 1,
          start,
          end,
          source: code.value,
          fileName: `${DIAGRAM_PNG_PREFIX}${found.length + 1}.png`,
        });
      }
    }
    const children = (node as { children?: Node[] }).children;
    if (Array.isArray(children)) {
      for (const child of children) visit(child);
    }
  };
  visit(root);
  return found;
}

// Replaces each diagram's fence span with its image reference and returns
// the throwaway export copy of the document. Spans are replaced
// last-to-first so earlier offsets stay valid; every other byte is kept
// verbatim (the document itself is never rewritten — golden rule 1).
export function swapMermaidFences(markdown: string, diagrams: MermaidDiagram[]): string {
  let out = markdown;
  for (let i = diagrams.length - 1; i >= 0; i -= 1) {
    const d = diagrams[i];
    out = out.slice(0, d.start) + `![diagram](${d.fileName})` + out.slice(d.end);
  }
  return out;
}

// Normalizes whatever the render pipeline throws into a displayable message.
function errorMessage(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const err = e as { str?: unknown; message?: unknown };
    if (typeof err.str === "string" && err.str.length > 0) return err.str;
    if (typeof err.message === "string" && err.message.length > 0) return err.message;
  }
  return String(e);
}

// Renders diagram source to PNG bytes (SVG -> 2x canvas). Rejects with the
// mermaid error message when the diagram does not render.
export async function renderDiagramToPng(source: string, theme: ThemeId): Promise<Uint8Array> {
  const result = await renderMermaid(source, theme);
  if (result.error !== null || result.svg === null) {
    throw new Error(result.error ?? "diagram rendered to no SVG");
  }
  return svgToPngBytes(result.svg);
}

// The intrinsic size of an SVG string: the viewBox when present, else the
// width/height attributes. Throws when the SVG has no usable size (a diagram
// the rasterizer could not place).
function svgIntrinsicSize(svg: string): { width: number; height: number } {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const el = doc.documentElement;
  if (el.nodeName !== "svg" || el.querySelector("parsererror")) {
    throw new Error("diagram SVG could not be parsed");
  }
  const vb = el.getAttribute("viewBox");
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/);
    if (parts.length === 4) {
      const w = Number(parts[2]);
      const h = Number(parts[3]);
      if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
        return { width: w, height: h };
      }
    }
  }
  const w = Number(el.getAttribute("width"));
  const h = Number(el.getAttribute("height"));
  if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
    return { width: w, height: h };
  }
  throw new Error("diagram SVG has no usable viewBox or width/height");
}

// Loads an SVG string into an offscreen Image through a data URL.
function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("diagram SVG could not be loaded"));
    image.src = url;
  });
}

// Rasterizes an SVG string to PNG bytes at `scale` (2x by default, so
// diagrams stay crisp in PDF/DOCX). The canvas is sized from the SVG's
// intrinsic size (viewBox, then width/height), not from layout, so the
// output dimensions are deterministic.
export async function svgToPngBytes(svg: string, scale = 2): Promise<Uint8Array> {
  const { width, height } = svgIntrinsicSize(svg);
  const image = await loadSvgImage(svg);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
  if (blob === null) throw new Error("PNG encoding failed (canvas.toBlob returned no blob)");
  return new Uint8Array(await blob.arrayBuffer());
}

// Parent directory of a path (both / and \ separators; "" when the path has
// no directory, which the Rust layer rejects with a clear error).
function dirNameOf(path: string): string {
  const m = /^(.*[\\/])/.exec(path);
  return m ? m[1] : "";
}

export interface MermaidExportJob {
  // The current document text (unsaved edits included).
  markdown: string;
  // The active theme (maps to the mermaid light/dark theme).
  theme: ThemeId;
  format: ExportFormat;
  // The final export output path (e.g. /docs/notes.pdf); the temp assets
  // are written next to it so pandoc resolves the image refs.
  outPath: string;
}

// The whole pipeline. Before anything is written, every diagram is rendered;
// if any fails, the error names the failing diagrams (1-based) and no asset
// is written. After the first write, the temp assets (PNGs + temp markdown)
// are always cleaned up, best-effort, so a failed conversion leaves no
// orphaned files.
export async function exportCurrentDocument(job: MermaidExportJob): Promise<void> {
  const { markdown, theme, format, outPath } = job;
  const diagrams = findMermaidDiagrams(markdown);

  if (diagrams.length > 0) {
    // Render every diagram before writing anything (all-or-nothing).
    const results = await Promise.all(
      diagrams.map((d) =>
        renderDiagramToPng(d.source, theme).then(
          (png) => ({ png, error: null as string | null }),
          (e: unknown) => ({ png: null, error: errorMessage(e) }),
        ),
      ),
    );
    const failures = results
      .map((r, i) => (r.error !== null ? `diagram ${i + 1}: ${r.error}` : null))
      .filter((f): f is string => f !== null);
    if (failures.length > 0) {
      throw new Error(`Mermaid export refused: ${failures.join("; ")}`);
    }

    const outDir = dirNameOf(outPath);
    const assets: string[] = [];
    try {
      for (let i = 0; i < diagrams.length; i += 1) {
        assets.push(await exportWriteAsset(outDir, diagrams[i].fileName, results[i].png!));
      }
      const exportMarkdown = swapMermaidFences(markdown, diagrams);
      assets.push(
        await exportWriteAsset(outDir, TEMP_EXPORT_MARKDOWN, new TextEncoder().encode(exportMarkdown)),
      );
      // The temp markdown (last asset) is what pandoc converts.
      await exportDocument(assets[assets.length - 1], format, outPath);
    } finally {
      await exportRemoveAsset(assets).catch(() => [] as string[]);
    }
    return;
  }

  // No diagrams: still export the current text through the temp markdown so
  // unsaved edits are exported (and untitled documents can be exported at
  // all) instead of the possibly-stale file on disk.
  const outDir = dirNameOf(outPath);
  const assets: string[] = [];
  try {
    assets.push(
      await exportWriteAsset(outDir, TEMP_EXPORT_MARKDOWN, new TextEncoder().encode(markdown)),
    );
    await exportDocument(assets[0], format, outPath);
  } finally {
    await exportRemoveAsset(assets).catch(() => [] as string[]);
  }
}
