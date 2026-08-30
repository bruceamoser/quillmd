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
  const extensions = wrap
    ? [markdown({ codeLanguages }), EditorView.lineWrapping]
    : [markdown({ codeLanguages })];
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
