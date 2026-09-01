// About QuillMD dialog (plan 10 task 10.4, issue #96): Help > About QuillMD.
// Shows the real app version + build hash (Rust get_app_info), the bundled
// pandoc/typst sidecar versions (Rust get_sidecar_versions), and the GitHub +
// docs links (system browser via openLinkUrl). "Check for updates" is
// intentionally disabled — v2 has no auto-update; releases are manual on
// GitHub (plan 10 §2.5).
//
// Keyboard model (plan 08 §3 convention):
//   Enter          close (the focused Close button)
//   Esc            close
//   autofocus      Close button

import { useEffect, useRef } from "react";
import { openLinkUrl } from "../lib/links";

// The project URLs the links row opens (GitHub repo; the README is the docs).
export const GITHUB_URL = "https://github.com/bruceamoser/quillmd";

// The sidecar versions the dialog shows (Rust get_sidecar_versions): the
// first line of `pandoc --version` / `typst --version`; null = not installed.
export interface SidecarVersions {
  pandoc: string | null;
  typst: string | null;
}

export interface AboutDialogProps {
  // The app version (CARGO_PKG_VERSION); null while loading / browser dev.
  version: string | null;
  // The build hash (git SHA at build time) or "unknown"; null while loading.
  buildHash: string | null;
  // The sidecar versions; null while loading / browser dev.
  sidecars: SidecarVersions | null;
  // Close (Enter, Esc, Close button, or the backdrop).
  onClose: () => void;
}

export default function AboutDialog({
  version,
  buildHash,
  sidecars,
  onClose,
}: AboutDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Autofocus the Close button on open so Enter/Space dismiss the dialog.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const rows: Array<[string, string]> = [
    ["Version", version ?? "…"],
    ["Build", buildHash ?? "…"],
    ["Pandoc", sidecars ? sidecars.pandoc ?? "not found" : "…"],
    ["Typst", sidecars ? sidecars.typst ?? "not found" : "…"],
  ];

  const open =
    (url: string) =>
    (e: React.MouseEvent) => {
      e.preventDefault();
      void openLinkUrl(url);
    };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="quillmd-about-overlay"
      onMouseDown={(e) => {
        // A backdrop press closes; the dialog itself keeps the event.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="quillmd-about-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="About QuillMD"
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="quillmd-about-title">About QuillMD</div>
        <div className="quillmd-about-scope">
          A WYSIWYG markdown editor that persists natively in markdown.
        </div>

        <dl className="quillmd-about-rows">
          {rows.map(([label, value]) => (
            <div key={label} className="quillmd-about-row">
              <dt className="quillmd-about-label">{label}</dt>
              <dd className="quillmd-about-value">{value}</dd>
            </div>
          ))}
          <div className="quillmd-about-row">
            <dt className="quillmd-about-label">GitHub</dt>
            <dd className="quillmd-about-value">
              <a href={GITHUB_URL} onClick={open(GITHUB_URL)}>
                {GITHUB_URL}
              </a>
            </dd>
          </div>
          <div className="quillmd-about-row">
            <dt className="quillmd-about-label">Docs</dt>
            <dd className="quillmd-about-value">
              <a href={GITHUB_URL} onClick={open(GITHUB_URL)}>
                {GITHUB_URL}
              </a>
            </dd>
          </div>
        </dl>

        <div className="quillmd-about-actions">
          <button
            type="button"
            className="quillmd-about-button"
            disabled
            title="Manual releases on GitHub"
          >
            Check for Updates
          </button>
          <button
            ref={closeRef}
            type="button"
            className="quillmd-about-button primary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
