// @vitest-environment jsdom
// The tab bar's right-click context menu (plan 03 task 3.6, issue #44; plan
// 03 §2 item 5): right-clicking a tab shows Close / Close Others / Close
// All. Close dispatches the tab's close flow (the same closeDoc the File
// menu uses, so the dirty confirm is identical), Close Others keeps the
// right-clicked tab (confirming the other dirty tabs as one batch), and
// Close All closes every tab. The shared ContextMenu component (task 3.1,
// issue #39) renders the menu at the cursor.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import TabBar, { type TabInfo } from "../../components/TabBar";
import { isSeparator, type ContextMenuItem } from "../../components/ContextMenu";
import {
  TAB_MENU_ITEM_IDS,
  buildTabMenu,
  isTabMenuSeparator,
  toTabContextEntries,
  type TabMenuItem,
} from "../tabMenu";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function makeTabs(paths: string[]): TabInfo[] {
  return paths.map((path) => ({ path, dirty: false, viewMode: "wysiwyg" as const }));
}

describe("buildTabMenu (plan 03 §2 item 5)", () => {
  it("carries the plan 03 tab item set in display order, with the plan's labels", () => {
    const items = buildTabMenu(["/docs/a.md", "/docs/b.md"], "/docs/a.md");
    expect(items.filter((e) => !isTabMenuSeparator(e)).map((i) => (i as TabMenuItem).id)).toEqual(
      [...TAB_MENU_ITEM_IDS],
    );
    expect(items.filter((e) => !isTabMenuSeparator(e)).map((i) => (i as TabMenuItem).label)).toEqual(
      ["Close", "Close Others", "Close All"],
    );
  });

  it("always enables Close and Close All (Close carries the Ctrl+W hint)", () => {
    const items = buildTabMenu(["/docs/a.md"], "/docs/a.md");
    const close = items.find((e): e is TabMenuItem => !isTabMenuSeparator(e) && e.id === "tab-close");
    const closeAll = items.find((e): e is TabMenuItem => !isTabMenuSeparator(e) && e.id === "tab-close-all");
    expect(close?.enabled).toBe(true);
    expect(close?.shortcut).toBe("Ctrl+W");
    expect(closeAll?.enabled).toBe(true);
  });

  it("enables Close Others with several tabs and disables it for the last tab", () => {
    const many = buildTabMenu(["/docs/a.md", "/docs/b.md", "/docs/c.md"], "/docs/b.md");
    const othersMany = many.find(
      (e): e is TabMenuItem => !isTabMenuSeparator(e) && e.id === "tab-close-others",
    );
    expect(othersMany?.enabled).toBe(true);

    const one = buildTabMenu(["/docs/a.md"], "/docs/a.md");
    const othersOne = one.find(
      (e): e is TabMenuItem => !isTabMenuSeparator(e) && e.id === "tab-close-others",
    );
    expect(othersOne?.enabled).toBe(false);
  });
});

describe("toTabContextEntries (the ContextMenu mapping)", () => {
  it("wires each item's onSelect to the dispatch, keeps separators, and carries state", () => {
    const items = buildTabMenu(["/docs/a.md", "/docs/b.md"], "/docs/a.md");
    const dispatched: TabMenuItem[] = [];
    const mapped = toTabContextEntries(items, (item) => dispatched.push(item));
    expect(mapped).toHaveLength(4);
    expect(mapped.filter((e) => isSeparator(e))).toHaveLength(1);
    const closeOthers = mapped.find(
      (e) => !isSeparator(e) && e.id === "tab-close-others",
    ) as ContextMenuItem;
    expect(closeOthers.label).toBe("Close Others");
    closeOthers.onSelect?.();
    expect(dispatched.map((i) => i.action)).toEqual(["close-others"]);
  });
});

describe("TabBar surface (plan 03 AC4)", () => {
  let roots: Root[] = [];
  let container: HTMLDivElement;

  afterEach(() => {
    for (const root of roots) root.unmount();
    roots = [];
    document.body.innerHTML = "";
  });

  interface TabCallbacks {
    onClose: (path: string) => void;
    onCloseOthers: (keepPath: string) => void;
    onCloseAll: () => void;
  }

  function renderTabBar(tabs: TabInfo[], callbacks: Partial<TabCallbacks> = {}) {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const noop = () => {};
    act(() => {
      root.render(
        <TabBar
          tabs={tabs}
          activePath={tabs[0]?.path ?? ""}
          onSelect={noop}
          onClose={callbacks.onClose ?? noop}
          onCloseOthers={callbacks.onCloseOthers ?? noop}
          onCloseAll={callbacks.onCloseAll ?? noop}
          onNewTab={noop}
        />,
      );
    });
    return container;
  }

  function tabButton(path: string): HTMLElement {
    const tab = document.querySelector<HTMLElement>(`.quillmd-tab[title^="${path}"]`);
    if (!tab) throw new Error(`tab not found: ${path}`);
    return tab;
  }

  function openMenu(path: string): void {
    act(() => {
      tabButton(path).dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 60 }),
      );
    });
  }

  function menuItemButton(label: string): HTMLButtonElement {
    // Items with a shortcut hint carry it in the aria-label ("Close (Ctrl+W)").
    const button =
      document.querySelector<HTMLButtonElement>(`.quillmd-context-item[aria-label="${label}"]`) ??
      document.querySelector<HTMLButtonElement>(`.quillmd-context-item[aria-label^="${label} ("]`);
    if (!button) throw new Error(`menu item not found: ${label}`);
    return button;
  }

  it("right-clicking a tab opens the tab menu with the plan 03 item set", () => {
    renderTabBar(makeTabs(["/docs/a.md", "/docs/b.md"]));
    expect(document.querySelector(".quillmd-context-menu")).toBeNull();
    openMenu("/docs/a.md");
    const menu = document.querySelector(".quillmd-context-menu");
    expect(menu).not.toBeNull();
    for (const label of ["Close", "Close Others", "Close All"]) {
      expect(menuItemButton(label), label).not.toBeNull();
    }
    // The editor text menu's items are not part of the tab menu.
    expect(document.querySelector('.quillmd-context-item[aria-label="Bold"]')).toBeNull();
  });

  it("Close dispatches onClose with the right-clicked tab's path and closes the menu", () => {
    const closed: string[] = [];
    renderTabBar(makeTabs(["/docs/a.md", "/docs/b.md"]), { onClose: (p) => closed.push(p) });
    openMenu("/docs/b.md");
    act(() => {
      menuItemButton("Close").click();
    });
    expect(closed).toEqual(["/docs/b.md"]);
    expect(document.querySelector(".quillmd-context-menu")).toBeNull();
  });

  it("Close Others dispatches onCloseOthers with the right-clicked tab's path", () => {
    const kept: string[] = [];
    renderTabBar(makeTabs(["/docs/a.md", "/docs/b.md"]), { onCloseOthers: (p) => kept.push(p) });
    openMenu("/docs/a.md");
    act(() => {
      menuItemButton("Close Others").click();
    });
    expect(kept).toEqual(["/docs/a.md"]);
    expect(document.querySelector(".quillmd-context-menu")).toBeNull();
  });

  it("Close All dispatches onCloseAll", () => {
    let all = 0;
    renderTabBar(makeTabs(["/docs/a.md", "/docs/b.md"]), { onCloseAll: () => { all += 1; } });
    openMenu("/docs/a.md");
    act(() => {
      menuItemButton("Close All").click();
    });
    expect(all).toBe(1);
    expect(document.querySelector(".quillmd-context-menu")).toBeNull();
  });

  it("Close Others is inert (aria-disabled) when the tab is the only one open", () => {
    let others = 0;
    renderTabBar(makeTabs(["/docs/a.md"]), { onCloseOthers: () => { others += 1; } });
    openMenu("/docs/a.md");
    const item = document.querySelector<HTMLButtonElement>(
      '.quillmd-context-item[aria-label="Close Others"]',
    );
    expect(item?.getAttribute("aria-disabled")).toBe("true");
    // A disabled item cannot be activated (the shared menu gates it).
    act(() => {
      item?.click();
    });
    expect(others).toBe(0);
  });
});

describe("App.tsx tab-menu wiring (plan 03 task 3.6, issue #44)", () => {
  const repoFile = (rel: string): string => {
    const url = new URL(rel, import.meta.url);
    return readFileSync(fileURLToPath(url), "utf8");
  };

  it("TabBar receives the close-others / close-all flows from the App", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain("onCloseOthers={(keep) => void closeOthers(keep)}");
    expect(app).toContain("onCloseAll={() => void closeAll()}");
  });

  it("closeOthers keeps the right-clicked tab, confirms the rest as one batch, then activates it", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain("const closeOthers = useCallback(");
    // The batch confirm runs over the "others" only (the kept tab excluded).
    expect(app).toMatch(
      /Object\.entries\(docs\)\.filter\(\(\[path\]\) => path !== keepPath\)/,
    );
    expect(app).toContain("confirmCloseAll(");
    expect(app).toContain("setActivePath(keepPath)");
    expect(app).toContain('setStatus("Closed other documents")');
  });
});
