import { useEffect, useRef } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { LanguageDescription } from "@codemirror/language";
import { registerSourceFindView, sourceFindExtensions } from "../lib/sourceFind";
import { mermaidCodeLanguage } from "../lib/mermaidHighlight";

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
}

export default function SourceView({
  value,
  onChange,
  readOnly = false,
  wrap = true,
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

  return (
    <div className="quillmd-source">
      <CodeMirror
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        height="100%"
        theme="dark"
        basicSetup={{ searchKeymap: false }}
        onCreateEditor={(view) => {
          viewRef.current = view;
        }}
        extensions={extensions}
      />
    </div>
  );
}
