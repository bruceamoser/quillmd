// @vitest-environment jsdom
// Source-view find & replace (plan 07 task 7.4, issue #72): the CodeMirror
// search wiring behind the shared find panel. Covers
//   * the 1:1 panel-options -> SearchQuery mapping (AC3),
//   * sourceMatches / replace against a live CodeMirror view (AC2),
//   * the match-count parity between the WYSIWYG engine (searchDoc) and the
//     CodeMirror engine (sourceMatches) on the same fixture (AC4), and
//   * the view-provider bridge the SourceView registers on mount (wiring).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getSearchQuery, setSearchQuery } from "@codemirror/search";
import { Editor } from "@tiptap/core";
import AppEditor from "../../components/Editor";
import SourceView from "../../components/SourceView";
import { currentFindEditor, searchDoc } from "../find";
import {
  currentSourceFindView,
  registerSourceFindView,
  replaceAllSourceMatches,
  replaceSourceActiveMatch,
  selectSourceMatch,
  setSourceFindHighlight,
  sourceFindExtensions,
  sourceMatches,
  toSearchQuery,
} from "../sourceFind";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "..", "..", "..", "fixtures", "clean", "long-document.md");
const FIXTURE_TEXT = readFileSync(FIXTURE, "utf8");

let views: EditorView[] = [];
let editors: Editor[] = [];
let roots: Root[] = [];
let parents: HTMLElement[] = [];

afterEach(() => {
  for (const v of views) v.destroy();
  views = [];
  for (const e of editors) e.destroy();
  editors = [];
  for (const r of roots) r.unmount();
  roots = [];
  for (const p of parents) p.remove();
  parents = [];
});

function makeView(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  parents.push(parent);
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: sourceFindExtensions }),
    parent,
  });
  views.push(view);
  return view;
}

// Render the real app editor (full QuillMD schema: custom nodes, tables,
// footnotes, images) so searchDoc sees the same flattened text the WYSIWYG
// engine uses in the app. The live editor is exposed through the find bridge.
function renderAppEditor(markdown: string): Editor {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  parents.push(parent);
  const root = createRoot(parent);
  roots.push(root);
  act(() => {
    root.render(<AppEditor value={markdown} onChange={() => {}} />);
  });
  const editor = currentFindEditor();
  if (!editor) throw new Error("find editor provider not registered");
  editors.push(editor);
  return editor;
}

describe("toSearchQuery (plan 07 task 7.4, AC3: 1:1 option mapping)", () => {
  it("maps every panel option onto the CodeMirror query", () => {
    const q = toSearchQuery({
      term: "foo",
      matchCase: true,
      wholeWord: true,
      useRegex: false,
      replace: "bar",
    });
    expect(q.search).toBe("foo");
    expect(q.caseSensitive).toBe(true);
    expect(q.wholeWord).toBe(true);
    expect(q.regexp).toBe(false);
    expect(q.literal).toBe(true);
    expect(q.replace).toBe("bar");
  });

  it("defaults are case-insensitive, non-whole-word, plain (literal)", () => {
    const q = toSearchQuery({ term: "foo" });
    expect(q.caseSensitive).toBe(false);
    expect(q.wholeWord).toBe(false);
    expect(q.regexp).toBe(false);
    expect(q.literal).toBe(true);
    expect(q.replace).toBe("");
  });

  it("regex mode sets regexp and drops literal", () => {
    const q = toSearchQuery({ term: "a.b", useRegex: true });
    expect(q.regexp).toBe(true);
    expect(q.literal).toBe(false);
  });

  it("an invalid regex is reported through query.valid", () => {
    expect(toSearchQuery({ term: "(", useRegex: true }).valid).toBe(false);
    expect(toSearchQuery({ term: "a.b", useRegex: true }).valid).toBe(true);
  });
});

describe("sourceMatches (plan 07 task 7.4, AC2)", () => {
  it("finds plain matches in doc order", () => {
    const view = makeView("one two one three one");
    expect(sourceMatches(view, { term: "one" })).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
      { from: 18, to: 21 },
    ]);
  });

  it("honors match case", () => {
    const view = makeView("Cat cat CAT");
    expect(sourceMatches(view, { term: "cat" }).length).toBe(3);
    expect(sourceMatches(view, { term: "cat", matchCase: true }).length).toBe(1);
  });

  it("honors whole word", () => {
    const view = makeView("cat catalog scat");
    expect(sourceMatches(view, { term: "cat" }).length).toBe(3);
    expect(sourceMatches(view, { term: "cat", wholeWord: true }).length).toBe(1);
  });

  it("runs regex terms", () => {
    const view = makeView("order 123 and order 456");
    expect(sourceMatches(view, { term: "order (\\d+)", useRegex: true })).toEqual([
      { from: 0, to: 9 },
      { from: 14, to: 23 },
    ]);
  });

  it("returns no matches for an empty term or an invalid regex", () => {
    const view = makeView("hello");
    expect(sourceMatches(view, { term: "" })).toEqual([]);
    expect(sourceMatches(view, { term: "(", useRegex: true })).toEqual([]);
  });
});

describe("replace (plan 07 task 7.4, AC2: writes through the view)", () => {
  it("replaces the active match and selects the replacement", () => {
    const view = makeView("find me find me");
    const matches = sourceMatches(view, { term: "find" });
    expect(replaceSourceActiveMatch(view, matches, 1, { term: "find" }, "got")).toBe(true);
    expect(view.state.doc.toString()).toBe("find me got me");
    const main = view.state.selection.main;
    expect(view.state.sliceDoc(main.from, main.to)).toBe("got");
  });

  it("applies regex capture substitution", () => {
    const view = makeView("order 123 ships");
    const matches = sourceMatches(view, { term: "order (\\d+)", useRegex: true });
    replaceSourceActiveMatch(view, matches, 0, { term: "order (\\d+)", useRegex: true }, "ord-$1");
    expect(view.state.doc.toString()).toBe("ord-123 ships");
  });

  it("is a no-op (and false) with no active match", () => {
    const view = makeView("nothing here");
    const matches = sourceMatches(view, { term: "zzz" });
    expect(replaceSourceActiveMatch(view, matches, 0, { term: "zzz" }, "x")).toBe(false);
    expect(view.state.doc.toString()).toBe("nothing here");
  });

  it("replace all rewrites every match in one transaction (single undo)", async () => {
    const { history, undo } = await import("@codemirror/commands");
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    parents.push(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: "a b a b a", extensions: [sourceFindExtensions, history()] }),
      parent,
    });
    views.push(view);
    const matches = sourceMatches(view, { term: "a" });
    expect(matches.length).toBe(3);
    const replaced = replaceAllSourceMatches(view, matches, { term: "a" }, "Z");
    expect(replaced).toBe(3);
    expect(view.state.doc.toString()).toBe("Z b Z b Z");
    // A single transaction -> a single undo step restores the original text.
    await act(async () => {
      undo(view);
    });
    expect(view.state.doc.toString()).toBe("a b a b a");
  });

  it("replace all with an empty replacement deletes the matches", () => {
    const view = makeView("x-y-z");
    const matches = sourceMatches(view, { term: "-" });
    replaceAllSourceMatches(view, matches, { term: "-" }, "");
    expect(view.state.doc.toString()).toBe("xyz");
  });
});

describe("selectSourceMatch", () => {
  it("moves the selection onto the match and skips when already there", () => {
    const view = makeView("hello world");
    selectSourceMatch(view, { from: 6, to: 11 });
    expect(view.state.selection.main.from).toBe(6);
    expect(view.state.selection.main.to).toBe(11);
    // A second call for the same range is a no-op (no extra transaction).
    const before = view.state;
    selectSourceMatch(view, { from: 6, to: 11 });
    expect(view.state).toBe(before);
  });
});

describe("WYSIWYG / source parity (plan 07 task 7.4, AC4)", () => {
  // (term, options) pairs expected to yield the same match count in both
  // engines on the shared fixture. The WYSIWYG engine searches the rendered
  // (flattened) text; the source engine searches the raw markdown. Prose
  // terms appear identically in both, so the counts agree.
   const cases: Array<{ name: string; term: string; opts?: { matchCase?: boolean; wholeWord?: boolean; useRegex?: boolean } }> = [
    { name: "plain word", term: "Section" },
    { name: "case-sensitive heading", term: "Section", opts: { matchCase: true } },
    { name: "case-sensitive substring (Subsection)", term: "section", opts: { matchCase: true } },
    { name: "list word", term: "bullet" },
    { name: "paragraph word", term: "paragraph" },
    { name: "code-block word (case-sensitive)", term: "fixture", opts: { matchCase: true } },
    { name: "title word (case-insensitive)", term: "Fixture" },
    { name: "whole-word heading word", term: "Section", opts: { wholeWord: true } },
    { name: "regex alternation", term: "numbered (one|two)", opts: { useRegex: true } },
    { name: "regex with char class", term: "Col [AB]", opts: { useRegex: true } },
  ];

  it("the same term/options produce the same match count in both engines", () => {
    const editor = renderAppEditor(FIXTURE_TEXT);
    const view = makeView(FIXTURE_TEXT);
    for (const c of cases) {
      const wysiwyg = searchDoc(editor.state.doc, { term: c.term, ...c.opts });
      const source = sourceMatches(view, { term: c.term, ...c.opts });
      expect(
        source.length,
        `source count for ${c.name} (${JSON.stringify(c.opts ?? {})})`,
      ).toBe(wysiwyg.matches.length);
    }
  });

  it("the comparison is meaningful (every case actually matches)", () => {
    const editor = renderAppEditor(FIXTURE_TEXT);
    for (const c of cases) {
      expect(
        searchDoc(editor.state.doc, { term: c.term, ...c.opts }).matches.length,
        `wysiwyg count for ${c.name}`,
      ).toBeGreaterThan(0);
    }
  });

  it("an invalid regex yields zero matches in both engines", () => {
    const editor = renderAppEditor(FIXTURE_TEXT);
    const view = makeView(FIXTURE_TEXT);
    expect(searchDoc(editor.state.doc, { term: "(", useRegex: true }).matches.length).toBe(0);
    expect(sourceMatches(view, { term: "(", useRegex: true }).length).toBe(0);
  });
});

describe("view-provider bridge (wiring)", () => {
  it("SourceView registers the live view on mount and clears it on unmount", () => {
    expect(currentSourceFindView()).toBeNull();
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    parents.push(parent);
    const root = createRoot(parent);
    roots.push(root);
    act(() => {
      root.render(<SourceView value={FIXTURE_TEXT} onChange={() => {}} />);
    });
    const view = currentSourceFindView();
    expect(view).not.toBeNull();
    expect(view!.state.doc.toString()).toBe(FIXTURE_TEXT);
    act(() => root.unmount());
    expect(currentSourceFindView()).toBeNull();
  });

  it("a registered provider can be replaced and unregistered by identity", () => {
    const a = () => null;
    const b = () => null;
    const unregA = registerSourceFindView(a);
    expect(currentSourceFindView()).toBeNull();
    const unregB = registerSourceFindView(b);
    // Unregistering the stale provider does not clear the live one.
    unregA();
    expect(currentSourceFindView()).toBeNull();
    unregB();
    expect(currentSourceFindView()).toBeNull();
  });
});

describe("search state applied through the view (AC3 sync)", () => {
  it("setSearchQuery on the view is what sourceMatches reads back", () => {
    const view = makeView("alpha beta alpha");
    const q = toSearchQuery({ term: "alpha", matchCase: true });
    view.dispatch({ effects: [setSearchQuery.of(q)] });
    expect(getSearchQuery(view.state).search).toBe("alpha");
    expect(sourceMatches(view, { term: "alpha", matchCase: true }).length).toBe(2);
  });

  it("the highlight field drives decorations on the view", () => {
    const view = makeView("dup dup dup");
    const q = toSearchQuery({ term: "dup" });
    view.dispatch({ effects: [setSourceFindHighlight.of({ query: q, active: 1 })] });
    // The decoration layer renders the match spans (two plain, one current).
    const layer = view.contentDOM as HTMLElement;
    const matches = layer.querySelectorAll(".quillmd-find-match");
    const current = layer.querySelectorAll(".quillmd-find-current");
    expect(matches.length).toBe(3);
    expect(current.length).toBe(1);
    // Clearing the field removes the highlights.
    view.dispatch({ effects: [setSourceFindHighlight.of(null)] });
    expect(view.contentDOM.querySelectorAll(".quillmd-find-match").length).toBe(0);
  });
});
