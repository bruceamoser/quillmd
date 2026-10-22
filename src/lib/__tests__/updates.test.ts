// Update dialog formatting helpers (src/lib/updates.ts). The command wrappers
// and the state machine are exercised through the dialog component test and
// the Rust unit tests; the pure helpers are pinned here.
import { describe, expect, it } from "vitest";
import {
  describeInstallMethod,
  formatBytes,
  progressLabel,
  progressPercent,
  type UpdateProgress,
} from "../updates";

describe("formatBytes", () => {
  it("renders readable sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(134_217_728)).toBe("128 MB");
    expect(formatBytes(1_073_741_824)).toBe("1 GB");
  });

  it("treats invalid sizes as zero", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("describeInstallMethod", () => {
  it("spells out what the install button does per package", () => {
    expect(describeInstallMethod("appimage")).toContain("replace this AppImage");
    expect(describeInstallMethod("nsis")).toContain("Windows installer");
    expect(describeInstallMethod("msi")).toContain("Windows installer");
    expect(describeInstallMethod("deb")).toContain(".deb");
    expect(describeInstallMethod("rpm")).toContain(".rpm");
    expect(describeInstallMethod("none")).toContain("No package");
  });
});

describe("progress", () => {
  const progress = (patch: Partial<UpdateProgress>): UpdateProgress => ({
    phase: "download",
    downloaded: 0,
    total: 0,
    ...patch,
  });

  it("computes a clamped percentage for the download", () => {
    expect(progressPercent(progress({ downloaded: 25, total: 100 }))).toBe(25);
    expect(progressPercent(progress({ downloaded: 100, total: 100 }))).toBe(100);
    expect(progressPercent(progress({ downloaded: 300, total: 100 }))).toBe(100);
    expect(progressPercent(progress({ downloaded: 10, total: 0 }))).toBe(0);
  });

  it("shows verify/install as complete steps", () => {
    expect(progressPercent(progress({ phase: "verify" }))).toBe(100);
    expect(progressPercent(progress({ phase: "install" }))).toBe(100);
  });

  it("labels each phase", () => {
    expect(progressLabel(progress({ phase: "download" }))).toBe("Downloading the update…");
    expect(progressLabel(progress({ phase: "verify" }))).toBe("Verifying the checksum…");
    expect(progressLabel(progress({ phase: "install" }))).toBe("Applying the update…");
  });
});
