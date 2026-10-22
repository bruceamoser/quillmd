// @vitest-environment jsdom
// The updater's state machine (src/lib/updates.ts): the startup check only
// opens the dialog for an available update, Help > Check for Updates… always
// reports, and the install/restart callbacks move the dialog through its
// states. IPC is mocked; the Rust side is covered by update.rs's tests.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { useUpdater, type UpdateCheck, type UpdateOutcome, type Updater } from "../updates";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../fileIo", () => ({ runningInTauri: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const AVAILABLE: UpdateCheck = {
  current: "0.2.5",
  latest: "0.2.6",
  available: true,
  notes: "notes",
  release_url: "https://github.com/bruceamoser/quillmd/releases/tag/v0.2.6",
  asset_name: "quillmd_0.2.6_amd64.AppImage",
  asset_size: 1000,
  method: "appimage",
  checksum_available: true,
};

const CURRENT: UpdateCheck = { ...AVAILABLE, latest: "0.2.5", available: false };

const OUTCOME: UpdateOutcome = {
  version: "0.2.6",
  method: "appimage",
  path: "/tmp/quillmd_0.2.6_amd64.AppImage",
  restart_required: true,
};

// Renders the hook and hands the latest value to the test.
function Probe({ onValue }: { onValue: (updater: Updater) => void }) {
  const updater = useUpdater();
  onValue(updater);
  return null;
}

describe("useUpdater", () => {
  let root: Root | null = null;
  let latest: Updater;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <Probe
          onValue={(value) => {
            latest = value;
          }}
        />,
      );
    });
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("opens the dialog when the startup check finds an update", async () => {
    vi.mocked(invoke).mockResolvedValue(AVAILABLE);
    await act(async () => {
      latest.checkQuietly();
    });
    expect(invoke).toHaveBeenCalledWith("update_check");
    expect(latest.status).toBe("available");
    expect(latest.open).toBe(true);
    expect(latest.check?.latest).toBe("0.2.6");
  });

  it("stays silent when the startup check finds nothing newer", async () => {
    vi.mocked(invoke).mockResolvedValue(CURRENT);
    await act(async () => {
      latest.checkQuietly();
    });
    expect(latest.status).toBe("current");
    expect(latest.open).toBe(false);
  });

  it("always reports an explicit Help > Check for Updates…", async () => {
    vi.mocked(invoke).mockResolvedValue(CURRENT);
    await act(async () => {
      latest.openAndCheck();
    });
    expect(latest.open).toBe(true);
    expect(latest.status).toBe("current");
  });

  it("surfaces a failed check without opening on its own", async () => {
    vi.mocked(invoke).mockRejectedValue("could not reach GitHub: offline");
    await act(async () => {
      latest.checkQuietly();
    });
    expect(latest.status).toBe("error");
    expect(latest.error).toContain("offline");
    expect(latest.open).toBe(false);
  });

  it("surfaces check failures in the dialog when the user asked for one", async () => {
    vi.mocked(invoke).mockRejectedValue("could not reach GitHub: offline");
    await act(async () => {
      latest.openAndCheck();
    });
    expect(latest.open).toBe(true);
    expect(latest.status).toBe("error");
  });

  it("installs after the user confirms and reports the outcome", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "update_check") return AVAILABLE;
      if (command === "update_install") return OUTCOME;
      throw new Error(`unexpected command ${command}`);
    });
    await act(async () => {
      latest.openAndCheck();
    });
    expect(latest.status).toBe("available");
    await act(async () => {
      latest.install();
    });
    expect(invoke).toHaveBeenCalledWith("update_install");
    expect(latest.status).toBe("installed");
    expect(latest.outcome?.version).toBe("0.2.6");
    expect(latest.outcome?.restart_required).toBe(true);
  });

  it("reports a failed install and retries it", async () => {
    vi.mocked(invoke).mockResolvedValue(AVAILABLE);
    await act(async () => {
      latest.openAndCheck();
    });
    vi.mocked(invoke).mockRejectedValue("The downloaded update failed its checksum check");
    await act(async () => {
      latest.install();
    });
    expect(latest.status).toBe("error");
    expect(latest.error).toContain("checksum");
    expect(latest.check?.available).toBe(true);
  });

  it("closes back to the initial state", async () => {
    vi.mocked(invoke).mockResolvedValue(AVAILABLE);
    await act(async () => {
      latest.checkQuietly();
    });
    expect(latest.open).toBe(true);
    act(() => latest.close());
    expect(latest.open).toBe(false);
    expect(latest.status).toBe("idle");
    expect(latest.check).toBeNull();
    expect(latest.progress).toBeNull();
  });
});
