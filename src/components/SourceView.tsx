import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { LanguageDescription } from "@codemirror/language";

const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({ name: "html", support: html(), load: async () => html() }),
  LanguageDescription.of({ name: "javascript", support: javascript(), load: async () => javascript() }),
  LanguageDescription.of({ name: "css", support: css(), load: async () => css() }),
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
  const base = [markdown({ codeLanguages }), EditorView.contentAttributes.of({ spellcheck: "false" })];
  const extensions = wrap ? [...base, EditorView.lineWrapping] : base;
  return (
    <div className="quillmd-source">
      <CodeMirror
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        height="100%"
        theme="dark"
        extensions={extensions}
      />
    </div>
  );
}
