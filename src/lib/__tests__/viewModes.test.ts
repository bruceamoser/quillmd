// @vitest-environment jsdom
// Per-file view-mode memory (spec §2.2.1) and the app-level fallback
// (plan 10 task 10.2, issue #94): the "default view mode" setting seeds the
// mode for paths with no remembered one; a remembered mode always wins.
import { afterEach, describe, expect, it } from "vitest";
import { loadViewMode, saveViewMode } from "../../components/viewModes";

const KEY = "quillmd.viewMode";

describe("viewModes (plan 10 task 10.2, issue #94)", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("remembers the last-used mode per path", () => {
    saveViewMode("/a.md", "source");
    expect(loadViewMode("/a.md")).toBe("source");
    // A path without a remembered mode falls back to the hardcoded default.
    expect(loadViewMode("/b.md")).toBe("wysiwyg");
  });

  it("falls back to the app default when the setting provides one", () => {
    saveViewMode("/a.md", "split");
    expect(loadViewMode("/a.md", "preview")).toBe("split");
    expect(loadViewMode("/b.md", "preview")).toBe("preview");
  });

  it("recovers a corrupted or invalid map onto the fallback", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadViewMode("/a.md", "source")).toBe("source");
    localStorage.setItem(KEY, JSON.stringify({ "/a.md": "zen" }));
    expect(loadViewMode("/a.md", "source")).toBe("source");
  });
});
