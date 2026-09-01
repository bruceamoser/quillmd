import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { middleClickLinkHref, openLinkUrl } from "../lib/links";
import { renderMermaid } from "../lib/mermaidRender";
import { PAGE_BREAK_HTML, TOC_TOKEN } from "../lib/pm";
import type { ThemeId } from "../lib/theme";
import ContextMenu from "./ContextMenu";
import { buildPreviewMenu, toContextEntries } from "../lib/textMenu";
import type { TextMenuItem, TextMenuEntry } from "../lib/textMenu";

// The TOC token (plan 09 task 9.1, issue #84) is an HTML comment, which
// remark/rehype drop from the output. To render the live TOC in the preview at
// the token's position, the comment is swapped for an empty code fence tagged
// `quillmd-toc` before parsing — the fence survives the pipeline at the same
// block position (like the mermaid fences), and a post-render DOM pass swaps
// it for the generated TOC list. The document bytes are never touched: this is
// preview-only; the on-disk token stays the comment.
//
// The page break (plan 09 task 9.7, issue #90) is a raw HTML block, which
// remark/rehype drop the same way: it is swapped for an empty
// `quillmd-page-break` fence before parsing and drawn as the visible break
// line by the post-render pass below.
function markdownToHtml(markdown: string): string {
  const withTocFence = markdown.split(TOC_TOKEN).join("```quillmd-toc\n```");
  const withPageBreakFence = withTocFence
    .split(PAGE_BREAK_HTML)
    .join("```quillmd-page-break\n```");
  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeStringify)
    .processSync(withPageBreakFence);
  return String(file);
}

// Builds the preview's TOC block (a read-only, clickable list) from the
// article's rendered H1-H4 headings. Clicking an entry scrolls the preview to
// that heading. Returns null when the article has no headings.
function buildTocBlock(article: HTMLElement): HTMLDivElement {
  const headings = Array.from(article.querySelectorAll("h1, h2, h3, h4"));
  const block = document.createElement("div");
  block.className = "quillmd-toc";
  block.setAttribute("data-quillmd-toc", "");

  const title = document.createElement("div");
  title.className = "quillmd-toc-title";
  title.textContent = "Contents";
  block.appendChild(title);

  if (headings.length === 0) {
    const empty = document.createElement("div");
    empty.className = "quillmd-toc-empty";
    empty.textContent = "No headings";
    block.appendChild(empty);
    return block;
  }

  const list = document.createElement("ol");
  list.className = "quillmd-toc-list";
  for (const heading of headings) {
    const item = document.createElement("li");
    item.className = "quillmd-toc-item";
    item.setAttribute("data-level", heading.tagName.charAt(1));
    const link = document.createElement("button");
    link.type = "button";
    link.className = "quillmd-toc-link";
    link.textContent = heading.textContent || "(untitled)";
    link.addEventListener("click", () =>
      heading.scrollIntoView({ block: "center" }),
    );
    item.appendChild(link);
    list.appendChild(item);
  }
  block.appendChild(list);
  return block;
}

// Builds the preview's page break block (plan 09 task 9.7, issue #90): the
// same visible break line the WYSIWYG NodeView (PageBreakCard) draws, so both
// surfaces show an identical artifact.
function buildPageBreakBlock(): HTMLDivElement {
  const block = document.createElement("div");
  block.className = "quillmd-page-break";
  block.setAttribute("data-quillmd-page-break", "");
  const line = document.createElement("div");
  line.className = "quillmd-page-break-line";
  const label = document.createElement("span");
  label.className = "quillmd-page-break-label";
  label.textContent = "Page break";
  line.appendChild(label);
  block.appendChild(line);
  return block;
}

interface PreviewViewProps {
  value: string;
  // The active document theme (plan 11 task 11.4, issue #103): mermaid
  // fences render with the mapped light/dark mermaid theme, the same mapping
  // the WYSIWYG card uses (plan 11 AC3 — preview re-renders on theme switch).
  theme?: ThemeId;
  // The preview context menu's "Open in WYSIWYG" item (plan 03 task 3.2,
  // issue #40): switches the view mode back to the WYSIWYG editor.
  onOpenInWysiwyg?: () => void;
  // The link menu's Edit / Remove items (plan 03 task 3.5, issue #43): the
  // preview has no editor to run the mark on, so it reports the anchor under
  // the caret (destination + display text) and the app splices the markdown
  // source — Edit reopens the link dialog with a markdown target.
  onEditLink?: (href: string, text: string) => void;
  onRemoveLink?: (href: string, text: string) => void;
}

export default function PreviewView({
  value,
  theme = "quill",
  onOpenInWysiwyg,
  onEditLink,
  onRemoveLink,
}: PreviewViewProps) {
  const html = useMemo(() => markdownToHtml(value), [value]);
  const articleRef = useRef<HTMLElement | null>(null);
  // The diagram source of every rendered holder. The holder replaces the
  // fence in the DOM, so a later pass (a theme switch on the same document)
  // needs the source back to re-render it. The map lives in a ref: it
  // survives re-renders, and its entries are collected with their holders
  // when the document HTML is replaced.
  const holderSources = useRef(new WeakMap<HTMLElement, string>());
  // Bumped on every render pass: in-flight renders from a superseded pass
  // (doc or theme changed) are dropped, so a stale SVG can never land on the
  // fresh document.
  const renderSeq = useRef(0);

  // The open preview context menu (plan 03 task 3.2, issue #40): the cursor
  // position in viewport coordinates, the item set, and the href + display
  // text of the link under the caret (null when the caret is not on a link)
  // — the dispatch reads it from the menu state, not from the live DOM.
  const [textMenu, setTextMenu] = useState<{
    x: number;
    y: number;
    items: readonly TextMenuEntry[];
    href: string | null;
    text: string | null;
  } | null>(null);

  // The preview menu's pick handler (plan 03 §3): Copy copies the rendered
  // text under the selection (the browser's own selection — the preview is
  // read-only HTML, nothing to edit); the link items act on the anchor under
  // the caret; Open in WYSIWYG is the mode switch. Edit link and Remove link
  // (plan 03 task 3.5, issue #43) report the anchor to the app, which edits
  // the markdown source (the preview itself never touches the document).
  const dispatchTextMenu = (item: TextMenuItem): void => {
    if (item.action === "open-in-wysiwyg") {
      onOpenInWysiwyg?.();
      return;
    }
    switch (item.action) {
      case "copy":
        document.execCommand("copy");
        break;
      case "open-link": {
        const href = textMenu?.href;
        if (href) void openLinkUrl(href);
        break;
      }
      case "edit-link": {
        const href = textMenu?.href;
        const text = textMenu?.text;
        if (href && typeof text === "string") onEditLink?.(href, text);
        break;
      }
      case "remove-link": {
        const href = textMenu?.href;
        const text = textMenu?.text;
        if (href && typeof text === "string") onRemoveLink?.(href, text);
        break;
      }
      case "copy-address": {
        const href = textMenu?.href;
        if (!href) return;
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          void navigator.clipboard.writeText(href);
        }
        break;
      }
    }
  };

  // The document HTML is applied by hand, and only when it changes (value).
  // dangerouslySetInnerHTML would re-apply on every re-render — including a
  // theme-only re-render — wiping the mermaid holders and forcing a full
  // re-render (a visible flicker). Applying it only on value changes lets the
  // holders persist so a theme switch re-renders them in place. A layout
  // effect (not a passive one) keeps the content present before first paint,
  // matching the original dangerouslySetInnerHTML timing.
  useLayoutEffect(() => {
    const article = articleRef.current;
    if (article) article.innerHTML = html;
  }, [html]);

  // Mermaid fences (plan 11 task 11.4, issue #103): remark/rehype emit a
  // plain <pre><code class="language-mermaid">. Once the HTML is in the DOM,
  // each fence renders through the shared render service — the same one the
  // WYSIWYG card and the PNG export use — and the fence is swapped in place
  // for the SVG (a view artifact; the document bytes are never touched). A
  // failed render leaves the fence as plain code: the source stays visible
  // and the preview never breaks. Already-rendered holders re-render on a
  // theme switch, so the preview follows the mapped light/dark theme.
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    // Bump before collecting jobs so any in-flight render from a superseded
    // pass is dropped even when this pass has nothing to do.
    const seq = ++renderSeq.current;
    const sources = holderSources.current;
    const jobs: { target: HTMLElement; source: string }[] = [];
    for (const code of Array.from(
      article.querySelectorAll<HTMLElement>("pre > code.language-mermaid"),
    )) {
      const source = code.textContent ?? "";
      jobs.push({ target: code, source });
    }
    for (const holder of Array.from(
      article.querySelectorAll<HTMLElement>(".quillmd-mermaid-preview"),
    )) {
      const source = sources.get(holder);
      if (source !== undefined) jobs.push({ target: holder, source });
    }
    if (jobs.length === 0) return;
    for (const { target, source } of jobs) {
      void renderMermaid(source, theme).then((result) => {
        if (seq !== renderSeq.current) return;
        if (result.svg === null) {
          // Error: keep the fence as plain code (the source stays visible).
          return;
        }
        if (target.classList.contains("quillmd-mermaid-preview")) {
          if (article.contains(target)) target.innerHTML = result.svg;
          return;
        }
        const pre = target.parentElement;
        if (pre?.tagName !== "PRE" || !article.contains(pre)) return;
        const holder = document.createElement("div");
        holder.className = "quillmd-mermaid-preview";
        holder.innerHTML = result.svg;
        sources.set(holder, source);
        pre.replaceWith(holder);
      });
    }
  }, [html, theme]);

  // TOC blocks (plan 09 task 9.1, issue #84): the `<!-- quillmd:toc -->` token
  // is preprocessed into an empty `quillmd-toc` code fence (markdownToHtml);
  // once the HTML is in the DOM, each fence is swapped in place for a live,
  // clickable list of the document's H1-H4 headings (built from the rendered
  // headings, so the list always matches what is shown). The swap is
  // synchronous and re-runs on every value change, so adding/removing headings
  // updates the preview TOC live without touching the document bytes.
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    for (const code of Array.from(
      article.querySelectorAll<HTMLElement>("pre > code.language-quillmd-toc"),
    )) {
      const pre = code.parentElement;
      if (pre?.tagName !== "PRE" || !article.contains(pre)) continue;
      pre.replaceWith(buildTocBlock(article));
    }
  }, [html]);

  // Page breaks (plan 09 task 9.7, issue #90): the fixed
  // `<div class="quillmd-page-break"></div>` block is preprocessed into an
  // empty `quillmd-page-break` code fence (markdownToHtml); once the HTML is
  // in the DOM, each fence is swapped in place for the visible break line.
  // The swap is synchronous and re-runs on every value change.
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    for (const code of Array.from(
      article.querySelectorAll<HTMLElement>(
        "pre > code.language-quillmd-page-break",
      ),
    )) {
      const pre = code.parentElement;
      if (pre?.tagName !== "PRE" || !article.contains(pre)) continue;
      pre.replaceWith(buildPageBreakBlock());
    }
  }, [html]);

  return (
    <div className="quillmd-preview">
      <article
        ref={articleRef}
        className="quillmd-preview-content"
        // The HTML is applied in the effect above (only on value changes), so
        // the mermaid holders added to this subtree persist across theme-only
        // re-renders and re-render in place.
        // Middle-click on a link (plan 08 task 8.5, issue #80, AC7): open it
        // through plugin-opener (system browser for http/https, OS handler
        // for file://) instead of the webview's default navigation.
        onAuxClick={(event) => {
          const href = middleClickLinkHref(event, event.currentTarget);
          if (href === null) return;
          event.preventDefault();
          void openLinkUrl(href);
        }}
        // Right-click (plan 03 task 3.2, issue #40): the preview context
        // menu. The link item's state comes from the anchor under the caret
        // (the rendered HTML carries the href the WYSIWYG mark would).
        onContextMenu={(event) => {
          event.preventDefault();
          const target = event.target instanceof Element ? event.target : null;
          const anchor = target?.closest("a[href]") ?? null;
          const href = anchor?.getAttribute("href") || null;
          setTextMenu({
            x: event.clientX,
            y: event.clientY,
            items: buildPreviewMenu(anchor !== null, href),
            href,
            text: anchor?.textContent ?? null,
          });
        }}
      />
      {textMenu && (
        <ContextMenu
          x={textMenu.x}
          y={textMenu.y}
          items={toContextEntries(textMenu.items, dispatchTextMenu)}
          onClose={() => setTextMenu(null)}
          label="Preview menu"
        />
      )}
    </div>
  );
}
