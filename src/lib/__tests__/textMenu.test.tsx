// @vitest-environment jsdom
// The editor text context-menu item set (plan 03 task 3.2, issue #40): the
// right-click menus for the WYSIWYG, source, and preview surfaces — the
// pure builders (textMenu.ts), the ProseMirror selection resolution that
// drives the WYSIWYG item states (empty / range / node, plan 03 §3), and
// the 1:1 mapping of every registry item to a shared registry command
// (plan 03 AC1: the context menu dispatches the same command id the
// toolbar and the native menu dispatch, so the behavior is identical). The
// surface wiring (the contextmenu handlers that render the shared
// ContextMenu) is covered end-to-end at the bottom.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import type { Editor as CoreEditor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import QuillEditor, {
  AlignedBlockquote,
  AlignedHeading,
  AlignedParagraph,
} from "../../components/Editor";
import PreviewView from "../../components/PreviewView";
import {
  EDITOR_COMMANDS,
  runEditorCommand,
} from "../editorCommands";
import {
  buildPreviewMenu,
  buildSourceMenu,
  buildTextMenu,
  hasTextSelection,
  isTextMenuSeparator,
  linkHrefAtCaret,
  PREVIEW_MENU_ITEM_IDS,
  SOURCE_MENU_ITEM_IDS,
  TEXT_MENU_ITEM_IDS,
  textSelectionKind,
  toContextEntries,
  type TextMenuItem,
  type TextMenuEntry,
} from "../textMenu";
import { isSeparator } from "../../components/ContextMenu";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { currentFindEditor } from "../find";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const DOC_MD = "Hello world\n\nSecond paragraph";
const LINK_MD = "See [the site](https://example.com) now";

// The same block/mark extensions the app editor (Editor.tsx) uses for the
// items this menu dispatches, so the active-state checks read the same
// document state the surface does.
function makeEditor(md: string): CoreEditor {
  return new Editor({
    extensions: [
      StarterKit.configure({ paragraph: false, heading: false, blockquote: false }),
      AlignedParagraph,
      AlignedHeading,
      AlignedBlockquote,
      Underline,
      Highlight,
      Link.configure({ openOnClick: false }),
      Subscript,
      Superscript,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: markdownToTiptap(md),
  });
}

function caretAt(editor: CoreEditor, pos: number): void {
  editor.commands.setTextSelection(pos);
}

function selectRange(editor: CoreEditor, from: number, to: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
  );
}

function nodeSelect(editor: CoreEditor, pos: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)),
  );
}

// The non-separator items of a menu level, in display order.
function entriesOf(entries: readonly TextMenuEntry[]): TextMenuItem[] {
  return entries.filter((e): e is TextMenuItem => !isTextMenuSeparator(e));
}

function findItem(entries: readonly TextMenuEntry[], id: string): TextMenuItem | undefined {
  return entriesOf(entries).find((e) => e.id === id);
}

// Every leaf item (recursively through the submenus) that carries a
// registry command — the items the plan 03 AC1 mapping asserts on.
function commandLeaves(entries: readonly TextMenuEntry[]): TextMenuItem[] {
  const out: TextMenuItem[] = [];
  for (const e of entriesOf(entries)) {
    if (e.submenu) out.push(...commandLeaves(e.submenu));
    else if (e.command) out.push(e);
  }
  return out;
}

describe("textSelectionKind / hasTextSelection (plan 03 §3)", () => {
  it("a collapsed caret is an empty selection", () => {
    const editor = makeEditor(DOC_MD);
    caretAt(editor, 1);
    expect(textSelectionKind(editor)).toBe("empty");
    expect(hasTextSelection(editor)).toBe(false);
    editor.destroy();
  });

  it("a text range is a range selection", () => {
    const editor = makeEditor(DOC_MD);
    selectRange(editor, 1, 6);
    expect(textSelectionKind(editor)).toBe("range");
    expect(hasTextSelection(editor)).toBe(true);
    editor.destroy();
  });

  it("a node selection is a node selection", () => {
    const editor = makeEditor(DOC_MD + "\n\n---");
    let hrPos: number | null = null;
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === "horizontalRule" && hrPos === null) hrPos = p;
      return hrPos === null;
    });
    nodeSelect(editor, hrPos!);
    expect(textSelectionKind(editor)).toBe("node");
    expect(hasTextSelection(editor)).toBe(true);
    editor.destroy();
  });
});

describe("buildTextMenu (WYSIWYG, plan 03 §2)", () => {
  it("carries the plan 03 item set in display order, with the clipboard separator", () => {
    const editor = makeEditor(DOC_MD);
    const entries = buildTextMenu(editor);
    expect(entriesOf(entries).map((e) => e.id)).toEqual([...TEXT_MENU_ITEM_IDS]);
    // The separator divides the clipboard block from Format/Insert/Link/Emoji.
    expect(entries[5]).toEqual({ type: "separator", id: "text-sep-clipboard" });
    editor.destroy();
  });

  it("enables the clipboard items per the selection shape", () => {
    const editor = makeEditor(DOC_MD);
    caretAt(editor, 1);
    expect(findItem(buildTextMenu(editor), "text-cut")!.enabled).toBe(false);
    expect(findItem(buildTextMenu(editor), "text-copy")!.enabled).toBe(false);
    expect(findItem(buildTextMenu(editor), "text-paste")!.enabled).toBe(true);
    expect(findItem(buildTextMenu(editor), "text-select-all")!.enabled).toBe(true);

    selectRange(editor, 1, 6);
    expect(findItem(buildTextMenu(editor), "text-cut")!.enabled).toBe(true);
    expect(findItem(buildTextMenu(editor), "text-copy")!.enabled).toBe(true);
    editor.destroy();
  });

  it("wires the clipboard items to their surface actions", () => {
    const editor = makeEditor(DOC_MD);
    const entries = buildTextMenu(editor);
    expect(findItem(entries, "text-cut")!.action).toBe("cut");
    expect(findItem(entries, "text-copy")!.action).toBe("copy");
    expect(findItem(entries, "text-paste")!.action).toBe("paste");
    expect(findItem(entries, "text-paste-as-text")!.action).toBe("paste-as-text");
    expect(findItem(entries, "text-select-all")!.action).toBe("select-all");
    // Surface actions carry no registry command.
    for (const id of ["text-cut", "text-copy", "text-paste", "text-paste-as-text", "text-select-all"]) {
      expect(findItem(entries, id)!.command).toBeUndefined();
    }
    editor.destroy();
  });

  it("builds the Format submenu: the Font group, the Paragraph group, in plan 03 order", () => {
    const editor = makeEditor(DOC_MD);
    const format = findItem(buildTextMenu(editor), "text-format")!;
    expect(format.submenu).toBeDefined();
    const ids = entriesOf(format.submenu!).map((e) => e.id);
    expect(ids).toEqual([
      "text-bold",
      "text-italic",
      "text-underline",
      "text-strike",
      "text-code",
      "text-subscript",
      "text-superscript",
      "text-highlight",
      "text-clear-formatting",
      "text-align-left",
      "text-align-center",
      "text-align-right",
      "text-indent",
      "text-outdent",
      "text-spacing-single",
      "text-spacing-1.15",
      "text-spacing-1.5",
      "text-spacing-double",
    ]);
    editor.destroy();
  });

  it("checks the Font toggles from the document state, and dispatches them", () => {
    const editor = makeEditor(DOC_MD);
    selectRange(editor, 1, 6);
    const checkedOf = (id: string) =>
      findItem(findItem(buildTextMenu(editor), "text-format")!.submenu!, id)?.checked;
    expect(checkedOf("text-bold")).toBeUndefined();
    expect(checkedOf("text-underline")).toBeUndefined();
    // Dispatch through the registry the menu item carries (plan 03 AC1).
    expect(runEditorCommand(editor, "bold")).toBe(true);
    expect(checkedOf("text-bold")).toBe(true);
    expect(tiptapToMarkdown(editor.getJSON())).toContain("**Hello**");
    expect(runEditorCommand(editor, "underline")).toBe(true);
    expect(checkedOf("text-underline")).toBe(true);
    editor.destroy();
  });

  it("checks the alignment items from the block state, and dispatches them", () => {
    const editor = makeEditor(DOC_MD);
    caretAt(editor, 1);
    const checkedOf = (id: string) =>
      findItem(findItem(buildTextMenu(editor), "text-format")!.submenu!, id)?.checked;
    // The default alignment is left (the absent textAlign attribute).
    expect(checkedOf("text-align-left")).toBe(true);
    expect(checkedOf("text-align-center")).toBeUndefined();
    expect(runEditorCommand(editor, "alignCenter")).toBe(true);
    expect(checkedOf("text-align-center")).toBe(true);
    expect(checkedOf("text-align-left")).toBeUndefined();
    editor.destroy();
  });

  it("checks the line-spacing item for the applied preset, and dispatches it with its param", () => {
    const editor = makeEditor(DOC_MD);
    caretAt(editor, 1);
    const checkedOf = (id: string) =>
      findItem(findItem(buildTextMenu(editor), "text-format")!.submenu!, id)?.checked;
    // Unset reads as the "single" default.
    expect(checkedOf("text-spacing-single")).toBe(true);
    const item = findItem(findItem(buildTextMenu(editor), "text-format")!.submenu!, "text-spacing-1.5")!;
    expect(item.command).toBe("lineSpacing");
    expect(item.param).toBe("1.5");
    expect(runEditorCommand(editor, "lineSpacing", "1.5")).toBe(true);
    expect(checkedOf("text-spacing-1.5")).toBe(true);
    expect(checkedOf("text-spacing-single")).toBeUndefined();
    editor.destroy();
  });

  it("builds the Insert submenu: headings, then the insertables, in plan 03 order", () => {
    const editor = makeEditor(DOC_MD);
    const insert = findItem(buildTextMenu(editor), "text-insert")!;
    expect(insert.submenu).toBeDefined();
    const ids = entriesOf(insert.submenu!).map((e) => e.id);
    expect(ids).toEqual([
      "text-h1",
      "text-h2",
      "text-h3",
      "text-h4",
      "text-h5",
      "text-h6",
      "text-insert-link",
      "text-insert-image-file",
      "text-insert-image-url",
      "text-insert-table",
      "text-insert-hr",
      "text-insert-footnote",
      "text-insert-tasklist",
    ]);
    editor.destroy();
  });

  it("is a single Insert link item off a link, and a submenu on a link", () => {
    const editor = makeEditor(DOC_MD);
    caretAt(editor, 1);
    const link = findItem(buildTextMenu(editor), "text-link")!;
    expect(link.submenu).toBeUndefined();
    expect(link.label).toBe("Insert link");
    expect(link.command).toBe("link");

    const linked = makeEditor(LINK_MD);
    // The caret inside the link's text ("the site", at offset 4).
    caretAt(linked, 8);
    const linkItem = findItem(buildTextMenu(linked), "text-link")!;
    expect(linkItem.label).toBe("Link");
    // The full link item set (plan 03 task 3.5, issue #43), in plan 03 §2
    // order: Open / Edit / Copy address / Remove.
    expect(entriesOf(linkItem.submenu!).map((e) => e.id)).toEqual([
      "text-link-open",
      "text-link-edit",
      "text-link-copy-address",
      "text-link-remove",
    ]);
    expect(findItem(linkItem.submenu!, "text-link-edit")!.command).toBe("link");
    expect(findItem(linkItem.submenu!, "text-link-open")!.action).toBe("open-link");
    expect(findItem(linkItem.submenu!, "text-link-copy-address")!.action).toBe("copy-address");
    const remove = findItem(linkItem.submenu!, "text-link-remove")!;
    expect(remove.action).toBe("remove-link");
    expect(remove.danger).toBe(true);
    editor.destroy();
    linked.destroy();
  });

  it("maps every registry item 1:1 to a registered command (plan 03 AC1)", () => {
    const editor = makeEditor(LINK_MD);
    caretAt(editor, 8);
    const commands = new Set(EDITOR_COMMANDS.map((c) => c.id));
    const leaves = commandLeaves(buildTextMenu(editor));
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) {
      expect(
        commands.has(leaf.command!),
        `unknown registry command ${leaf.command!} for ${leaf.id}`,
      ).toBe(true);
    }
    editor.destroy();
  });
});

describe("linkHrefAtCaret", () => {
  it("returns the link href for a caret in the link", () => {
    const editor = makeEditor(LINK_MD);
    caretAt(editor, 8);
    expect(linkHrefAtCaret(editor)).toBe("https://example.com");
    editor.destroy();
  });

  it("returns null for a caret outside a link", () => {
    const editor = makeEditor(LINK_MD);
    caretAt(editor, 1);
    expect(linkHrefAtCaret(editor)).toBeNull();
    editor.destroy();
  });
});

describe("buildSourceMenu (plan 03 §3)", () => {
  it("carries the fixed source item set: the clipboard block and Open in WYSIWYG", () => {
    const entries = buildSourceMenu();
    expect(entriesOf(entries).map((e) => e.id)).toEqual([...SOURCE_MENU_ITEM_IDS]);
    expect(entries[4]).toEqual({ type: "separator", id: "source-sep-clipboard" });
    expect(entriesOf(entries).every((e) => e.enabled === true)).toBe(true);
    expect(findItem(entries, "source-copy")!.action).toBe("copy");
    expect(findItem(entries, "source-paste")!.action).toBe("paste");
    expect(findItem(entries, "source-paste-as-text")!.action).toBe("paste-as-text");
    expect(findItem(entries, "source-select-all")!.action).toBe("select-all");
    expect(findItem(entries, "source-open-wysiwyg")!.action).toBe("open-in-wysiwyg");
    expect(findItem(entries, "source-open-wysiwyg")!.label).toBe("Open in WYSIWYG");
  });
});

describe("buildPreviewMenu (plan 03 §3)", () => {
  it("is the fixed preview set with a disabled Link item off a link", () => {
    const entries = buildPreviewMenu(false, null);
    expect(entriesOf(entries).map((e) => e.id)).toEqual([...PREVIEW_MENU_ITEM_IDS]);
    const link = findItem(entries, "preview-link")!;
    expect(link.enabled).toBe(false);
    expect(link.submenu).toBeUndefined();
    expect(findItem(entries, "preview-copy")!.action).toBe("copy");
    expect(findItem(entries, "preview-open-wysiwyg")!.action).toBe("open-in-wysiwyg");
  });

  it("is the full Link submenu (Open / Edit / Copy address / Remove) on a link", () => {
    const entries = buildPreviewMenu(true, "https://example.com");
    const link = findItem(entries, "preview-link")!;
    expect(link.enabled).toBe(true);
    // The same item set as the WYSIWYG link submenu (plan 03 task 3.5,
    // issue #43), in plan 03 §2 order.
    expect(entriesOf(link.submenu!).map((e) => e.id)).toEqual([
      "preview-link-open",
      "preview-link-edit",
      "preview-link-copy-address",
      "preview-link-remove",
    ]);
    expect(findItem(link.submenu!, "preview-link-open")!.action).toBe("open-link");
    expect(findItem(link.submenu!, "preview-link-edit")!.action).toBe("edit-link");
    expect(findItem(link.submenu!, "preview-link-copy-address")!.action).toBe("copy-address");
    const remove = findItem(link.submenu!, "preview-link-remove")!;
    expect(remove.action).toBe("remove-link");
    expect(remove.danger).toBe(true);
  });

  it("disables the link items when the link has no href", () => {
    const entries = buildPreviewMenu(true, null);
    const link = findItem(entries, "preview-link")!;
    expect(link.enabled).toBe(true);
    expect(findItem(link.submenu!, "preview-link-open")!.enabled).toBe(false);
    expect(findItem(link.submenu!, "preview-link-edit")!.enabled).toBe(false);
    expect(findItem(link.submenu!, "preview-link-copy-address")!.enabled).toBe(false);
    expect(findItem(link.submenu!, "preview-link-remove")!.enabled).toBe(false);
  });
});

describe("toContextEntries (the ContextMenu mapping)", () => {
  it("wires each leaf's onSelect to the dispatch and passes separators through", () => {
    const editor = makeEditor(DOC_MD);
    caretAt(editor, 1);
    const entries = buildTextMenu(editor);
    const dispatch = (item: TextMenuItem): void => {
      runEditorCommand(editor, item.command!, item.param);
    };
    const mapped = toContextEntries(entries, dispatch);
    // The separator passes through untouched.
    expect(mapped[5]).toEqual({ type: "separator", id: "text-sep-clipboard" });
    // The submenu is mapped recursively: a leaf inside it carries its state
    // and an onSelect that dispatches its command.
    const format = mapped.find(
      (e) => !isSeparator(e) && e.id === "text-format",
    ) as {
      label: string;
      submenu?: { id: string; label: string; onSelect?: () => void }[];
    };
    expect(format.label).toBe("Format");
    const bold = format.submenu!.find((e) => e.id === "text-bold")!;
    expect(bold.label).toBe("Bold");
    expect(bold.onSelect).toBeTypeOf("function");
    selectRange(editor, 1, 6);
    bold.onSelect!();
    expect(tiptapToMarkdown(editor.getJSON())).toContain("**Hello**");
    const italic = format.submenu!.find((e) => e.id === "text-italic")!;
    italic.onSelect!();
    expect(editor.isActive("italic")).toBe(true);
    editor.destroy();
  });
});

describe("WYSIWYG surface end-to-end (plan 03 AC1)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  afterEach(() => {
    const current = root;
    if (current) {
      act(() => current.unmount());
      root = null;
    }
    document.body.innerHTML = "";
  });

  function menuItemButton(label: string): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(
      `.quillmd-context-item[aria-label="${label}"]`,
    );
    if (!button) throw new Error(`menu item not found: ${label}`);
    return button;
  }

  it("right-click opens the text menu and a pick dispatches the registry command", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const r = createRoot(container);
    root = r;
    await act(async () => {
      r.render(<QuillEditor value={DOC_MD} onChange={() => {}} />);
    });
    const editor = currentFindEditor();
    if (!editor) throw new Error("no live editor");

    // Select "Hello", then right-click inside the editor.
    await act(async () => {
    selectRange(editor, 1, 6);
      editor.view.dom.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 120,
          clientY: 80,
        }),
      );
    });
    const menu = document.querySelector(".quillmd-context-menu");
    expect(menu).not.toBeNull();
    // The menu carries the WYSIWYG item set (the clipboard block is
    // present, Cut/Copy enabled for the range selection — enabled items
    // carry no aria-disabled, disabled ones do).
    expect(menuItemButton("Cut (Ctrl+X)").getAttribute("aria-disabled")).toBeNull();
    expect(menuItemButton("Format")).not.toBeNull();
    expect(menuItemButton("Insert")).not.toBeNull();
    expect(menuItemButton("Emoji")).not.toBeNull();

    // Pick Format > Bold through the menu's own keyboard navigation: roving
    // focus lands on the first item (Cut) when the menu opens, so five
    // ArrowDowns reach Format, ArrowRight opens its submenu (focus lands on
    // the first child, Bold), and Enter activates it — dispatching the same
    // registry command the toolbar dispatches.
    const key = (k: string) =>
      menu!.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
      );
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        key("ArrowDown");
      });
    }
    await act(async () => {
      key("ArrowRight");
    });
    expect(menuItemButton("Bold (Ctrl+B)")).not.toBeNull();
    await act(async () => {
      key("Enter");
    });
    // The pick ran the command and closed the menu.
    expect(tiptapToMarkdown(editor.getJSON())).toContain("**Hello**");
    expect(document.querySelector(".quillmd-context-menu")).toBeNull();
  });

  it("right-click on a link: Link > Copy address copies the destination (plan 03 task 3.5)", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const r = createRoot(container);
    root = r;
    await act(async () => {
      r.render(<QuillEditor value={LINK_MD} onChange={() => {}} />);
    });
    const editor = currentFindEditor();
    if (!editor) throw new Error("no live editor");

    // The caret inside the link's text ("the site", at doc position 8).
    await act(async () => {
      caretAt(editor, 8);
      editor.view.dom.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 120,
          clientY: 80,
        }),
      );
    });
    const menu = document.querySelector(".quillmd-context-menu");
    expect(menu).not.toBeNull();

    // Roving focus lands on the first enabled item (Paste — Cut/Copy are
    // disabled for the collapsed caret), so End jumps to the last item
    // (Emoji), one ArrowUp reaches Link, ArrowRight opens its submenu
    // (focus lands on Open link), two ArrowDowns reach Copy address, and
    // Enter activates it.
    const key = (k: string) =>
      menu!.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
      );
    await act(async () => {
      key("End");
    });
    await act(async () => {
      key("ArrowUp");
    });
    await act(async () => {
      key("ArrowRight");
    });
    expect(menuItemButton("Open link")).not.toBeNull();
    await act(async () => {
      key("ArrowDown");
    });
    await act(async () => {
      key("ArrowDown");
    });
    await act(async () => {
      key("Enter");
    });
    // The pick copied the link's destination and closed the menu.
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("https://example.com");
    expect(document.querySelector(".quillmd-context-menu")).toBeNull();
    Object.defineProperty(window.navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    editor.destroy();
  });
});

describe("Preview surface end-to-end (plan 03 task 3.5, issue #43)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  const PREVIEW_LINK_MD = "See [the site](https://example.com) now";

  afterEach(() => {
    const current = root;
    if (current) {
      act(() => current.unmount());
      root = null;
    }
    document.body.innerHTML = "";
  });

  function menuItemButton(label: string): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(
      `.quillmd-context-item[aria-label="${label}"]`,
    );
    if (!button) throw new Error(`menu item not found: ${label}`);
    return button;
  }

  // Renders the preview with the given link-menu handlers and right-clicks
  // the rendered anchor, opening the preview context menu on it.
  async function openLinkMenu(
    onEditLink: (href: string, text: string) => void,
    onRemoveLink: (href: string, text: string) => void,
  ): Promise<void> {
    container = document.createElement("div");
    document.body.appendChild(container);
    const r = createRoot(container);
    root = r;
    await act(async () => {
      r.render(<PreviewView value={PREVIEW_LINK_MD} onEditLink={onEditLink} onRemoveLink={onRemoveLink} />);
    });
    const anchor = container.querySelector("a[href]");
    if (!anchor) throw new Error("no rendered anchor");
    await act(async () => {
      anchor.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    expect(document.querySelector(".quillmd-context-menu")).not.toBeNull();
  }

  // Roving focus lands on the first enabled item (Copy), so End jumps to
  // the last item (Open in WYSIWYG) and one ArrowUp reaches Link.
  async function focusLinkItem(menu: Element): Promise<void> {
    const key = (k: string) =>
      menu.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
      );
    await act(async () => {
      key("End");
    });
    await act(async () => {
      key("ArrowUp");
    });
  }

  it("right-click on a link offers the full link submenu (Open / Edit / Copy address / Remove)", async () => {
    await openLinkMenu(vi.fn(), vi.fn());
    const menu = document.querySelector(".quillmd-context-menu")!;
    await focusLinkItem(menu);
    await act(async () => {
      menu.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    expect(menuItemButton("Open link")).not.toBeNull();
    expect(menuItemButton("Edit link")).not.toBeNull();
    expect(menuItemButton("Copy address")).not.toBeNull();
    expect(menuItemButton("Remove link")).not.toBeNull();
  });

  it("Link > Edit link reports the anchor (href + display text) to the app", async () => {
    const onEditLink = vi.fn();
    await openLinkMenu(onEditLink, vi.fn());
    const menu = document.querySelector(".quillmd-context-menu")!;
    const key = (k: string) =>
      menu.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
      );
    await focusLinkItem(menu);
    await act(async () => {
      key("ArrowRight");
    });
    // Focus lands on Open link; one ArrowDown reaches Edit link.
    await act(async () => {
      key("ArrowDown");
    });
    await act(async () => {
      key("Enter");
    });
    expect(onEditLink).toHaveBeenCalledTimes(1);
    expect(onEditLink).toHaveBeenCalledWith("https://example.com", "the site");
    // The pick closed the menu.
    expect(document.querySelector(".quillmd-context-menu")).toBeNull();
  });

  it("Link > Remove link reports the anchor (href + display text) to the app", async () => {
    const onRemoveLink = vi.fn();
    await openLinkMenu(vi.fn(), onRemoveLink);
    const menu = document.querySelector(".quillmd-context-menu")!;
    const key = (k: string) =>
      menu.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
      );
    await focusLinkItem(menu);
    await act(async () => {
      key("ArrowRight");
    });
    // Focus lands on Open link; three ArrowDowns reach Remove link. Each
    // keypress is its own act — a batch of synthetic keydowns in one act
    // would all read the same render's focus state.
    await act(async () => {
      key("ArrowDown");
    });
    await act(async () => {
      key("ArrowDown");
    });
    await act(async () => {
      key("ArrowDown");
    });
    await act(async () => {
      key("Enter");
    });
    expect(onRemoveLink).toHaveBeenCalledTimes(1);
    expect(onRemoveLink).toHaveBeenCalledWith("https://example.com", "the site");
    expect(document.querySelector(".quillmd-context-menu")).toBeNull();
  });
});
