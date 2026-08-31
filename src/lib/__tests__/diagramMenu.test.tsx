// @vitest-environment jsdom
// The diagram node's context-menu item set (plan 11 task 11.6, issue #105):
// the four items (Edit diagram / Preview diagram / Copy diagram code /
// Delete diagram) — the registry commands behind them, the pure builder
// (diagramMenu.ts), and the card mode channel the edit/preview items route
// through — are defined and covered here. Plan 03 (#38) implements the
// shared ContextMenu that consumes buildDiagramMenu's output, so the
// definition stays pure (builder + registry commands + channel) and fully
// unit-testable without the menu component.
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import type { Editor as CoreEditor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { MermaidBlock } from "../../components/Editor";
import {
  EDITOR_COMMANDS,
  diagramNodeOf,
  inDiagram,
  mermaidFenceOf,
  runEditorCommand,
  editorCommandActive,
} from "../editorCommands";
import {
  mermaidCardModeAt,
  registerMermaidCardModeHandler,
  type MermaidCardMode,
} from "../mermaidCardMode";
import { buildDiagramMenu, DIAGRAM_MENU_ITEM_IDS } from "../diagramMenu";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom implements no SVG geometry API; the shims below keep mermaid's
// layout math total (the same shims mermaidCard.test.ts installs).
const svgProto = SVGElement.prototype as unknown as Record<string, unknown>;
if (typeof svgProto.getBBox !== "function") {
  svgProto.getBBox = () => new DOMRect(0, 0, 100, 20);
}
if (typeof svgProto.getComputedTextLength !== "function") {
  svgProto.getComputedTextLength = () => 100;
}
if (typeof svgProto.getTotalLength !== "function") {
  svgProto.getTotalLength = () => 100;
}

const SOURCE = "graph TD\n  A-->B";
const FENCE = mermaidFenceOf(SOURCE);
const DOC_MD = "Before\n\n" + FENCE + "\n\nAfter";

let unregisters: Array<() => void> = [];

afterEach(() => {
  for (const unregister of unregisters.splice(0)) unregister();
});

function makeEditor(md: string): CoreEditor {
  return new Editor({
    extensions: [StarterKit.configure({ codeBlock: false }), MermaidBlock],
    content: markdownToTiptap(md),
  });
}

// The doc position of the (only) mermaidBlock.
function diagramPos(editor: CoreEditor): number {
  let pos: number | null = null;
  editor.state.doc.descendants((node, p) => {
    if (node.type.name === "mermaidBlock" && pos === null) pos = p;
    return pos === null;
  });
  if (pos === null) throw new Error("no mermaidBlock in doc");
  return pos;
}

// Puts the cursor inside the diagram's text.
function placeInDiagram(editor: CoreEditor): void {
  editor.commands.setTextSelection(diagramPos(editor) + 1);
}

// Puts the cursor in the trailing "After" paragraph (outside any diagram).
function placeOutside(editor: CoreEditor): void {
  const { doc } = editor.state;
  let lastParagraph: number | null = null;
  doc.forEach((child, offset) => {
    if (child.type.name === "paragraph") lastParagraph = offset;
  });
  if (lastParagraph === null) throw new Error("no paragraph in doc");
  editor.commands.setTextSelection(lastParagraph + 1);
}

interface FakeCard {
  mode: MermaidCardMode;
  setMode: Mock;
  pos: () => number | null;
}

// A stand-in mounted card: the same handler shape MermaidCard registers.
function fakeCard(editor: CoreEditor): FakeCard {
  const card: FakeCard = {
    mode: "preview",
    setMode: vi.fn(),
    pos: () => diagramPos(editor),
  };
  unregisters.push(
    registerMermaidCardModeHandler({
      getPos: () => card.pos(),
      setMode: (m) => {
        card.mode = m;
        card.setMode(m);
      },
      getMode: () => card.mode,
    }),
  );
  return card;
}

describe("diagram node commands registry (issue #105)", () => {
  it("registers the four context-menu commands exactly once, with the plan 11 labels", () => {
    const byId = new Map<string, (typeof EDITOR_COMMANDS)[number]>();
    for (const cmd of EDITOR_COMMANDS) {
      expect(byId.has(cmd.id), `duplicate registry id ${cmd.id}`).toBe(false);
      byId.set(cmd.id, cmd);
    }
    expect(byId.get("diagramEdit")?.label).toBe("Edit diagram");
    expect(byId.get("diagramPreview")?.label).toBe("Preview diagram");
    expect(byId.get("diagramCopyCode")?.label).toBe("Copy diagram code");
    expect(byId.get("diagramDelete")?.label).toBe("Delete diagram");
  });
});

describe("diagramNodeOf / inDiagram", () => {
  it("finds the diagram for a cursor inside it", () => {
    const editor = makeEditor(DOC_MD);
    placeInDiagram(editor);
    const target = diagramNodeOf(editor);
    expect(target).not.toBeNull();
    expect(target!.pos).toBe(diagramPos(editor));
    expect(target!.node.type.name).toBe("mermaidBlock");
    expect(target!.node.textBetween(0, target!.node.content.size)).toBe(SOURCE);
    expect(inDiagram(editor)).toBe(true);
    editor.destroy();
  });

  it("finds the diagram for a NodeSelection on it", () => {
    const editor = makeEditor(DOC_MD);
    const pos = diagramPos(editor);
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)),
    );
    expect(inDiagram(editor)).toBe(true);
    expect(diagramNodeOf(editor)!.pos).toBe(pos);
    editor.destroy();
  });

  it("is null outside a diagram, including a NodeSelection on another node", () => {
    const editor = makeEditor(DOC_MD + "\n\n---");
    placeOutside(editor);
    expect(inDiagram(editor)).toBe(false);
    expect(diagramNodeOf(editor)).toBeNull();
    // A NodeSelection on the horizontal rule is not a diagram either.
    let hrPos: number | null = null;
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === "horizontalRule" && hrPos === null) hrPos = p;
      return hrPos === null;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, hrPos!),
      ),
    );
    expect(inDiagram(editor)).toBe(false);
    editor.destroy();
  });
});

describe("diagramDelete", () => {
  it("deletes the diagram, keeps the rest, and is a round-trip fixed point", () => {
    const editor = makeEditor(DOC_MD);
    placeInDiagram(editor);
    expect(runEditorCommand(editor, "diagramDelete")).toBe(true);
    const md = tiptapToMarkdown(editor.getJSON());
    expect(md).not.toContain("mermaid");
    expect(md).toBe("Before\n\nAfter\n");
    expect(tiptapToMarkdown(markdownToTiptap(md))).toBe(md);
    editor.destroy();
  });

  it("undo restores the prior fence exactly (plan 11 AC7)", () => {
    const editor = makeEditor(DOC_MD);
    placeInDiagram(editor);
    expect(runEditorCommand(editor, "diagramDelete")).toBe(true);
    expect(tiptapToMarkdown(editor.getJSON())).not.toContain("mermaid");
    editor.commands.undo();
    // The serializer (remark) terminates the document with a newline.
    expect(tiptapToMarkdown(editor.getJSON())).toBe(DOC_MD + "\n");
    editor.destroy();
  });

  it("deleting the only block leaves a valid document", () => {
    const editor = makeEditor(FENCE);
    placeInDiagram(editor);
    expect(runEditorCommand(editor, "diagramDelete")).toBe(true);
    const doc = editor.state.doc;
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild!.type.name).toBe("paragraph");
    editor.destroy();
  });

  it("is a no-op outside a diagram", () => {
    const editor = makeEditor(DOC_MD);
    placeOutside(editor);
    const before = editor.getJSON();
    expect(runEditorCommand(editor, "diagramDelete")).toBe(false);
    expect(editor.getJSON()).toEqual(before);
    editor.destroy();
  });
});

describe("diagramCopyCode", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
  });

  it("copies the fenced source — the same bytes the converter writes", () => {
    const editor = makeEditor(DOC_MD);
    placeInDiagram(editor);
    expect(runEditorCommand(editor, "diagramCopyCode")).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(FENCE);
    // No document change.
    editor.destroy();
  });

  it("is a no-op outside a diagram", () => {
    const editor = makeEditor(DOC_MD);
    placeOutside(editor);
    expect(runEditorCommand(editor, "diagramCopyCode")).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    editor.destroy();
  });
});

describe("diagramEdit / diagramPreview (mode channel)", () => {
  it("requests the card to switch to edit mode, and reports it active", () => {
    const editor = makeEditor(DOC_MD);
    const card = fakeCard(editor);
    placeInDiagram(editor);
    expect(editorCommandActive(editor, "diagramEdit")).toBe(false);
    expect(runEditorCommand(editor, "diagramEdit")).toBe(true);
    expect(card.setMode).toHaveBeenCalledWith("edit");
    expect(editorCommandActive(editor, "diagramEdit")).toBe(true);
    expect(editorCommandActive(editor, "diagramPreview")).toBe(false);
    editor.destroy();
  });

  it("requests the card to switch to preview mode", () => {
    const editor = makeEditor(DOC_MD);
    const card = fakeCard(editor);
    card.mode = "edit";
    placeInDiagram(editor);
    expect(runEditorCommand(editor, "diagramPreview")).toBe(true);
    expect(card.setMode).toHaveBeenCalledWith("preview");
    expect(editorCommandActive(editor, "diagramPreview")).toBe(true);
    expect(editorCommandActive(editor, "diagramEdit")).toBe(false);
    editor.destroy();
  });

  it("is a no-op when no card is mounted for the diagram", () => {
    const editor = makeEditor(DOC_MD);
    placeInDiagram(editor);
    expect(runEditorCommand(editor, "diagramEdit")).toBe(false);
    expect(runEditorCommand(editor, "diagramPreview")).toBe(false);
    expect(editorCommandActive(editor, "diagramEdit")).toBe(false);
    editor.destroy();
  });

  it("is a no-op outside a diagram, even with a card mounted", () => {
    const editor = makeEditor(DOC_MD);
    const card = fakeCard(editor);
    placeOutside(editor);
    expect(runEditorCommand(editor, "diagramEdit")).toBe(false);
    expect(card.setMode).not.toHaveBeenCalled();
    editor.destroy();
  });
});

describe("buildDiagramMenu (issue #105)", () => {
  it("defines the four items in plan 11 §2.8 order with the plan's labels", () => {
    const editor = makeEditor(DOC_MD);
    placeInDiagram(editor);
    const items = buildDiagramMenu(editor);
    expect(items.map((i) => i.id)).toEqual([...DIAGRAM_MENU_ITEM_IDS]);
    expect(items.map((i) => i.label)).toEqual([
      "Edit diagram",
      "Preview diagram",
      "Copy diagram code",
      "Delete diagram",
    ]);
    editor.destroy();
  });

  it("maps each item 1:1 to a registry command (plan 03 AC1)", () => {
    const editor = makeEditor(DOC_MD);
    placeInDiagram(editor);
    const commands = new Set(EDITOR_COMMANDS.map((c) => c.id));
    const items = buildDiagramMenu(editor);
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(commands.has(item.command), `unknown command ${item.command}`).toBe(
        true,
      );
    }
    const registryIds = items.map((i) => i.command);
    expect(new Set(registryIds).size).toBe(registryIds.length);
    expect(registryIds.sort()).toEqual(
      ["diagramCopyCode", "diagramDelete", "diagramEdit", "diagramPreview"],
    );
    editor.destroy();
  });

  it("disables every item and checks nothing outside a diagram", () => {
    const editor = makeEditor(DOC_MD);
    placeOutside(editor);
    const items = buildDiagramMenu(editor);
    expect(items.every((i) => i.enabled === false)).toBe(true);
    expect(items.every((i) => i.checked !== true)).toBe(true);
    editor.destroy();
  });

  it("enables every item inside a diagram and marks delete as the destructive one", () => {
    const editor = makeEditor(DOC_MD);
    placeInDiagram(editor);
    const items = buildDiagramMenu(editor);
    expect(items.every((i) => i.enabled === true)).toBe(true);
    const danger = items.filter((i) => i.danger === true);
    expect(danger.map((i) => i.id)).toEqual(["diagram-delete"]);
    editor.destroy();
  });

  it("checks the edit/preview pair according to the card's mode", () => {
    const editor = makeEditor(DOC_MD);
    const card = fakeCard(editor);
    placeInDiagram(editor);

    const checkedOf = (id: string) =>
      buildDiagramMenu(editor).find((i) => i.id === id)?.checked;
    // No mode switch yet: the card is in preview.
    expect(checkedOf("diagram-preview")).toBe(true);
    expect(checkedOf("diagram-edit")).toBe(false);
    // Switch through the registry command the menu item dispatches.
    expect(runEditorCommand(editor, "diagramEdit")).toBe(true);
    expect(checkedOf("diagram-edit")).toBe(true);
    expect(checkedOf("diagram-preview")).toBe(false);

    // No card mounted: both items stay unchecked (mode is unknown).
    card.pos = () => null;
    expect(checkedOf("diagram-edit")).toBe(false);
    expect(checkedOf("diagram-preview")).toBe(false);
    editor.destroy();
  });
});

describe("card mode channel end-to-end (issue #105)", () => {
  interface Mounted {
    container: HTMLDivElement;
    root: Root;
    editor: Editor;
  }

  async function mountDoc(markdown: string): Promise<Mounted> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const editor = new Editor({
      extensions: [StarterKit.configure({ codeBlock: false }), MermaidBlock],
      content: markdownToTiptap(markdown),
    });
    await act(async () => {
      root.render(<EditorContent editor={editor} />);
    });
    return { container, root, editor };
  }

  async function waitFor(cond: () => boolean, what: string): Promise<void> {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > 15000) throw new Error(`timeout waiting for ${what}`);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });
    }
  }

  function cardOf(container: HTMLDivElement): HTMLDivElement {
    const card = container.querySelector(".quillmd-mermaid-card");
    if (!card) throw new Error("mermaid card not mounted");
    return card as HTMLDivElement;
  }

  it("routes the menu commands through the mounted card and back", async () => {
    const { container, root, editor } = await mountDoc(DOC_MD);
    try {
      await waitFor(() => !!container.querySelector(".quillmd-mermaid-card"), "card");
      placeInDiagram(editor);
      const before = tiptapToMarkdown(editor.getJSON());

      await act(async () => {
        expect(runEditorCommand(editor, "diagramEdit")).toBe(true);
      });
      expect(cardOf(container).dataset.mode).toBe("edit");
      expect(editorCommandActive(editor, "diagramEdit")).toBe(true);
      expect(
        buildDiagramMenu(editor).find((i) => i.id === "diagram-edit")?.checked,
      ).toBe(true);

      await act(async () => {
        expect(runEditorCommand(editor, "diagramPreview")).toBe(true);
      });
      expect(cardOf(container).dataset.mode).toBe("preview");
      expect(editorCommandActive(editor, "diagramPreview")).toBe(true);
      expect(
        buildDiagramMenu(editor).find((i) => i.id === "diagram-preview")?.checked,
      ).toBe(true);

      // The document bytes never changed (the mode is a view state).
      expect(tiptapToMarkdown(editor.getJSON())).toBe(before);
    } finally {
      await act(async () => root.unmount());
      editor.destroy();
      container.remove();
    }
  });

  it("unregisters the card on unmount, so requests no longer match", async () => {
    const { container, root, editor } = await mountDoc(DOC_MD);
    const pos = diagramPos(editor);
    try {
      await waitFor(() => !!container.querySelector(".quillmd-mermaid-card"), "card");
      placeInDiagram(editor);
      expect(runEditorCommand(editor, "diagramEdit")).toBe(true);
      expect(mermaidCardModeAt(pos)).toBe("edit");
    } finally {
      await act(async () => root.unmount());
    }
    expect(mermaidCardModeAt(pos)).toBeNull();
    editor.destroy();
    container.remove();
  });
});
