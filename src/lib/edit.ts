// Markdown-text editing primitives (spec §2.1.5). Each function is a pure
// byte-range splice over the decoded source string: it changes exactly the
// bytes implied by the operation and returns a new string, leaving every other
// byte untouched. These are what the acceptance tests drive to prove that
// interactive task-list and list behaviors are reflected in source without
// re-serializing anything.

export interface TaskMarker {
  // 0-based index among all task markers in the source.
  index: number;
  // Character offset where the marker's line starts.
  lineStart: number;
  // Character offset of the "[" of the checkbox.
  bracketStart: number;
  // Character offset of the single byte between the brackets (" " or "x").
  contentOffset: number;
  checked: boolean;
}

// The leading whitespace of a list item is preserved verbatim; the rest of the
// prefix (marker + spacing, and the checkbox for task items) is what the
// editing primitives splice.
export interface ListItemInfo {
  lineStart: number;
  lineEnd: number;
  indent: string;
  // Marker symbol only: "-", "*", "+", or "1." / "1)" for ordered lists.
  marker: string;
  ordered: boolean;
  number: number | null;
  // "." or ")" for ordered lists, null otherwise.
  punctuation: string | null;
  task: boolean;
  checked: boolean | null;
  // Character offset of the first byte of item text (after the full prefix).
  textStart: number;
  text: string;
}

const TASK_RE = /^([ \t]*)([-+*]|\d{1,9}[.)])[ \t]+\[([ xX])\][ \t]*/;
const OL_RE = /^([ \t]*)(\d{1,9})([.)])[ \t]+/;
const UL_RE = /^([ \t]*)([-+*])[ \t]+/;

// Scans every line of `source` for a task-list checkbox and reports the exact
// byte offset of the checked/unchecked byte for a byte-range splice.
export function findTaskMarkers(source: string): TaskMarker[] {
  const markers: TaskMarker[] = [];
  let pos = 0;
  let index = 0;
  while (pos < source.length) {
    const nl = source.indexOf("\n", pos);
    const lineEnd = nl < 0 ? source.length : nl;
    const line = source.slice(pos, lineEnd);
    const m = /^([ \t]*(?:[-+*]|\d{1,9}[.)]))[ \t]+\[([ xX])\]/.exec(line);
    if (m) {
      let bracket = m[1].length;
      while (bracket < line.length && (line[bracket] === " " || line[bracket] === "\t")) {
        bracket += 1;
      }
      if (line[bracket] === "[") {
        const contentOffset = pos + bracket + 1;
        const checked = line[bracket + 1] === "x" || line[bracket + 1] === "X";
        markers.push({
          index,
          lineStart: pos,
          bracketStart: pos + bracket,
          contentOffset,
          checked,
        });
        index += 1;
      }
    }
    pos = lineEnd + 1;
  }
  return markers;
}

// Toggles a single checkbox in place, replacing only the " " <-> "x" byte.
export function toggleTaskAt(source: string, marker: TaskMarker): string {
  const replacement = marker.checked ? " " : "x";
  return (
    source.slice(0, marker.contentOffset) +
    replacement +
    source.slice(marker.contentOffset + 1)
  );
}

// Toggles the nth task checkbox (0-based). Returns null when there is no such
// marker so callers can distinguish "no-op" from "toggled".
export function toggleTaskByIndex(source: string, index: number): string | null {
  const marker = findTaskMarkers(source)[index];
  if (!marker) return null;
  return toggleTaskAt(source, marker);
}

// Analyzes the list item (if any) that contains the character at `offset`.
export function listItemAt(source: string, offset: number): ListItemInfo | null {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const nl = source.indexOf("\n", offset);
  const lineEnd = nl < 0 ? source.length : nl;
  const line = source.slice(lineStart, lineEnd);

  const task = TASK_RE.exec(line);
  if (task) {
    const ordered = /^\d/.test(task[2]);
    return {
      lineStart,
      lineEnd,
      indent: task[1],
      marker: task[2],
      ordered,
      number: ordered ? parseInt(task[2], 10) : null,
      punctuation: ordered ? task[2].slice(-1) : null,
      task: true,
      checked: task[3].toLowerCase() === "x",
      textStart: lineStart + task[0].length,
      text: line.slice(task[0].length),
    };
  }

  const ol = OL_RE.exec(line);
  if (ol) {
    return {
      lineStart,
      lineEnd,
      indent: ol[1],
      marker: `${ol[2]}${ol[3]}`,
      ordered: true,
      number: parseInt(ol[2], 10),
      punctuation: ol[3],
      task: false,
      checked: null,
      textStart: lineStart + ol[0].length,
      text: line.slice(ol[0].length),
    };
  }

  const ul = UL_RE.exec(line);
  if (ul) {
    return {
      lineStart,
      lineEnd,
      indent: ul[1],
      marker: ul[2],
      ordered: false,
      number: null,
      punctuation: null,
      task: false,
      checked: null,
      textStart: lineStart + ul[0].length,
      text: line.slice(ul[0].length),
    };
  }

  return null;
}

// The prefix for a new sibling item created by Enter-continue. Ordered lists
// increment the marker number; task lists produce an unchecked sibling.
function continuePrefix(info: ListItemInfo): string {
  if (info.task) return `${info.indent}${info.marker} [ ] `;
  if (info.ordered && info.number !== null) {
    return `${info.indent}${info.number + 1}${info.punctuation ?? "."} `;
  }
  return `${info.indent}${info.marker} `;
}

// Enter inside a list item: split the item text at `offset` and move the text
// after the cursor into a new sibling item with the same indent and marker.
// Returns the source unchanged when `offset` is not inside a list item.
export function continueListItem(source: string, offset: number): string {
  const info = listItemAt(source, offset);
  if (!info) return source;
  const prefix = continuePrefix(info);
  return (
    source.slice(0, offset) +
    "\n" +
    prefix +
    source.slice(offset)
  );
}

// Tab inside a list item: indents the item one level (two spaces), making it a
// nested item under its predecessor. Returns the source unchanged when `offset`
// is not inside a list item.
export function indentListItem(source: string, offset: number): string {
  const info = listItemAt(source, offset);
  if (!info) return source;
  return source.slice(0, info.lineStart) + "  " + source.slice(info.lineStart);
}

// Shift-Tab inside a list item: outdents the item one level (up to two spaces
// of leading indent). Returns the source unchanged when `offset` is not inside
// a list item or the item has no indent to remove.
export function outdentListItem(source: string, offset: number): string {
  const info = listItemAt(source, offset);
  if (!info) return source;
  const remove = Math.min(info.indent.length, 2);
  if (remove === 0) return source;
  return (
    source.slice(0, info.lineStart) +
    source.slice(info.lineStart + remove)
  );
}

// Backspace at the start of an empty list item: exits the list by removing the
// marker (and checkbox) and leaving only the item's leading indent. Returns the
// source unchanged when `offset` is not inside an empty list item.
export function backspaceOnEmptyListItem(source: string, offset: number): string {
  const info = listItemAt(source, offset);
  if (!info || info.text !== "") return source;
  const indentStart = info.lineStart + info.indent.length;
  return (
    source.slice(0, indentStart) +
    source.slice(info.textStart)
  );
}
