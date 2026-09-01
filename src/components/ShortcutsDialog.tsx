// Keyboard Shortcuts dialog (plan 10 task 10.5, issue #97): Help > Shortcuts.
// Renders the single-source shortcut table (src/lib/shortcuts.ts) grouped by
// menu area — the registry rows are generated from EDITOR_COMMANDS there, so
// this dialog can't drift from the shortcuts the editor actually runs.
// Replaces the old window.alert() text block.
//
// Keyboard model (plan 08 §3 convention):
//   Enter          close (the focused Close button)
//   Esc            close
//   autofocus      Close button

import { useEffect, useRef } from "react";
import { shortcutGroups } from "../lib/shortcuts";

export interface ShortcutsDialogProps {
  // Close (Enter, Esc, Close button, or the backdrop).
  onClose: () => void;
}

export default function ShortcutsDialog({ onClose }: ShortcutsDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Autofocus the Close button on open so Enter/Space dismiss the dialog.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="quillmd-shortcuts-overlay"
      onMouseDown={(e) => {
        // A backdrop press closes; the dialog itself keeps the event.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="quillmd-shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts"
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="quillmd-shortcuts-title">Keyboard Shortcuts</div>
        <div className="quillmd-shortcuts-scope">
          The keys QuillMD listens for. The menus show the same accelerators.
        </div>

        <div className="quillmd-shortcuts-columns">
          {shortcutGroups().map(({ group, entries }) => (
            <section key={group} className="quillmd-shortcuts-group">
              <div className="quillmd-shortcuts-group-title">{group}</div>
              <dl className="quillmd-shortcuts-rows">
                {entries.map((entry) => (
                  <div key={entry.keys} className="quillmd-shortcuts-row">
                    <dt className="quillmd-shortcuts-keys">{entry.keys}</dt>
                    <dd className="quillmd-shortcuts-label">{entry.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <div className="quillmd-shortcuts-actions">
          <button
            ref={closeRef}
            type="button"
            className="quillmd-shortcuts-button primary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
