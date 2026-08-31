// Style gallery popover (plan 05 task 5.1, issue #54): the Word-style
// dropdown over the built-in style registry (styles.ts). The top row shows
// large preview swatches for the six common styles; "More styles" lists every
// built-in style grouped by kind (paragraph / character) with its markdown
// equivalent. Picking a style runs its registry command (the same commands
// the toolbar and menus dispatch), and the active style at the cursor is
// highlighted, re-evaluated on every editor transaction.
//
// The Format > Styles menu and the toolbar button (task 5.2, same issue)
// mount this component; the gallery itself carries no editor dependency
// beyond the registry, so the tests can render it against a plain TipTap
// instance.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor as CoreEditor } from "@tiptap/core";
import {
  BUILT_IN_STYLES,
  TOP_GALLERY_STYLES,
  activeStyles,
  applyStyle,
  styleById,
} from "../lib/styles";
import type { QuillStyle, StyleKind } from "../lib/styles";

export interface StyleGalleryProps {
  editor: CoreEditor | null;
  // Tooltip / accessible name of the trigger ("Styles").
  title?: string;
}

// The sample line every swatch previews the style with.
const SAMPLE = "Aa Bb Cc";

const KIND_TITLES: Record<StyleKind, string> = {
  block: "Paragraph styles",
  mark: "Character styles",
};

// previewCSS is a "prop: value; prop2: value2" sheet; React's style prop
// wants an object, so split it (the built-in sheets use simple, single-word
// values only).
function cssToStyle(css: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const decl of css.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (prop === "") continue;
    out[prop.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = value;
  }
  return out as CSSProperties;
}

// One large top-row swatch: the sample line rendered in the style's preview
// CSS, its Word/Docs name under it.
function StyleSwatch({
  style,
  active,
  onPick,
}: {
  style: QuillStyle;
  active: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      data-style-id={style.id}
      className={active ? "quillmd-style-active" : ""}
      title={`${style.label} — ${style.markdown}`}
      onClick={() => onPick(style.id)}
    >
      <span className="quillmd-style-preview" style={cssToStyle(style.previewCSS)}>
        {SAMPLE}
      </span>
      <span className="quillmd-style-name">{style.label}</span>
    </button>
  );
}

// One "More styles" row: a small preview chip, the style name, and the
// markdown equivalent (the honest mapping, plan 05 §3).
function StyleRow({
  style,
  active,
  onPick,
}: {
  style: QuillStyle;
  active: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      data-style-id={style.id}
      className={active ? "quillmd-style-active" : ""}
      title={`${style.label} — ${style.markdown}`}
      onClick={() => onPick(style.id)}
    >
      <span className="quillmd-style-row-preview" style={cssToStyle(style.previewCSS)}>
        {SAMPLE}
      </span>
      <span className="quillmd-style-row-name">{style.label}</span>
      <span className="quillmd-style-row-md">{style.markdown}</span>
    </button>
  );
}

export default function StyleGallery({ editor, title = "Styles" }: StyleGalleryProps) {
  // Re-render on every editor transaction so the active-style highlight
  // follows the cursor while the gallery is open.
  useEditorState({
    editor,
    selector: ({ transactionNumber }) => transactionNumber,
  });

  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // Close on an outside click or an Escape press (same model as the color
  // palette popover).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!editor) return null;

  // Every built-in style active at the selection (aliases of one block, e.g.
  // Title + Heading 1 on an H1, highlight together — the mapping documents
  // which names share a markdown form).
  const activeIds = new Set(activeStyles(editor).map((style) => style.id));

  const pick = (id: string) => {
    const style = styleById(id);
    if (!style) return;
    setOpen(false);
    setMore(false);
    applyStyle(editor, style);
  };

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setMore(false);
    setOpen(true);
  };

  const topStyles = TOP_GALLERY_STYLES.map(styleById).filter(
    (style): style is QuillStyle => style !== null,
  );
  const groups: StyleKind[] = ["block", "mark"];

  return (
    <span className="quillmd-styles" ref={rootRef}>
      <button
        type="button"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        className={open ? "quillmd-toolbar-active" : ""}
        // Keep the editor's selection while the button is pressed.
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
      >
        <span className="quillmd-styles-trigger" aria-hidden>
          Aa
        </span>
      </button>
      {open && (
        <span className="quillmd-styles-popover" role="menu">
          {!more ? (
            <>
              <span className="quillmd-style-grid" role="presentation">
                {topStyles.map((style) => (
                  <StyleSwatch
                    key={style.id}
                    style={style}
                    active={activeIds.has(style.id)}
                    onPick={pick}
                  />
                ))}
              </span>
              <button
                type="button"
                role="menuitem"
                className="quillmd-style-more"
                onClick={() => setMore(true)}
              >
                More styles…
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                className="quillmd-style-more"
                onClick={() => setMore(false)}
              >
                {"\u2190"} All styles
              </button>
              {groups.map((kind) => (
                <span key={kind} className="quillmd-style-group" role="presentation">
                  <span className="quillmd-style-group-title">{KIND_TITLES[kind]}</span>
                  {BUILT_IN_STYLES.filter((style) => style.kind === kind).map((style) => (
                    <StyleRow
                      key={style.id}
                      style={style}
                      active={activeIds.has(style.id)}
                      onPick={pick}
                    />
                  ))}
                </span>
              ))}
            </>
          )}
        </span>
      )}
    </span>
  );
}
