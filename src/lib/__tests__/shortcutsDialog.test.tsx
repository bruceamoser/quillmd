// @vitest-environment jsdom
// Keyboard Shortcuts dialog (plan 10 task 10.5, issue #97): Help > Shortcuts
// renders the single-source shortcut table (src/lib/shortcuts.ts) — the
// registry rows are generated from EDITOR_COMMANDS there, so the dialog can't
// drift from the shortcuts the editor actually runs. Replaces the old
// window.alert() text block. Plan 10 §4 AC7 (≥25 shortcuts, no drift) is
// asserted against the table in shortcuts.test.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EDITOR_COMMANDS } from "../editorCommands";
import { SHORTCUTS } from "../shortcuts";
import ShortcutsDialog from "../../components/ShortcutsDialog";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("menu.rs Help > Shortcuts (issue #97)", () => {
  it("keeps Help > Keyboard Shortcuts", () => {
    const src = repoFile("../../../src-tauri/src/menu.rs");
    expect(src).toContain(
      'MenuItem::with_id(app, "help-shortcuts", "Keyboard Shortcuts", true, None::<&str>)'
    );
    expect(src).toContain('SubmenuBuilder::new(app, "Help")');
  });
});

describe("App.tsx Help > Shortcuts routing (issue #97)", () => {
  it("routes help-shortcuts to the dialog; the old alert block is gone", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('id === "help-shortcuts"');
    expect(app).toContain("setShortcutsDialogOpen(true)");
    expect(app).toContain("<ShortcutsDialog");
    expect(app).toContain('from "./components/ShortcutsDialog"');
    // The old alert text block is gone — the single source is shortcuts.ts.
    expect(app).not.toContain("SHORTCUTS_TEXT");
  });

  it("the dialog component renders the table, not a hardcoded list", () => {
    const dialog = repoFile("../../components/ShortcutsDialog.tsx");
    expect(dialog).toContain('shortcutGroups()');
    expect(dialog).toContain('from "../lib/shortcuts"');
  });
});

describe("ShortcutsDialog component (issue #97)", () => {
  interface Harness {
    container: HTMLDivElement;
    onClose: ReturnType<typeof vi.fn>;
    rows: () => Array<{ keys: string; label: string }>;
    button: (text: string) => HTMLButtonElement;
  }

  let roots: Root[] = [];

  function renderDialog(): Harness {
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<ShortcutsDialog onClose={onClose} />);
    });
    return {
      container,
      onClose,
      rows: () =>
        Array.from(container.querySelectorAll(".quillmd-shortcuts-row")).map((row) => ({
          keys: row.querySelector(".quillmd-shortcuts-keys")!.textContent!,
          label: row.querySelector(".quillmd-shortcuts-label")!.textContent!,
        })),
      button: (text) =>
        Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
          (b) => b.textContent === text
        )!,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    roots = [];
  });
  afterEach(() => {
    for (const r of roots) act(() => r.unmount());
    roots = [];
    vi.restoreAllMocks();
  });

  it("shows the title, scope, and a section per group", () => {
    const h = renderDialog();
    expect(h.container.querySelector(".quillmd-shortcuts-title")!.textContent).toBe(
      "Keyboard Shortcuts"
    );
    expect(h.container.querySelector(".quillmd-shortcuts-scope")!.textContent).toContain(
      "QuillMD listens for"
    );
    const titles = Array.from(
      h.container.querySelectorAll(".quillmd-shortcuts-group-title")
    ).map((t) => t.textContent);
    expect(titles).toEqual(["File", "Edit", "Format", "View", "Tools", "Editor"]);
  });

  it("lists every entry of the single-source table (AC7)", () => {
    const h = renderDialog();
    const rows = h.rows();
    expect(rows.length).toBe(SHORTCUTS.length);
    expect(rows.length).toBeGreaterThanOrEqual(25);
    // Spot-check a registry row and an app-level row.
    expect(rows).toContainEqual({ keys: "Ctrl+B", label: "Bold" });
    expect(rows).toContainEqual({ keys: "Ctrl+1..6", label: "Heading level 1–6 (press again to return to paragraph)" });
  });

  it("renders the registry rows with the registry's own keys and labels (no drift)", () => {
    const h = renderDialog();
    const rows = h.rows();
    for (const command of EDITOR_COMMANDS) {
      if (command.shortcut === undefined) continue;
      expect(rows).toContainEqual({ keys: command.shortcut, label: command.label });
    }
  });

  it("autofocuses the Close button; Enter closes", () => {
    const h = renderDialog();
    expect(document.activeElement).toBe(h.button("Close"));
    act(() => {
      h.container
        .querySelector(".quillmd-shortcuts-dialog")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels on Esc", () => {
    const h = renderDialog();
    act(() => {
      h.container
        .querySelector(".quillmd-shortcuts-dialog")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("a backdrop press closes; a press inside the dialog does not", () => {
    const h = renderDialog();
    act(() => {
      h.container
        .querySelector(".quillmd-shortcuts-overlay")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);

    const h2 = renderDialog();
    act(() => {
      h2.container
        .querySelector(".quillmd-shortcuts-dialog")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h2.onClose).not.toHaveBeenCalled();
  });
});
