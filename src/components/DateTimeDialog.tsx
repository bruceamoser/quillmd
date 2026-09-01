// Date & Time dialog (plan 09 task 9.6, issue #89): Insert > Date & Time.
// Lists the app's date/time formats (dateformats.ts), each row showing a
// live sample for the current date — the samples tick every second so the
// time-with-seconds rows stay honest while the dialog is open. Clicking a
// row inserts that sample at the caret as plain text (no markup, plan 09
// §3) and closes the dialog.
//
// Keyboard model (plan 08 §3 convention):
//   Enter          insert the focused row
//   ArrowUp/Down   move between rows
//   Esc            close
//   autofocus      first row

import { useEffect, useMemo, useRef, useState } from "react";
import { DATE_TIME_FORMATS, dateTimeSample } from "../lib/dateformats";

export interface DateTimeDialogProps {
  // Insert the picked format's sample at the caret. The app shell runs the
  // insertion and closes the dialog.
  onInsert: (text: string) => void;
  // Close (Esc or the backdrop).
  onClose: () => void;
}

export default function DateTimeDialog({ onInsert, onClose }: DateTimeDialogProps) {
  // The samples are of "now": tick every second so the time-with-seconds
  // rows stay live while the dialog is open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const rows = useMemo(
    () =>
      DATE_TIME_FORMATS.map((spec) => ({
        id: spec.id,
        label: spec.label,
        sample: dateTimeSample(spec, now),
      })),
    [now],
  );

  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Autofocus the first row so Enter inserts it and the arrows walk the list.
  useEffect(() => {
    rowRefs.current[0]?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const current = rowRefs.current.findIndex((el) => el === document.activeElement);
      const next =
        e.key === "ArrowDown"
          ? (current + 1) % rows.length
          : (current - 1 + rows.length) % rows.length;
      rowRefs.current[next]?.focus();
    }
  };

  return (
    <div
      className="quillmd-datetime-overlay"
      onMouseDown={(e) => {
        // A backdrop press closes; the dialog itself keeps the event.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="quillmd-datetime-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Date & Time"
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="quillmd-datetime-title">Date &amp; Time</div>
        <div className="quillmd-datetime-hint">
          Insert the selected format for the current date
        </div>

        <div className="quillmd-datetime-rows">
          {rows.map((row, i) => (
            <button
              key={row.id}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              type="button"
              className="quillmd-datetime-row"
              title={row.sample}
              onClick={() => onInsert(row.sample)}
            >
              <span className="quillmd-datetime-label">{row.label}</span>
              <span className="quillmd-datetime-value">{row.sample}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
