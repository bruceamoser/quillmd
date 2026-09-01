// Word count dialog (plan 09 task 9.4, issue #87): Tools > Word Count
// (Ctrl+Shift+F5). A read-only presentation of the counts the app already
// computes for the status bar (counts.ts — shared, so the dialog matches the
// status bar for the whole document, plan 09 AC3), plus sentences,
// paragraphs, and reading time. When a WYSIWYG selection is active at
// request time, the counts are scoped to the selected text range and the
// scope row says so; otherwise the whole document is counted.
//
// Keyboard model (plan 08 §3 convention):
//   Enter          close (the focused Close button)
//   Esc            close
//   autofocus      Close button

import { useEffect, useRef } from "react";
import { formatReadingTime, type TextCounts } from "../lib/counts";

export interface WordCountDialogProps {
  // The count set to display (whole document or selection-scoped).
  counts: TextCounts;
  // True when the counts cover the selected text range rather than the
  // whole document (drives the scope row).
  scoped: boolean;
  // Close (Enter, Esc, Close button, or the backdrop).
  onClose: () => void;
}

export default function WordCountDialog({ counts, scoped, onClose }: WordCountDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Autofocus the Close button on open so Enter/Space dismiss the dialog.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const rows: Array<[string, string]> = [
    ["Words", String(counts.words)],
    ["Characters (with spaces)", String(counts.chars)],
    ["Characters (no spaces)", String(counts.charsNoSpaces)],
    ["Sentences", String(counts.sentences)],
    ["Paragraphs", String(counts.paragraphs)],
    ["Reading time (200 wpm)", formatReadingTime(counts.readingMinutes)],
  ];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="quillmd-wordcount-overlay"
      onMouseDown={(e) => {
        // A backdrop press closes; the dialog itself keeps the event.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="quillmd-wordcount-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Word Count"
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="quillmd-wordcount-title">Word Count</div>
        <div className="quillmd-wordcount-scope">
          {scoped ? `Selection (${counts.words} words)` : "Entire document"}
        </div>

        <dl className="quillmd-wordcount-rows">
          {rows.map(([label, value]) => (
            <div key={label} className="quillmd-wordcount-row">
              <dt className="quillmd-wordcount-label">{label}</dt>
              <dd className="quillmd-wordcount-value">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="quillmd-wordcount-actions">
          <button
            ref={closeRef}
            type="button"
            className="quillmd-wordcount-button primary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
