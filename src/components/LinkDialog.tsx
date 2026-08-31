// Link dialog (plan 08 task 8.1, issue #76): the in-app modal for inserting
// and editing links. A native dialog cannot hold the URL + display-text +
// tooltip fields, so the dialog lives in the webview (plan 08 §3). Fully
// controlled: App.tsx owns the open state, passes the prefill read from the
// editor, and applies the result through the links.ts operations.
//
// Keyboard model (plan 08 §3):
//   Enter          submit (Save)
//   Esc            cancel
//   autofocus      URL field, selected
//
// Validation (plan 08 §2.1): scheme check http/https/mailto/tel plus
// relative destinations; anything else (javascript:, data:, ...) shows the
// error and refuses to submit.

import { useEffect, useRef, useState } from "react";
import { validateLinkUrl } from "../lib/links";
import type { LinkPayload, LinkPrefill } from "../lib/links";

export interface LinkDialogProps {
  // Opening values: the link under the caret when isEditing, otherwise the
  // plain selection (its text prefills the display text).
  prefill: LinkPrefill;
  // Submits the dialog with the field values.
  onApply: (payload: LinkPayload) => void;
  // "Remove link": strips the link markup, keeps the text.
  onRemove: () => void;
  // "Open": launches the destination in the system browser.
  onOpen: (href: string) => void;
  // Cancel (Esc, Cancel button, or the backdrop).
  onClose: () => void;
}

export default function LinkDialog({
  prefill,
  onApply,
  onRemove,
  onOpen,
  onClose,
}: LinkDialogProps) {
  const [href, setHref] = useState(prefill.href);
  const [text, setText] = useState(prefill.text);
  const [title, setTitle] = useState(prefill.title);
  // Error reported by the last failed submit; live validation covers the
  // non-empty cases while typing.
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  // Plan 08 §3: autofocus the URL field on open, selected for replacement.
  useEffect(() => {
    const el = urlRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const liveError = href.length > 0 ? validateLinkUrl(href) : null;
  const shownError = error ?? liveError;
  const canSubmit = validateLinkUrl(href) === null;

  const submit = () => {
    const urlError = validateLinkUrl(href);
    if (urlError !== null) {
      setError(urlError);
      urlRef.current?.focus();
      return;
    }
    onApply({ href: href.trim(), title: title.trim(), text: text.trim() });
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
      className="quillmd-link-overlay"
      onMouseDown={(e) => {
        // A backdrop press cancels; the dialog itself keeps the event.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="quillmd-link-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Link"
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="quillmd-link-title">
          {prefill.isEditing ? "Edit Link" : "Insert Link"}
        </div>

        <form
          className="quillmd-link-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="quillmd-link-field">
            <span className="quillmd-link-label">URL</span>
            <input
              ref={urlRef}
              className={`quillmd-link-input${shownError ? " error" : ""}`}
              type="text"
              value={href}
              placeholder="https://example.com or page.md"
              onChange={(e) => {
                setHref(e.target.value);
                if (error) setError(null);
              }}
              spellCheck={false}
            />
          </label>
          <label className="quillmd-link-field">
            <span className="quillmd-link-label">Link text</span>
            <input
              className="quillmd-link-input"
              type="text"
              value={text}
              placeholder={href.trim() || "Display text"}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label className="quillmd-link-field">
            <span className="quillmd-link-label">Tooltip</span>
            <input
              className="quillmd-link-input"
              type="text"
              value={title}
              placeholder="Optional"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          {shownError && <div className="quillmd-link-error">{shownError}</div>}

          <div className="quillmd-link-actions">
            <div className="quillmd-link-actions-left">
              <button
                type="button"
                className="quillmd-link-button"
                disabled={href.trim().length === 0}
                onClick={() => onOpen(href.trim())}
              >
                Open
              </button>
              {prefill.isEditing && (
                <button
                  type="button"
                  className="quillmd-link-button danger"
                  onClick={onRemove}
                >
                  Remove link
                </button>
              )}
            </div>
            <div className="quillmd-link-actions-right">
              <button
                type="button"
                className="quillmd-link-button"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="quillmd-link-button primary"
                disabled={!canSubmit}
              >
                Save
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
