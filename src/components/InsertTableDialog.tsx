// "Insert table…" dialog (plan 06 task 6.3, issue #63): the precise-size
// variant of the table insert — rows/columns fields (1..99) plus a header-row
// checkbox, for sizes the 10×10 hover picker cannot express (>10) or an
// explicit header choice. A native dialog cannot hold the fields, so the
// dialog lives in the webview (plan 06 §3), the same shape as the link and
// image dialogs. Fully controlled: App.tsx owns the open state and applies
// the result through the tableInsert registry command.
//
// Keyboard model (plan 06 §3):
//   Enter          submit (Insert)
//   Esc            cancel
//   autofocus      rows field, selected
//
// Validation: whole numbers in 1..99 per dimension; anything else (blank,
// fractional, out of range) shows the error and refuses to submit.

import { useEffect, useRef, useState } from "react";
import {
  TABLE_MAX,
  TABLE_MIN,
  isValidTableSize,
  type TableInsertSpec,
} from "../lib/tables";

export interface InsertTableDialogProps {
  // Submits the dialog with the field values.
  onApply: (spec: TableInsertSpec) => void;
  // Cancel (Esc, Cancel button, or the backdrop).
  onClose: () => void;
}

// The dialog's field defaults: the fixed 3×3 header table the size picker
// replaces, so "Insert table…" opens on a familiar size.
const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 3;
const DEFAULT_HEADER = true;

function parseSize(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isInteger(n) ? n : null;
}

export default function InsertTableDialog({ onApply, onClose }: InsertTableDialogProps) {
  const [rows, setRows] = useState(String(DEFAULT_ROWS));
  const [cols, setCols] = useState(String(DEFAULT_COLS));
  const [withHeaderRow, setWithHeaderRow] = useState(DEFAULT_HEADER);
  // Error reported by the last failed submit; live validation covers the
  // non-empty cases while typing.
  const [error, setError] = useState<string | null>(null);
  const rowsRef = useRef<HTMLInputElement>(null);
  const colsRef = useRef<HTMLInputElement>(null);

  // Plan 06 §3: autofocus the rows field on open, selected for replacement.
  useEffect(() => {
    const el = rowsRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const rowsNum = parseSize(rows);
  const colsNum = parseSize(cols);
  const sizeValid = rowsNum !== null && colsNum !== null && isValidTableSize(rowsNum, colsNum);

  const submit = () => {
    if (rowsNum === null || colsNum === null || !isValidTableSize(rowsNum, colsNum)) {
      setError(`Rows and columns must be whole numbers between ${TABLE_MIN} and ${TABLE_MAX}.`);
      if (rowsNum === null) rowsRef.current?.focus();
      else colsRef.current?.focus();
      return;
    }
    onApply({ rows: rowsNum, cols: colsNum, withHeaderRow });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter") {
      // Intercept implicit form submission so the same submit path runs in
      // the browser and in the jsdom tests.
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="quillmd-table-dialog-overlay"
      onMouseDown={(e) => {
        // A backdrop press cancels; the dialog itself keeps the event.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="quillmd-table-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Insert table"
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="quillmd-table-dialog-title">Insert Table</div>

        <form
          className="quillmd-table-dialog-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="quillmd-table-dialog-fields">
            <label className="quillmd-image-field">
              <span className="quillmd-image-label">Rows</span>
              <input
                ref={rowsRef}
                className={`quillmd-image-input${error && rowsNum === null ? " error" : ""}`}
                type="number"
                min={TABLE_MIN}
                max={TABLE_MAX}
                value={rows}
                onChange={(e) => {
                  setRows(e.target.value);
                  if (error) setError(null);
                }}
              />
            </label>
            <label className="quillmd-image-field">
              <span className="quillmd-image-label">Columns</span>
              <input
                ref={colsRef}
                className={`quillmd-image-input${error && colsNum === null ? " error" : ""}`}
                type="number"
                min={TABLE_MIN}
                max={TABLE_MAX}
                value={cols}
                onChange={(e) => {
                  setCols(e.target.value);
                  if (error) setError(null);
                }}
              />
            </label>
          </div>
          <label className="quillmd-table-dialog-checkbox">
            <input
              type="checkbox"
              checked={withHeaderRow}
              onChange={(e) => setWithHeaderRow(e.target.checked)}
            />
            <span>Header row</span>
          </label>

          {error && <div className="quillmd-image-error">{error}</div>}

          <div className="quillmd-image-actions">
            <div className="quillmd-image-actions-right">
              <button type="button" className="quillmd-image-button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="quillmd-image-button primary"
                disabled={!sizeValid}
              >
                Insert
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
