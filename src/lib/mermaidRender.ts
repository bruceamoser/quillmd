// Mermaid render service (plan 11 task 11.2, issue #101): renders mermaid
// diagram source to SVG for the WYSIWYG card, Preview, and PNG export.
// The SVG is a view artifact only — the fence text in the document stays
// the single source of truth (golden rule 1), nothing is ever written back.
//
// The `mermaid` package (~1.9 MB min) is loaded lazily through a dynamic
// import on the first render, so opening the editor does not pay its cost
// (plan 11 AC8). Initialization happens exactly once, with the security
// level pinned to "strict": diagrams cannot run scripts or bind click
// handlers, and the returned SVG has passed mermaid's DOMPurify sanitize.
// Theme follows the active QuillMD theme, mapped to mermaid's light/dark.

import type { ThemeId } from "./theme";

// The mermaid theme values QuillMD themes map onto (plan 11 §3: "theme
// mapped from the active QuillMD theme — light/dark").
export type MermaidThemeMode = "default" | "dark";

export interface MermaidRenderResult {
  // The rendered SVG markup, or null on failure.
  svg: string | null;
  // The mermaid error message (includes the offending line), or null on
  // success. A failure never throws — the card shows the error state.
  error: string | null;
}

type MermaidModule = typeof import("mermaid").default;

// Pinned for every render: no auto-render on load (we render explicitly),
// strict security (no scripts, no click handlers), and no error DOM nodes
// (failures surface through the return value, not stray divs).
const STRICT_INIT = {
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
} as const;

// "dark" and "high-contrast" render with mermaid's dark theme; the remaining
// light QuillMD themes use the default (light) theme.
export function mermaidThemeFor(theme: ThemeId): MermaidThemeMode {
  return theme === "dark" || theme === "high-contrast" ? "dark" : "default";
}

let mermaidPromise: Promise<MermaidModule> | null = null;
let appliedTheme: MermaidThemeMode | null = null;

// Lazy load: the first call pays the dynamic import; every later call
// awaits the same promise (and thus the same module instance).
async function loadMermaid(): Promise<MermaidModule> {
  if (mermaidPromise === null) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

// Initialize once, and re-initialize only when the requested theme changes
// (mermaid.initialize merges into the running config).
async function ensureMermaid(mode: MermaidThemeMode): Promise<MermaidModule> {
  const mermaid = await loadMermaid();
  if (appliedTheme !== mode) {
    mermaid.initialize({ ...STRICT_INIT, theme: mode });
    appliedTheme = mode;
  }
  return mermaid;
}

// A unique id per render call: mermaid.render builds temporary DOM elements
// under the id, and reusing an id across concurrent renders is the classic
// duplicate-id race (one render removes the other's nodes).
let renderSeq = 0;

function nextRenderId(): string {
  renderSeq += 1;
  return `quillmd-mermaid-${renderSeq}`;
}

// Normalize whatever mermaid throws into a displayable message. Newer
// versions throw Error; some paths reject with `{ str, hash }`.
function errorMessage(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const err = e as { str?: unknown; message?: unknown };
    if (typeof err.str === "string" && err.str.length > 0) return err.str;
    if (typeof err.message === "string" && err.message.length > 0) return err.message;
  }
  return String(e);
}

// Render diagram source to SVG. Resolves (never rejects): `{ svg, error }`
// carries the outcome, so a syntax error is data for the card's error badge,
// not an exception for the caller to handle.
export async function renderMermaid(
  source: string,
  theme: ThemeId = "quill",
): Promise<MermaidRenderResult> {
  let mermaid: MermaidModule;
  try {
    mermaid = await ensureMermaid(mermaidThemeFor(theme));
  } catch (e) {
    return {
      svg: null,
      error: `Failed to load the diagram renderer: ${errorMessage(e)}`,
    };
  }

  // Offscreen container: mermaid.render appends its temporary render
  // element here (and removes it when done), so no visible document node is
  // ever touched. The container itself is removed unconditionally.
  const container = document.createElement("div");
  container.style.display = "none";
  document.body.appendChild(container);
  try {
    const { svg } = await mermaid.render(nextRenderId(), source, container);
    return { svg, error: null };
  } catch (e) {
    return { svg: null, error: errorMessage(e) };
  } finally {
    container.remove();
  }
}

// Trailing-edge debounce for the card NodeView's re-render scheduling
// (plan 11: ~300 ms while the source is being typed).
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = ((...args: A) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  }) as Debounced<A>;
  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced;
}
