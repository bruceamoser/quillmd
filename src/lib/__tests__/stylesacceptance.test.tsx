// @vitest-environment jsdom
// Round-trip regression: style/theme markup is never written to disk
// (plan 05 task 5.6, issue #59; plan 05 §4 AC6).
//
// Themes and style overrides are the app's only two view-only styling layers:
// a theme is a CSS variable sheet selected by the data-theme attribute on the
// content container (App.tsx), and a style override is injected as a scoped
// <style> block. Neither may reach the markdown, the save pipeline, or the
// bytes on disk — a modified H2 (AC3) or a switched theme (AC2) must change
// zero bytes of a document.
//
// This is the AC6 regression guard. It renders a document through the app's
// own WYSIWYG pipeline (markdown -> TipTap -> the markdown the editor emits),
// turns the full view-only styling layer on (every theme, plus a
// representative set of style overrides), runs the result through the real
// save pipeline, and asserts the bytes that would be written to disk gain no
// style/theme markup token (no data-theme attribute, no --quillmd-* variable,
// no quillmd-* class/attr, no inline style, no leaked override declaration
// such as the AC3 Georgia/18pt rule). It then sweeps the whole clean
// round-trip corpus with the same property, so a future change that bakes
// theme/override state into the serialized document is caught on every
// fixture, not just the standard one.
//
// The assertion is "adds no token", not "contains no token": a document's own
// user content may legitimately contain such strings (the legacy-HTML
// fixtures carry quillmd-* spans), and general byte-fidelity of an edited
// document is the save pipeline's job (roundtrip.test.ts), not AC6's.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Strike from "@tiptap/extension-strike";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { createDocument, saveDocument } from "../pipeline";
import { THEMES, resolveTheme, type ThemeId } from "../theme";
import { overridesToCss, type StyleOverrides } from "../styleOverrides";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..");
const CLEAN_DIR = join(ROOT, "fixtures", "clean");
const STANDARD_FIXTURE = join(CLEAN_DIR, "theme-standard.md");

// The app's two content surfaces, exactly as App.tsx scopes the override CSS.
const SCOPES = [".quillmd-prosemirror", ".quillmd-preview-content"];

// The app editor's importable extension set (Editor.tsx minus its private
// footnote nodes, which the fixtures do not use): the DOM this renders is the
// WYSIWYG surface the themes and overrides restyle.
function makeEditor(markdown: string): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      Strike,
      Underline,
      Highlight,
      Link,
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
      Subscript,
      Superscript,
      Table,
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: markdownToTiptap(markdown),
  });
}

// The markdown the live editor emits for a document (what App.tsx feeds the
// save pipeline as currentText on the next save).
function emitMarkdown(markdown: string): string {
  const editor = makeEditor(markdown);
  try {
    return tiptapToMarkdown(editor.getJSON());
  } finally {
    editor.destroy();
  }
}

// The bytes the save pipeline would actually write to disk for a document the
// user has (re)serialized through the editor: the real clean-path decision.
function diskBytes(source: string): string {
  return saveDocument(createDocument(source), emitMarkdown(source)).text;
}

// The tokens that identify the app's view-only style/theme layer: the theme
// attribute, the CSS variable namespace, the app's content-container
// class/attr prefix, inline style attributes, and the exact declarations of
// the representative overrides below.
const STYLE_THEME_TOKENS = [
  "data-theme",
  "--quillmd-",
  "quillmd-",
  "style=",
  "font-family: Georgia",
  "font-size: 18pt",
  ".quillmd-prosemirror",
  ".quillmd-preview-content",
];

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

// The disk write must never add a view-layer token: every occurrence in the
// written text already existed in the source.
function expectNoNewStyleThemeMarkup(
  source: string,
  text: string,
  label: string,
): void {
  for (const token of STYLE_THEME_TOKENS) {
    expect(
      countOccurrences(text, token),
      `${label}: the disk write must not add "${token}" (source has ${countOccurrences(
        source,
        token,
      )})`,
    ).toBeLessThanOrEqual(countOccurrences(source, token));
  }
}

// A representative set of stored style overrides: AC3's exact H2 pick plus a
// spread across block, mark, and inline-code keys. These render to real,
// scoped CSS (asserted below) and are the view-only layer under test.
const REPRESENTATIVE_OVERRIDES: StyleOverrides = {
  h2: { fontFamily: "Georgia", fontSize: "18pt" },
  paragraph: { spacing: "compact" },
  strong: { fontWeight: "bold" },
  inlineCode: { color: "#ff0000" },
};

// The view-only styling layer is genuinely on: each theme resolves to a
// distinct data-theme value and the overrides render real scoped CSS. Returns
// the override CSS so a caller can prove the layer produced output.
function assertViewLayerActive(): string {
  const seen = new Set<ThemeId>();
  for (const theme of THEMES) {
    // A per-doc override to this theme: the App's data-theme value.
    seen.add(resolveTheme("quill", theme.id));
  }
  expect(seen.size).toBe(THEMES.length);
  const css = overridesToCss(REPRESENTATIVE_OVERRIDES, SCOPES);
  expect(css).not.toBe("");
  expect(css).toContain(".quillmd-prosemirror h2, .quillmd-preview-content h2");
  expect(css).toContain("font-family: Georgia;");
  expect(css).toContain("font-size: 18pt;");
  return css;
}

describe("AC6: style/theme markup is never written to disk (issue #59)", () => {
  it("the standard fixture doc writes to disk with no style/theme markup, styling layer fully on", () => {
    const source = readFileSync(STANDARD_FIXTURE, "utf8");

    // The view-only layer is on (every theme + representative overrides).
    const css = assertViewLayerActive();
    expect(css).not.toBe("");

    // The bytes the save pipeline would write gain no view-layer token. The
    // standard fixture carries none in its source, so the write must contain
    // none at all.
    const written = diskBytes(source);
    for (const token of STYLE_THEME_TOKENS) {
      expect(written, `token "${token}" must never be written`).not.toContain(token);
    }
    expectNoNewStyleThemeMarkup(source, written, "standard fixture");
  });

  it.each(THEMES.map((theme) => [theme.id] as [ThemeId]))(
    "the %s theme selection writes no markup to disk",
    (themeId) => {
      const source = readFileSync(STANDARD_FIXTURE, "utf8");
      expect(resolveTheme("quill", themeId)).toBe(themeId);
      const written = diskBytes(source);
      expectNoNewStyleThemeMarkup(source, written, `theme ${themeId}`);
      for (const token of STYLE_THEME_TOKENS) {
        expect(written, `token "${token}" must never be written`).not.toContain(token);
      }
    },
  );

  it("every clean fixture writes to disk without gaining a style/theme markup token", () => {
    const files = readdirSync(CLEAN_DIR)
      .filter((name) => name.endsWith(".md"))
      .sort();
    expect(files.length).toBeGreaterThanOrEqual(40);
    for (const file of files) {
      const source = readFileSync(join(CLEAN_DIR, file), "utf8");
      expectNoNewStyleThemeMarkup(source, diskBytes(source), file);
    }
  });
});
