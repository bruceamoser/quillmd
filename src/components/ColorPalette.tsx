// Shared color palette popover (plan 04 task 4.2, issue #48): the 24
// standard colors (colors.ts) as a 6-column grid, an "Auto" cell (inherit /
// no color), and a custom row backed by the native <input type="color">.
// The font color and the highlight color pickers both render this one
// component, so the two surfaces always offer the same swatches; applying a
// pick is the caller's job (onPick), which keeps the palette free of any
// editor dependency.
//
// Interaction: the trigger button toggles the popover; a swatch or the Auto
// cell applies and closes; the custom row applies when the native picker
// confirms. Outside click and Escape close without applying. The active
// swatch (the color currently at the caret) is marked; `current === null`
// marks the Auto cell instead.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { COLOR_AUTO, COLOR_PALETTE, COLOR_PALETTE_COLUMNS } from "../lib/colors";
import type { ColorPick } from "../lib/colors";

export interface ColorPaletteProps {
  // Tooltip / accessible name of the control ("Font color", "Highlight color").
  title: string;
  // The trigger's glyph (e.g. the "A" for font color); the palette renders a
  // color bar under it showing the current pick.
  trigger: ReactNode;
  // The color currently at the caret: null = auto (the Auto cell is active).
  current: string | null;
  // Called with the picked color, or COLOR_AUTO (null) for the Auto cell.
  onPick: (color: ColorPick) => void;
}

export default function ColorPalette({ title, trigger, current, onPick }: ColorPaletteProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // Close on an outside click or an Escape press (same model as the image
  // split dropdown in Toolbar.tsx).
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

  const pick = (color: ColorPick) => {
    setOpen(false);
    onPick(color);
  };

  return (
    <span className="quillmd-color" ref={rootRef}>
      <button
        type="button"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        className={open ? "quillmd-toolbar-active" : ""}
        // Keep the editor's selection while the button is pressed.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="quillmd-color-trigger">{trigger}</span>
        {current !== null && (
          <span className="quillmd-color-bar" style={{ background: current }} aria-hidden />
        )}
      </button>
      {open && (
        <span className="quillmd-color-popover" role="menu">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={current === COLOR_AUTO}
            className={current === COLOR_AUTO ? "quillmd-color-active" : ""}
            title="Auto"
            onClick={() => pick(COLOR_AUTO)}
          >
            <span className="quillmd-color-auto-swatch" aria-hidden />
            Auto
          </button>
          <span
            className="quillmd-color-grid"
            style={{ gridTemplateColumns: `repeat(${COLOR_PALETTE_COLUMNS}, 1fr)` }}
          >
            {COLOR_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                role="menuitemradio"
                aria-checked={current === color}
                className={current === color ? "quillmd-color-active" : ""}
                title={color}
                style={{ background: color }}
                onClick={() => pick(color)}
              />
            ))}
          </span>
          <label className="quillmd-color-custom">
            <input
              type="color"
              // The native picker has no "auto" state; seed it with the
              // current pick (or black) so a re-open starts where the user
              // left off.
              value={current ?? "#000000"}
              onChange={(e) => {
                const color = e.target.value;
                if (color !== "") pick(color);
              }}
            />
            <span>Custom color…</span>
          </label>
        </span>
      )}
    </span>
  );
}
