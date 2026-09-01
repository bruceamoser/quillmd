// Image edit dialog (plan 08 task 8.4, issue #79): the in-app modal for
// editing the image under the caret. A native dialog cannot hold the URL +
// alt-text + width fields, so the dialog lives in the webview (plan 08 §3),
// the same shape as the link dialog from task 8.1. Fully controlled: App.tsx
// owns the open state, passes the prefill read from the editor, and applies
// the result through the images.ts operations.
//
// Keyboard model (plan 08 §3):
//   Enter          submit (Save)
//   Esc            cancel
//   autofocus      URL field, selected
//
// Validation (plan 08 §2.4/§2.5): the URL must be http/https or a relative
// path; the width must be a pixel number or a percent (empty = no width).
// Anything else shows the error and refuses to submit.

import { useEffect, useRef, useState } from "react";
import {
  validateImageUrl,
  validateImageWidth,
  type ImageEditPayload,
  type ImageEditPrefill,
} from "../lib/images";

export interface ImageEditDialogProps {
  // Opening values: the image under the caret when isEditing, otherwise the
  // empty values (the dialog then acts as an insert at the caret).
  prefill: ImageEditPrefill;
  // Which field gets the initial focus: the URL field by default (plan 08
  // §3), or the alt-text field when the dialog was opened from the image
  // menu's "Change alt text" item (plan 03 task 3.4, issue #42).
  focusField?: "url" | "alt";
  // Submits the dialog with the field values.
  onApply: (payload: ImageEditPayload) => void;
  // Cancel (Esc, Cancel button, or the backdrop).
  onClose: () => void;
}

export default function ImageEditDialog({
  prefill,
  focusField = "url",
  onApply,
  onClose,
}: ImageEditDialogProps) {
  const [src, setSrc] = useState(prefill.src);
  const [alt, setAlt] = useState(prefill.alt);
  const [width, setWidth] = useState(prefill.width);
  // Error reported by the last failed submit; live validation covers the
  // non-empty cases while typing.
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const altRef = useRef<HTMLInputElement>(null);

  // Plan 08 §3: autofocus the URL field on open, selected for replacement.
  // Plan 03 task 3.4 (issue #42): the alt-text item of the image menu opens
  // the same dialog with the alt field focused instead.
  useEffect(() => {
    const el = focusField === "alt" ? altRef.current : urlRef.current;
    if (el) {
      el.focus();
      if (el === urlRef.current) el.select();
    }
  }, []);

  const liveUrlError = src.length > 0 ? validateImageUrl(src) : null;
  const liveWidthError = width.length > 0 ? validateImageWidth(width) : null;
  const shownError = error ?? liveUrlError ?? liveWidthError;
  const canSubmit =
    validateImageUrl(src) === null && validateImageWidth(width) === null;

  const submit = () => {
    const urlError = validateImageUrl(src);
    if (urlError !== null) {
      setError(urlError);
      urlRef.current?.focus();
      return;
    }
    const widthError = validateImageWidth(width);
    if (widthError !== null) {
      setError(widthError);
      return;
    }
    // The title is carried through unedited: the dialog has no title field,
    // so an edit must never silently drop one (plan 08 §3 title
    // round-trip).
    onApply({ src: src.trim(), alt: alt.trim(), width: width.trim(), title: prefill.title });
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
        <div className="quillmd-image-title">
          {prefill.isEditing ? "Edit Image" : "Insert Image"}
        </div>

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
              className={`quillmd-image-input${liveUrlError ? " error" : ""}`}
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
              ref={altRef}
              className="quillmd-image-input"
              type="text"
              value={alt}
              placeholder="Optional"
              onChange={(e) => setAlt(e.target.value)}
            />
          </label>
          <label className="quillmd-image-field">
            <span className="quillmd-image-label">Width</span>
            <input
              className={`quillmd-image-input${liveWidthError ? " error" : ""}`}
              type="text"
              value={width}
              placeholder="Optional — pixels (320) or percent (50%)"
              onChange={(e) => {
                setWidth(e.target.value);
                if (error) setError(null);
              }}
              spellCheck={false}
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
                {prefill.isEditing ? "Save" : "Insert"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
