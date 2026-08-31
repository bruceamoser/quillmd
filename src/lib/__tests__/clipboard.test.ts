// @vitest-environment jsdom
// Clipboard reads for the Edit > Paste as Text menu item (plan 02 task 2.9,
// issue #36): the menu path reads the system clipboard, so the read must
// report null (never throw) where the Web Clipboard API is unavailable or
// denied — the caller then degrades to a status message instead of pasting
// a guessed payload.
import { afterEach, describe, expect, it } from "vitest";
import { readClipboardText } from "../clipboard";

function stubClipboard(impl: Partial<{ readText: () => Promise<string> }>): void {
  Object.defineProperty(navigator, "clipboard", {
    value: impl,
    configurable: true,
  });
}

afterEach(() => {
  // jsdom has no native clipboard; remove the stub so each test starts clean.
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
});

describe("readClipboardText (issue #36)", () => {
  it("resolves to the system clipboard contents", async () => {
    stubClipboard({ readText: async () => "hello world" });
    await expect(readClipboardText()).resolves.toBe("hello world");
  });

  it("resolves to an empty string for an empty clipboard", async () => {
    stubClipboard({ readText: async () => "" });
    await expect(readClipboardText()).resolves.toBe("");
  });

  it("reports null when the clipboard API is unavailable", async () => {
    // jsdom default: navigator.clipboard is undefined.
    await expect(readClipboardText()).resolves.toBeNull();
  });

  it("reports null when the read is denied or rejected", async () => {
    stubClipboard({ readText: async () => Promise.reject(new Error("denied")) });
    await expect(readClipboardText()).resolves.toBeNull();
  });
});
