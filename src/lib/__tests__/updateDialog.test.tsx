// @vitest-environment jsdom
// The update dialog's states (Help > Check for Updates…): offer, progress,
// install outcome, and the error paths. The dialog is presentation only —
// every button is asserted to call the updater callback, and no network/IPC
// is touched here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import UpdateDialog from "../../components/UpdateDialog";
import type { UpdateCheck, UpdateOutcome, UpdateProgress, UpdaterStatus } from "../updates";

vi.mock("../links", () => ({ openLinkUrl: vi.fn(async () => {}) }));

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CHECK: UpdateCheck = {
  current: "0.2.5",
  latest: "0.2.6",
  available: true,
  notes: "- Fixed the Explorer\n- Added update checks",
  release_url: "https://github.com/bruceamoser/quillmd/releases/tag/v0.2.6",
  asset_name: "quillmd_0.2.6_amd64.AppImage",
  asset_size: 134_217_728,
  method: "appimage",
  checksum_available: true,
};

interface Harness {
  container: HTMLDivElement;
  onInstall: ReturnType<typeof vi.fn>;
  onRestart: ReturnType<typeof vi.fn>;
  onRetry: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
  button: (text: string) => HTMLButtonElement;
  text: () => string;
}

let roots: Root[] = [];

function renderDialog(props: {
  status: UpdaterStatus;
  check?: UpdateCheck | null;
  error?: string | null;
  progress?: UpdateProgress | null;
  outcome?: UpdateOutcome | null;
}): Harness {
  const onInstall = vi.fn();
  const onRestart = vi.fn();
  const onRetry = vi.fn();
  const onClose = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      <UpdateDialog
        status={props.status}
        check={props.check ?? null}
        error={props.error ?? null}
        progress={props.progress ?? null}
        outcome={props.outcome ?? null}
        onInstall={onInstall}
        onRestart={onRestart}
        onRetry={onRetry}
        onClose={onClose}
      />,
    );
  });
  return {
    container,
    onInstall,
    onRestart,
    onRetry,
    onClose,
    button: (text) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent === text,
      )!,
    text: () => container.textContent ?? "",
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  roots = [];
});

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots = [];
  vi.restoreAllMocks();
});

describe("UpdateDialog", () => {
  it("offers the release: version, package, size, notes, and the install action", () => {
    const h = renderDialog({ status: "available", check: CHECK });
    expect(h.container.querySelector(".quillmd-about-title")!.textContent).toBe("QuillMD 0.2.6");
    expect(h.text()).toContain("You have v0.2.5; v0.2.6 is available.");
    expect(h.text()).toContain("quillmd_0.2.6_amd64.AppImage (128 MB)");
    expect(h.text()).toContain("replace this AppImage");
    expect(h.container.querySelector(".quillmd-update-notes")!.textContent).toContain(
      "Fixed the Explorer",
    );
    act(() => h.button("Download & Install").click());
    expect(h.onInstall).toHaveBeenCalledTimes(1);
  });

  it("disables the install action when the release has no package", () => {
    const h = renderDialog({
      status: "available",
      check: { ...CHECK, method: "none", asset_name: null, asset_size: 0 },
    });
    expect(h.button("Download & Install").disabled).toBe(true);
  });

  it("reports a check in progress", () => {
    const h = renderDialog({ status: "checking" });
    expect(h.text()).toContain("Checking GitHub for a newer release…");
    act(() => h.button("Cancel").click());
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("reports that this build is current", () => {
    const h = renderDialog({
      status: "current",
      check: { ...CHECK, latest: "0.2.5", available: false },
    });
    expect(h.text()).toContain("You are on the newest release (v0.2.5).");
  });

  it("shows download progress with the phase label and a progressbar", () => {
    const h = renderDialog({
      status: "installing",
      check: CHECK,
      progress: { phase: "download", downloaded: 64 * 1024 * 1024, total: 128 * 1024 * 1024 },
    });
    expect(h.text()).toContain("Downloading the update…");
    expect(h.text()).toContain("50% · 64 MB of 128 MB");
    const bar = h.container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    // Closing the dialog does not cancel the install.
    act(() => h.button("Close").click());
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("asks for the restart once an AppImage update is applied", () => {
    const h = renderDialog({
      status: "installed",
      check: CHECK,
      outcome: {
        version: "0.2.6",
        method: "appimage",
        path: "/home/me/apps/quillmd.AppImage",
        restart_required: true,
      },
    });
    expect(h.text()).toContain("QuillMD 0.2.6 is installed and ready. Restart to finish.");
    expect(h.text()).toContain("/home/me/apps/quillmd.AppImage");
    act(() => h.button("Restart Now").click());
    expect(h.onRestart).toHaveBeenCalledTimes(1);
  });

  it("tells the user to finish a package-manager install and offers no restart", () => {
    const h = renderDialog({
      status: "installed",
      check: CHECK,
      outcome: {
        version: "0.2.6",
        method: "deb",
        path: "/tmp/quillmd_0.2.6_amd64.deb",
        restart_required: false,
      },
    });
    expect(h.text()).toContain("your package installer was opened");
    expect(h.container.textContent).not.toContain("Restart Now");
    act(() => h.button("Close").click());
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a check error and retries", () => {
    const h = renderDialog({ status: "error", error: "could not reach GitHub: offline" });
    expect(h.text()).toContain("Could not check for updates.");
    expect(h.text()).toContain("could not reach GitHub: offline");
    act(() => h.button("Try Again").click());
    expect(h.onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows a failed install on top of the offer and retries the install", () => {
    const h = renderDialog({ status: "error", check: CHECK, error: "checksum mismatch" });
    expect(h.text()).toContain("checksum mismatch");
    act(() => h.button("Try Again").click());
    expect(h.onInstall).toHaveBeenCalledTimes(1);
  });

  it("closes on Esc", () => {
    const h = renderDialog({ status: "available", check: CHECK });
    act(() => {
      h.container
        .querySelector(".quillmd-update-dialog")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });
});
