// @vitest-environment jsdom
// Word count (plan 09 task 9.4, issue #87): the counting rules shared by the
// status bar and the Word Count dialog, plus the selection scoping that runs
// against a live ProseMirror doc. Plan 09 AC3: the dialog must match the
// status bar for the whole document — both run these same functions, and this
// suite pins the rules, including against fixtures with known counts (the
// expected values were derived independently with tr/wc/awk over the same
// files, then confirmed by hand).
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  READING_WPM,
  countChars,
  countCharsNoSpaces,
  countParagraphs,
  countSentences,
  countSelection,
  countText,
  countWords,
  formatReadingTime,
  paragraphsInRange,
  readingMinutes,
} from "../counts";
import { markdownToTiptap } from "../pm";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "..", "..", "fixtures", "clean");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function makeEditor(markdown: string): Editor {
  return new Editor({
    extensions: [StarterKit],
    content: markdownToTiptap(markdown),
  });
}

let editors: Editor[] = [];
afterEach(() => {
  for (const e of editors) e.destroy();
  editors = [];
});
function track(e: Editor): Editor {
  editors.push(e);
  return e;
}

describe("countWords", () => {
  it("is 0 for empty or whitespace-only text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t  ")).toBe(0);
  });

  it("splits on any whitespace run, ignoring surrounding whitespace", () => {
    expect(countWords("one two three")).toBe(3);
    expect(countWords("a  b\nc")).toBe(3);
    expect(countWords("  padded  ")).toBe(1);
  });

  it("counts CRLF and tab separators", () => {
    expect(countWords("word\r\nnext")).toBe(2);
    expect(countWords("a\tb")).toBe(2);
  });
});

describe("countChars / countCharsNoSpaces", () => {
  it("chars is the raw length; noSpaces strips every whitespace character", () => {
    expect(countChars("")).toBe(0);
    expect(countChars("a b")).toBe(3);
    expect(countCharsNoSpaces("")).toBe(0);
    expect(countCharsNoSpaces("a b\nc\r\nd")).toBe(4);
  });
});

describe("countSentences", () => {
  it("is 0 for empty or whitespace-only text", () => {
    expect(countSentences("")).toBe(0);
    expect(countSentences("  \n ")).toBe(0);
  });

  it("breaks at a terminator followed by whitespace", () => {
    expect(countSentences("Hello.")).toBe(1);
    expect(countSentences("Hello. World.")).toBe(2);
    expect(countSentences("End! Next? Last.")).toBe(3);
    expect(countSentences("First.  Second.\nThird")).toBe(3);
  });

  it("a terminator with no following whitespace does not break", () => {
    expect(countSentences("a.b")).toBe(1);
    expect(countSentences("3.14 is pi")).toBe(1);
    expect(countSentences("...")).toBe(1);
  });

  it("numbered-list markers are terminators too (the plan's regex rule)", () => {
    // "1. " and "2. " each break after the marker's period, so "1. one"
    // yields the segments "1." and "one…" — the same rule Word-style regex
    // counters apply; the fixture known-count test pins this.
    expect(countSentences("1. one")).toBe(2);
    expect(countSentences("1. one\n2. two")).toBe(3);
  });
});

describe("countParagraphs", () => {
  it("is the blank-line-separated block count with non-empty content", () => {
    expect(countParagraphs("")).toBe(0);
    expect(countParagraphs("a")).toBe(1);
    expect(countParagraphs("a\n")).toBe(1);
    expect(countParagraphs("a\n\n")).toBe(1);
    expect(countParagraphs("a\nb")).toBe(1);
    expect(countParagraphs("a\n\nb")).toBe(2);
    expect(countParagraphs("a\n\n\n\nb")).toBe(2);
  });

  it("treats CRLF and whitespace-only separator lines as blank lines", () => {
    expect(countParagraphs("a\r\n\r\nb")).toBe(2);
    expect(countParagraphs("a\n \nb")).toBe(2);
  });
});

describe("reading time", () => {
  it("uses 200 wpm, rounded up; 0 words is 0 minutes", () => {
    expect(READING_WPM).toBe(200);
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(1)).toBe(1);
    expect(readingMinutes(200)).toBe(1);
    expect(readingMinutes(201)).toBe(2);
    expect(readingMinutes(400)).toBe(2);
    expect(readingMinutes(1000)).toBe(5);
  });

  it("formats the readout", () => {
    expect(formatReadingTime(0)).toBe("0 min");
    expect(formatReadingTime(1)).toBe("1 min");
    expect(formatReadingTime(7)).toBe("7 min");
  });
});

describe("countText on fixtures with known counts (plan 09 AC3)", () => {
  // headings.md: 6 heading blocks + 1 paragraph; the only sentence
  // terminator followed by whitespace is the final period.
  it("matches the hand-verified counts for headings.md", () => {
    const text = fixture("headings.md");
    expect(countText(text)).toEqual({
      words: 27,
      chars: 184,
      charsNoSpaces: 151,
      sentences: 1,
      paragraphs: 7,
      readingMinutes: 1,
    });
  });

  // mixed-structure.md: 11 blocks (heading, intro, quote, ordered list,
  // bullet list, code block, table, footnote ref, footnote def, hr, final
  // paragraph); 6 sentences (the intro's period, both ordered-list markers,
  // the footnote ref, the footnote def).
  it("matches the hand-verified counts for mixed-structure.md", () => {
    const text = fixture("mixed-structure.md");
    expect(countText(text)).toEqual({
      words: 62,
      chars: 376,
      charsNoSpaces: 302,
      sentences: 6,
      paragraphs: 11,
      readingMinutes: 1,
    });
  });
});

describe("selection scoping (countSelection / paragraphsInRange)", () => {
  // The doc layout the tests select against (nodeSize = open + content +
  // close, so a heading with 5 chars spans 7 positions):
  //   # Title                                  [0, 7)
  //   Alpha beta gamma. Delta.                 [7, 33)
  //   Epsilon zeta.                            [33, 48)
  const DOC_MD = "# Title\n\nAlpha beta gamma. Delta.\n\nEpsilon zeta.";

  it("counts a single-paragraph selection from the extracted text", () => {
    const editor = track(makeEditor(DOC_MD));
    // "beta gamma" sits at content offset 6..16 of the first paragraph
    // (absolute 14..24: paragraph open at 7, content at 8).
    const counts = countSelection(editor.state.doc, 7 + 1 + 6, 7 + 1 + 16);
    expect(counts).toEqual({
      words: 2,
      chars: 10,
      charsNoSpaces: 9,
      sentences: 1,
      paragraphs: 1,
      readingMinutes: 1,
    });
  });

  it("counts a cross-paragraph selection: text from the range, paragraphs from the doc", () => {
    const editor = track(makeEditor(DOC_MD));
    // From "Delta." (content offset 18 of the first paragraph, absolute 26)
    // to the end of "Epsilon zeta." (absolute 47): the extracted text joins
    // the blocks with one newline.
    const counts = countSelection(editor.state.doc, 7 + 1 + 18, 33 + 1 + 13);
    expect(counts.words).toBe(3);
    expect(counts.chars).toBe("Delta.\nEpsilon zeta.".length);
    expect(counts.charsNoSpaces).toBe("Delta.\nEpsilon zeta.".replace(/\s/g, "").length);
    expect(counts.sentences).toBe(2);
    expect(counts.paragraphs).toBe(2);
  });

  it("whole-doc: the PM doc drops markdown syntax tokens the source text keeps", () => {
    const editor = track(makeEditor(DOC_MD));
    // content.size, not nodeSize: the doc's nodeSize runs two positions past
    // the last valid end (the open/close convention), which textBetween
    // rejects.
    const fromDoc = countSelection(editor.state.doc, 0, editor.state.doc.content.size);
    const fromText = countText(DOC_MD);
    // The status bar counts the raw markdown, where the "#" marker is a
    // whitespace-delimited token; the PM doc counts rendered text only. The
    // whole-dialog path uses the source text (status bar parity, plan 09
    // AC3), so the two word counts legitimately differ by the syntax tokens.
    expect(fromDoc.words).toBe(7);
    expect(fromText.words).toBe(8);
    // Sentences and paragraphs agree for a well-formed doc.
    expect(fromDoc.sentences).toBe(fromText.sentences);
    expect(fromDoc.paragraphs).toBe(fromText.paragraphs);
    expect(fromDoc.paragraphs).toBe(3);
  });

  it("paragraphsInRange only counts textblocks the range touches", () => {
    const editor = track(makeEditor(DOC_MD));
    const doc = editor.state.doc;
    expect(paragraphsInRange(doc, 0, 6)).toBe(1); // the heading alone
    expect(paragraphsInRange(doc, 0, 32)).toBe(2); // heading + first paragraph
    expect(paragraphsInRange(doc, 0, doc.content.size)).toBe(3);
    expect(paragraphsInRange(doc, 10, 12)).toBe(1); // inside the first paragraph
  });
});
