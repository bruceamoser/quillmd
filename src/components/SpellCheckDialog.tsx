// Spell check dialog (plan 09 task 9.5, issue #88): Tools > Spelling…
// (Ctrl+Shift+F7). A scan-and-flag presentation of the terms the doc's prose
// is flagged for (spellcheck.ts — the bundled wordlist, the personal
// dictionary, and the session ignore list already applied), grouped by
// lowercase form with an occurrence count. Per term: "Ignore" suppresses it
// for this session only, "Add to dictionary" adds it to the personal
// dictionary (persisted in app config, survives a restart — plan 09 AC4).
//
// Keyboard model (plan 08 §3 convention):
//   Enter          close — except on a per-term button, which activates it
//   Esc            close
//   autofocus      Close button

import { useEffect, useRef } from "react";
import type { FlaggedWord } from "../lib/spellcheck";

export interface SpellCheckDialogProps {
  // The flagged terms (first-occurrence order), after the wordlist, personal
  // dictionary, and session ignores are applied.
  flags: FlaggedWord[];
  // Suppress the term for this session only (never persisted).
  onIgnore: (word: string) => void;
  // Add the term to the personal dictionary (persisted in app config).
  onAddToDictionary: (word: string) => void;
  // Close (Enter, Esc, Close button, or the backdrop).
  onClose: () => void;
}

export default function SpellCheckDialog({
  flags,
  onIgnore,
  onAddToDictionary,
  onClose,
}: SpellCheckDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Autofocus the Close button on open so Enter/Space dismiss the dialog.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" && e.key !== "Enter") return;
    // Enter on a per-term action button (Ignore / Add to dictionary) activates
    // that button — the browser fires its click — rather than closing the
    // dialog. The Close button (the .primary control) and the rest of the
    // dialog chrome close on Enter. preventDefault stops the browser's own
    // button activation, so onClose fires exactly once.
    if (e.key === "Enter") {
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement && !active.classList.contains("primary")) return;
    }
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  return (
    <div
      className="quillmd-spellcheck-overlay"
      onMouseDown={(e) => {
        // A backdrop press closes; the dialog itself keeps the event.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="quillmd-spellcheck-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Spelling"
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="quillmd-spellcheck-title">Spelling…</div>
        <div className="quillmd-spellcheck-scope">
          {flags.length === 0
            ? "No misspellings found"
            : `${flags.length} flagged term${flags.length === 1 ? "" : "s"}`}
        </div>

        {flags.length > 0 ? (
          <ul className="quillmd-spellcheck-terms">
            {flags.map((f) => (
              <li key={f.word} className="quillmd-spellcheck-term">
                <span className="quillmd-spellcheck-word" title={`Found ${f.count}×`}>
                  {f.word}
                  {f.count > 1 ? ` (${f.count})` : ""}
                </span>
                <span className="quillmd-spellcheck-term-actions">
                  <button
                    type="button"
                    className="quillmd-spellcheck-button"
                    title="Ignore this term for this session"
                    onClick={() => onIgnore(f.word)}
                  >
                    Ignore
                  </button>
                  <button
                    type="button"
                    className="quillmd-spellcheck-button"
                    title="Add this term to the personal dictionary (permanent)"
                    onClick={() => onAddToDictionary(f.word)}
                  >
                    Add to dictionary
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="quillmd-spellcheck-empty">
            The document&apos;s prose is clear. Code blocks are never spell-checked.
          </div>
        )}

        <div className="quillmd-spellcheck-actions">
          <button
            ref={closeRef}
            type="button"
            className="quillmd-spellcheck-button primary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
