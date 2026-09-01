// @vitest-environment jsdom
// The image's right-click context menu (plan 03 task 3.4, issue #42; plan 03
// §2 item 3): right-clicking an image node shows the image menu instead of
// the text menu — edit image (URL dialog), change alt text, replace image
// (file picker), remove image. Every item dispatches its registry command
// through the shared registry (plan 03 AC1: 1:1 command mapping), "Remove
// image" is gated on the native confirm dialog (plan 03 §3), and the delete
// is a plain undoable ProseMirror delete that re-serializes the saved text
// as a converter fixed point (plan 03 AC3: Remove deletes the node,
// undoable via Ctrl+Z).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import type { Editor as CoreEditor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import QuillEditor, { ImageWithWidth } from "../../components/Editor";
import { isSeparator, type ContextMenuItem } from "../../components/ContextMenu";
import {
  EDITOR_COMMANDS,
  inImage,
  registerImageAltDialogListener,
  registerImageEditDialogListener,
  registerImageReplaceListener,
  requestImageAltDialog,
  requestImageReplace,
  runEditorCommand,
} from "../editorCommands";
import {
  buildImageMenu,
  IMAGE_MENU_ITEM_IDS,
  toImageContextEntries,
  type ImageMenuItem,
} from "../imageMenu";
import { markdownToTiptap, tiptapToMarkdown } from "../pm";
import { currentFindEditor } from "../find";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// The app's image extension (inline, width-carrying) so the schema and
// selection handling behave exactly as in the real editor (Editor.tsx).
function makeEditor(markdown = "![Alt](a.png)"): Editor {
  return new Editor({
    extensions: [StarterKit, ImageWithWidth.configure({ inline: true })],
    content: markdownToTiptap(markdown),
  });
}

function md(editor: Editor): string {
  return tiptapToMarkdown(editor.getJSON());
}

// The doc position of the (first) image node.
function imagePos(editor: CoreEditor): number {
  let pos: number | null = null;
  editor.state.doc.descendants((node, p) => {
    if (node.type.name === "image" && pos === null) pos = p;
    return pos === null;
  });
  if (pos === null) throw new Error("no image node in doc");
  return pos;
}

// The image menu acts on the selected node (plan 03 §3: "selection node is
// image") — put a NodeSelection over the image.
function selectImage(editor: CoreEditor): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos(editor))),
  );
}

// A caret inside the image's paragraph but not on the image node itself.
function selectText(editor: CoreEditor): void {
  editor.state.doc.descendants((node, pos) => {
    if (node.isText) {
      editor.chain().setTextSelection(pos + 1).run();
      return false;
    }
    return true;
  });
}

let editors: Editor[] = [];
let disposers: (() => void)[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  for (const dispose of disposers) dispose();
  disposers = [];
});

function tracked(markdown?: string): Editor {
  const editor = makeEditor(markdown);
  editors.push(editor);
  return editor;
}

describe("buildImageMenu (plan 03 §2 item 3)", () => {
  it("carries the plan 03 image item set in display order, with the plan's labels", () => {
    const editor = tracked();
    selectImage(editor);
    const items = buildImageMenu(editor);
    expect(items.map((i) => i.id)).toEqual([...IMAGE_MENU_ITEM_IDS]);
    expect(items.map((i) => i.label)).toEqual([
      "Edit image",
      "Change alt text",
      "Replace image",
      "Remove image",
    ]);
  });

  it("wires every item 1:1 to a registered command (plan 03 AC1)", () => {
    const editor = tracked();
    selectImage(editor);
    const commands = new Set(EDITOR_COMMANDS.map((c) => c.id));
    const items = buildImageMenu(editor);
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(commands.has(item.command), `unknown command ${item.command}`).toBe(true);
    }
    // The edit item reuses the plan 08 task 8.4 command (the image click and
    // the URL dialog flow); the rest are the image menu's own commands.
    expect(items.map((i) => i.command)).toEqual([
      "imageEdit",
      "imageAlt",
      "imageReplace",
      "imageDelete",
    ]);
  });

  it("enables every item for a NodeSelection on an image and marks remove as destructive", () => {
    const editor = tracked();
    selectImage(editor);
    const items = buildImageMenu(editor);
    expect(items.every((i) => i.enabled === true)).toBe(true);
    expect(items.filter((i) => i.danger === true).map((i) => i.id)).toEqual([
      "image-delete",
    ]);
  });

  it("disables every item for a selection that is not an image node", () => {
    const editor = tracked("Text before ![Alt](a.png) text after");
    selectText(editor);
    // A caret beside the image (its paragraph) is not the node itself.
    expect(inImage(editor)).toBe(false);
    expect(
      buildImageMenu(editor).every((i) => i.enabled === false),
    ).toBe(true);

    const editor2 = tracked("![Alt](a.png)\n\n---");
    // A NodeSelection on another node (the horizontal rule) is not an image.
    let hrPos: number | null = null;
    editor2.state.doc.descendants((node, p) => {
      if (node.type.name === "horizontalRule" && hrPos === null) hrPos = p;
      return hrPos === null;
    });
    editor2.view.dispatch(
      editor2.state.tr.setSelection(
        NodeSelection.create(editor2.state.doc, hrPos!),
      ),
    );
    editors.push(editor2);
    expect(inImage(editor2)).toBe(false);
    expect(buildImageMenu(editor2).every((i) => i.enabled === false)).toBe(true);
  });
});

describe("toImageContextEntries (the ContextMenu mapping)", () => {
  it("wires each item's onSelect to the dispatch and carries the item state", () => {
    const editor = tracked();
    selectImage(editor);
    const dispatched: ImageMenuItem[] = [];
    const mapped = toImageContextEntries(buildImageMenu(editor), (item) => {
      dispatched.push(item);
    });
    expect(mapped).toHaveLength(4);
    const remove = mapped.find((e) => !isSeparator(e) && e.id === "image-delete") as
      | ContextMenuItem
      | undefined;
    expect(remove?.label).toBe("Remove image");
    expect(remove?.danger).toBe(true);
    expect(typeof remove?.onSelect).toBe("function");
    remove!.onSelect!();
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].command).toBe("imageDelete");
  });
});

describe("imageAlt / imageReplace registry wiring (issue #42)", () => {
  it("imageAlt requests the alt-focused edit dialog for the live editor", () => {
    const editor = tracked();
    selectImage(editor);
    const seen: CoreEditor[] = [];
    disposers.push(registerImageAltDialogListener((e) => seen.push(e)));

    expect(runEditorCommand(editor, "imageAlt")).toBe(true);
    expect(seen).toEqual([editor]);
    // The command itself edits nothing; the dialog's result does.
    expect(md(editor)).toBe("![Alt](a.png)\n");
  });

  it("imageReplace requests the replace flow for the live editor", () => {
    const editor = tracked();
    selectImage(editor);
    const seen: CoreEditor[] = [];
    disposers.push(registerImageReplaceListener((e) => seen.push(e)));

    expect(runEditorCommand(editor, "imageReplace")).toBe(true);
    expect(seen).toEqual([editor]);
    // The command itself edits nothing; the picked file's src does.
    expect(md(editor)).toBe("![Alt](a.png)\n");
  });

  it("both are no-ops without a renderer", () => {
    const editor = tracked();
    selectImage(editor);
    expect(requestImageAltDialog(editor)).toBe(false);
    expect(requestImageReplace(editor)).toBe(false);
    expect(md(editor)).toBe("![Alt](a.png)\n");
  });

  it("the registry carries the new image entries with unique ids", () => {
    const ids = EDITOR_COMMANDS.map((c) => c.id);
    expect(ids).toContain("imageAlt");
    expect(ids).toContain("imageReplace");
    expect(ids).toContain("imageDelete");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("imageDelete (plan 03 AC3)", () => {
  it("deletes the node, keeps the surrounding text, and stays a fixed point", () => {
    const editor = tracked("Before ![Alt](a.png) After");
    selectImage(editor);
    expect(runEditorCommand(editor, "imageDelete")).toBe(true);
    const out = md(editor);
    expect(out).not.toContain("a.png");
    expect(out).toContain("Before");
    expect(out).toContain("After");
    // The saved shape is a converter fixed point (save -> reopen -> save).
    expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
  });

  it("undo (Ctrl+Z) restores the image exactly (plan 03 AC3)", () => {
    const editor = tracked("Before\n\n![Alt](a.png)\n\nAfter");
    selectImage(editor);
    expect(runEditorCommand(editor, "imageDelete")).toBe(true);
    expect(md(editor)).not.toContain("a.png");
    editor.commands.undo();
    // The serializer (remark) terminates the document with a newline.
    expect(md(editor)).toBe("Before\n\n![Alt](a.png)\n\nAfter\n");
  });

  it("deleting the only content leaves a valid document", () => {
    const editor = tracked("![Alt](a.png)");
    selectImage(editor);
    expect(runEditorCommand(editor, "imageDelete")).toBe(true);
    const doc = editor.state.doc;
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild!.type.name).toBe("paragraph");
  });

  it("is a no-op when the selection is not an image node", () => {
    const editor = tracked("![Alt](a.png)");
    selectText(editor);
    const before = editor.getJSON();
    expect(runEditorCommand(editor, "imageDelete")).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });
});

describe("WYSIWYG surface end-to-end (plan 03 AC3)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  afterEach(() => {
    const current = root;
    if (current) {
      act(() => current.unmount());
      root = null;
    }
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function menuItemButton(label: string): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(
      `.quillmd-context-item[aria-label="${label}"]`,
    );
    if (!button) throw new Error(`menu item not found: ${label}`);
    return button;
  }

  async function renderImageDoc(markdown: string): Promise<CoreEditor> {
    container = document.createElement("div");
    document.body.appendChild(container);
    const r = createRoot(container);
    root = r;
    await act(async () => {
      r.render(<QuillEditor value={markdown} onChange={() => {}} />);
    });
    const editor = currentFindEditor();
    if (!editor) throw new Error("no live editor");
    return editor;
  }

  function openImageMenu(editor: CoreEditor): void {
    editor.view.dom.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 80,
      }),
    );
  }

  it("right-clicking a selected image shows the image menu, not the text menu", async () => {
    const editor = await renderImageDoc("![Alt](a.png)");
    await act(async () => {
      selectImage(editor);
      openImageMenu(editor);
    });
    const menu = document.querySelector(".quillmd-context-menu");
    expect(menu).not.toBeNull();
    // The plan 03 §2 item 3 set is present...
    for (const label of ["Edit image", "Change alt text", "Replace image", "Remove image"]) {
      expect(menuItemButton(label), label).not.toBeNull();
    }
    // ...and the text menu's items are not.
    const menuText = menu!.textContent ?? "";
    expect(menuText).not.toContain("Cut");
    expect(menuText).not.toContain("Format");
    expect(menuText).not.toContain("Emoji");
  });

  it("an image node inside a table cell still gets the image menu", async () => {
    const editor = await renderImageDoc("| h |\n|---|\n| ![](a.png) |");
    await act(async () => {
      selectImage(editor);
      openImageMenu(editor);
    });
    const menu = document.querySelector(".quillmd-context-menu");
    expect(menu).not.toBeNull();
    // The image menu wins over the table menu for an image node selection...
    expect(menuItemButton("Remove image")).not.toBeNull();
    // ...and the table menu's items are not present.
    expect(
      document.querySelector('.quillmd-context-item[aria-label="Delete table"]'),
    ).toBeNull();
  });

  it("right-click with a text caret still shows the text menu", async () => {
    const editor = await renderImageDoc("Text before ![Alt](a.png) text");
    await act(async () => {
      selectText(editor);
      openImageMenu(editor);
    });
    const menu = document.querySelector(".quillmd-context-menu");
    expect(menu).not.toBeNull();
    expect(
      document.querySelector('.quillmd-context-item[aria-label="Remove image"]'),
    ).toBeNull();
    expect(menuItemButton("Format")).not.toBeNull();
  });

  it("Edit image dispatches the imageEdit command (the URL dialog request)", async () => {
    const editor = await renderImageDoc("![Alt](a.png)");
    const seen: CoreEditor[] = [];
    const dispose = registerImageEditDialogListener((e) => seen.push(e));
    disposers.push(dispose);
    await act(async () => {
      selectImage(editor);
      openImageMenu(editor);
    });
    await act(async () => {
      menuItemButton("Edit image").click();
    });
    // The pick ran the command and closed the menu.
    expect(document.querySelector(".quillmd-context-menu")).toBeNull();
    expect(seen).toEqual([editor]);
  });

  it("Change alt text dispatches the imageAlt command (the alt-focused dialog)", async () => {
    const editor = await renderImageDoc("![Alt](a.png)");
    const seen: CoreEditor[] = [];
    const dispose = registerImageAltDialogListener((e) => seen.push(e));
    disposers.push(dispose);
    await act(async () => {
      selectImage(editor);
      openImageMenu(editor);
    });
    await act(async () => {
      menuItemButton("Change alt text").click();
    });
    expect(document.querySelector(".quillmd-context-menu")).toBeNull();
    expect(seen).toEqual([editor]);
  });

  it("Replace image dispatches the imageReplace command (the file picker request)", async () => {
    const editor = await renderImageDoc("![Alt](a.png)");
    const seen: CoreEditor[] = [];
    const dispose = registerImageReplaceListener((e) => seen.push(e));
    disposers.push(dispose);
    await act(async () => {
      selectImage(editor);
      openImageMenu(editor);
    });
    await act(async () => {
      menuItemButton("Replace image").click();
    });
    expect(document.querySelector(".quillmd-context-menu")).toBeNull();
    expect(seen).toEqual([editor]);
  });

  it("remove image requires the native confirm and deletes the node (undoable)", async () => {
    const editor = await renderImageDoc("Before\n\n![Alt](a.png)\n\nAfter");
    await act(async () => {
      selectImage(editor);
      openImageMenu(editor);
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      menuItemButton("Remove image").click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(confirmSpy).toHaveBeenCalledWith("Remove this image?");
    // The menu closed on the pick...
    expect(document.querySelector(".quillmd-context-menu")).toBeNull();
    // ...and the confirmed delete removed the image, keeping the text.
    const out = tiptapToMarkdown(editor.getJSON());
    expect(out).not.toContain("a.png");
    expect(out).toContain("Before");
    expect(out).toContain("After");
    // The delete is undoable (plan 03 AC3).
    await act(async () => {
      editor.commands.undo();
    });
    expect(tiptapToMarkdown(editor.getJSON())).toBe("Before\n\n![Alt](a.png)\n\nAfter\n");
  });

  it("declining the confirm leaves the image in place", async () => {
    const editor = await renderImageDoc("![Alt](a.png)");
    await act(async () => {
      selectImage(editor);
      openImageMenu(editor);
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => {
      menuItemButton("Remove image").click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(confirmSpy).toHaveBeenCalledWith("Remove this image?");
    const out = tiptapToMarkdown(editor.getJSON());
    expect(out).toBe("![Alt](a.png)\n");
    // The document is still a converter fixed point.
    expect(tiptapToMarkdown(markdownToTiptap(out))).toBe(out);
  });
});
