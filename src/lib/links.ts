// Link dialog logic (plan 08 task 8.1, issue #76): URL validation, the
// prefill read for the in-app link dialog, and the set/remove mark operations
// behind it. Pure over the TipTap editor so the registry command, the
// toolbar, the Insert menu, and the tests all share one behavior.

import type { Editor as CoreEditor } from "@tiptap/core";
import type { MarkType } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { runningInTauri } from "./fileIo";

// What the dialog submits (and what it opens with): the destination, the
// tooltip/title ("" when none), and the display text.
export interface LinkPayload {
  href: string;
  title: string;
  text: string;
}

// The dialog's opening state: the link under the caret (isEditing) or the
// plain selection a new link will cover.
export interface LinkPrefill extends LinkPayload {
  isEditing: boolean;
}

// Plan 08 §2.1 validation: scheme check — http/https/mailto/tel plus
// scheme-less (relative) destinations. Everything else (javascript:, data:,
// ftp:, ...) is rejected before it can reach the document.
const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

// A scheme is two or more characters before the colon: a single letter is a
// Windows drive letter, so `c:\notes.md` stays a relative path, not a scheme.
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]+):/;

// The error message for a URL the dialog refuses, or null when acceptable.
export function validateLinkUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return "Enter a URL";
  const m = SCHEME_RE.exec(trimmed);
  if (m) {
    const scheme = m[1].toLowerCase();
    if (!ALLOWED_SCHEMES.has(scheme)) {
      return `Unsupported URL scheme "${scheme}:" (allowed: http, https, mailto, tel, or a relative path)`;
    }
  }
  // The serializer cannot express whitespace inside a link destination
  // (mdast wraps it and splits the link), so the dialog refuses it.
  if (/[\u0000-\u0020\u007F]/.test(trimmed)) {
    return "URLs may not contain spaces or line breaks";
  }
  return null;
}

function linkMarkType(editor: CoreEditor): MarkType | null {
  return editor.state.schema.marks.link ?? null;
}

// The full range of the link mark covering the current selection, or null
// when the selection is not in a link. A collapsed selection counts when the
// caret sits in a link (stored marks first, then the marks at the caret).
export function coveringLinkRange(
  editor: CoreEditor,
): { from: number; to: number } | null {
  const mark = linkMarkType(editor);
  if (!mark) return null;
  const { state } = editor;
  const { from, to } = state.selection;

  let inLink: boolean;
  if (from === to) {
    // The caret may sit exactly on a link boundary, where "the marks at the
    // caret" (the text before it) is empty. TipTap's own extendMarkRange
    // covers this by also looking at the node after the caret, so we check
    // the stored marks (a click sets them), then the text on both sides.
    const $pos = state.doc.resolve(from);
    const candidates = [
      ...(state.storedMarks ?? []),
      ...($pos.nodeBefore?.isText ? $pos.nodeBefore.marks : []),
      ...($pos.nodeAfter?.isText ? $pos.nodeAfter.marks : []),
    ];
    inLink = candidates.some((m) => m.type === mark);
  } else {
    inLink = state.doc.rangeHasMark(from, to, mark);
  }
  if (!inLink) return null;

  // Grow outwards to the whole mark so the dialog (and the apply below)
  // always act on the complete link, not a partial selection inside it. The
  // character check uses the text node before the boundary position, so a
  // caret at the document end cannot be mistaken for a linked character.
  let lo = from;
  while (lo > 0) {
    const ch = state.doc.resolve(lo).nodeBefore;
    if (!ch?.isText || !ch.marks.some((m) => m.type === mark)) break;
    lo -= 1;
  }
  let hi = to;
  while (hi < state.doc.nodeSize) {
    const ch = state.doc.resolve(hi + 1).nodeBefore;
    if (!ch?.isText || !ch.marks.some((m) => m.type === mark)) break;
    hi += 1;
  }
  return { from: lo, to: hi };
}

// The values the dialog opens with (plan 08 §2.1): editing an existing link
// prefills href, title, and the link's full text; a plain selection prefills
// the selected text as the display text; an empty caret prefills nothing.
export function readLinkPrefill(editor: CoreEditor): LinkPrefill {
  const range = coveringLinkRange(editor);
  const { state } = editor;
  const { from, to } = state.selection;
  if (range) {
    // Read the attributes from the document, not from the selection: a
    // caret on the link's boundary has no "active" marks, so
    // getAttributes("link") would come back empty. The first text node of
    // the covering range always carries the mark.
    const $at = state.doc.resolve(range.from);
    const textNode = $at.nodeAfter?.isText ? $at.nodeAfter : $at.nodeBefore;
    const linkMark = textNode?.marks.find((m) => m.type === state.schema.marks.link);
    const attrs = linkMark?.attrs ?? {};
    return {
      href: typeof attrs.href === "string" ? attrs.href : "",
      title: typeof attrs.title === "string" ? attrs.title : "",
      text: state.doc.textBetween(range.from, range.to),
      isEditing: true,
    };
  }
  return {
    href: "",
    title: "",
    text: editor.state.doc.textBetween(from, to),
    isEditing: false,
  };
}

// Sets (or edits) the link mark: the selection is extended over the link
// mark it intersects, the display text replaces the covered range when it
// changed, and the href/title attributes are (re)applied. The preventAutolink
// meta stops the autolinker from double-linking the freshly written URL.
export function applyLink(editor: CoreEditor, payload: LinkPayload): boolean {
  const mark = linkMarkType(editor);
  if (!mark) return false;
  const href = payload.href.trim();
  const title = payload.title.trim();
  if (validateLinkUrl(href) !== null) return false;

  const { state } = editor;
  const range = coveringLinkRange(editor) ?? {
    from: state.selection.from,
    to: state.selection.to,
  };
  const currentText = state.doc.textBetween(range.from, range.to);
  // Display text: what the user typed, falling back to the covered text
  // (editing a link without changing the text field), then to the URL itself.
  const text =
    payload.text !== "" ? payload.text : currentText !== "" ? currentText : href;

  const tr = state.tr;
  if (text !== currentText) {
    tr.insertText(text, range.from, range.to);
  }
  const to = range.from + text.length;
  tr.addMark(range.from, to, mark.create({ href, title: title === "" ? null : title }));
  tr.setSelection(TextSelection.create(tr.doc, range.from, to));
  tr.setMeta("preventAutolink", true);
  editor.view.dispatch(tr);
  return true;
}

// A middle-click event, structurally: the DOM MouseEvent and React's
// synthetic MouseEvent both satisfy it (React's omits the layer/offset
// coordinates the DOM type requires).
interface MiddleClickEvent {
  button: number;
  target: EventTarget | null;
}

// The href of the link under a middle click inside `root` (plan 08 task
// 8.5, issue #80): null for any other button, a target that is not an
// anchor, or an anchor without an href. The WYSIWYG editor resolves the
// link mark at the click position instead (its DOM carries the href); the
// preview's rendered HTML does not, so it reads the anchor directly.
export function middleClickLinkHref(event: MiddleClickEvent, root: Element): string | null {
  if (event.button !== 1) return null;
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a[href]");
  if (!anchor || !root.contains(anchor)) return null;
  return anchor.getAttribute("href");
}

// Opens the destination in the system browser (plan 08 §2.1 "Open" button):
// plugin-opener under Tauri, a new tab in browser dev.
export async function openLinkUrl(url: string): Promise<void> {
  if (runningInTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

// Removes the link markup under the selection, keeping the text (plan 08 §4
// AC1). A selection not inside a link is a no-op.
export function removeLink(editor: CoreEditor): boolean {
  const mark = linkMarkType(editor);
  if (!mark) return false;
  const range = coveringLinkRange(editor);
  if (!range) return false;
  const { state } = editor;
  const tr = state.tr;
  tr.removeMark(range.from, range.to, mark);
  tr.setSelection(TextSelection.create(tr.doc, range.from, range.to));
  tr.setMeta("preventAutolink", true);
  editor.view.dispatch(tr);
  return true;
}
