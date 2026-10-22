// Update dialog (Help > Check for Updates…, About > Check for Updates, and
// the startup check when a newer GitHub release exists).
//
// The dialog is presentation only: src/lib/updates.ts owns the state machine
// (check → offer → download → installed) and every network/filesystem step
// happens in Rust (src-tauri/src/update.rs). Nothing installs without the
// user pressing the primary button, and the restart step is separate so the
// outcome is visible before the app exits.
//
// Keyboard model (plan 08 §3 convention):
//   Esc            close (allowed while installing; the download continues)
//   Enter          activate the focused button
//   autofocus      the primary action of the current state

import { useEffect, useRef } from "react";
import { openLinkUrl } from "../lib/links";
import {
  describeInstallMethod,
  formatBytes,
  progressLabel,
  progressPercent,
  type UpdateCheck,
  type UpdateOutcome,
  type UpdateProgress,
  type UpdaterStatus,
} from "../lib/updates";

export interface UpdateDialogProps {
  status: UpdaterStatus;
  check: UpdateCheck | null;
  error: string | null;
  progress: UpdateProgress | null;
  outcome: UpdateOutcome | null;
  onInstall: () => void;
  onRestart: () => void;
  onRetry: () => void;
  onClose: () => void;
}

export default function UpdateDialog({
  status,
  check,
  error,
  progress,
  outcome,
  onInstall,
  onRestart,
  onRetry,
  onClose,
}: UpdateDialogProps) {
  const actionRef = useRef<HTMLButtonElement>(null);

  // Focus the primary action so Enter does the obvious thing.
  useEffect(() => {
    actionRef.current?.focus();
  }, [status, check?.latest, outcome?.version]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const openReleasePage = () => {
    const url = check?.release_url;
    if (url) void openLinkUrl(url);
  };

  const version = check?.latest ?? outcome?.version ?? "";
  const percent = progress ? progressPercent(progress) : 0;

  return (
    <div
      className="quillmd-about-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="quillmd-about-dialog quillmd-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quillmd-update-title"
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="quillmd-about-title" id="quillmd-update-title">
          {version ? `QuillMD ${version}` : "Software Update"}
        </div>

        {status === "checking" && (
          <>
            <div className="quillmd-about-scope">Checking GitHub for a newer release…</div>
            <div className="quillmd-about-actions">
              <button
                ref={actionRef}
                type="button"
                className="quillmd-about-button primary"
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {status === "current" && (
          <>
            <div className="quillmd-about-scope">
              You are on the newest release (v{check?.current ?? "?"}).
            </div>
            <div className="quillmd-about-actions">
              <button
                ref={actionRef}
                type="button"
                className="quillmd-about-button primary"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </>
        )}

        {(status === "available" || (status === "error" && check?.available)) && (
          <>
            <div className="quillmd-about-scope">
              You have v{check?.current}; v{check?.latest} is available.
            </div>
            <dl className="quillmd-about-rows">
              <div className="quillmd-about-row">
                <dt className="quillmd-about-label">Package</dt>
                <dd className="quillmd-about-value">
                  {check?.asset_name ?? "none for this platform"}
                  {check && check.asset_size > 0 ? ` (${formatBytes(check.asset_size)})` : ""}
                </dd>
              </div>
              <div className="quillmd-about-row">
                <dt className="quillmd-about-label">Install</dt>
                <dd className="quillmd-about-value">
                  {check ? describeInstallMethod(check.method) : ""}
                </dd>
              </div>
            </dl>
            <pre className="quillmd-update-notes">
              {check?.notes?.trim() ? check.notes : "No release notes were provided."}
            </pre>
            {status === "error" && (
              <div className="quillmd-update-error" role="alert">
                {error ?? "The update could not be installed."}
              </div>
            )}
            <div className="quillmd-about-actions">
              <button
                type="button"
                className="quillmd-about-button"
                onClick={openReleasePage}
              >
                Release Notes
              </button>
              <button type="button" className="quillmd-about-button" onClick={onClose}>
                Later
              </button>
              <button
                ref={actionRef}
                type="button"
                className="quillmd-about-button primary"
                disabled={!check || check.method === "none"}
                onClick={onInstall}
              >
                {status === "error" ? "Try Again" : "Download & Install"}
              </button>
            </div>
          </>
        )}

        {status === "installing" && (
          <>
            <div className="quillmd-about-scope">
              {progress ? progressLabel(progress) : "Starting the download…"}
            </div>
            <div
              className="quillmd-update-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div
                className="quillmd-update-progress-fill"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="quillmd-update-progress-label">
              {progress && progress.phase === "download" && progress.total > 0
                ? `${percent}% · ${formatBytes(progress.downloaded)} of ${formatBytes(progress.total)}`
                : `${percent}%`}
            </div>
            <div className="quillmd-update-hint">
              QuillMD checks the download against the release's SHA256SUMS before installing.
              Closing this window does not stop the update.
            </div>
            <div className="quillmd-about-actions">
              <button type="button" className="quillmd-about-button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}

        {status === "installed" && outcome && (
          <>
            <div className="quillmd-about-scope">
              {outcome.restart_required
                ? `QuillMD ${outcome.version} is installed and ready. Restart to finish.`
                : `QuillMD ${outcome.version} was downloaded and your package installer was opened. Finish the install there.`}
            </div>
            <div className="quillmd-update-hint">{outcome.path}</div>
            {error && (
              <div className="quillmd-update-error" role="alert">
                {error}
              </div>
            )}
            <div className="quillmd-about-actions">
              <button
                type="button"
                className="quillmd-about-button"
                onClick={onClose}
              >
                {outcome.restart_required ? "Later" : "Close"}
              </button>
              {outcome.restart_required && (
                <button
                  ref={actionRef}
                  type="button"
                  className="quillmd-about-button primary"
                  onClick={onRestart}
                >
                  Restart Now
                </button>
              )}
            </div>
          </>
        )}

        {status === "error" && !check?.available && (
          <>
            <div className="quillmd-about-scope">Could not check for updates.</div>
            <div className="quillmd-update-error" role="alert">
              {error ?? "Unknown error"}
            </div>
            <div className="quillmd-about-actions">
              <button type="button" className="quillmd-about-button" onClick={onClose}>
                Close
              </button>
              <button
                ref={actionRef}
                type="button"
                className="quillmd-about-button primary"
                onClick={onRetry}
              >
                Try Again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
