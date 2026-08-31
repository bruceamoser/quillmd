// Image dialog (plan 08 task 8.2, issue #77): the in-app modal for the
// "From URL" half of the Insert > Image submenu. A native dialog cannot hold
// the URL + alt-text fields, so the dialog lives in the webview (plan 08 §3),
// the same shape as the link dialog from task 8.1. Fully controlled: App.tsx
// owns the open state and applies the result through images.ts.
//
// Keyboard model (plan 08 §3):
//   Enter          submit (Insert)
//   Esc            cancel
//   autofocus      URL field, selected
//
// Validation (plan 08 §2.4): http/https or a relative path; anything else
// (javascript:, data:, ...) shows the error and refuses to submit. The
// "From file" half needs no dialog — the native picker carries both the path
// and the file type (App.tsx runs it and inserts the relativized src).

import { useEffect, useRef, useState } from "react";
import { validateImageUrl, type ImagePayload } from "../lib/images";

export interface ImageDialogProps {
  // Submits the dialog with the field values.
  onApply: (payload: ImagePayload) => void;
  // Cancel (Esc, Cancel button, or the backdrop).
  onClose: () => void;
}

export default function ImageDialog({ onApply, onClose }: ImageDialogProps) {
  const [src, setSrc] = useState("");
  const [alt, setAlt] = useState("");
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

  const liveError = src.length > 0 ? validateImageUrl(src) : null;
  const shownError = error ?? liveError;
  const canSubmit = validateImageUrl(src) === null;

  const submit = () => {
    const urlError = validateImageUrl(src);
    if (urlError !== null) {
      setError(urlError);
      urlRef.current?.focus();
      return;
    }
    onApply({ src: src.trim(), alt: alt.trim() });
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
      className="quillmd-image-overlay"
      onMouseDown={(e) => {
        // A backdrop press cancels; the dialog itself keeps the event.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="quillmd-image-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Image"
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="quillmd-image-title">Insert Image</div>

        <form
          className="quillmd-image-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="quillmd-image-field">
            <span className="quillmd-image-label">URL</span>
            <input
              ref={urlRef}
              className={`quillmd-image-input${shownError ? " error" : ""}`}
              type="text"
              value={src}
              placeholder="https://example.com/photo.png or images/photo.png"
              onChange={(e) => {
                setSrc(e.target.value);
                if (error) setError(null);
              }}
              spellCheck={false}
            />
          </label>
          <label className="quillmd-image-field">
            <span className="quillmd-image-label">Alt text</span>
            <input
              className="quillmd-image-input"
              type="text"
              value={alt}
              placeholder="Optional"
              onChange={(e) => setAlt(e.target.value)}
            />
          </label>

          {shownError && <div className="quillmd-image-error">{shownError}</div>}

          <div className="quillmd-image-actions">
            <div className="quillmd-image-actions-right">
              <button
                type="button"
                className="quillmd-image-button"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="quillmd-image-button primary"
                disabled={!canSubmit}
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
