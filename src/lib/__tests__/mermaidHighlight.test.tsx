// @vitest-environment jsdom
// Mermaid CodeMirror highlight (plan 11 task 11.4, issue #103): the source
// view colors ```mermaid fences with a lightweight stream-language highlight
// — the plan 11 §2 keyword set (graph/flowchart/sequenceDiagram/
// classDiagram/erDiagram/stateDiagram/gantt/pie/gitgraph/timeline) plus %%
// line comments, no full grammar.
//
// Two levels are covered:
//  1. The stream language in isolation (which tokens get which tag).
//  2. The markdown fence wiring — a ```mermaid fence's body is parsed with
//     the mermaid language via codeLanguages, a plain/other fence is not.
//
// The fence body is a *mounted* sub-parse (parseMixed), so its tags are not
// on the top-level markdown tree; they are reached by resolving into the
// overlay with tree.resolveInner(pos).
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { getStyleTags, tags, type Tag } from "@lezer/highlight";
import { mermaidCodeLanguage, mermaidStreamLanguage } from "../mermaidHighlight";
import SourceView from "../../components/SourceView";
import { currentSourceFindView } from "../sourceFind";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const KEYWORDS = [
  "graph",
  "flowchart",
  "sequenceDiagram",
  "classDiagram",
  "erDiagram",
  "stateDiagram",
  "gantt",
  "pie",
  "gitgraph",
  "timeline",
];

interface Token {
  text: string;
  tagSet: readonly Tag[];
}

// Level 1: run the stream language alone over raw mermaid text and collect
// every tagged leaf. Untagged text (node ids, labels, arrows) never appears.
function taggedTokens(doc: string): Token[] {
  const state = EditorState.create({
    doc,
    extensions: [mermaidStreamLanguage],
  });
  const tree = ensureSyntaxTree(state, state.doc.length);
  if (!tree) throw new Error("no syntax tree");
  const out: Token[] = [];
  tree.iterate({
    enter: (node) => {
      // Only the stream-language tokens carry a highlight rule; container
      // nodes (Document, etc.) do not, so a non-empty tag set identifies a
      // token. (No isLeaf filter: the token's NodeType does not expose it.)
      const style = getStyleTags(node);
      if (style && style.tags.length > 0) {
        out.push({ text: state.sliceDoc(node.from, node.to), tagSet: style.tags });
      }
      return true;
    },
  });
  return out;
}

// Level 2: the tags the markdown fence wiring assigns at an absolute doc
// position, descending into the mounted mermaid sub-parse.
function fenceTagSetAt(doc: string, pos: number): readonly Tag[] {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ codeLanguages: [mermaidCodeLanguage] })],
  });
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  if (!tree) return [];
  return getStyleTags(tree.resolveInner(pos))?.tags ?? [];
}

describe("mermaid stream language (issue #103)", () => {
  it("tags every diagram-type keyword in the plan's set", () => {
    const tokens = taggedTokens(KEYWORDS.join("\n"));
    const keywords = tokens.filter((t) => t.tagSet.includes(tags.keyword));
    // Exactly the ten keywords, nothing else.
    expect(keywords.map((t) => t.text)).toEqual(KEYWORDS);
  });

  it("tags %% comments as line comments", () => {
    const tokens = taggedTokens("%% a note\ngantt\ntitle X");
    const comments = tokens.filter((t) => t.tagSet.includes(tags.lineComment));
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe("%% a note");
    // The keyword on the following line is still tagged.
    expect(tokens.some((t) => t.text === "gantt" && t.tagSet.includes(tags.keyword))).toBe(true);
  });

  it("leaves non-keyword diagram text untagged", () => {
    const tokens = taggedTokens("graph TD\nA[Start] --> B{Decision}");
    // Only the diagram type is a keyword.
    expect(tokens.filter((t) => t.tagSet.includes(tags.keyword)).map((t) => t.text)).toEqual([
      "graph",
    ]);
    // The direction and node labels are plain text.
    for (const text of ["TD", "Start", "Decision"]) {
      expect(tokens.some((t) => t.text === text && t.tagSet.includes(tags.keyword))).toBe(false);
    }
  });

  it("is case-insensitive on a word boundary", () => {
    const tokens = taggedTokens("Graph TD\ngraphX[not a keyword]");
    const keywords = tokens.filter((t) => t.tagSet.includes(tags.keyword));
    expect(keywords.map((t) => t.text)).toEqual(["Graph"]);
    // graphX is a node id: the word boundary keeps it untagged.
    expect(tokens.some((t) => t.text === "graphX" && t.tagSet.includes(tags.keyword))).toBe(false);
  });
});

describe("markdown fence wiring (issue #103)", () => {
  it("colors the keywords inside a ```mermaid fence", () => {
    const doc = "```mermaid\n" + KEYWORDS.join("\n") + "\n```\n";
    for (const kw of KEYWORDS) {
      const pos = doc.indexOf(kw) + 1; // a character inside the keyword
      expect(fenceTagSetAt(doc, pos), `expected ${kw} to be tagged`).toContain(tags.keyword);
    }
  });

  it("colors %% comments inside a ```mermaid fence", () => {
    const doc = "```mermaid\n%% a note\ngantt\n```\n";
    expect(fenceTagSetAt(doc, doc.indexOf("note") + 1)).toContain(tags.lineComment);
  });

  it("selects the language by the fence info string (AC6)", () => {
    const doc = "```mermaid\ngraph\n```\n\n```\ngraph\n```\n";
    // The mermaid-fence keyword is tagged...
    expect(fenceTagSetAt(doc, doc.indexOf("graph") + 1)).toContain(tags.keyword);
    // ...the same word in a plain (no-info) fence is not.
    const plainPos = doc.lastIndexOf("graph") + 1;
    expect(fenceTagSetAt(doc, plainPos)).not.toContain(tags.keyword);
  });

  it("leaves non-keyword fence text untagged", () => {
    const doc = "```mermaid\ngraph TD\nA[Start]\n```\n";
    expect(fenceTagSetAt(doc, doc.indexOf("Start") + 1)).not.toContain(tags.keyword);
    expect(fenceTagSetAt(doc, doc.indexOf("TD") + 1)).not.toContain(tags.keyword);
  });
});

describe("SourceView wiring (issue #103)", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      const r = root;
      act(() => r.unmount());
      root = null;
    }
    container?.remove();
    container = null;
  });

  it("colors the mermaid keywords in the live source view", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const doc = "```mermaid\ngraph TD\n  A[Start]\n```\n";
    act(() => {
      root!.render(<SourceView value={doc} onChange={() => {}} />);
    });
    // The view is created in a layout effect; give the mount a tick so the
    // find-view bridge registration (a passive effect) has run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const view = currentSourceFindView();
    expect(view).not.toBeNull();
    const tree = ensureSyntaxTree(view!.state, view!.state.doc.length, 5000);
    expect(tree).not.toBeNull();
    // The diagram type is tagged in the real SourceView's markdown
    // codeLanguages (the wiring, not just the standalone language).
    expect(getStyleTags(tree!.resolveInner(doc.indexOf("graph") + 1))?.tags ?? []).toContain(
      tags.keyword,
    );
    // The node label is not (an untagged node resolves to no style rule).
    expect(getStyleTags(tree!.resolveInner(doc.indexOf("Start") + 1))?.tags ?? []).not.toContain(
      tags.keyword,
    );
  });
});
