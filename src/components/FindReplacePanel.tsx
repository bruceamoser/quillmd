// Find & replace panel (plan 07 task 7.2, issue #70): the floating bar under
// the toolbar. Fully controlled — App.tsx owns the state object
// ({ open, mode, term, ... }), runs the search engine (task 7.1) against the
// active doc, and reports the outcome back through `result`. This component
// renders the UI, the result counter, and the error states, and implements
// the keyboard model:
//   Esc            close
//   F3 / Enter     next match (wrapping)
//   Shift+F3 /
//   Shift+Enter    previous match (wrapping)
//   ArrowDown      next match (while an input has focus)
//   ArrowUp        previous match (while an input has focus)
//
// Error states (plan 07 §1/§3):
//   * invalid regex  -> the error message shows under the bar, the term input
//     turns red, the search is suppressed (count 0, no navigation),
//   * no results     -> the term input turns red and the counter reads
//     "No results",
//   * cross-block active match -> the Replace button is disabled with a
//     tooltip (replace only applies within a single text block).

import { useEffect, useRef } from "react";

export type FindPanelMode = "find" | "replace";

export type FindPanelOption = "matchCase" | "wholeWord" | "useRegex";

// Summary of the search result the panel renders. `error` is the engine's
// message for an invalid regex term; `active` is the 0-based index of the
// active match (-1 when there are none); `activeCrossBlock` marks the active
// match as spanning top-level blocks.
export interface FindPanelResult {
  count: number;
  active: number;
  error: string | null;
  activeCrossBlock: boolean;
}

export interface FindReplacePanelProps {
  mode: FindPanelMode;
  term: string;
  replaceTerm: string;
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  result: FindPanelResult;
  onTermChange: (term: string) => void;
  onReplaceTermChange: (term: string) => void;
  onToggle: (option: FindPanelOption) => void;
  onModeChange: (mode: FindPanelMode) => void;
  onNext: () => void;
  onPrev: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

const CROSS_BLOCK_TOOLTIP =
  "Match spans multiple blocks; replace only applies within a single block";

export default function FindReplacePanel({
  mode,
  term,
  replaceTerm,
  matchCase,
  wholeWord,
  useRegex,
  result,
  onTermChange,
  onReplaceTermChange,
  onToggle,
  onModeChange,
  onNext,
  onPrev,
  onReplace,
  onReplaceAll,
  onClose,
}: FindReplacePanelProps) {
  const termRef = useRef<HTMLInputElement>(null);

  // Word behavior: opening the panel focuses the term input with the whole
  // term selected so typing replaces it.
  useEffect(() => {
    const el = termRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const hasError = result.error !== null;
  const noResults = !hasError && term.length > 0 && result.count === 0;
  const canNavigate = !hasError && result.count > 0;
  const canReplace = canNavigate && !result.activeCrossBlock;
  const canReplaceAll = !hasError && result.count > 0;

  const counterText = hasError
    ? "Invalid regex"
    : term.length === 0
      ? ""
      : result.count === 0
        ? "No results"
        : `${result.active + 1} of ${result.count}`;

  const inputErrorClass = hasError || noResults;

  // Keyboard model (plan 07 task 7.2). The handler sits on the panel root so
  // it applies while either input has focus; Tab keeps the browser default so
  // focus can move between the inputs and out of the panel. stopPropagation
  // keeps the window-level F3/Esc handlers (App.tsx) from firing a second
  // time for the same key stroke.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
      case "F3":
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) onPrev();
        else onNext();
        break;
      case "Enter":
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) onPrev();
        else onNext();
        break;
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        onNext();
        break;
      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        onPrev();
        break;
      default:
        break;
    }
  };

  // Buttons keep the focus on the inputs (mousedown would blur the term
  // input and break the F3 flow), so they swallow mousedown only.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  const toggleProps = (
    option: FindPanelOption,
    active: boolean,
    label: string,
    text: string,
  ) => (
    <button
      type="button"
      className={`quillmd-find-toggle${active ? " active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={keepFocus}
      onClick={() => onToggle(option)}
    >
      {text}
    </button>
  );

  return (
    <div className="quillmd-find-panel" role="search" onKeyDown={handleKeyDown}>
      <div className="quillmd-find-row">
        <input
          ref={termRef}
          type="text"
          className={`quillmd-find-input${inputErrorClass ? " error" : ""}`}
          placeholder="Find"
          aria-label="Find"
          value={term}
          onChange={(e) => onTermChange(e.target.value)}
        />
        <span
          className={`quillmd-find-counter${inputErrorClass ? " error" : ""}`}
          aria-live="polite"
        >
          {counterText}
        </span>
        <button
          type="button"
          className="quillmd-find-nav"
          title="Find previous (Shift+F3)"
          aria-label="Previous match"
          disabled={!canNavigate}
          onMouseDown={keepFocus}
          onClick={onPrev}
        >
          &#8593;
        </button>
        <button
          type="button"
          className="quillmd-find-nav"
          title="Find next (F3)"
          aria-label="Next match"
          disabled={!canNavigate}
          onMouseDown={keepFocus}
          onClick={onNext}
        >
          &#8595;
        </button>
        {toggleProps("matchCase", matchCase, "Match case", "Aa")}
        {toggleProps("wholeWord", wholeWord, "Whole word", "W")}
        {toggleProps("useRegex", useRegex, "Regular expression", ".*")}
        <button
          type="button"
          className="quillmd-find-mode"
          title={mode === "find" ? "Show replace (Ctrl+H)" : "Hide replace (Ctrl+H)"}
          aria-label="Toggle replace row"
          aria-expanded={mode === "replace"}
          onMouseDown={keepFocus}
          onClick={() => onModeChange(mode === "find" ? "replace" : "find")}
        >
          {mode === "find" ? "Replace \u25BE" : "Hide \u25B4"}
        </button>
        <button
          type="button"
          className="quillmd-find-close"
          title="Close (Esc)"
          aria-label="Close find panel"
          onMouseDown={keepFocus}
          onClick={onClose}
        >
          &times;
        </button>
      </div>
      {hasError && <div className="quillmd-find-error">{result.error}</div>}
      {mode === "replace" && (
        <div className="quillmd-find-row quillmd-find-replace-row">
          <input
            type="text"
            className="quillmd-find-input"
            placeholder="Replace with"
            aria-label="Replace with"
            value={replaceTerm}
            onChange={(e) => onReplaceTermChange(e.target.value)}
          />
          <button
            type="button"
            className="quillmd-find-action"
            title={
              canReplace
                ? "Replace the active match"
                : result.activeCrossBlock
                  ? CROSS_BLOCK_TOOLTIP
                  : "No match to replace"
            }
            disabled={!canReplace}
            onMouseDown={keepFocus}
            onClick={onReplace}
          >
            Replace
          </button>
          <button
            type="button"
            className="quillmd-find-action"
            title={
              canReplaceAll ? "Replace every match (one undo step)" : "No match to replace"
            }
            disabled={!canReplaceAll}
            onMouseDown={keepFocus}
            onClick={onReplaceAll}
          >
            Replace All
          </button>
        </div>
      )}
    </div>
  );
}
