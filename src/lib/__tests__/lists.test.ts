import { describe, expect, it } from "vitest";
import {
  backspaceOnEmptyListItem,
  continueListItem,
  indentListItem,
  listItemAt,
  outdentListItem,
} from "../edit";

describe("list editing primitives (markdown-text model)", () => {
  it("Enter at the end of a bullet item continues with a new empty item", () => {
    const source = "- one\n";
    expect(continueListItem(source, source.indexOf("\n"))).toBe("- one\n- \n");
  });

  it("Enter at the end of an ordered item increments the number", () => {
    const source = "1. one\n";
    expect(continueListItem(source, source.indexOf("\n"))).toBe("1. one\n2. \n");
  });

  it("Enter at the end of a task item continues with an unchecked sibling", () => {
    const source = "- [ ] first\n";
    expect(continueListItem(source, source.indexOf("\n"))).toBe(
      "- [ ] first\n- [ ] \n",
    );
  });

  it("Enter mid-item splits text into a new sibling item", () => {
    const source = "- abc def\n";
    expect(continueListItem(source, source.indexOf("c"))).toBe("- ab\n- c def\n");
  });

  it("Tab indents a list item into a nested level", () => {
    const source = "- one\n- two\n";
    const offset = source.indexOf("two") + 1;
    expect(indentListItem(source, offset)).toBe("- one\n  - two\n");
  });

  it("Shift-Tab outdents a nested list item", () => {
    const source = "- one\n  - two\n";
    const offset = source.indexOf("two") + 1;
    expect(outdentListItem(source, offset)).toBe("- one\n- two\n");
  });

  it("Shift-Tab is a no-op when the item has no indent", () => {
    const source = "- one\n";
    expect(outdentListItem(source, 2)).toBe(source);
  });

  it("Backspace on an empty list item exits the list", () => {
    const source = "- one\n- \n";
    const offset = source.length - 1;
    expect(backspaceOnEmptyListItem(source, offset)).toBe("- one\n\n");
  });

  it("Backspace on a non-empty list item is a no-op", () => {
    const source = "- one\n";
    expect(backspaceOnEmptyListItem(source, 2)).toBe(source);
  });

  it("Enter on a non-list line is a no-op", () => {
    const source = "plain paragraph\n";
    expect(continueListItem(source, 3)).toBe(source);
  });

  it("listItemAt returns null outside any list item", () => {
    const source = "no list here\n";
    expect(listItemAt(source, 3)).toBeNull();
  });
});
