// @vitest-environment jsdom
// Broken-image detection (plan 08 task 8.5, issue #80, AC6): collecting the
// image srcs from the WYSIWYG doc, resolving the local ones against the doc
// folder, seeding the re-link picker with the last folder, and finding the
// srcs whose local file is gone through one batched existence check.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { markdownToTiptap } from "../pm";
import {
  collectImageSrcs,
  findMissingImageSrcs,
  isLocalImageSrc,
  relinkFolderFor,
  resolveImageSrc,
} from "../missingImages";
import { ImageWithWidth } from "../../components/Editor";

let editors: Editor[] = [];

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

// The same image extension as the app editor (Editor.tsx): inline, so
// inserted images land in a paragraph and survive tiptapToMarkdown.
function makeEditor(markdown = "Hello world"): Editor {
  const editor = new Editor({
    extensions: [StarterKit, ImageWithWidth.configure({ inline: true })],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  return editor;
}

// The live doc of a rendered markdown string.
function doc(markdown: string): PmNode {
  return makeEditor(markdown).state.doc;
}

describe("isLocalImageSrc (plan 08 §3)", () => {
  it("treats relative and absolute paths as local", () => {
    expect(isLocalImageSrc("photo.png")).toBe(true);
    expect(isLocalImageSrc("assets/photo.png")).toBe(true);
    expect(isLocalImageSrc("../sibling/photo.png")).toBe(true);
    expect(isLocalImageSrc("/abs/photo.png")).toBe(true);
    expect(isLocalImageSrc("C:\\photos\\a.png")).toBe(true);
  });

  it("treats any scheme as non-local", () => {
    expect(isLocalImageSrc("http://example.com/a.png")).toBe(false);
    expect(isLocalImageSrc("https://example.com/a.png")).toBe(false);
    expect(isLocalImageSrc("data:image/png;base64,AAAA")).toBe(false);
    expect(isLocalImageSrc("file:///C:/photos/a.png")).toBe(false);
  });
});

describe("resolveImageSrc (plan 08 §3)", () => {
  it("joins relative srcs onto the doc folder", () => {
    expect(resolveImageSrc("/docs/notes.md", "assets/photo.png")).toBe(
      "/docs/assets/photo.png",
    );
    expect(resolveImageSrc("/docs/notes.md", "photo.png")).toBe("/docs/photo.png");
  });

  it("keeps the POSIX root for a root-level document", () => {
    expect(resolveImageSrc("/notes.md", "assets/a.png")).toBe("/assets/a.png");
  });

  it("uses forward slashes for Windows doc paths", () => {
    expect(resolveImageSrc("C:\\docs\\notes.md", "assets/a.png")).toBe(
      "C:/docs/assets/a.png",
    );
  });

  it("passes absolute srcs through unchanged", () => {
    expect(resolveImageSrc("/docs/notes.md", "/elsewhere/a.png")).toBe(
      "/elsewhere/a.png",
    );
    expect(resolveImageSrc("C:\\docs\\notes.md", "C:\\other\\a.png")).toBe(
      "C:\\other\\a.png",
    );
  });

  it("is null for schemes, empty srcs, and docs without a folder", () => {
    expect(resolveImageSrc("/docs/notes.md", "https://example.com/a.png")).toBeNull();
    expect(resolveImageSrc("/docs/notes.md", "")).toBeNull();
    expect(resolveImageSrc(":new:", "photo.png")).toBeNull();
    expect(resolveImageSrc("", "photo.png")).toBeNull();
  });
});

describe("collectImageSrcs (plan 08 §3)", () => {
  it("collects image srcs in document order, deduplicated", () => {
    const d = doc("First ![a](a.png) then ![b](b.png) and again ![a](a.png).\n");
    expect(collectImageSrcs(d)).toEqual(["a.png", "b.png"]);
  });

  it("is empty when the doc has no images", () => {
    expect(collectImageSrcs(doc("Just text.\n"))).toEqual([]);
  });

  it("skips empty srcs", () => {
    const d = doc("![a](a.png) and ![no src]( ).\n");
    expect(collectImageSrcs(d)).toEqual(["a.png"]);
  });

  it("collects srcs from the <img> HTML form too", () => {
    const d = doc('<img src="sized.png" width="320">\n');
    expect(collectImageSrcs(d)).toEqual(["sized.png"]);
  });
});

describe("relinkFolderFor (plan 08 §3 last folder)", () => {
  it("seeds the picker in the src's folder, not the doc folder", () => {
    expect(relinkFolderFor("/docs/notes.md", "assets/photo.png")).toBe("/docs/assets");
  });

  it("seeds the doc folder for a bare file name", () => {
    expect(relinkFolderFor("/docs/notes.md", "photo.png")).toBe("/docs");
  });

  it("uses the absolute src's folder when the src is absolute", () => {
    expect(relinkFolderFor("/docs/notes.md", "/elsewhere/deep/a.png")).toBe(
      "/elsewhere/deep",
    );
  });

  it("handles Windows paths", () => {
    expect(relinkFolderFor("C:\\docs\\notes.md", "assets\\photo.png")).toBe(
      "C:/docs/assets",
    );
  });

  it("is empty when the src cannot be resolved, or the folder when it sits at the root", () => {
    expect(relinkFolderFor("/docs/notes.md", "https://example.com/a.png")).toBe("");
    expect(relinkFolderFor(":new:", "photo.png")).toBe("");
    expect(relinkFolderFor("/docs/notes.md", "/photo.png")).toBe("/");
  });
});

describe("findMissingImageSrcs (plan 08 §3 batched check)", () => {
  it("returns the srcs whose file is gone, in one batched call", async () => {
    const d = doc("![a](a.png) ![b](b.png) ![c](assets/c.png)\n");
    const check = vi.fn(async (paths: string[]) =>
      paths.map((p) => p.endsWith("a.png") || p.endsWith("c.png")),
    );
    const missing = await findMissingImageSrcs(d, "/docs/notes.md", check);
    expect(missing).toEqual(new Set(["b.png"]));
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith(["/docs/a.png", "/docs/b.png", "/docs/assets/c.png"]);
  });

  it("never checks non-local srcs and returns empty for all-remote docs", async () => {
    const d = doc("![a](https://example.com/a.png) ![b](http://x/b.png)\n");
    const check = vi.fn(async () => []);
    await expect(findMissingImageSrcs(d, "/docs/notes.md", check)).resolves.toEqual(new Set());
    expect(check).not.toHaveBeenCalled();
  });

  it("does not call the checker for image-less docs", async () => {
    const check = vi.fn(async () => []);
    await expect(findMissingImageSrcs(doc("No images here.\n"), "/docs/notes.md", check)).resolves
      .toEqual(new Set());
    expect(check).not.toHaveBeenCalled();
  });

  it("does not call the checker for docs without a folder (no disk to check)", async () => {
    const d = doc("![a](photo.png)\n");
    const check = vi.fn(async () => []);
    await expect(findMissingImageSrcs(d, ":new:", check)).resolves.toEqual(new Set());
    expect(check).not.toHaveBeenCalled();
  });

  it("flags every local src when every file is gone", async () => {
    const d = doc("![a](a.png) ![b](b.png)\n");
    const missing = await findMissingImageSrcs(d, "/docs/notes.md", async () => [false, false]);
    expect(missing).toEqual(new Set(["a.png", "b.png"]));
  });
});
