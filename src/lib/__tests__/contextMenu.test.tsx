// @vitest-environment jsdom
// Shared context menu component (plan 03 task 3.1, issue #39): the
// declarative item model (label, icon, shortcut hint, enabled, checked,
// submenu, separator, danger), the pure positioning/clamping math
// (clampMenuPosition, submenuPosition), and the component's interaction
// behavior — opens at the cursor, clamps to the viewport, dismisses on
// Escape / outside click, and is fully keyboard-navigable (arrows, Enter,
// Escape, submenu on right-arrow) with a screen-reader label on every item.
// The interactions are exercised against a mock surface that wires a
// `contextmenu` event to the menu the same way every real surface (editor
// text, tables, images, tabs, explorer — tasks 3.2-3.6) will.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import ContextMenu, {
  clampMenuPosition,
  isSeparator,
  submenuPosition,
  MENU_SUBMENU_GAP,
  MENU_VIEWPORT_MARGIN,
  type ContextMenuEntry,
} from "../../components/ContextMenu";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom's default viewport (the clamp math is exercised against it).
const VIEWPORT = { width: 1024, height: 768 };

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  root = null;
  container.remove();
  document.body.innerHTML = "";
});

function renderMenu(
  items: ContextMenuEntry[],
  opts: { x?: number; y?: number; label?: string; onClose?: () => void } = {},
): { onClose: () => void } {
  const onClose = opts.onClose ?? vi.fn();
  const r = createRoot(container);
  root = r;
  act(() => {
    r.render(
      <ContextMenu
        x={opts.x ?? 300}
        y={opts.y ?? 200}
        items={items}
        onClose={onClose}
        label={opts.label}
      />,
    );
  });
  return { onClose };
}

// The mock surface (plan 03 §5 task 3.1): a right-clickable element that
// opens the menu at the click's viewport coordinates — the exact wiring the
// per-surface builders will mount in tasks 3.2-3.6 (editor contextmenu event
// -> clientX/clientY -> <ContextMenu x y items onClose>).
function renderSurface(items: ContextMenuEntry[], label?: string) {
  const closed: Array<() => void> = [];
  const Surface = () => {
    const [at, setAt] = useState<{ x: number; y: number } | null>(null);
    return (
      <div
        data-testid="mock-surface"
        onContextMenu={(e) => {
          e.preventDefault();
          setAt({ x: e.clientX, y: e.clientY });
        }}
      >
        mock surface
        {at && (
          <ContextMenu
            x={at.x}
            y={at.y}
            items={items}
            label={label}
            onClose={() => {
              closed.forEach((fn) => fn());
              setAt(null);
            }}
          />
        )}
      </div>
    );
  };
  const r = createRoot(container);
  root = r;
  act(() => {
    r.render(<Surface />);
  });
  const surface = container.querySelector("[data-testid='mock-surface']");
  expect(surface, "mock surface").not.toBeNull();
  // Right-click the surface at (cx, cy) — the surface's contextmenu handler
  // opens the menu there, like the real surfaces will.
  const rightClick = (cx: number, cy: number) => {
    act(() => {
      surface!.dispatchEvent(
        new MouseEvent("contextmenu", { clientX: cx, clientY: cy, bubbles: true, cancelable: true }),
      );
    });
  };
  const menu = () => container.querySelector<HTMLElement>(".quillmd-context-menu");
  const onClosed = (fn: () => void) => closed.push(fn);
  return { rightClick, menu, onClosed };
}

const ITEMS: ContextMenuEntry[] = [
  { id: "undo", label: "Undo", shortcut: "Ctrl+Z", onSelect: () => {} },
  { id: "redo", label: "Redo", shortcut: "Ctrl+Shift+Z", enabled: false },
  { type: "separator" as const },
  { id: "format", label: "Format", submenu: [
      { id: "bold", label: "Bold", shortcut: "Ctrl+B", onSelect: () => {} },
      { id: "italic", label: "Italic", shortcut: "Ctrl+I", onSelect: () => {} },
    ] },
  { id: "delete", label: "Delete", danger: true, onSelect: () => {} },
];

function itemButtons(menuEl: HTMLElement): HTMLButtonElement[] {
  // The top-level items only (the submenu, when open, is a nested menu).
  return Array.from(menuEl.querySelectorAll<HTMLButtonElement>(":scope > button.quillmd-context-item"));
}

function pressKey(key: string): void {
  const el = document.activeElement;
  expect(el, "an element should hold focus while the menu is open").not.toBeNull();
  act(() => {
    el!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

// --- positioning math (pure) -------------------------------------------------

describe("clampMenuPosition (issue #39)", () => {
  it("keeps the cursor position when the menu fits", () => {
    expect(clampMenuPosition(100, 50, { width: 200, height: 300 }, VIEWPORT)).toEqual({
      left: 100,
      top: 50,
    });
  });

  it("clamps a right-edge overflow back inside the viewport", () => {
    // 950 + 200 would run past 1024; the menu's right edge lands on the
    // margin instead: left = 1024 - 200 - 4.
    expect(clampMenuPosition(950, 50, { width: 200, height: 300 }, VIEWPORT)).toEqual({
      left: VIEWPORT.width - 200 - MENU_VIEWPORT_MARGIN,
      top: 50,
    });
  });

  it("clamps a bottom-edge overflow back inside the viewport", () => {
    expect(clampMenuPosition(100, 700, { width: 200, height: 300 }, VIEWPORT)).toEqual({
      left: 100,
      top: VIEWPORT.height - 300 - MENU_VIEWPORT_MARGIN,
    });
  });

  it("clamps an off-screen cursor to the top-left margin", () => {
    expect(clampMenuPosition(-40, -10, { width: 200, height: 300 }, VIEWPORT)).toEqual({
      left: MENU_VIEWPORT_MARGIN,
      top: MENU_VIEWPORT_MARGIN,
    });
  });

  it("pins a menu larger than the viewport at the top-left margin", () => {
    expect(clampMenuPosition(500, 400, { width: 2000, height: 2000 }, VIEWPORT)).toEqual({
      left: MENU_VIEWPORT_MARGIN,
      top: MENU_VIEWPORT_MARGIN,
    });
  });
});

describe("submenuPosition (issue #39)", () => {
  const anchor = { top: 100, height: 24, left: 50, right: 250 };

  it("opens to the right of the parent item when it fits", () => {
    expect(submenuPosition(anchor, { width: 180, height: 200 }, VIEWPORT)).toEqual({
      left: anchor.right + MENU_SUBMENU_GAP,
      top: anchor.top,
    });
  });

  it("flips to the left when the submenu would overflow the right edge", () => {
    // Parent at the right edge: 1000 + 2 + 180 overflows 1024, so the
    // submenu opens to the parent's left.
    const edgeAnchor = { top: 100, height: 24, left: 800, right: 1000 };
    expect(submenuPosition(edgeAnchor, { width: 180, height: 200 }, VIEWPORT)).toEqual({
      left: 800 - 180 - MENU_SUBMENU_GAP,
      top: 100,
    });
  });

  it("clamps the submenu top to the viewport bottom", () => {
    expect(
      submenuPosition(
        { top: 700, height: 24, left: 50, right: 250 },
        { width: 180, height: 200 },
        VIEWPORT,
      ),
    ).toEqual({
      left: 250 + MENU_SUBMENU_GAP,
      top: VIEWPORT.height - 200 - MENU_VIEWPORT_MARGIN,
    });
  });
});

describe("declarative item model (issue #39)", () => {
  it("isSeparator guards the two entry kinds", () => {
    expect(isSeparator({ type: "separator" })).toBe(true);
    expect(isSeparator({ id: "a", label: "A" })).toBe(false);
  });

  it("renders every model field: icon, shortcut, checked, disabled, danger, separator, submenu hint", () => {
    renderMenu([
      { id: "cut", label: "Cut", icon: <span data-testid="cut-icon">C</span>, shortcut: "Ctrl+X" },
      { type: "separator", id: "sep1" },
      { id: "align", label: "Align Left", checked: true },
      { id: "off", label: "Disabled item", enabled: false },
      { id: "danger", label: "Delete table", danger: true },
      { id: "sub", label: "Format", submenu: [{ id: "b", label: "Bold" }] },
    ]);
    const menu = container.querySelector<HTMLElement>(".quillmd-context-menu");
    expect(menu).not.toBeNull();

    // Icon renders (aria-hidden: the label is the accessible name).
    expect(menu!.querySelector("[data-testid='cut-icon']")).not.toBeNull();
    // The shortcut hint is shown, right-aligned.
    expect(menu!.querySelector(".quillmd-context-shortcut")?.textContent).toBe("Ctrl+X");
    // Separator renders as a separator.
    expect(menu!.querySelector("hr.quillmd-context-sep[role='separator']")).not.toBeNull();
    // Checked item carries the aria-checked state and the check glyph.
    const align = menu!.querySelector<HTMLButtonElement>("#align, button[aria-label='Align Left']");
    expect(align).not.toBeNull();
    expect(align!.getAttribute("aria-checked")).toBe("true");
    expect(align!.querySelector(".quillmd-context-check")?.textContent).toBe("✓");
    // Disabled item is aria-disabled and grayed.
    const off = menu!.querySelector<HTMLButtonElement>("button[aria-label='Disabled item']");
    expect(off).not.toBeNull();
    expect(off!.getAttribute("aria-disabled")).toBe("true");
    // The destructive item carries the danger class.
    const danger = menu!.querySelector<HTMLButtonElement>("button[aria-label='Delete table']");
    expect(danger).not.toBeNull();
    expect(danger!.className).toContain("quillmd-context-danger");
    // The submenu parent advertises its popup.
    const sub = menu!.querySelector<HTMLButtonElement>("button[aria-label='Format']");
    expect(sub).not.toBeNull();
    expect(sub!.getAttribute("aria-haspopup")).toBe("menu");
    expect(sub!.getAttribute("aria-expanded")).toBe("false");
  });
});

// --- mock-surface interactions -------------------------------------------------

describe("ContextMenu on a mock surface (issue #39)", () => {
  it("opens at the right-click cursor position (fixed, viewport-anchored)", () => {
    const { rightClick, menu } = renderSurface(ITEMS);
    expect(menu()).toBeNull();
    rightClick(300, 200);
    const m = menu();
    expect(m).not.toBeNull();
    // Fixed positioning: the left/top are the clamped cursor coordinates.
    expect(m!.style.left).toBe("300px");
    expect(m!.style.top).toBe("200px");
    // The default WebView menu is suppressed (the handler preventDefaults).
    // (Asserted indirectly: our menu is what the right-click produced.)
  });

  it("clamps an off-screen right-click to the viewport margin", () => {
    const { rightClick, menu } = renderSurface(ITEMS);
    rightClick(-50, -60);
    const m = menu();
    expect(m).not.toBeNull();
    expect(m!.style.left).toBe(`${MENU_VIEWPORT_MARGIN}px`);
    expect(m!.style.top).toBe(`${MENU_VIEWPORT_MARGIN}px`);
  });

  it("labels the menu for screen readers with the default label", () => {
    const { rightClick, menu } = renderSurface(ITEMS);
    rightClick(100, 100);
    expect(menu()!.getAttribute("aria-label")).toBe("Context menu");
  });

  it("honors a custom menu label", () => {
    const { rightClick, menu } = renderSurface(ITEMS, "Editor menu");
    rightClick(100, 100);
    expect(menu()!.getAttribute("aria-label")).toBe("Editor menu");
  });

  it("puts a screen-reader label on every item", () => {
    const { rightClick, menu } = renderSurface(ITEMS);
    rightClick(100, 100);
    const items = itemButtons(menu()!);
    expect(items.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Undo (Ctrl+Z)",
      "Redo (Ctrl+Shift+Z)",
      "Format",
      "Delete",
    ]);
  });

  it("lands initial focus on the first enabled item", () => {
    const { rightClick } = renderSurface(ITEMS);
    rightClick(100, 100);
    // The first item is enabled; a leading disabled item would be skipped.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Undo (Ctrl+Z)");
  });

  it("selecting a leaf item runs its onSelect and closes the menu", () => {
    const selected: string[] = [];
    const { rightClick, menu, onClosed } = renderSurface(
      [
        { id: "a", label: "A", onSelect: () => selected.push("a") },
        { id: "b", label: "B", onSelect: () => selected.push("b") },
      ],
    );
    onClosed(() => selected.push("closed"));
    rightClick(100, 100);
    const [a] = itemButtons(menu()!);
    act(() => {
      a.click();
    });
    expect(selected).toEqual(["a", "closed"]);
    expect(menu()).toBeNull();
  });

  it("a disabled item is inert on click and skipped by arrow navigation", () => {
    const selected: string[] = [];
    const { rightClick, menu } = renderSurface([
      { id: "a", label: "A", onSelect: () => selected.push("a") },
      { id: "b", label: "B", enabled: false, onSelect: () => selected.push("b") },
      { id: "c", label: "C", onSelect: () => selected.push("c") },
    ]);
    rightClick(100, 100);
    const [, b] = itemButtons(menu()!);
    act(() => {
      b.click();
    });
    expect(selected).toEqual([]);
    expect(menu()).not.toBeNull(); // still open

    // ArrowDown from A skips B (disabled) and lands on C.
    act(() => {
      itemButtons(menu()!)[0].focus();
    });
    pressKey("ArrowDown");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("C");
    pressKey("ArrowDown"); // wraps to A
    expect(document.activeElement?.getAttribute("aria-label")).toBe("A");
  });

  it("ArrowDown/ArrowUp navigate the enabled items, wrapping at the ends", () => {
    const { rightClick } = renderSurface(ITEMS);
    rightClick(100, 100);
    // Enabled top-level items: Undo, Format, Delete (Redo disabled, the
    // separator is not an item).
    const sequence: string[] = [];
    for (let i = 0; i < 4; i++) {
      pressKey("ArrowDown");
      sequence.push(document.activeElement!.getAttribute("aria-label")!);
    }
    expect(sequence).toEqual(["Format", "Delete", "Undo (Ctrl+Z)", "Format"]);
    // From Format: up wraps to Undo, up again to Delete.
    pressKey("ArrowUp");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Undo (Ctrl+Z)");
    pressKey("ArrowUp");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Delete");
  });

  it("Home and End jump to the first and last enabled item", () => {
    const { rightClick } = renderSurface(ITEMS);
    rightClick(100, 100);
    pressKey("End");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Delete");
    pressKey("Home");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Undo (Ctrl+Z)");
  });

  it("Enter (and Space) activate the focused leaf item and close", () => {
    const selected: string[] = [];
    const { rightClick, menu, onClosed } = renderSurface([
      { id: "a", label: "A", onSelect: () => selected.push("a") },
      { id: "b", label: "B", onSelect: () => selected.push("b") },
    ]);
    onClosed(() => selected.push("closed"));
    rightClick(100, 100);
    pressKey("ArrowDown"); // focus B
    pressKey("Enter");
    expect(selected).toEqual(["b", "closed"]);
    expect(menu()).toBeNull();

    // Space does the same: reopen the same surface's menu (focus lands on
    // the first item, A) and activate it with Space.
    rightClick(100, 100);
    pressKey(" ");
    expect(selected).toEqual(["b", "closed", "a", "closed"]);
    expect(menu()).toBeNull();
  });

  it("ArrowRight opens the focused item's submenu and focuses its first child", () => {
    const { rightClick, menu } = renderSurface(ITEMS);
    rightClick(100, 100);
    pressKey("ArrowDown"); // focus Format
    expect(menu()!.querySelector(".quillmd-context-submenu")).toBeNull();
    pressKey("ArrowRight");
    const sub = menu()!.querySelector<HTMLElement>(".quillmd-context-submenu");
    expect(sub, "submenu").not.toBeNull();
    expect(sub!.getAttribute("aria-label")).toBe("Format menu");
    // The submenu's first enabled child holds focus.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Bold (Ctrl+B)");
    // The parent item reports the open state.
    const format = itemButtons(menu()!).find((b) => b.getAttribute("aria-label") === "Format");
    expect(format!.getAttribute("aria-expanded")).toBe("true");
  });

  it("navigates inside an open submenu and ArrowLeft returns to the parent", () => {
    const { rightClick, menu } = renderSurface(ITEMS);
    rightClick(100, 100);
    pressKey("ArrowDown"); // Format
    pressKey("ArrowRight"); // open submenu, focus Bold
    pressKey("ArrowDown"); // Italic
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Italic (Ctrl+I)");
    pressKey("ArrowDown"); // wraps back to Bold
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Bold (Ctrl+B)");
    pressKey("ArrowLeft"); // close the submenu, focus returns to Format
    expect(menu()!.querySelector(".quillmd-context-submenu")).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Format");
  });

  it("Enter on a submenu parent opens it instead of dismissing the menu", () => {
    const { rightClick, menu } = renderSurface(ITEMS);
    rightClick(100, 100);
    pressKey("ArrowDown"); // Format
    pressKey("Enter");
    expect(menu()).not.toBeNull();
    expect(menu()!.querySelector(".quillmd-context-submenu")).not.toBeNull();
  });

  it("Escape closes an open submenu first, then the menu; Tab dismisses", () => {
    const { rightClick, menu, onClosed } = renderSurface(ITEMS);
    let closes = 0;
    onClosed(() => {
      closes++;
    });
    rightClick(100, 100);
    pressKey("ArrowDown"); // Format
    pressKey("ArrowRight"); // open submenu

    // First Escape: submenu closes, the menu stays, focus returns to the parent.
    pressKey("Escape");
    expect(menu()).not.toBeNull();
    expect(menu()!.querySelector(".quillmd-context-submenu")).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Format");
    expect(closes).toBe(0);

    // Second Escape: the menu closes.
    pressKey("Escape");
    expect(menu()).toBeNull();
    expect(closes).toBe(1);

    // Tab dismisses a freshly opened menu (reopen the same surface).
    rightClick(100, 100);
    pressKey("Tab");
    expect(menu()).toBeNull();
    expect(closes).toBe(2);
  });

  it("a mousedown outside the menu dismisses it; inside keeps it open", () => {
    const { rightClick, menu, onClosed } = renderSurface(ITEMS);
    let closes = 0;
    onClosed(() => {
      closes++;
    });
    rightClick(100, 100);
    expect(menu()).not.toBeNull();

    // Click inside the menu (on an item, but as a bare mousedown) — stays open.
    const item = itemButtons(menu()!)[0];
    act(() => {
      item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(menu()).not.toBeNull();
    expect(closes).toBe(0);

    // A mousedown elsewhere in the document dismisses.
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(menu()).toBeNull();
    expect(closes).toBe(1);
  });

  it("supplements the surface's own dismissal: the surface unmounts the menu", () => {
    const { rightClick, menu } = renderSurface(ITEMS);
    rightClick(100, 100);
    expect(menu()).not.toBeNull();
    // The surface's contextmenu handler is the only opener; a second
    // right-click on the surface (with the menu already open) re-anchors the
    // menu at the new cursor position — the surface owns open/close state.
    rightClick(400, 300);
    const m = menu();
    expect(m).not.toBeNull();
    expect(m!.style.left).toBe("400px");
    expect(m!.style.top).toBe("300px");
  });
});
