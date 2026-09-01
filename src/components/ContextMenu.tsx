// Shared right-click context menu component (plan 03 task 3.1, issue #39;
// plan 03 §2): the single surface every right-click menu (editor text,
// tables, images, links, tabs, explorer — tasks 3.2-3.6) renders through.
//
// Declarative item model — label, icon, shortcut hint, enabled, checked,
// submenu, separator, danger — built by the per-surface builders (plan 03
// §3: buildTextMenu, buildTableMenu, ...) so enable/disable logic stays pure
// and unit-testable. The component itself is surface-agnostic: it renders
// whatever `items` it is given and reports dismissals through `onClose`;
// item activation calls the item's own `onSelect`, which the surface wires
// to its registry command dispatch (plan 03 AC1: 1:1 command mapping,
// identical behavior to every other surface).
//
// Positioning: the menu opens at the cursor (viewport coordinates — the
// contextmenu event's clientX/clientY) with `position: fixed`, so it is
// anchored to the viewport rather than the document: scrolling the page
// never drags the menu off-screen, and it is clamped to the viewport
// (MENU_VIEWPORT_MARGIN from every edge) via clampMenuPosition, which is
// pure and unit-tested. Submenus open to the right of the parent item and
// flip to the left when they would overflow the right edge
// (submenuPosition, also pure).
//
// Dismissal: Escape (a submenu closes first, returning focus to its parent
// item; a second Escape closes the menu) and any mousedown outside the
// menu. Leaf-item selection also closes the menu.
//
// Keyboard (plan 03 §2): ArrowDown/ArrowUp move between the enabled items
// of the open level (wrapping), Home/End jump to the first/last, Enter and
// Space activate the focused item (open its submenu when it has one),
// ArrowRight opens the focused item's submenu, ArrowLeft closes an open
// submenu back to its parent, Tab and Escape close (see dismissal). Focus
// is a roving tabindex over role="menuitem" buttons; every item carries a
// screen-reader label (plan 00 overview accessibility requirement) and the
// menu itself is labeled via `label` (defaults to "Context menu").

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

// --- declarative item model ------------------------------------------------

// A separator entry. Carries an optional stable id so surfaces can key it.
export interface ContextMenuSeparator {
  type: "separator";
  id?: string;
}

// One actionable entry (or a submenu opener). `id` is the stable key the
// surface builders and the tests address it by. The component dispatches
// nothing itself: `onSelect` is the surface's callback, which routes the
// pick through the editorCommands registry (or a dialog request, for the
// tab/explorer menus) — keeping this component surface-agnostic.
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  // The keyboard shortcut hint, right-aligned in the item ("Ctrl+Z").
  shortcut?: string;
  // Omit or true for enabled; false grays the item out (skipped by arrow
  // navigation, inert on click/Enter, aria-disabled).
  enabled?: boolean;
  // Set on checkable items (mode toggles like the diagram Edit/Preview
  // pair, header-row toggle) while the check is on.
  checked?: boolean;
  // Marks the destructive item (Delete table / Delete diagram / Delete
  // file) with the danger style; the surface still gates it on the P0
  // native confirm dialog.
  danger?: boolean;
  // Submenu entries; Enter/ArrowRight on the item opens it.
  submenu?: readonly ContextMenuEntry[];
  // Called when the item is activated (click or Enter/Space), before the
  // menu closes.
  onSelect?: () => void;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

// Type guard: a separator is the only entry kind carrying `type`.
export function isSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
  return (entry as ContextMenuSeparator).type === "separator";
}

// --- positioning -------------------------------------------------------------

// The gap kept between the menu's edge and the viewport edge when clamped.
export const MENU_VIEWPORT_MARGIN = 4;
// The gap between a submenu and its parent item's edge.
export const MENU_SUBMENU_GAP = 2;

export interface MenuSize {
  width: number;
  height: number;
}

// Clamp a menu opened at the cursor (x, y) so a `size`d menu stays inside
// the `viewport`, keeping MENU_VIEWPORT_MARGIN from every edge. Pure: the
// component feeds it the measured size after mount, and the tests exercise
// the edges (right/bottom overflow, off-screen cursor, menu larger than
// the viewport) directly. When the menu is larger than the viewport the
// margin pin wins — the menu is reachable at the top-left corner.
export function clampMenuPosition(
  x: number,
  y: number,
  size: MenuSize,
  viewport: MenuSize,
): { left: number; top: number } {
  const left = Math.max(
    MENU_VIEWPORT_MARGIN,
    Math.min(x, viewport.width - size.width - MENU_VIEWPORT_MARGIN),
  );
  const top = Math.max(
    MENU_VIEWPORT_MARGIN,
    Math.min(y, viewport.height - size.height - MENU_VIEWPORT_MARGIN),
  );
  return { left, top };
}

// The open parent item's viewport rect — the submenu's anchor.
export interface MenuAnchor {
  top: number;
  height: number;
  left: number;
  right: number;
}

// Position a submenu next to its parent item: to the right when it fits
// within the viewport, flipped to the left when it would overflow the right
// edge; the top edge aligns with the parent item's top, clamped to the
// viewport. Pure, like clampMenuPosition.
export function submenuPosition(
  anchor: MenuAnchor,
  size: MenuSize,
  viewport: MenuSize,
): { left: number; top: number } {
  const rightLeft = anchor.right + MENU_SUBMENU_GAP;
  const left =
    rightLeft + size.width <= viewport.width - MENU_VIEWPORT_MARGIN
      ? rightLeft
      : Math.max(MENU_VIEWPORT_MARGIN, anchor.left - size.width - MENU_SUBMENU_GAP);
  const top = Math.max(
    MENU_VIEWPORT_MARGIN,
    Math.min(anchor.top, viewport.height - size.height - MENU_VIEWPORT_MARGIN),
  );
  return { left, top };
}

function viewportSize(): MenuSize {
  return { width: window.innerWidth, height: window.innerHeight };
}

// --- component ---------------------------------------------------------------

export interface ContextMenuProps {
  // Cursor position in viewport coordinates (the contextmenu event's
  // clientX/clientY).
  x: number;
  y: number;
  items: readonly ContextMenuEntry[];
  // Dismissal callback: Escape, outside mousedown, and leaf-item selection
  // all route through it.
  onClose: () => void;
  // Screen-reader label for the menu itself (defaults to "Context menu").
  label?: string;
}

// Find a root item by id, narrowing the entry union to ContextMenuItem.
function findItem(
  items: readonly ContextMenuEntry[],
  id: string | null,
): ContextMenuItem | null {
  if (id === null) return null;
  return items.find((e): e is ContextMenuItem => !isSeparator(e) && e.id === id) ?? null;
}

// The enabled (navigable) items of an entry list: separators and disabled
// items drop out.
function enabledItems(entries: readonly ContextMenuEntry[]): ContextMenuItem[] {
  return entries.filter((e): e is ContextMenuItem => !isSeparator(e) && e.enabled !== false);
}

// The enabled items of a level: root (id null), or the submenu of the item
// with `id`.
function levelItems(items: readonly ContextMenuEntry[], id: string | null): ContextMenuItem[] {
  const entries = id === null ? items : (findItem(items, id)?.submenu ?? []);
  return enabledItems(entries);
}

function ariaLabelFor(item: ContextMenuItem): string {
  // Same label (+ shortcut) convention the toolbar buttons carry in their
  // title: the screen reader hears the full item, not just the glyph.
  return item.shortcut ? `${item.label} (${item.shortcut})` : item.label;
}

export default function ContextMenu({
  x,
  y,
  items,
  onClose,
  label = "Context menu",
}: ContextMenuProps) {
  // The top-level menu's clamped position. Initialized with a zero size
  // (the clamp is then just the margin floor) and re-clamped with the
  // measured size after mount, so a menu that would overflow the viewport
  // lands flush with the margin in the first painted frame.
  const [pos, setPos] = useState(() => clampMenuPosition(x, y, { width: 0, height: 0 }, viewportSize()));
  // The open submenu's position (null while no submenu is open).
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null);
  // The id of the root item whose submenu is open (null = closed).
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  // The roving-focus item id across the whole tree (null before the first
  // focus lands).
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  const setItemRef = useCallback((id: string) => (el: HTMLButtonElement | null) => {
    if (el) itemRefs.current.set(id, el);
    else itemRefs.current.delete(id);
  }, []);

  // The root item whose submenu is open (the submenu's anchor + parent);
  // callers additionally check `.submenu` (a root item without one never
  // opens, so the id stays null for it).
  const openSubmenuItem = openSubmenuId === null ? null : findItem(items, openSubmenuId);

  // The level the focused item lives in: the submenu's children when focus
  // is inside an open submenu, the root otherwise.
  const focusLevel: string | null =
    openSubmenuItem && openSubmenuItem.submenu?.some((e) => !isSeparator(e) && e.id === focusedId)
      ? openSubmenuId
      : null;

  const focusItem = useCallback((id: string) => {
    setFocusedId(id);
    itemRefs.current.get(id)?.focus();
  }, []);

  // Move roving focus within a level, wrapping at the ends. `from` null
  // (no focus yet in this level) lands on the first item for either arrow.
  const stepFocus = useCallback(
    (level: string | null, dir: 1 | -1, from: string | null): void => {
      const list = levelItems(items, level);
      if (list.length === 0) return;
      const idx = list.findIndex((e) => e.id === from);
      const next =
        idx === -1
          ? list[0]
          : list[(idx + dir + list.length) % list.length];
      focusItem(next.id);
    },
    [items, focusItem],
  );

  const focusEdge = useCallback(
    (level: string | null, end: boolean): void => {
      const list = levelItems(items, level);
      const target = end ? list[list.length - 1] : list[0];
      if (target) focusItem(target.id);
    },
    [items, focusItem],
  );

  const openSubmenu = useCallback((item: ContextMenuItem) => {
    // Focus on the first child lands in the layout effect below: the
    // submenu's DOM does not exist until this state update re-renders.
    setOpenSubmenuId(item.id);
  }, []);

  const closeSubmenu = useCallback(() => {
    if (openSubmenuId === null) return;
    setOpenSubmenuId(null);
    setSubPos(null);
    // Focus returns to the parent item that owns the submenu.
    focusItem(openSubmenuId);
  }, [openSubmenuId, focusItem]);

  const activateItem = useCallback(
    (item: ContextMenuItem) => {
      if (item.enabled === false) return;
      if (item.submenu) {
        openSubmenu(item);
        return;
      }
      item.onSelect?.();
      onClose();
    },
    [onClose, openSubmenu],
  );

  // --- positioning: measure after mount, clamp to the viewport ---------------

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next = clampMenuPosition(x, y, { width: r.width, height: r.height }, viewportSize());
    // Bail out when unchanged: the effect re-runs on items re-creation (a
    // surface rebuilds its item set on every transaction), and setting a
    // fresh object each time would loop a re-render.
    setPos((prev) => (prev.left === next.left && prev.top === next.top ? prev : next));
  }, [x, y]);

  // The submenu anchors to the parent item's rect; recompute when the open
  // submenu (or the items it renders) change.
  useLayoutEffect(() => {
    if (!openSubmenuItem || !openSubmenuItem.submenu) {
      setSubPos(null);
      return;
    }
    const parentEl = itemRefs.current.get(openSubmenuItem.id);
    const subEl = subRef.current;
    if (!parentEl || !subEl) return;
    const r = parentEl.getBoundingClientRect();
    const s = subEl.getBoundingClientRect();
    const next = submenuPosition(
      { top: r.top, height: r.height, left: r.left, right: r.right },
      { width: s.width, height: s.height },
      viewportSize(),
    );
    // Bail out when unchanged (same re-render loop guard as the top level).
    setSubPos((prev) => (prev && prev.left === next.left && prev.top === next.top ? prev : next));
  }, [openSubmenuItem, items]);

  // Land roving focus on the open submenu's first enabled child once the
  // submenu is mounted (openSubmenu runs before its DOM exists).
  useLayoutEffect(() => {
    if (openSubmenuId === null) return;
    const parent = findItem(items, openSubmenuId);
    if (!parent?.submenu) return;
    const first = enabledItems(parent.submenu)[0];
    if (first) focusItem(first.id);
    // openSubmenuId alone: a surface re-mounts the menu per open, and the
    // first child of a given submenu does not change under it.
  }, [openSubmenuId]);

  // --- keyboard --------------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const item =
        focusedId === null
          ? null
          : [...levelItems(items, null), ...(openSubmenuItem?.submenu ?? [])]
              .find((en): en is ContextMenuItem => !isSeparator(en) && en.id === focusedId) ?? null;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          stepFocus(focusLevel, 1, focusedId);
          return;
        case "ArrowUp":
          e.preventDefault();
          stepFocus(focusLevel, -1, focusedId);
          return;
        case "Home":
          e.preventDefault();
          focusEdge(focusLevel, false);
          return;
        case "End":
          e.preventDefault();
          focusEdge(focusLevel, true);
          return;
        case "ArrowRight":
          e.preventDefault();
          if (item?.submenu) openSubmenu(item);
          return;
        case "ArrowLeft":
          e.preventDefault();
          if (focusLevel !== null) closeSubmenu();
          return;
        case "Enter":
        case " ":
          e.preventDefault();
          if (item) activateItem(item);
          return;
        case "Escape":
          e.preventDefault();
          if (focusLevel !== null) closeSubmenu();
          else onClose();
          return;
        case "Tab":
          e.preventDefault();
          onClose();
          return;
      }
    },
    [
      items,
      focusedId,
      focusLevel,
      openSubmenuItem,
      stepFocus,
      focusEdge,
      openSubmenu,
      closeSubmenu,
      activateItem,
      onClose,
    ],
  );

  // --- focus + dismissal -------------------------------------------------------

  // Land roving focus on the first enabled item when the menu opens.
  useLayoutEffect(() => {
    const first = levelItems(items, null)[0];
    if (first) focusItem(first.id);
    // Mount-only: roving focus lands on the first enabled item when the
    // menu opens (the surface re-mounts the component per menu).
  }, []);

  // Dismiss on a mousedown anywhere outside the menu (the menu's own
  // clicks land inside, so item activation still runs its onClick).
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [onClose]);

  // --- rendering ---------------------------------------------------------------

  // The stable key for an entry: an item's id, or a separator's id (falling
  // back to its position when the separator carries none).
  const keyOf = (entry: ContextMenuEntry, index: number): string | number =>
    isSeparator(entry) ? (entry.id ?? `sep-${index}`) : entry.id;

  const renderEntry = (entry: ContextMenuEntry, key: string | number) => {
    if (isSeparator(entry)) {
      return <hr key={key} className="quillmd-context-sep" role="separator" />;
    }
    const item = entry;
    const focused = focusedId === item.id;
    const disabled = item.enabled === false;
    const submenuOpen = openSubmenuId === item.id && item.submenu !== undefined;
    const className = [
      "quillmd-context-item",
      item.danger ? "quillmd-context-danger" : "",
      item.submenu ? "quillmd-context-submenu-item" : "",
      focused ? "quillmd-context-focused" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <button
        key={item.id}
        ref={setItemRef(item.id)}
        type="button"
        role="menuitem"
        className={className}
        tabIndex={focused ? 0 : -1}
        aria-label={ariaLabelFor(item)}
        aria-disabled={disabled || undefined}
        aria-checked={item.checked === undefined ? undefined : item.checked}
        aria-haspopup={item.submenu ? "menu" : undefined}
        aria-expanded={item.submenu ? submenuOpen : undefined}
        onMouseEnter={() => {
          if (!disabled) {
            // Hovering moves the roving focus (and, for submenu parents,
            // opens the submenu) — the standard menu hover behavior.
            if (item.submenu && focusLevel === null && openSubmenuId !== item.id) {
              openSubmenu(item);
            } else {
              focusItem(item.id);
            }
          }
        }}
        onClick={() => activateItem(item)}
      >
        {item.icon !== undefined && (
          <span className="quillmd-context-icon" aria-hidden="true">
            {item.icon}
          </span>
        )}
        <span className="quillmd-context-check" aria-hidden="true">
          {item.checked ? "✓" : "\u00A0"}
        </span>
        <span className="quillmd-context-label">{item.label}</span>
        {item.shortcut !== undefined && (
          <span className="quillmd-context-shortcut" aria-hidden="true">
            {item.shortcut}
          </span>
        )}
        {item.submenu && (
          <span className="quillmd-context-caret" aria-hidden="true">
            {"›"}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      ref={menuRef}
      className="quillmd-context-menu"
      role="menu"
      aria-label={label}
      aria-orientation="vertical"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((entry, i) => renderEntry(entry, keyOf(entry, i)))}
      {openSubmenuItem && openSubmenuItem.submenu && (
        <div
          ref={subRef}
          className="quillmd-context-menu quillmd-context-submenu"
          role="menu"
          aria-label={`${openSubmenuItem.label} menu`}
          aria-orientation="vertical"
          style={{ left: subPos?.left ?? 0, top: subPos?.top ?? 0 }}
        >
          {openSubmenuItem.submenu.map((entry, i) => renderEntry(entry, keyOf(entry, i)))}
        </div>
      )}
    </div>
  );
}
