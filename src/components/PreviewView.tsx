import { useMemo } from "react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { middleClickLinkHref, openLinkUrl } from "../lib/links";

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
        // Middle-click on a link (plan 08 task 8.5, issue #80, AC7): open it
        // through plugin-opener (system browser for http/https, OS handler
        // for file://) instead of the webview's default navigation.
        onAuxClick={(event) => {
          const href = middleClickLinkHref(event, event.currentTarget);
          if (href === null) return;
          event.preventDefault();
          void openLinkUrl(href);
        }}
      />
    </div>
  );
}
