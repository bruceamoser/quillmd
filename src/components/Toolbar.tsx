import { useEffect, useRef, useState } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor as CoreEditor } from "@tiptap/core";
import ColorPalette from "./ColorPalette";
import StyleGallery from "./StyleGallery";
import {
  EDITOR_COMMANDS,
  FONT_FAMILY_CUSTOM,
  FONT_FAMILIES,
  FONT_SIZES,
  editorCommandActive,
  fontFamilyOf,
  fontColorOf,
  fontSizeOf,
  highlightColorOf,
  registerTablePickerListener,
  runEditorCommand,
} from "../lib/editorCommands";
import type { EditorCommandId } from "../lib/editorCommands";
import type { TableInsertSpec } from "../lib/tables";
import TableSizePicker from "./TableSizePicker";

interface ToolbarProps {
  editor: CoreEditor | null;
}

// Inline marks rendered as toggle buttons, in display order. Highlight is no
// longer a plain toggle button: the toolbar exposes it through the shared
// color palette (plan 04 task 4.2, issue #48); the colorless ==text==
// highlight stays reachable from the Format menu ("highlight" command).
const INLINE_CMDS: EditorCommandId[] = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "subscript",
  "superscript",
];

// Block and insert commands rendered after the inline group.
const BLOCK_CMDS: EditorCommandId[] = [
  "link",
  "image",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "table",
  "codeBlock",
  "hr",
  "footnote",
];

// Block alignment group (plan 02 task 2.3).
const ALIGN_CMDS: EditorCommandId[] = ["alignLeft", "alignCenter", "alignRight"];

// Indent/outdent group (plan 02 task 2.4): list nesting and quote levels.
const INDENT_CMDS: EditorCommandId[] = ["indent", "outdent"];

const CMD = new Map(EDITOR_COMMANDS.map((c) => [c.id, c]));

// Compact glyph per command; the full label + shortcut live in the title.
const GLYPHS: Partial<Record<EditorCommandId, string>> = {
  bold: "B",
  italic: "I",
  underline: "U",
  strike: "S",
  code: "</>",
  subscript: "x\u2082",
  superscript: "x\u00B2",
  link: "Link",
  image: "Img",
  blockquote: "\u201D",
  bulletList: "\u2022 List",
  orderedList: "1. List",
  taskList: "\u2610 List",
  table: "Table",
  codeBlock: "{ }",
  hr: "\u2014",
  footnote: "[^1]",
  alignLeft: "L",
  alignCenter: "C",
  alignRight: "R",
  // Table editing commands (plan 06 task 6.2, issue #62): rendered by the
  // floating table toolbar (task 6.4, issue #64). The cell-alignment glyphs
  // mirror the block-alignment group — same meaning, table context.
  rowInsertAbove: "Row \u2191",
  rowInsertBelow: "Row \u2193",
  rowDelete: "Row \u2715",
  colInsertLeft: "Col \u2190",
  colInsertRight: "Col \u2192",
  colDelete: "Col \u2715",
  cellAlignLeft: "L",
  cellAlignCenter: "C",
  cellAlignRight: "R",
  headerRowToggle: "Hdr",
  cellMerge: "Merge",
  cellClear: "Clear",
  tableDelete: "\u2715 Table",
  indent: "\u21E5",
  outdent: "\u21E4",
};

function title(cmdId: EditorCommandId): string {
  const cmd = CMD.get(cmdId);
  if (!cmd) return "";
  return cmd.shortcut ? `${cmd.label} (${cmd.shortcut})` : cmd.label;
}

// The shared toolbar button renderer (plan 06 task 6.4, issue #64): the
// registry-driven button the main toolbar and the floating table toolbar
// both render — glyph, title (label + shortcut), and the active state all
// come from the command registry, so every surface shows the same control
// for the same command and dispatches the same command. With keepSelection
// (the floating table toolbar) the mousedown is swallowed so the editor
// keeps its selection — a CellSelection included — while the click runs the
// command.
export function ToolbarButton({
  editor,
  id,
  keepSelection = false,
  disabled = false,
}: {
  editor: CoreEditor;
  id: EditorCommandId;
  keepSelection?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title(id)}
      className={editorCommandActive(editor, id) ? "quillmd-toolbar-active" : ""}
      disabled={disabled}
      onMouseDown={keepSelection ? (e) => e.preventDefault() : undefined}
      onClick={() => runEditorCommand(editor, id)}
    >
      {GLYPHS[id] ?? id}
    </button>
  );
}

export default function Toolbar({ editor }: ToolbarProps) {
  // Re-render on every editor transaction so active states and the heading
  // indicator track the selection.
  useEditorState({
    editor,
    selector: ({ transactionNumber }) => transactionNumber,
  });

  // Image split button (plan 08 task 8.2, issue #77): the main button keeps
  // the "From URL" default, the caret opens the From file / From URL menu.
  const [imageMenuOpen, setImageMenuOpen] = useState(false);
  const imageSplitRef = useRef<HTMLSpanElement>(null);

  // Table split button (plan 06 task 6.3, issue #63): the main button opens
  // the 10×10 size-picker popover, the caret opens the "Insert table…" menu.
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const tableSplitRef = useRef<HTMLSpanElement>(null);

  // The "table" registry command (slash menu /table, the Table button)
  // requests the size picker; this listener is the single renderer (the
  // toolbar that owns the button), the same shape as the link/image dialog
  // commands. Insert > Table dispatches the tableDialog command instead,
  // since a native menu item cannot anchor the hover popover.
  useEffect(() => {
    if (!editor) return;
    return registerTablePickerListener(() => {
      setTableMenuOpen(false);
      setTablePickerOpen(true);
    });
  }, [editor]);

  // Close the open dropdown / picker on an outside click or an Escape press.
  useEffect(() => {
    if (!imageMenuOpen && !tableMenuOpen && !tablePickerOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!imageSplitRef.current?.contains(e.target as Node)) setImageMenuOpen(false);
      if (!tableSplitRef.current?.contains(e.target as Node)) {
        setTableMenuOpen(false);
        setTablePickerOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setImageMenuOpen(false);
      setTableMenuOpen(false);
      setTablePickerOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [imageMenuOpen, tableMenuOpen, tablePickerOpen]);

  if (!editor) return null;

  const heading = (["h1", "h2", "h3", "h4", "h5", "h6"] as EditorCommandId[]).find((id) =>
    editorCommandActive(editor, id),
  );

  // The shared renderer (ToolbarButton) — the same control the floating
  // table toolbar (plan 06 task 6.4, issue #64) uses.
  const renderButton = (id: EditorCommandId) => (
    <ToolbarButton key={id} editor={editor} id={id} />
  );

  // Font cluster (plan 04 task 4.3, issue #49): the family and size selects
  // read the attribute at the selection (or "" for "Normal") and dispatch
  // the fontFamily / fontSize registry commands. A value that is not in the
  // curated list (a custom family, an off-list size loaded from a doc) is
  // added as a dynamic option so the controlled select always shows it.
  const family = fontFamilyOf(editor) ?? "";
  const familyOptions =
    family !== "" && !FONT_FAMILIES.includes(family)
      ? [...FONT_FAMILIES, family]
      : [...FONT_FAMILIES];
  const size = fontSizeOf(editor) ?? "";
  const sizeValues = FONT_SIZES.map((n) => `${n}pt`);
  const sizeOptions = size !== "" && !sizeValues.includes(size) ? [...sizeValues, size] : sizeValues;

  const renderFontSelects = () => (
    <>
      <select
        className="quillmd-font-select"
        title="Font family"
        value={family}
        onChange={(e) => {
          const value = e.target.value;
          if (value === "") {
            // "Normal" clears the attribute back to the document default.
            runEditorCommand(editor, "fontFamily", null);
          } else if (value === FONT_FAMILY_CUSTOM) {
            const name = window.prompt("Custom font family") ?? "";
            if (name.trim() !== "") runEditorCommand(editor, "fontFamily", name);
          } else {
            runEditorCommand(editor, "fontFamily", value);
          }
        }}
      >
        <option value="">Normal (document default)</option>
        {familyOptions.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
        <option value={FONT_FAMILY_CUSTOM}>Custom…</option>
      </select>
      <select
        className="quillmd-font-select"
        title="Font size"
        value={size}
        onChange={(e) => {
          const value = e.target.value;
          runEditorCommand(editor, "fontSize", value === "" ? null : value);
        }}
      >
        <option value="">Normal</option>
        {sizeOptions.map((s) => (
          <option key={s} value={s}>
            {s.replace("pt", "")}
          </option>
        ))}
      </select>
    </>
  );

  // The image split button (plan 08 task 8.2, issue #77): the main half runs
  // the "From URL" default, the caret half opens the From file / From URL
  // dropdown — the same two flows as the Insert > Image submenu.
  const renderImageSplit = () => (
    <span key="image" className="quillmd-toolbar-split" ref={imageSplitRef}>
      <button
        type="button"
        title={title("image")}
        onClick={() => {
          setImageMenuOpen(false);
          runEditorCommand(editor, "image");
        }}
      >
        {GLYPHS.image}
      </button>
      <button
        type="button"
        title="Image options"
        aria-haspopup="menu"
        aria-expanded={imageMenuOpen}
        className={imageMenuOpen ? "quillmd-toolbar-active" : ""}
        onClick={() => setImageMenuOpen((open) => !open)}
      >
        {"\u25BE"}
      </button>
      {imageMenuOpen && (
        <span className="quillmd-toolbar-dropdown" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setImageMenuOpen(false);
              runEditorCommand(editor, "imageFromFile");
            }}
          >
            From file…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setImageMenuOpen(false);
              runEditorCommand(editor, "image");
            }}
          >
            From URL…
          </button>
        </span>
      )}
    </span>
  );

  // The table split button (plan 06 task 6.3, issue #63): the main half opens
  // the 10×10 size-picker popover (the pick dispatches the tableInsert
  // command with the hovered size), the caret half opens the "Insert table…"
  // dialog menu (precise sizes / header choice).
  const renderTableSplit = () => {
    const handlePick = (spec: TableInsertSpec) => {
      setTablePickerOpen(false);
      runEditorCommand(editor, "tableInsert", spec);
    };
    return (
      <span key="table" className="quillmd-toolbar-split" ref={tableSplitRef}>
        <button
          type="button"
          title={title("table")}
          aria-haspopup="grid"
          aria-expanded={tablePickerOpen}
          className={tablePickerOpen ? "quillmd-toolbar-active" : ""}
          onClick={() => {
            setTableMenuOpen(false);
            if (tablePickerOpen) {
              setTablePickerOpen(false);
            } else {
              runEditorCommand(editor, "table");
            }
          }}
        >
          {GLYPHS.table}
        </button>
        <button
          type="button"
          title="Table options"
          aria-haspopup="menu"
          aria-expanded={tableMenuOpen}
          className={tableMenuOpen ? "quillmd-toolbar-active" : ""}
          onClick={() => {
            setTablePickerOpen(false);
            setTableMenuOpen((open) => !open);
          }}
        >
          {"\u25BE"}
        </button>
        {tableMenuOpen && (
          <span className="quillmd-toolbar-dropdown" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setTableMenuOpen(false);
                runEditorCommand(editor, "tableDialog");
              }}
            >
              Insert table…
            </button>
          </span>
        )}
        {tablePickerOpen && (
          <span className="quillmd-toolbar-picker-anchor">
            <TableSizePicker onPick={handlePick} />
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="quillmd-toolbar">
      {/* Style gallery (plan 05 task 5.2, issue #55): the Word-style
          dropdown over the built-in style registry. Picking a style runs its
          registry command — the same path the Format > Styles menu and the
          keyboard shortcuts dispatch. */}
      <StyleGallery editor={editor} />
      <span className="quillmd-toolbar-sep" />
      <select
        className="quillmd-heading-select"
        title="Paragraph / heading level"
        value={heading ?? "paragraph"}
        onChange={(e) => {
          const value = e.target.value;
          if (value === "paragraph") {
            editor.chain().focus().setParagraph().run();
          } else {
            runEditorCommand(editor, value as EditorCommandId);
          }
        }}
      >
        <option value="paragraph">Paragraph</option>
        {(["h1", "h2", "h3", "h4", "h5", "h6"] as EditorCommandId[]).map((id) => (
          <option key={id} value={id}>
            {CMD.get(id)?.label ?? id}
          </option>
        ))}
      </select>

      <span className="quillmd-toolbar-sep" />
      {renderFontSelects()}

      <span className="quillmd-toolbar-sep" />
      {INLINE_CMDS.map(renderButton)}

      <span className="quillmd-toolbar-sep" />
      {/* Font + highlight color pickers (plan 04 task 4.2, issue #48): both
          render the shared ColorPalette (the colors.ts swatches); each
          dispatches its registry command with the picked color — a hex
          string, or null for "Auto". */}
      <ColorPalette
        title="Font color"
        trigger="A"
        current={fontColorOf(editor)}
        onPick={(color) => runEditorCommand(editor, "fontColor", color)}
      />
      <ColorPalette
        title="Highlight color"
        trigger={"\u270E"}
        current={highlightColorOf(editor)}
        onPick={(color) => runEditorCommand(editor, "highlightColor", color)}
      />

      <span className="quillmd-toolbar-sep" />
      {BLOCK_CMDS.map((id) =>
        id === "image" ? renderImageSplit() : id === "table" ? renderTableSplit() : renderButton(id),
      )}

      <span className="quillmd-toolbar-sep" />
      {ALIGN_CMDS.map(renderButton)}

      <span className="quillmd-toolbar-sep" />
      {INDENT_CMDS.map(renderButton)}

      <span className="quillmd-toolbar-sep" />
      <button
        type="button"
        title="Undo (Ctrl+Z)"
        disabled={!editor.can().undo()}
        onClick={() => runEditorCommand(editor, "undo")}
      >
        Undo
      </button>
      <button
        type="button"
        title="Redo (Ctrl+Shift+Z)"
        disabled={!editor.can().redo()}
        onClick={() => runEditorCommand(editor, "redo")}
      >
        Redo
      </button>
    </div>
  );
}
