// MermaidCard (plan 11 task 11.3, issue #102): the React NodeView for the
// mermaidBlock node (plan 11 task 11.1, issue #100). The card renders the
// diagram as a live SVG in preview mode and swaps to an editable source
// surface in edit mode, with a header bar (label, Edit/Preview toggle, error
// badge) and an error footer.
//
// The fence text in the document is the single source of truth (golden rule
// 1); the SVG is a view artifact that is never stored or written back. The
// edit surface is the node's own ProseMirror text (NodeViewContent), so
// editing flows through the editor's normal transactions: undo/redo stays at
// the markdown-text level (plan 11 AC7 — undo restores the prior fence text
// exactly) and the unified markdown-text undo works unchanged.
//
// A syntax error never breaks the editor: render failure is data (the render
// service resolves, it does not throw), and the card shows a red badge plus
// the first error line in the footer while the source stays visible (never
// blank). Re-renders are debounced ~300 ms while the source is typed.

import { useEffect, useRef, useState } from "react";
import type React from "react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/core";
import { registerMermaidCardModeHandler } from "../lib/mermaidCardMode";
import { renderMermaid } from "../lib/mermaidRender";
import { isThemeId, type ThemeId } from "../lib/theme";

// Trailing-edge delay for the card's re-render (plan 11: ~300 ms while the
// source is being typed).
const RE_RENDER_DELAY_MS = 300;

// The active QuillMD theme of the editor that owns the mounted cards. The
// Editor component lives in the app's React tree, but a NodeView renders in
// its own React root (ReactNodeViewRenderer), so the theme crosses that
// boundary through this module holder: the Editor writes it on mount and on
// theme change, and every mounted card re-renders its SVG with the mapped
// mermaid theme (plan 11 AC3 — switching themes re-renders light/dark).
export const mermaidCardRuntime = {
  theme: "quill" as ThemeId,
};

const mermaidCardListeners = new Set<() => void>();

// Editor.tsx (and any host) calls this when the active document's theme
// changes. It is a no-op while the theme is unchanged, so the common case
// (a re-render for an unrelated reason) never re-renders the diagrams.
export function setMermaidCardTheme(theme: ThemeId): void {
  if (mermaidCardRuntime.theme === theme) return;
  mermaidCardRuntime.theme = theme;
  for (const listener of mermaidCardListeners) listener();
}

type CardMode = "preview" | "edit";

interface RenderState {
  // The last successful SVG markup, or null while pending / on failure.
  svg: string | null;
  // The render error message, or null on success.
  error: string | null;
}

// The framework passes its own ref through as a prop (React 19 treats ref as
// a regular prop for function components); the core NodeViewProps type does
// not declare it, so the card's props add it.
type MermaidCardProps = NodeViewProps & { ref?: React.Ref<HTMLElement> };

export default function MermaidCard(props: MermaidCardProps) {
  const { node } = props;
  const [mode, setMode] = useState<CardMode>("preview");
  const [renderState, setRenderState] = useState<RenderState>({ svg: null, error: null });
  const [rendering, setRendering] = useState(false);
  const [theme, setThemeState] = useState<ThemeId>(mermaidCardRuntime.theme);

  // The diagram source: the node's own text (the fence body). This is what
  // the user edits and what the render service renders.
  const source = node.textBetween(0, node.content.size);

  // Theme changes arrive through the module holder (written by the Editor),
  // which is outside this component's prop flow, so subscribe and mirror the
  // current theme into state. The subscription is stable across re-renders.
  useEffect(() => {
    const notify = () => {
      const next = mermaidCardRuntime.theme;
      if (isThemeId(next)) setThemeState(next);
    };
    mermaidCardListeners.add(notify);
    return () => {
      mermaidCardListeners.delete(notify);
    };
  }, []);

  // Mode channel (plan 11 task 11.6, issue #105): the diagram node's
  // context-menu item set (diagramMenu.ts) switches this card's mode through
  // the diagramEdit / diagramPreview registry commands. The card registers
  // itself on mount — its doc position plus the mode getter/setter — so a
  // request for the diagram under the selection lands here. The mode itself
  // stays React state; the channel only routes the switch.
  const modeRef = useRef<CardMode>(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    return registerMermaidCardModeHandler({
      getPos: () => {
        const pos = props.getPos();
        return typeof pos === "number" ? pos : null;
      },
      setMode: (next) => {
        // Update the ref synchronously so getMode reports the new mode
        // immediately (React state, and the effect that mirrors it into the
        // ref, only settle on the next render).
        modeRef.current = next;
        setMode(next);
      },
      getMode: () => modeRef.current,
    });
  }, []);

  // Debounced re-render (plan 11: ~300 ms while the source changes). Every
  // source or theme change re-arms a single trailing timer; a render that is
  // superseded by a newer source/theme is dropped (seq guard) so a slow stale
  // render can never clobber a fresher result. `rendering` drives the
  // "rendering…" chip and is held true from scheduling until the current
  // render settles.
  const requestSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const seq = ++requestSeq.current;
    setRendering(true);
    const timer = setTimeout(() => {
      void renderMermaid(source, theme).then((result) => {
        if (!mounted.current || seq !== requestSeq.current) return;
        setRenderState(result);
        setRendering(false);
      });
    }, RE_RENDER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [source, theme]);

  const error = renderState.error;
  const svg = renderState.svg;

  // Preview body: the SVG when the last render succeeded, otherwise the
  // source (a render failure shows the source, never a blank card). Edit
  // body is always the source. The source surface (NodeViewContent) is kept
  // mounted in both modes and only hidden via display:none, so ProseMirror's
  // content DOM stays attached and the selection/undo model never breaks.
  const showSvg = mode === "preview" && svg !== null;
  const showSource = mode === "edit" || (mode === "preview" && svg === null);

  // The first line of the error for the footer (plan 11: "the first error
  // line in the card footer"); the full message is kept in the title so
  // nothing is lost.
  const firstErrorLine = error ? error.split("\n", 1)[0] : null;

  const switchMode = (next: CardMode) => {
    if (next !== mode) setMode(next);
  };

  return (
    <NodeViewWrapper
      as="div"
      ref={props.ref}
      className={`quillmd-mermaid-card quillmd-mermaid-${mode}${
        error ? " quillmd-mermaid-error" : ""
      }`}
      data-mode={mode}
    >
      <div className="quillmd-mermaid-header">
        <span className="quillmd-mermaid-label">Mermaid</span>
        {error && (
          <span className="quillmd-mermaid-badge" title={error}>
            Error
          </span>
        )}
        {rendering && !error && <span className="quillmd-mermaid-rendering">rendering…</span>}
        <span className="quillmd-mermaid-actions">
          <button
            type="button"
            className={mode === "edit" ? "quillmd-mermaid-active" : ""}
            onClick={() => switchMode("edit")}
          >
            Edit
          </button>
          <button
            type="button"
            className={mode === "preview" ? "quillmd-mermaid-active" : ""}
            onClick={() => switchMode("preview")}
          >
            Preview
          </button>
        </span>
      </div>
      <div className="quillmd-mermaid-body">
        <div
          className="quillmd-mermaid-svg"
          style={{ display: showSvg ? undefined : "none" }}
          // Click-to-edit (plan 11 §3): the preview is read-only, so a click
          // on the rendered diagram drops into edit mode at the source.
          onClick={() => {
            if (mode === "preview") switchMode("edit");
          }}
        >
          {showSvg && (
            // The SVG is sanitized by mermaid's strict security level in the
            // render service (no scripts, no click handlers); it is a view
            // artifact only and is never written back to the document.
            <div
              className="quillmd-mermaid-svg-inner"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        </div>
        <div
          className="quillmd-mermaid-source"
          style={{ display: showSource ? undefined : "none" }}
        >
          {/* The editable source: the node's real ProseMirror text. Enter
              inserts a newline (code node), so multi-line diagrams edit
              naturally and undo/redo stays at the markdown-text level. The
              inline white-space overrides NodeViewContent's default
              pre-wrap so long lines scroll like code, not wrap. */}
          <NodeViewContent
            as="code"
            className="quillmd-mermaid-source-code"
            style={{ whiteSpace: "pre" }}
          />
        </div>
      </div>
      {error && (
        <div className="quillmd-mermaid-footer" title={error}>
          {firstErrorLine}
        </div>
      )}
    </NodeViewWrapper>
  );
}
