import { describe, expect, it } from "vitest";
import { UndoStack } from "../undo";

describe("markdown-text undo stack", () => {
  it("is never re-based on save: undo past a save restores pre-save bytes", () => {
    const preSave = "# doc\n";
    const stack = new UndoStack(preSave);

    stack.push("# doc\n\nfirst edit\n");
    // Simulate an autosave: the stack is deliberately untouched.
    stack.push("# doc\n\nsecond edit\n");

    expect(stack.undo()).toBe("# doc\n\nfirst edit\n");
    expect(stack.undo()).toBe(preSave);
    expect(stack.undo()).toBeNull();
  });

  it("coalesces an action group into a single undo step", () => {
    const stack = new UndoStack("a");
    stack.beginGroup();
    stack.push("ab");
    stack.push("abc");
    stack.push("abcd");
    stack.endGroup();
    expect(stack.undo()).toBe("a");
  });

  it("supports redo after undo", () => {
    const stack = new UndoStack("one");
    stack.push("two");
    stack.push("three");
    expect(stack.undo()).toBe("two");
    expect(stack.redo()).toBe("three");
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });

  it("ignores pushes that do not change the text", () => {
    const stack = new UndoStack("same");
    stack.push("same");
    expect(stack.canUndo()).toBe(false);
    expect(stack.dump().length).toBe(1);
  });
});
