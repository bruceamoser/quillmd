import { describe, expect, it } from "vitest";
import { indentListItem, outdentListItem, toggleTaskByIndex } from "../edit";
import { parseMarkdown } from "../markdown";
import { UndoStack } from "../undo";

function applyStep(text: string, i: number): string {
  switch (i % 6) {
    case 0:
      return toggleTaskByIndex(text, 0) ?? text;
    case 1:
      return toggleTaskByIndex(text, 1) ?? text;
    case 2:
      return toggleTaskByIndex(text, 2) ?? text;
    case 3:
      return indentListItem(text, text.indexOf("beta") + 1);
    case 4:
      return outdentListItem(text, text.indexOf("beta") + 1);
    default:
      return `${text}paragraph ${i}\n`;
  }
}

describe("50-step undo sequence asserts markdown bytes", () => {
  it("records exact bytes per step and undo past a save restores pre-save bytes", () => {
    const initial = "# Tasks\n\n- [ ] alpha\n- [ ] beta\n- [ ] gamma\n\nEnd.\n";
    const stack = new UndoStack(initial);
    const history: string[] = [initial];

    let text = initial;
    let preSave: string | null = null;

    for (let i = 0; i < 50; i += 1) {
      text = applyStep(text, i);
      stack.push(text);
      history.push(text);

      // Assert the markdown bytes (not merely parse success) after each step.
      expect(stack.current()).toBe(text);
      expect(new TextEncoder().encode(stack.current())).toEqual(
        new TextEncoder().encode(text),
      );

      // Parse always succeeds.
      expect(parseMarkdown(text).warnings).toHaveLength(0);

      // A save mid-sequence must not re-base the stack.
      if (i === 24) preSave = text;
    }

    expect(history).toHaveLength(51);
    expect(preSave).toBe(history[25]);

    // Undo all the way back; each step returns the exact prior bytes.
    for (let i = 50; i >= 1; i -= 1) {
      expect(stack.undo()).toBe(history[i - 1]);
    }

    // Undo past the initial state is a no-op.
    expect(stack.undo()).toBeNull();
  });

  it("undo to and past the save point returns pre-save bytes", () => {
    const initial = "# Tasks\n\n- [ ] alpha\n- [ ] beta\n- [ ] gamma\n\nEnd.\n";
    const stack = new UndoStack(initial);
    let text = initial;
    for (let i = 0; i < 10; i += 1) {
      text = applyStep(text, i);
      stack.push(text);
    }

    // Save happens here (no-op on the stack).
    const saved = stack.current();

    for (let i = 10; i < 20; i += 1) {
      text = applyStep(text, i);
      stack.push(text);
    }

    // Undo back to the save point, then one past it.
    for (let i = 0; i < 10; i += 1) {
      stack.undo();
    }
    expect(stack.current()).toBe(saved);
    const before = stack.undo();
    expect(before).not.toBeNull();
    expect(parseMarkdown(before as string).warnings).toHaveLength(0);
  });

  it("supports redo back to the latest bytes", () => {
    const stack = new UndoStack("a");
    stack.push("ab");
    stack.push("abc");
    expect(stack.undo()).toBe("ab");
    expect(stack.redo()).toBe("abc");
    expect(stack.redo()).toBeNull();
  });
});
