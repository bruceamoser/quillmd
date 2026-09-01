// Special characters popover (plan 09 task 9.6, issue #89): Insert > Special
// Characters…. A search box that matches symbol names ("copyright" → ©),
// category tabs (currency, math, arrows, bullets, typography, symbols), and
// a recents row of previously inserted characters. Clicking a symbol inserts
// it at the caret as plain text; the popover stays open so several characters
// can be inserted in a row (Word behavior). Recents persist to localStorage
// (symbols.ts) across sessions.
//
// Keyboard model (plan 08 §3 convention):
//   Esc            close
//   search box     filters the grid as you type
//   autofocus      search box

import { useEffect, useMemo, useRef, useState } from "react";
import {
  SYMBOLS,
  SYMBOL_CATEGORIES,
  SYMBOL_COUNT,
  getRecentSymbols,
  recordSymbolInsert,
  searchSymbols,
  symbolsInCategory,
  type SymbolCategory,
} from "../lib/symbols";

// The category tabs: "All" plus the six bundled categories, in popover order.
type CategoryFilter = "all" | SymbolCategory;

export interface SymbolDialogProps {
  // Insert the picked character at the caret. The app shell runs the
  // insertion; the popover stays open.
  onInsert: (char: string) => void;
  // Close (Esc, the Close button, or the backdrop).
  onClose: () => void;
}

export default function SymbolDialog({ onInsert, onClose }: SymbolDialogProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [recent, setRecent] = useState<readonly string[]>(() => getRecentSymbols());
  const searchRef = useRef<HTMLInputElement>(null);

  // Autofocus the search box so typing filters immediately.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // The grid contents: name search wins over the category tab (searching
  // cuts across all categories, like Word's symbol search).
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q !== "") return searchSymbols(q);
    if (category === "all") return SYMBOLS;
    return symbolsInCategory(category);
  }, [query, category]);

  // The recents row shows while no search is running (it is name-free).
  const showRecent = query.trim() === "" && recent.length > 0;

  const pick = (char: string) => {
    recordSymbolInsert(char);
    setRecent(getRecentSymbols());
    onInsert(char);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="quillmd-symbol-overlay"
      onMouseDown={(e) => {
        // A backdrop press closes; the dialog itself keeps the event.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="quillmd-symbol-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Special Characters"
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="quillmd-symbol-title">
          Special Characters <span className="quillmd-symbol-count">{SYMBOL_COUNT}</span>
        </div>

        <input
          ref={searchRef}
          type="search"
          className="quillmd-symbol-search"
          placeholder="Search by name (e.g. copyright)"
          aria-label="Search symbols by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="quillmd-symbol-tabs" role="tablist" aria-label="Symbol categories">
          <button
            type="button"
            role="tab"
            aria-selected={category === "all" && query.trim() === ""}
            className="quillmd-symbol-tab"
            onClick={() => setCategory("all")}
          >
            All
          </button>
          {SYMBOL_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={category === c.id && query.trim() === ""}
              className="quillmd-symbol-tab"
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {showRecent && (
          <div className="quillmd-symbol-recents">
            <span className="quillmd-symbol-recent-label">Recent</span>
            {recent.map((char) => (
              <button
                key={`recent-${char}`}
                type="button"
                className="quillmd-symbol-cell"
                aria-label={char}
                title={char}
                onClick={() => pick(char)}
              >
                {char}
              </button>
            ))}
          </div>
        )}

        <div className="quillmd-symbol-grid" role="listbox" aria-label="Symbols">
          {entries.map((entry) => (
            <button
              key={entry.char}
              type="button"
              role="option"
              aria-selected={false}
              aria-label={entry.name}
              className="quillmd-symbol-cell"
              title={entry.name}
              onClick={() => pick(entry.char)}
            >
              {entry.char}
            </button>
          ))}
          {entries.length === 0 && (
            <div className="quillmd-symbol-empty">No symbols match “{query.trim()}”</div>
          )}
        </div>

        <div className="quillmd-symbol-actions">
          <button type="button" className="quillmd-symbol-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
