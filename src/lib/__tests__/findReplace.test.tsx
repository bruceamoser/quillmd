// @vitest-environment jsdom
// Find & replace against the live WYSIWYG editor (plan 07 task 7.2, issue
// #70): single replace, replace all in one transaction (single undo), the
// cross-block refusal, and the decoration pipeline that renders the
// published SearchState in the real app Editor component (bridge + plugin).
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { TextSelection } from "@tiptap/pm/state";
import type { DecorationSet } from "@tiptap/pm/view";
import AppEditor from "../../components/Editor";
import { markdownToTiptap } from "../pm";
import {
  applyReplacement,
  currentFindDoc,
  currentFindEditor,
  matchDecorations,
  publishFindState,
  replaceActiveMatch,
  replaceAllMatches,
  searchDoc,
} from "../find";
import type { SearchState } from "../find";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let editors: Editor[] = [];
let roots: Root[] = [];
let container: HTMLDivElement | null = null;

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  for (const root of roots) root.unmount();
  roots = [];
  container?.remove();
  container = null;
});

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

// The decoration set currently held by the app editor's find plugin. A
// prosemirror Plugin stores its key as the string form of the PluginKey
// ("quillmdFind$"), so match on that prefix. The key is set at runtime but
// not in the type definitions, hence the cast.
function pluginDecos(editor: Editor): Array<{ from: number; to: number; cls: string }> {
  for (const p of editor.state.plugins) {
    const key = (p as unknown as { key?: string }).key;
    if (typeof key !== "string" || !key.startsWith("quillmdFind$")) continue;
    const set = p.getState(editor.state) as DecorationSet | undefined;
    if (!set) return [];
    return set.find().map((d) => ({
      from: d.from,
      to: d.to,
      cls: (d.spec as { class?: string }).class ?? "",
    }));
  }
  throw new Error("find decoration plugin not found");
}

describe("applyReplacement (plan 07 task 7.2, issue #70)", () => {
  it("plain mode inserts the replacement literally", () => {
    const norm = { term: "a.b", matchCase: false, wholeWord: false, useRegex: false };
    expect(applyReplacement("a.b", norm, "x(y)\\z")).toBe("x(y)\\z");
    // A regex metacharacter in the replacement is not special in plain mode.
    expect(applyReplacement("any", norm, "$1 & $&")).toBe("$1 & $&");
  });

  it("regex mode supports $1-style capture substitution (JS replace semantics)", () => {
    const norm = { term: "order (\\d+)", matchCase: false, wholeWord: false, useRegex: true };
    expect(applyReplacement("order 123", norm, "ord-$1")).toBe("ord-123");
    expect(applyReplacement("order 456", norm, "[$&]")).toBe("[order 456]");
    // Case-insensitive terms compile with the i flag; replacement still applies.
    const ci = { term: "ORDER (\\d+)", matchCase: false, wholeWord: false, useRegex: true };
    expect(applyReplacement("order 7", ci, "#$1")).toBe("#7");
  });
});

describe("replaceActiveMatch", () => {
  it("replaces the active match and selects the replacement", () => {
    const editor = makeEditor("hello hello hello\n");
    const state = searchDoc(editor.state.doc, { term: "hello" });
    expect(state.matches).toHaveLength(3);

    expect(replaceActiveMatch(editor, state, "bye")).toBe(true);
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size)).toBe("bye hello hello");

    // The replacement is left selected (Word behavior).
    const sel = editor.state.selection;
    expect(sel).toBeInstanceOf(TextSelection);
    expect(editor.state.doc.textBetween(sel.from, sel.to)).toBe("bye");
  });

  it("applies regex capture substitution to the active match", () => {
    const editor = makeEditor("order 123 and order 456\n");
    const state = searchDoc(editor.state.doc, { term: "order (\\d+)", useRegex: true });
    expect(state.matches).toHaveLength(2);
    expect(replaceActiveMatch(editor, state, "ord-$1")).toBe(true);
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size)).toBe(
      "ord-123 and order 456",
    );
  });

  it("refuses cross-block matches and leaves the doc untouched", () => {
    const editor = makeEditor("foo\n\nbar\n");
    const state = searchDoc(editor.state.doc, { term: "o\\nb", useRegex: true });
    expect(state.matches).toHaveLength(1);
    expect(state.matches[0].crossBlock).toBe(true);
    const before = editor.state.doc;
    expect(replaceActiveMatch(editor, state, "X")).toBe(false);
    expect(before.eq(editor.state.doc)).toBe(true);
  });

  it("returns false when there is no active match", () => {
    const editor = makeEditor("nothing\n");
    const state = searchDoc(editor.state.doc, { term: "z" });
    expect(replaceActiveMatch(editor, state, "x")).toBe(false);
  });
});

describe("replaceAllMatches", () => {
  it("replaces every match in one transaction (single undo)", () => {
    const editor = makeEditor("cat catalog cats\n");
    const state = searchDoc(editor.state.doc, { term: "cat" });
    expect(state.matches).toHaveLength(3);
    const before = editor.state.doc;

    expect(replaceAllMatches(editor, state, "dog")).toBe(3);
    // "cat" inside "catalog" is a match too: cat+alog -> dog+alog.
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size)).toBe(
      "dog dogalog dogs",
    );

    // One undo restores the pre-replace doc exactly (Word parity).
    editor.chain().undo().run();
    expect(before.eq(editor.state.doc)).toBe(true);
  });

  it("skips cross-block matches and reports the number replaced", () => {
    // Paragraphs "xaa", "a", "a". Regex "a\n?a" matches the in-block "aa" in
    // the first paragraph and the cross-block "a\na" between paragraphs 2/3.
    const editor = makeEditor("xaa\n\na\n\na\n");
    const state = searchDoc(editor.state.doc, { term: "a\\n?a", useRegex: true });
    expect(state.matches).toHaveLength(2);
    const cross = state.matches.filter((m) => m.crossBlock).length;
    expect(cross).toBe(1);

    const replaced = replaceAllMatches(editor, state, "X");
    expect(replaced).toBe(1); // the in-block match only
    // The cross-block match was left untouched: "xaa" -> "xX", the two "a"
    // paragraphs stay as-is.
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n")).toBe(
      "xX\na\na",
    );
  });

  it("applies regex capture substitution to every match", () => {
    const editor = makeEditor("order 1 order 2 order 3\n");
    const state = searchDoc(editor.state.doc, { term: "order (\\d+)", useRegex: true });
    expect(replaceAllMatches(editor, state, "ord-$1")).toBe(3);
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size)).toBe(
      "ord-1 ord-2 ord-3",
    );
  });

  it("returns 0 and dispatches nothing when there are no matches", () => {
    const editor = makeEditor("nothing\n");
    const state = searchDoc(editor.state.doc, { term: "z" });
    const before = editor.state.doc;
    expect(replaceAllMatches(editor, state, "x")).toBe(0);
    expect(before.eq(editor.state.doc)).toBe(true);
  });
});

describe("decoration pipeline in the app editor (issue #70)", () => {
  function renderAppEditor(markdown: string): Editor {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<AppEditor value={markdown} onChange={() => {}} />);
    });
    const editor = currentFindEditor();
    if (!editor) throw new Error("find editor provider not registered");
    return editor;
  }

  it("exposes the live doc through the find bridge", () => {
    renderAppEditor("hello hello\n");
    const doc = currentFindDoc();
    expect(doc?.textBetween(0, doc.content.size)).toBe("hello hello");
  });

  it("publishing a SearchState renders every match and marks the active one", () => {
    const editor = renderAppEditor("hello hello hello\n");
    const state: SearchState = searchDoc(editor.state.doc, { term: "hello" });
    act(() => {
      publishFindState(state);
    });

    const decos = pluginDecos(editor);
    expect(decos).toHaveLength(3);
    expect(decos[0].cls).toBe("quillmd-find-match quillmd-find-current");
    expect(decos[1].cls).toBe("quillmd-find-match");

    // The decorations reach the DOM as styled spans.
    expect(container!.querySelectorAll(".quillmd-find-match")).toHaveLength(3);
    expect(container!.querySelectorAll(".quillmd-find-current")).toHaveLength(1);

    // Navigating moves the stronger highlight (panel next/prev drives this).
    act(() => {
      publishFindState({ ...state, active: 1 });
    });
    const moved = pluginDecos(editor);
    expect(moved[1].cls).toBe("quillmd-find-match quillmd-find-current");
    expect(moved[0].cls).toBe("quillmd-find-match");
  });

  it("publishing null clears the decorations", () => {
    const editor = renderAppEditor("hello hello\n");
    act(() => {
      publishFindState(searchDoc(editor.state.doc, { term: "hello" }));
    });
    expect(container!.querySelectorAll(".quillmd-find-match")).toHaveLength(2);
    act(() => {
      publishFindState(null);
    });
    expect(container!.querySelectorAll(".quillmd-find-match")).toHaveLength(0);
    expect(pluginDecos(editor)).toHaveLength(0);
  });

  it("decorations track doc edits through the mapping", () => {
    const editor = renderAppEditor("hello hello\n");
    const state = searchDoc(editor.state.doc, { term: "hello" });
    const firstFrom = state.matches[0].from;
    act(() => {
      publishFindState(state);
    });

    // Insert a character at the start of the paragraph: every range shifts by one.
    editor.view.dispatch(editor.state.tr.insertText("x", 1));
    const remapped = pluginDecos(editor);
    expect(remapped).toHaveLength(2);
    expect(remapped[0].from).toBe(firstFrom + 1);
  });

  it("matchDecorations builds the same set the plugin receives", () => {
    const editor = renderAppEditor("hello hello\n");
    const state = searchDoc(editor.state.doc, { term: "hello" });
    act(() => {
      publishFindState(state);
    });
    const built = matchDecorations(editor.state.doc, state)
      .find()
      .map((d) => ({
        from: d.from,
        to: d.to,
        cls: (d.spec as { class?: string }).class ?? "",
      }));
    const inPlugin = pluginDecos(editor);
    expect(inPlugin).toEqual(built);
  });
});
