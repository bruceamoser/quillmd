// GitHub release updates — the frontend half of src-tauri/src/update.rs.
//
// The Rust side owns everything that touches the network or the filesystem:
// `update_check` compares the newest GitHub release with this build,
// `update_install` downloads + checksum-verifies + applies the package, and
// `update_restart` relaunches into the new build. This module wraps those
// commands, owns the dialog's state machine (check → offer → download →
// installed), and keeps the formatting helpers pure for the unit tests.
//
// Nothing here installs anything on its own: the startup check only offers an
// available update, and `install` runs after the user presses the button.

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { runningInTauri } from "./fileIo";

// How the update package is applied (mirrors the Rust InstallMethod).
export type InstallMethod = "appimage" | "nsis" | "msi" | "deb" | "rpm" | "none";

export type UpdatePhase = "download" | "verify" | "install";

// The result of `update_check`: the newest published release vs. this build.
export interface UpdateCheck {
  current: string;
  latest: string;
  available: boolean;
  notes: string;
  release_url: string;
  asset_name: string | null;
  asset_size: number;
  method: InstallMethod;
  checksum_available: boolean;
}

// One progress event from `update_install` (Tauri event "update-progress").
export interface UpdateProgress {
  phase: UpdatePhase;
  downloaded: number;
  total: number;
}

// The result of `update_install`.
export interface UpdateOutcome {
  version: string;
  method: InstallMethod;
  path: string;
  restart_required: boolean;
}

// The dialog's state machine. "current" means the check ran and this build is
// the newest one; "available" is the offer; "installing" covers the download
// and checksum; "installed" is the post-install restart prompt.
export type UpdaterStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "installing"
  | "installed"
  | "error";

// --- command wrappers -------------------------------------------------------

export function checkForUpdate(): Promise<UpdateCheck> {
  return invoke<UpdateCheck>("update_check");
}

export function installUpdate(): Promise<UpdateOutcome> {
  return invoke<UpdateOutcome>("update_install");
}

// Spawns the new build and exits; the promise may never settle (the process
// exits first), so callers fire-and-forget.
export function restartForUpdate(): Promise<void> {
  return invoke<void>("update_restart");
}

// Subscribes to download/verify/install progress. Returns an unsubscribe.
export async function watchUpdateProgress(
  onProgress: (progress: UpdateProgress) => void,
): Promise<UnlistenFn> {
  return listen<UpdateProgress>("update-progress", (event) => onProgress(event.payload));
}

// --- formatting (pure, unit-tested) ----------------------------------------

// "1.4 MB", "128 MB", "0 B".
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

// What the install button will actually do on this platform.
export function describeInstallMethod(method: InstallMethod): string {
  switch (method) {
    case "appimage":
      return "Download and replace this AppImage, then restart.";
    case "nsis":
      return "Download and run the Windows installer, then restart.";
    case "msi":
      return "Download and run the Windows installer, then restart.";
    case "deb":
      return "Download the .deb and open your package installer.";
    case "rpm":
      return "Download the .rpm and open your package installer.";
    case "none":
      return "No package is published for this platform.";
  }
}

// 0–100, clamped; used by the progress bar.
export function progressPercent(progress: UpdateProgress): number {
  if (progress.phase === "download") {
    if (progress.total <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((progress.downloaded / progress.total) * 100)));
  }
  if (progress.phase === "verify") return 100;
  return 100;
}

// The status line under the progress bar.
export function progressLabel(progress: UpdateProgress): string {
  switch (progress.phase) {
    case "download":
      return "Downloading the update…";
    case "verify":
      return "Verifying the checksum…";
    case "install":
      return "Applying the update…";
  }
}

// --- the dialog state machine ----------------------------------------------

interface UpdaterState {
  open: boolean;
  status: UpdaterStatus;
  check: UpdateCheck | null;
  error: string | null;
  progress: UpdateProgress | null;
  outcome: UpdateOutcome | null;
}

const INITIAL_STATE: UpdaterState = {
  open: false,
  status: "idle",
  check: null,
  error: null,
  progress: null,
  outcome: null,
};

export interface Updater extends UpdaterState {
  // Help > Check for Updates… / About > Check for Updates: open and check,
  // showing the result even when this build is current.
  openAndCheck: () => void;
  // The startup check: only opens the dialog when an update is available.
  checkQuietly: () => void;
  // Download + verify + apply (user-initiated only).
  install: () => void;
  // Relaunch into the new build / run the queued installer.
  restart: () => void;
  // Re-run the check after an error.
  retry: () => void;
  close: () => void;
}

// Owns the update dialog's state. Mounted once in App, so a check in flight
// survives re-renders; every network call stays in Rust.
export function useUpdater(): Updater {
  const [state, setState] = useState<UpdaterState>(INITIAL_STATE);

  const runCheck = useCallback(async (alwaysOpen: boolean) => {
    if (!runningInTauri()) {
      if (alwaysOpen) {
        setState({
          ...INITIAL_STATE,
          open: true,
          status: "error",
          error: "Updates are available in the desktop app only.",
        });
      }
      return;
    }
    setState((prev) => ({
      ...prev,
      open: prev.open || alwaysOpen,
      status: "checking",
      error: null,
      outcome: null,
    }));
    try {
      const check = await checkForUpdate();
      setState((prev) => ({
        ...prev,
        // The startup check only opens the dialog for an update; an explicit
        // check always reports its result (including "up to date").
        open: prev.open || alwaysOpen || check.available,
        status: check.available ? "available" : "current",
        check,
        error: null,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        open: prev.open || alwaysOpen,
        status: "error",
        error: String(err),
      }));
    }
  }, []);

  const openAndCheck = useCallback(() => {
    void runCheck(true);
  }, [runCheck]);

  const checkQuietly = useCallback(() => {
    void runCheck(false);
  }, [runCheck]);

  // Progress events only matter while the install runs.
  useEffect(() => {
    if (state.status !== "installing" || !runningInTauri()) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    void watchUpdateProgress((progress) => {
      if (!cancelled) setState((prev) => ({ ...prev, progress }));
    })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // Progress is cosmetic; a missing listener never blocks the install.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [state.status]);

  const install = useCallback(() => {
    setState((prev) => ({
      ...prev,
      status: "installing",
      error: null,
      progress: null,
    }));
    void (async () => {
      try {
        const outcome = await installUpdate();
        setState((prev) => ({
          ...prev,
          status: "installed",
          outcome,
          progress: null,
        }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          status: "error",
          error: String(err),
          progress: null,
        }));
      }
    })();
  }, []);

  const restart = useCallback(() => {
    void restartForUpdate().catch((err) => {
      // The process exits on success; a rejection means it did not spawn, so
      // keep the installed view and show why the restart failed.
      setState((prev) => ({ ...prev, error: String(err) }));
    });
  }, []);

  const retry = useCallback(() => {
    void runCheck(true);
  }, [runCheck]);

  const close = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return { ...state, openAndCheck, checkQuietly, install, restart, retry, close };
}
