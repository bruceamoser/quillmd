// Shared color palette (plan 04 task 4.2, issue #48): the 24 standard colors
// (Word's palette, rows of 6) plus the "auto" (inherit) and custom (any hex)
// handling. The constant is shared by the font color and the highlight color
// pickers so both surfaces always offer the same swatches. The palette is
// pure data + string helpers: it never touches the document, so it cannot
// affect the round-trip.

// The 24 standard colors, row-major: four shade rows (dark, primary, light,
// lightest) across six hue columns (gray, red, orange, gold, green, blue).
// The light/lightest shades are the Office accent tints, so a picked swatch
// reads like a Word document.
export const COLOR_PALETTE: readonly string[] = [
  // Row 1 — dark shades.
  "#000000",
  "#7f0000",
  "#9c5700",
  "#7f6000",
  "#375623",
  "#1f4e79",
  // Row 2 — primary colors.
  "#595959",
  "#c00000",
  "#ed7d31",
  "#ffc000",
  "#70ad47",
  "#4472c4",
  // Row 3 — light shades.
  "#a6a6a6",
  "#ff6b6b",
  "#f4b183",
  "#ffd966",
  "#a9d18e",
  "#9dc3e6",
  // Row 4 — lightest shades.
  "#d9d9d9",
  "#ffc7ce",
  "#fbe2d5",
  "#fff2cc",
  "#e2efda",
  "#ddebf7",
];

// The grid geometry the popover renders (plan 04 §3: "rows of 6").
export const COLOR_PALETTE_COLUMNS = 6;

// "Auto" is the inherit choice: it clears the mark's color (the font falls
// back to the document default, the highlight to its default yellow).
export const COLOR_AUTO = null;

export type ColorPick = string | null;

// A #rrggbb hex color (any case) or a browser-normalized rgb(r, g, b)
// (DOM paste hands us the CSSOM form). Canonical output is lowercase hex;
// null when the value is not a color (the picker and the pm.ts span parser
// both normalize through this one implementation).
export function normalizeColor(value: string): string | null {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (hex) return `#${hex[1].toLowerCase()}`;
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(value);
  if (rgb) {
    const nums = rgb.slice(1).map(Number);
    if (nums.some((n) => n > 255)) return null;
    return `#${nums.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

// Whether a normalized color is one of the 24 standard swatches (used to
// mark the active cell in the grid).
export function isPaletteColor(color: string | null): boolean {
  if (color === null) return false;
  return COLOR_PALETTE.includes(color);
}
