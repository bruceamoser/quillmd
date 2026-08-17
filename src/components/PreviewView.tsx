import { useMemo } from "react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

function markdownToHtml(markdown: string): string {
  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeStringify)
    .processSync(markdown);
  return String(file);
}

interface PreviewViewProps {
  value: string;
}

export default function PreviewView({ value }: PreviewViewProps) {
  const html = useMemo(() => markdownToHtml(value), [value]);
  return (
    <div className="quillmd-preview">
      <article
        className="quillmd-preview-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
