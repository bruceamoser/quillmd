// @vitest-environment jsdom
// Find & replace against the live WYSIWYG editor (plan 07 task 7.2, issue
// #70; replace behavior is task 7.3, issue #71): single replace, replace
// all in one reverse-order transaction (single undo), the cross-container
// refusal, empty (delete) replacements, and the dirty-state + save pipeline
// guarantee (plan 07 §4 AC6). Also covers the decoration pipeline that
// renders the published SearchState in the real app Editor component
// (bridge + plugin).
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
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { createDocument, encodeDocument, saveDocument } from "../pipeline";
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

// --- WYSIWYG replace (plan 07 task 7.3, issue #71) --------------------------
//
// The reverse-order single-transaction replace-all and its single-undo
// guarantee are asserted above; this block covers the remaining replace
// behaviors: empty (delete) replacements, matches that span inline marks
// within one text block, and the cross-container refusal.

describe("replaceActiveMatch with an empty replacement (issue #71)", () => {
  it("deletes the active match and collapses the selection there", () => {
    const editor = makeEditor("cat dog cat\n");
    const state = searchDoc(editor.state.doc, { term: "cat" });
    expect(replaceActiveMatch(editor, state, "")).toBe(true);
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size)).toBe(" dog cat");

    // The (empty) replacement is left selected: a collapsed selection at the
    // cut point.
    const sel = editor.state.selection;
    expect(sel).toBeInstanceOf(TextSelection);
    expect(sel.from).toBe(sel.to);
  });

  it("is a no-op for a zero-width match and leaves the doc untouched", () => {
    const editor = makeEditor("bb\n");
    const state = searchDoc(editor.state.doc, { term: "a*", useRegex: true });
    const before = editor.state.doc;
    expect(replaceActiveMatch(editor, state, "")).toBe(true);
    expect(before.eq(editor.state.doc)).toBe(true);
  });
});

describe("replaceAllMatches with an empty replacement (issue #71)", () => {
  it("deletes every match in one transaction (single undo)", () => {
    const editor = makeEditor("cat dog cat cat\n");
    const state = searchDoc(editor.state.doc, { term: "cat" });
    expect(state.matches).toHaveLength(3);
    const before = editor.state.doc;

    expect(replaceAllMatches(editor, state, "")).toBe(3);
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size)).toBe(" dog  ");

    // One undo restores the pre-replace doc exactly.
    editor.chain().undo().run();
    expect(before.eq(editor.state.doc)).toBe(true);
  });
});

describe("replace across inline marks within one text block (issue #71)", () => {
  it("single replace rewrites a range spanning marks", () => {
    // "lo w" runs from bold "lo" into italic "w" inside one paragraph: the
    // range is rewritable as a single text node, so replace must apply.
    const editor = makeEditor("Hel**lo** *world* here\n");
    const state = searchDoc(editor.state.doc, { term: "lo w" });
    expect(state.matches).toHaveLength(1);
    expect(state.matches[0].crossBlock).toBe(false);

    expect(replaceActiveMatch(editor, state, "X")).toBe(true);
    expect(tiptapToMarkdown(editor.getJSON())).toBe("HelX*orld* here\n");
  });

  it("replace-all rewrites every in-block match that spans marks", () => {
    const editor = makeEditor("a**b**c a**b**c\n");
    const state = searchDoc(editor.state.doc, { term: "bc" });
    expect(state.matches).toHaveLength(2);
    expect(state.matches.every((m) => !m.crossBlock)).toBe(true);

    expect(replaceAllMatches(editor, state, "X")).toBe(2);
    expect(tiptapToMarkdown(editor.getJSON())).toBe("aX aX\n");
  });
});

describe("cross-container refusal (issue #71)", () => {
  it("refuses a match spanning two list items of one list", () => {
    const editor = makeEditor("- alpha\n- beta\n");
    const state = searchDoc(editor.state.doc, { term: "abet" });
    expect(state.matches).toHaveLength(1);
    expect(state.matches[0].crossBlock).toBe(true);

    const before = editor.state.doc;
    expect(replaceActiveMatch(editor, state, "X")).toBe(false);
    expect(replaceAllMatches(editor, state, "X")).toBe(0);
    expect(before.eq(editor.state.doc)).toBe(true);
  });

  it("refuses a match spanning two table cells", () => {
    const editor = makeEditor("| a | b |\n| --- | --- |\n| x | y |\n");
    const state = searchDoc(editor.state.doc, { term: "bx" });
    expect(state.matches).toHaveLength(1);
    expect(state.matches[0].crossBlock).toBe(true);

    const before = editor.state.doc;
    expect(replaceActiveMatch(editor, state, "Z")).toBe(false);
    expect(before.eq(editor.state.doc)).toBe(true);
  });
});

describe("dirty state + save pipeline (plan 07 §4 AC6, issue #71)", () => {
  const SOURCE = "cat one\ncat two\n\nuntouched **block**\n";

  it("a replace marks the doc dirty and the save splices only dirty blocks", () => {
    const editor = makeEditor(SOURCE);
    const state = searchDoc(editor.state.doc, { term: "cat" });
    expect(replaceAllMatches(editor, state, "dog")).toBe(2);

    // Dirty: the serialized text differs from the source.
    const current = tiptapToMarkdown(editor.getJSON());
    expect(current).not.toBe(SOURCE);
    expect(current).toBe("dog one\ndog two\n\nuntouched **block**\n");

    // The clean-path pipeline splices exactly the two dirty blocks and keeps
    // the untouched block (and its blank-line separator) byte-identical.
    const result = saveDocument(createDocument(SOURCE), current);
    expect(result.kind).toBe("splice");
    expect(result.text).toBe("dog one\ndog two\n\nuntouched **block**\n");
  });

  it("re-saving a replaced doc is byte-identical", () => {
    const editor = makeEditor(SOURCE);
    const state = searchDoc(editor.state.doc, { term: "cat" });
    replaceAllMatches(editor, state, "dog");
    const current = tiptapToMarkdown(editor.getJSON());

    const saved = saveDocument(createDocument(SOURCE), current).text;
    // Round-trip the saved text through the editor's own parse/serialize and
    // save again: a second save must be a verbatim no-op (byte-identical).
    const resaved = saveDocument(
      createDocument(saved),
      tiptapToMarkdown(markdownToTiptap(saved)),
    );
    expect(resaved.kind).toBe("verbatim");
    expect(resaved.text).toBe(saved);
  });

  it("a single replace keeps the CRLF encoding on save", () => {
    const editor = makeEditor("alpha beta alpha\n");
    const state = searchDoc(editor.state.doc, { term: "alpha" });
    expect(replaceActiveMatch(editor, state, "gamma")).toBe(true);
    const current = tiptapToMarkdown(editor.getJSON());

    const result = saveDocument(createDocument("alpha beta alpha\n"), current);
    const bytes = encodeDocument(result.text, { eol: "crlf", bom: false });
    expect(new TextDecoder().decode(bytes)).toBe("gamma beta alpha\r\n");
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

  it("does not report programmatic editor setup as a document change", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const emitted: string[] = [];
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(<AppEditor value="opened without a final newline" onChange={(md) => emitted.push(md)} />);
    });
    expect(emitted).toEqual([]);

    // Read-only changes call TipTap's setEditable. They are view state too
    // and must not make App think the document has unsaved edits.
    act(() => {
      root.render(
        <AppEditor
          value="opened without a final newline"
          onChange={(md) => emitted.push(md)}
          readOnly
        />,
      );
    });
    expect(emitted).toEqual([]);
  });

  it("a replace through the bridge fires onChange with the new markdown (issue #71)", () => {
    // App.tsx owns the dirty flag as (currentText !== open.source); the only
    // way a replace dirties the doc is by flowing through the editor's
    // onUpdate -> onChange. Render the real app Editor with a live onChange
    // and drive replace exactly the way doReplaceAll does.
    container = document.createElement("div");
    document.body.appendChild(container);
    const emitted: string[] = [];
    const root = createRoot(container);
    roots.push(root);
    const source = "cat one\ncat two\n\nuntouched **block**\n";
    act(() => {
      root.render(<AppEditor value={source} onChange={(md) => emitted.push(md)} />);
    });
    const editor = currentFindEditor();
    if (!editor) throw new Error("find editor provider not registered");

    const state = searchDoc(editor.state.doc, { term: "cat" });
    act(() => {
      replaceAllMatches(editor, state, "dog");
    });

    // The editor stays silent during setup; the replace is the document
    // update that dirties the doc.
    const dirty = emitted[emitted.length - 1];
    expect(dirty).toBe("dog one\ndog two\n\nuntouched **block**\n");
    // Dirty: the emitted text differs from the opened source.
    expect(dirty).not.toBe(source);
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
