// @vitest-environment jsdom
// Keyboard shortcut table (plan 10 task 10.5, issue #97): the single-source
// table in src/lib/shortcuts.ts. Plan 10 §4 AC7: the shortcuts dialog lists
// ≥25 shortcuts, all present in the table (no drift: test that every registry
// `shortcut` appears). The dialog itself (rendering + keyboard model) is
// covered in shortcutsDialog.test.tsx.
import { describe, expect, it } from "vitest";
import { EDITOR_COMMANDS } from "../editorCommands";
import { SHORTCUTS, SHORTCUT_GROUPS, shortcutGroups } from "../shortcuts";

describe("shortcut table (plan 10 task 10.5, issue #97)", () => {
  it("lists ≥25 shortcuts (AC7)", () => {
    expect(SHORTCUTS.length).toBeGreaterThanOrEqual(25);
  });

  it("carries every registry shortcut with the registry's own label (no drift, AC7)", () => {
    const withShortcut = EDITOR_COMMANDS.filter((command) => command.shortcut !== undefined);
    expect(withShortcut.length).toBeGreaterThan(0);
    for (const command of withShortcut) {
      const row = SHORTCUTS.find((entry) => entry.keys === command.shortcut);
      expect(
        row,
        `registry shortcut ${command.shortcut} (${command.id}) missing from the table`
      ).toBeDefined();
      expect(row!.label).toBe(command.label);
    }
  });

  it("lists no shortcut twice", () => {
    const keys = SHORTCUTS.map((entry) => entry.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses only the known display groups", () => {
    for (const entry of SHORTCUTS) {
      expect(SHORTCUT_GROUPS).toContain(entry.group);
    }
  });

  it("grouped() covers the whole table, one non-empty section per group, in order", () => {
    const sections = shortcutGroups();
    for (const section of sections) {
      expect(section.entries.length).toBeGreaterThan(0);
    }
    expect(sections.reduce((n, section) => n + section.entries.length, 0)).toBe(
      SHORTCUTS.length
    );
    const order = new Map<string, number>(SHORTCUT_GROUPS.map((group, i) => [group, i]));
    for (let i = 1; i < sections.length; i++) {
      expect(order.get(sections[i - 1].group)!).toBeLessThan(
        order.get(sections[i].group)!
      );
    }
  });

  it("keeps the app-level (menu-owned) accelerators", () => {
    const keys = new Set(SHORTCUTS.map((entry) => entry.keys));
    const appLevel = [
      "Ctrl+N",
      "Ctrl+O",
      "Ctrl+Shift+O",
      "Ctrl+S",
      "Ctrl+Shift+S",
      "Ctrl+W",
      "Ctrl+Q",
      "Ctrl+X",
      "Ctrl+C",
      "Ctrl+V",
      "Ctrl+F",
      "Ctrl+H",
      "F3",
      "Shift+F3",
      "Ctrl+1..6",
      "Ctrl+/",
      "Ctrl+=",
      "Ctrl+-",
      "Ctrl+0",
      "Ctrl+wheel",
      "Ctrl+Shift+E",
      "Ctrl+Shift+8",
      "F11",
      "Esc",
      "Ctrl+,",
      "Tab",
      "Shift+Tab",
    ];
    for (const key of appLevel) {
      expect(keys, `app-level accelerator ${key} missing from the table`).toContain(key);
    }
  });
});
