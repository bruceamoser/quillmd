// @vitest-environment jsdom
// WYSIWYG find engine (plan 07 task 7.1, issue #69): case/word/regex
// matcher over the doc text, SearchState with next/prev navigation, and the
// decoration builder. The find panel (task 7.2) and replace (task 7.3)
// consume this module.
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import type { Node as PmNode } from "@tiptap/pm/model";
import { markdownToTiptap } from "../pm";
import {
  compileSearch,
  escapeRegExp,
  FIND_CURRENT_CLASS,
  FIND_MATCH_CLASS,
  matchDecorations,
  nextMatch,
  prevMatch,
  searchDoc,
  type SearchMatch,
  type SearchState,
} from "../find";

let editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

// Same block/inline coverage as the app editor, minus the app-only atoms.
function makeEditor(markdown: string): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  return editor;
}

function docOf(markdown: string): PmNode {
  return makeEditor(markdown).state.doc;
}

type PmDoc = PmNode;

// The visible text of a match, as the editor would render it (block
// boundaries joined with "\n").
function matchText(doc: PmDoc, m: SearchMatch): string {
  return doc.textBetween(m.from, m.to, "\n");
}

function ranges(state: SearchState): Array<[number, number]> {
  return state.matches.map((m) => [m.from, m.to]);
}

describe("find.ts search engine (plan 07 task 7.1)", () => {
  const DOC = [
    "# Heading One",
    "",
    "Hello **world** and hello again.",
    "",
    "> quote hello",
    "",
    "- item one",
    "- item two",
    "",
    "```js",
    "const hello = 1;",
    "```",
  ].join("\n") + "\n";

  it("finds literal matches case-insensitively by default", () => {
    const doc = docOf(DOC);
    const state = searchDoc(doc, { term: "hello" });
    expect(state.matches).toHaveLength(4);
    expect(matchText(doc, state.matches[0])).toBe("Hello");
    expect(matchText(doc, state.matches[1])).toBe("hello");
    expect(matchText(doc, state.matches[2])).toBe("hello");
    expect(matchText(doc, state.matches[3])).toBe("hello");
    expect(state.active).toBe(0);
  });

  it("matchCase restricts to exact casing", () => {
    const doc = docOf(DOC);
    const lower = searchDoc(doc, { term: "hello", matchCase: true });
    expect(lower.matches).toHaveLength(3);
    expect(lower.matches.map((m) => matchText(doc, m))).toEqual([
      "hello",
      "hello",
      "hello",
    ]);
    const upper = searchDoc(doc, { term: "Hello", matchCase: true });
    expect(upper.matches).toHaveLength(1);
    expect(matchText(doc, upper.matches[0])).toBe("Hello");
  });

  it("whole word keeps only boundary matches", () => {
    const doc = docOf("cat catalog cats category\n");
    const any = searchDoc(doc, { term: "cat" });
    expect(any.matches).toHaveLength(4);

    const whole = searchDoc(doc, { term: "cat", wholeWord: true });
    expect(whole.matches).toHaveLength(1);
    expect(matchText(doc, whole.matches[0])).toBe("cat");
  });

  it("whole word treats letters, digits, and underscore as word chars", () => {
    const doc = docOf("abc_x 1234 45\n");
    expect(searchDoc(doc, { term: "abc", wholeWord: true }).matches).toHaveLength(0);
    expect(searchDoc(doc, { term: "123", wholeWord: true }).matches).toHaveLength(0);
    expect(searchDoc(doc, { term: "1234", wholeWord: true }).matches).toHaveLength(1);

    // Non-ASCII letters are word chars too.
    const uni = docOf("naïve naïveté\n");
    expect(searchDoc(uni, { term: "naïve", wholeWord: true }).matches).toHaveLength(1);
    expect(searchDoc(uni, { term: "naïve" }).matches).toHaveLength(2);
  });

  it("regex mode matches patterns with capture groups", () => {
    const doc = docOf("order 123 and order 456 placed\n");
    const state = searchDoc(doc, { term: "order (\\d+)", useRegex: true });
    expect(state.matches).toHaveLength(2);
    expect(matchText(doc, state.matches[0])).toBe("order 123");
    expect(matchText(doc, state.matches[1])).toBe("order 456");
    // The match starts at the pattern start, not at the capture group.
    expect(doc.textBetween(state.matches[0].from, state.matches[0].from + 5)).toBe("order");
  });

  it("regex mode honors matchCase and wholeWord", () => {
    const doc = docOf("Cat cAteGory cat\n");
    const ci = searchDoc(doc, { term: "cat", useRegex: true });
    expect(ci.matches).toHaveLength(3);
    const cs = searchDoc(doc, { term: "cat", useRegex: true, matchCase: true });
    expect(cs.matches).toHaveLength(1);
    // Whole word and match case are independent toggles (Word parity):
    // "Cat" and "cat" both survive, the embedded "cAt" does not.
    const ww = searchDoc(doc, { term: "cat", useRegex: true, wholeWord: true });
    expect(ww.matches).toHaveLength(2);
    expect(ww.matches.map((m) => matchText(doc, m))).toEqual(["Cat", "cat"]);
    const wwCs = searchDoc(doc, { term: "cat", useRegex: true, wholeWord: true, matchCase: true });
    expect(wwCs.matches).toHaveLength(1);
    expect(matchText(doc, wwCs.matches[0])).toBe("cat");
  });

  it("plain mode treats the term as a literal (no regex metachars)", () => {
    const doc = docOf("a.b and (a) and axb\n");
    const dotted = searchDoc(doc, { term: "a.b" });
    expect(dotted.matches).toHaveLength(1);
    expect(matchText(doc, dotted.matches[0])).toBe("a.b");
    const paren = searchDoc(doc, { term: "(a)" });
    expect(paren.matches).toHaveLength(1);
    expect(matchText(doc, paren.matches[0])).toBe("(a)");
    expect(escapeRegExp("a.b(c)")).toBe("a\\.b\\(c\\)");
  });

  it("invalid regex reports an error and yields no matches", () => {
    const compiled = compileSearch({ term: "([unclosed", useRegex: true });
    expect(compiled.regex).toBeNull();
    expect(compiled.error).toBeTruthy();

    const doc = docOf("anything goes\n");
    const state = searchDoc(doc, { term: "([unclosed", useRegex: true });
    expect(state.matches).toHaveLength(0);
    expect(state.active).toBe(-1);
  });

  it("empty term and empty doc yield no matches", () => {
    const doc = docOf(DOC);
    expect(searchDoc(doc, { term: "" }).matches).toHaveLength(0);
    const empty = docOf("\n");
    expect(searchDoc(empty, { term: "x" }).matches).toHaveLength(0);
  });

  it("finds matches across inline marks", () => {
    const doc = docOf("Hel**lo** *world*\n");
    const state = searchDoc(doc, { term: "Hello" });
    expect(state.matches).toHaveLength(1);
    expect(matchText(doc, state.matches[0])).toBe("Hello");
  });

  it("finds matches inside code blocks", () => {
    const doc = docOf("```js\nconst hello = 1;\n```\n");
    const state = searchDoc(doc, { term: "hello" });
    expect(state.matches).toHaveLength(1);
    expect(matchText(doc, state.matches[0])).toBe("hello");
  });

  it("finds matches in tables and task lists", () => {
    const doc = docOf("| a | b |\n| --- | --- |\n| hello | world |\n\n- [x] hello task\n");
    const state = searchDoc(doc, { term: "hello" });
    expect(state.matches).toHaveLength(2);
    expect(matchText(doc, state.matches[0])).toBe("hello");
    expect(matchText(doc, state.matches[1])).toBe("hello");
  });

  it("reports the top-level block index of each match", () => {
    const doc = docOf("# H1\n\npara one\n\npara two\n");
    const state = searchDoc(doc, { term: "para" });
    expect(state.matches.map((m) => m.block)).toEqual([1, 2]);
    expect(state.matches.every((m) => !m.crossBlock)).toBe(true);
  });

  it("marks matches spanning top-level blocks as cross-block", () => {
    const doc = docOf("foo\n\nbar\n");
    const cross = searchDoc(doc, { term: "o\nb" });
    expect(cross.matches).toHaveLength(1);
    expect(cross.matches[0].crossBlock).toBe(true);
    expect(cross.matches[0].block).toBe(0);
    expect(matchText(doc, cross.matches[0])).toBe("o\nb");

    const single = searchDoc(doc, { term: "foo" });
    expect(single.matches[0].crossBlock).toBe(false);
    expect(single.matches[0].block).toBe(0);
  });

  it("cross-block detection works at list boundaries", () => {
    const doc = docOf("- alpha\n\nbeta\n");
    const state = searchDoc(doc, { term: "a\\nb", useRegex: true });
    expect(state.matches).toHaveLength(1);
    expect(state.matches[0].crossBlock).toBe(true);
    expect(state.matches[0].block).toBe(0);
  });

  it("zero-width regex matches terminate and map to positions", () => {
    const doc = docOf("ab\n");
    const state = searchDoc(doc, { term: "a*", useRegex: true });
    // "" before "a", "a", "" after "a" (the final boundary is out of range).
    expect(state.matches.length).toBeGreaterThanOrEqual(2);
    const widths = state.matches.map((m) => m.to - m.from);
    expect(widths).toContain(0);
    expect(widths).toContain(1);
  });

  describe("next/prev navigation", () => {
    it("wraps around at both ends", () => {
      const doc = docOf("a b a b a\n");
      const state = searchDoc(doc, { term: "a" });
      expect(state.matches).toHaveLength(3);
      expect(state.active).toBe(0);

      expect(nextMatch(state).active).toBe(1);
      expect(nextMatch(nextMatch(state)).active).toBe(2);
      expect(nextMatch(nextMatch(nextMatch(state))).active).toBe(0);
      expect(prevMatch(state).active).toBe(2);
      expect(prevMatch(prevMatch(state)).active).toBe(1);
    });

    it("starts at the first match when none is active yet", () => {
      const doc = docOf("a a\n");
      const state = { ...searchDoc(doc, { term: "a" }), active: -1 };
      expect(nextMatch(state).active).toBe(0);
      expect(prevMatch(state).active).toBe(1);
    });

    it("is a no-op without matches", () => {
      const doc = docOf("nothing here\n");
      const state = searchDoc(doc, { term: "z" });
      expect(nextMatch(state)).toBe(state);
      expect(prevMatch(state)).toBe(state);
      expect(state.active).toBe(-1);
    });

    it("never leaves a dangling active index", () => {
      const doc = docOf("a a a\n");
      let state = searchDoc(doc, { term: "a" });
      for (let i = 0; i < 7; i += 1) {
        state = i % 2 === 0 ? nextMatch(state) : prevMatch(state);
        expect(state.active).toBeGreaterThanOrEqual(0);
        expect(state.active).toBeLessThan(state.matches.length);
      }
    });
  });

  describe("decoration builder", () => {
    function collected(set: ReturnType<typeof matchDecorations>): Array<{
      from: number;
      to: number;
      cls: string;
    }> {
      return set.find().map((deco) => {
        const spec = deco.spec as { class?: string };
        return { from: deco.from, to: deco.to, cls: spec.class ?? "" };
      });
    }

    it("decorates every match, marking the active one", () => {
      const doc = docOf("a b a b a\n");
      const state = searchDoc(doc, { term: "a" });
      const decos = collected(matchDecorations(doc, state));
      expect(decos).toHaveLength(3);
      expect(ranges(state).map((r) => r.join("-"))).toEqual(
        decos.map((d) => `${d.from}-${d.to}`),
      );
      expect(decos[0].cls).toBe(`${FIND_MATCH_CLASS} ${FIND_CURRENT_CLASS}`);
      expect(decos[1].cls).toBe(FIND_MATCH_CLASS);
      expect(decos[2].cls).toBe(FIND_MATCH_CLASS);

      // Navigating moves the stronger highlight.
      const moved = matchDecorations(doc, nextMatch(state));
      expect(collected(moved)[1].cls).toBe(`${FIND_MATCH_CLASS} ${FIND_CURRENT_CLASS}`);
    });

    it("highlights cross-block matches too", () => {
      const doc = docOf("foo\n\nbar\n");
      const state = searchDoc(doc, { term: "o\nb" });
      const decos = collected(matchDecorations(doc, state));
      expect(decos).toHaveLength(1);
      expect(decos[0].from).toBe(state.matches[0].from);
      expect(decos[0].to).toBe(state.matches[0].to);
    });

    it("builds an empty set for a matchless state", () => {
      const doc = docOf("nothing\n");
      const state = searchDoc(doc, { term: "z" });
      expect(collected(matchDecorations(doc, state))).toHaveLength(0);
    });
  });
});
