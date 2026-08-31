// Mermaid CodeMirror highlight (plan 11 task 11.4, issue #103): lightweight
// syntax coloring for ```mermaid fences in the source view. A stream
// language carrying the plan's keyword set (graph/flowchart/
// sequenceDiagram/classDiagram/erDiagram/stateDiagram/gantt/pie/gitgraph/
// timeline) plus %% line comments — a small highlight definition, no full
// mermaid grammar. Pure view concern: the fence text in the document is the
// source of truth (golden rule 1) and the highlight never writes back.

import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StringStream,
} from "@codemirror/language";

// The diagram-type keywords (plan 11 §2 item 5). Matched case-insensitively
// on a word boundary: `graphX` is a node id, not a keyword, and a user who
// capitalizes the type still gets the coloring.
const KEYWORDS =
  /^(graph|flowchart|sequencediagram|classdiagram|erdiagram|statediagram|gantt|pie|gitgraph|timeline)\b/i;

export const mermaidStreamLanguage = StreamLanguage.define({
  name: "mermaid",
  token(stream: StringStream): string | null {
    // %% comments run to the end of the line.
    if (stream.match("%%")) {
      stream.skipToEnd();
      return "lineComment";
    }
    if (stream.match(KEYWORDS)) {
      return "keyword";
    }
    // Untagged text: whitespace in one go, anything else one character at a
    // time. The stream parser re-invokes the function until the stream
    // advances; a null return means "no tag" for the advanced range.
    if (stream.eatSpace()) return null;
    stream.next();
    return null;
  },
});

// The fence info string ```mermaid resolves to this description in
// @codemirror/lang-markdown's codeLanguages lookup (name match, case-
// insensitive), so the stream parser colors the fence body in place.
export const mermaidCodeLanguage: LanguageDescription = LanguageDescription.of({
  name: "mermaid",
  support: new LanguageSupport(mermaidStreamLanguage),
});
