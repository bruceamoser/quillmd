// Table size-picker popover (plan 06 task 6.3, issue #63): the 10×10 hover
// grid that replaces the fixed 3×3 insert, like Word/Docs. Hovering a cell
// previews rows×cols (rows = distance from the top edge, cols = distance
// from the left edge) with an "N × M" readout; the pick (click) inserts that
// exact size at the cursor with a header row (the GFM default, and the same
// as the fixed 3×3 insert it replaces). Precise sizes (>10, or an explicit
// header-row choice) go through the "Insert table…" dialog instead.
//
// Purely presentational: the caller (the toolbar's Table split button) owns
// the open state, the outside-click/Escape dismissal, and the pick — which
// dispatches the tableInsert registry command so every surface inserts the
// identical table.

import { useState } from "react";
import { TABLE_PICKER_SIZE, type TableInsertSpec } from "../lib/tables";

export interface TableSizePickerProps {
  // Receives the hovered size on pick.
  onPick: (spec: TableInsertSpec) => void;
}

export default function TableSizePicker({ onPick }: TableSizePickerProps) {
  // The hovered cell (1-based rows/cols); null before the first hover.
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(null);

  const pick = (rows: number, cols: number) => {
    // Header row on: the GFM delimiter row is mandatory, and the fixed 3×3
    // insert this replaces always carried a header row. The dialog is the
    // surface for opting out.
    onPick({ rows, cols, withHeaderRow: true });
  };

  const cells = [];
  for (let row = 1; row <= TABLE_PICKER_SIZE; row += 1) {
    for (let col = 1; col <= TABLE_PICKER_SIZE; col += 1) {
      const active = hover !== null && row <= hover.rows && col <= hover.cols;
      cells.push(
        <div
          key={`${row}-${col}`}
          data-row={row}
          data-col={col}
          aria-label={`${row} row${row > 1 ? "s" : ""}, ${col} column${col > 1 ? "s" : ""}`}
          className={
            active ? "quillmd-table-picker-cell active" : "quillmd-table-picker-cell"
          }
          onMouseEnter={() => setHover({ rows: row, cols: col })}
          onMouseDown={(e) => {
            // preventDefault keeps the editor's selection while the pick is
            // dispatched (the table then lands at the caret), the same model
            // as the slash menu's items.
            e.preventDefault();
            pick(row, col);
          }}
        />,
      );
    }
  }

  return (
    <div className="quillmd-table-picker" role="grid" aria-label="Table size">
      <div className="quillmd-table-picker-grid" onMouseLeave={() => setHover(null)}>
        {cells}
      </div>
      <div className="quillmd-table-picker-readout" aria-live="polite">
        {hover ? `${hover.rows} \u00d7 ${hover.cols}` : `1 \u2013 ${TABLE_PICKER_SIZE}`}
      </div>
    </div>
  );
}
