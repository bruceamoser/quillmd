import CodeMirror from "@uiw/react-codemirror";
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
}

export default function SourceView({ value, onChange, readOnly = false }: SourceViewProps) {
  return (
    <div className="quillmd-source">
      <CodeMirror
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        height="100%"
        theme="light"
        extensions={[markdown({ codeLanguages })]}
      />
    </div>
  );
}
