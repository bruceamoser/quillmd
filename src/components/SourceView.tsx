import { useEffect, useRef, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { LanguageDescription } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { registerSourceFindView, sourceFindExtensions } from "../lib/sourceFind";
import { mermaidCodeLanguage } from "../lib/mermaidHighlight";
import ContextMenu from "./ContextMenu";
import { buildSourceMenu, toContextEntries } from "../lib/textMenu";
import type { TextMenuItem, TextMenuEntry } from "../lib/textMenu";
import { readClipboardText } from "../lib/clipboard";

const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({ name: "html", support: html(), load: async () => html() }),
  LanguageDescription.of({ name: "javascript", support: javascript(), load: async () => javascript() }),
  LanguageDescription.of({ name: "css", support: css(), load: async () => css() }),
  // Mermaid (plan 11 task 11.4, issue #103): lightweight keyword highlight
  // for ```mermaid fences — the fence body is colored in place.
  mermaidCodeLanguage,
];

interface SourceViewProps {
  value: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
  // Word wrap (plan 02 task 2.5): on by default (lineWrapping extension); off
  // keeps CodeMirror's default horizontal scroll for long lines.
  wrap?: boolean;
  // Line-number gutter (plan 10 task 10.2, issue #94): the "show line numbers
  // in source" app setting. Off by default (the 10.1 default; the setting is
  // an opt-in), overriding CodeMirror basicSetup's own default-on gutter.
  lineNumbers?: boolean;
  // The source context menu's "Open in WYSIWYG" item (plan 03 task 3.2,
  // issue #40): switches the view mode back to the WYSIWYG editor.
  onOpenInWysiwyg?: () => void;
}

export default function SourceView({
  value,
  onChange,
  readOnly = false,
  wrap = true,
  lineNumbers = false,
  onOpenInWysiwyg,
}: SourceViewProps) {
  // CodeMirror 6 does not wrap lines by default (long lines scroll
  // horizontally). Word wrap on adds the lineWrapping extension; off keeps the
  // default horizontal scroll. The extensions prop reconfigures the live view
  // when it changes.
  //
  // Spellcheck is always off in the source view (plan 02 §2.8, issue #36):
  // it is a WYSIWYG-engine feature and the raw markdown source (including
  // syntax tokens) is not prose to spell-check. The contentAttributes facet
  // lands on the editable .cm-content element.
  //
  // Find & replace (plan 07 task 7.4, issue #72) adds CodeMirror's search
  // state and the match decorations; App applies the query and runs the
  // replace transactions through the view. CodeMirror's own search keymap is
  // off (basicSetup.searchKeymap) so F3 / Ctrl+F never open a second,
  // built-in panel — the app's find bar is the only UI in both views.
  const base = [
    markdown({ codeLanguages }),
    EditorView.contentAttributes.of({ spellcheck: "false" }),
    ...sourceFindExtensions,
  ];
  const extensions = wrap ? [...base, EditorView.lineWrapping] : base;

  // Find bridge (plan 07 task 7.4): expose the live view to the search owned
  // by App.tsx (the single-subscriber provider pattern the WYSIWYG find
  // editor bridge uses). The provider reads the ref at call time so it stays
  // valid if the view is ever re-created.
  const viewRef = useRef<EditorView | null>(null);
  useEffect(() => {
    return registerSourceFindView(() => viewRef.current);
  }, []);

  // The open source context menu (plan 03 task 3.2, issue #40): the cursor
  // position in viewport coordinates plus the item set. The source menu's
  // item set is fixed (buildSourceMenu), so it is built once per open.
  const [textMenu, setTextMenu] = useState<{
    x: number;
    y: number;
    items: readonly TextMenuEntry[];
  } | null>(null);

  // The source menu's pick handler (plan 03 §3): the clipboard items act on
  // CodeMirror's selection — the menu holds DOM focus while open (its roving
  // focus), so the clipboard actions re-focus the view first (view.focus()
  // keeps the CodeMirror selection). Paste as text inserts the clipboard as
  // plain text over the selection; Open in Wysiwyg is the mode switch.
  const dispatchTextMenu = (item: TextMenuItem): void => {
    const view = viewRef.current;
    if (item.action === "open-in-wysiwyg") {
      onOpenInWysiwyg?.();
      return;
    }
    if (!view) return;
    switch (item.action) {
      case "copy":
        view.focus();
        document.execCommand("copy");
        break;
      case "paste":
        view.focus();
        document.execCommand("paste");
        break;
      case "paste-as-text":
        void readClipboardText().then((text) => {
          if (text === null) return;
          // CodeMirror's selection is multi-range; the main range is the one
          // the caret (or the user's primary selection) sits in.
          const { from, to } = view.state.selection.main;
          view.dispatch({ changes: { from, to, insert: text } });
        });
        break;
      case "select-all":
        view.focus();
        view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) });
        break;
    }
  };

  return (
    <div
      className="quillmd-source"
      onContextMenu={(event) => {
        // Right-click (plan 03 task 3.2, issue #40): the source context
        // menu. Suppress the browser's own menu and open the shared
        // ContextMenu at the cursor.
        event.preventDefault();
        setTextMenu({ x: event.clientX, y: event.clientY, items: buildSourceMenu() });
      }}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        height="100%"
        theme="dark"
        // searchKeymap is off (the app's find bar is the only search UI);
        // lineNumbers follows the "show line numbers in source" setting
        // (plan 10 task 10.2, issue #94).
        basicSetup={{ searchKeymap: false, lineNumbers }}
        onCreateEditor={(view) => {
          viewRef.current = view;
        }}
        extensions={extensions}
      />
      {textMenu && (
        <ContextMenu
          x={textMenu.x}
          y={textMenu.y}
          items={toContextEntries(textMenu.items, dispatchTextMenu)}
          onClose={() => setTextMenu(null)}
          label="Source menu"
        />
      )}
    </div>
  );
}
