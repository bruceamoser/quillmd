// @vitest-environment jsdom
// Plan 11 task 11.7 (issue #106) — startup perf gate (plan 11 AC8):
// "Editor startup time regression < 100 ms (lazy import verified by a
// startup perf test)." The `mermaid` package (~1.9 MB min) is in the
// dependency set, but the editor must not pay for it on open: it is a lazy
// dynamic import (mermaidRender.ts), loaded on the first diagram render.
// This suite pins all three halves of the gate:
//   1. the app's startup module graph (App -> Editor -> MermaidCard ->
//      mermaidRender) evaluates without ever importing mermaid;
//   2. the import fires only on the first render call;
//   3. editor startup itself — the real Editor component (the app's path:
//      useEditor + EditorContent + node views) rendered to a ready editor —
//      stays under the 100 ms budget, with or without a diagram in the doc.
//      A diagram doc exercises the worst case: the card mounts and starts
//      the mermaid load, which must stay async (an eager import would pay
//      the package's cost inside the startup window).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Records when the (mocked) mermaid package is actually pulled in. The flag
// flips on access to the module's `default` export — the one point where
// app code (mermaidRender.loadMermaid) touches the package. A getter (not a
// factory side effect) keeps the signal honest across vi.resetModules,
// which reuses the cached mock result.
const state = vi.hoisted(() => ({ loaded: false }));

vi.mock("mermaid", () => {
  const mermaidDefault = {
    initialize: () => {},
    render: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }),
  };
  return {
    get default() {
      state.loaded = true;
      return mermaidDefault;
    },
  };
});

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Plan 11 §4 AC8 budget: editor startup must stay under 100 ms.
const STARTUP_BUDGET_MS = 100;

// A realistic small document (~10k chars of mixed structure). The perf
// envelope for large files is owned by perf.test.ts; this gate covers the
// startup path, where typical documents live.
function buildDoc(chars: number): string {
  const parts: string[] = [];
  let total = 0;
  let i = 0;
  const filler =
    "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ";
  while (total < chars) {
    const chunk = [
      `## Section ${i}`,
      `Paragraph ${i}: ${filler}`,
      `- item one ${i}\n- item two ${i}`,
    ].join("\n\n") + "\n";
    parts.push(chunk);
    total += chunk.length;
    i += 1;
  }
  return parts.join("\n");
}

const STARTER_TEMPLATE =
  "graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Done]\n  B -->|No| D[Retry]";
const DIAGRAM = "```mermaid\n" + STARTER_TEMPLATE + "\n```\n";

async function waitFor(cond: () => boolean, what: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

describe("plan 11 AC8: startup perf gate (task 11.7, issue #106)", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  function teardown(): void {
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    const c = container;
    c?.remove();
    container = null;
  }

  afterEach(teardown);

  it("the app's startup module graph does not import mermaid (lazy import)", async () => {
    vi.resetModules();
    state.loaded = false;
    // The full startup graph: App pulls in Editor (the mermaidBlock node +
    // the MermaidCard node view) and fileMenu (the export pipeline), which
    // pulls in mermaidRender. Evaluating it must not load the package.
    await import("../../App");
    expect(state.loaded).toBe(false);
  });

  it("mermaid loads only on the first render call", async () => {
    vi.resetModules();
    state.loaded = false;
    const svc = await import("../mermaidRender");
    expect(state.loaded).toBe(false);
    const result = await svc.renderMermaid(STARTER_TEMPLATE);
    expect(state.loaded).toBe(true);
    expect(result.svg).not.toBeNull();
    expect(result.error).toBeNull();
  });

  async function renderEditor(value: string): Promise<number> {
    const mod = await import("../../components/Editor");
    const find = await import("../find");
    const EditorCmp = mod.default;
    const el = document.createElement("div");
    container = el;
    document.body.appendChild(el);
    root = createRoot(el);
    const r = root;
    const t0 = performance.now();
    await act(async () => {
      r.render(<EditorCmp value={value} onChange={() => {}} />);
    });
    await waitFor(() => find.currentFindEditor() !== null, "live editor");
    return performance.now() - t0;
  }

  it(`editor startup (no diagram) stays under ${STARTUP_BUDGET_MS}ms`, async () => {
    vi.resetModules();
    state.loaded = false;
    // Warmup (JIT + module caches), then the measured runs.
    await renderEditor(buildDoc(10_000));
    teardown();

    const value = buildDoc(10_000);
    const times: number[] = [];
    for (let run = 0; run < 3; run++) {
      times.push(await renderEditor(value));
      teardown();
    }
    const best = Math.min(...times);
    console.log(
      `perf: editor startup (10k chars, no diagram) -> best of 3 ${times.map((t) => t.toFixed(1)).join(" / ")}ms = ${best.toFixed(1)}ms`,
    );
    expect(best).toBeLessThan(STARTUP_BUDGET_MS);
    // No diagram anywhere: the renderer never loads, even after settle.
    await new Promise((r) => setTimeout(r, 100));
    expect(state.loaded).toBe(false);
  }, 60000);

  it(`a doc with a diagram starts up under ${STARTUP_BUDGET_MS}ms and loads mermaid only after the card renders`, async () => {
    vi.resetModules();
    state.loaded = false;
    const value = DIAGRAM + "\n" + buildDoc(10_000);

    // Warmup with the same shape (the card's first mount pays React setup).
    await renderEditor(value);
    teardown();
    // The warmup card already triggered the lazy load; reset the flag and
    // the service's module-level caches by resetting the module registry.
    vi.resetModules();
    state.loaded = false;

    const ms = await renderEditor(value);
    console.log(`perf: editor startup (10k chars + 1 diagram) -> ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(STARTUP_BUDGET_MS);

    // The card mounts from the diagram and drives the lazy load; the SVG is
    // the mock's (the real renderer is covered by mermaidRender.test.ts).
    await waitFor(
      () => container?.querySelector(".quillmd-mermaid-card svg") !== null,
      "card svg",
    );
    expect(state.loaded).toBe(true);
  }, 60000);
});
