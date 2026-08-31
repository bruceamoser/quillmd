// @vitest-environment jsdom
// Find & replace panel (plan 07 task 7.2, issue #70): the panel's UI,
// result counter, error states, and keyboard model (Esc / F3 / Shift+F3 /
// Enter / Shift+Enter / ArrowUp / ArrowDown). The panel is fully controlled,
// so these tests drive it through props alone — no editor involved.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import FindReplacePanel, {
  type FindPanelMode,
  type FindPanelOption,
  type FindPanelResult,
} from "../../components/FindReplacePanel";
import type { FindPanelPosition } from "../findMemory";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface PanelProps {
  mode: FindPanelMode;
  term: string;
  replaceTerm: string;
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  position: FindPanelPosition;
  result: FindPanelResult;
  onTermChange: (term: string) => void;
  onReplaceTermChange: (term: string) => void;
  onToggle: (option: FindPanelOption) => void;
  onModeChange: (mode: FindPanelMode) => void;
  onNext: () => void;
  onPrev: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
  onPositionToggle: () => void;
}

function makeProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    mode: "find",
    term: "hello",
    replaceTerm: "hi",
    matchCase: false,
    wholeWord: false,
    useRegex: false,
    position: "top",
    result: { count: 17, active: 2, error: null, activeCrossBlock: false },
    onTermChange: vi.fn(),
    onReplaceTermChange: vi.fn(),
    onToggle: vi.fn(),
    onModeChange: vi.fn(),
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onReplace: vi.fn(),
    onReplaceAll: vi.fn(),
    onClose: vi.fn(),
    onPositionToggle: vi.fn(),
    ...overrides,
  };
}

let roots: Root[] = [];
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  for (const root of roots) root.unmount();
  roots = [];
  container.remove();
});

function render(props: PanelProps) {
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(<FindReplacePanel {...props} />);
  });
  const buttonByText = (text: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === text,
    );
  return {
    termInput: container.querySelector<HTMLInputElement>('input[aria-label="Find"]'),
    replaceInput: container.querySelector<HTMLInputElement>('input[aria-label="Replace with"]'),
    counter: container.querySelector(".quillmd-find-counter"),
    errorLine: container.querySelector(".quillmd-find-error"),
    prev: container.querySelector<HTMLButtonElement>('button[aria-label="Previous match"]'),
    next: container.querySelector<HTMLButtonElement>('button[aria-label="Next match"]'),
    close: container.querySelector<HTMLButtonElement>('button[aria-label="Close find panel"]'),
    modeToggle: container.querySelector<HTMLButtonElement>('button[aria-label="Toggle replace row"]'),
    positionToggle: container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Move find panel"]',
    ),
    panel: container.querySelector(".quillmd-find-panel"),
    replace: buttonByText("Replace"),
    replaceAll: buttonByText("Replace All"),
  };
}

// Dispatches a keydown the way the browser delivers it (bubbling from the
// focused input through the panel root where the panel's handler lives).
function key(target: EventTarget & HTMLElement, keyName: string, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true, ...init }),
    );
  });
}

describe("find panel UI (plan 07 task 7.2, issue #70)", () => {
  it("renders the find row: input, counter, nav, toggles, close", () => {
    const q = render(makeProps());
    expect(q.termInput?.value).toBe("hello");
    expect(q.counter?.textContent).toBe("3 of 17");
    expect(q.prev).toBeTruthy();
    expect(q.next).toBeTruthy();
    expect(q.close).toBeTruthy();
    // Match case / whole word / regex toggles, none active by default.
    const toggles = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".quillmd-find-toggle"),
    );
    expect(toggles).toHaveLength(3);
    expect(toggles.map((t) => t.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "false",
    ]);
    // The replace row is hidden in find mode.
    expect(q.replaceInput).toBeNull();
    expect(q.replace).toBeUndefined();
  });

  it("shows the replace row in replace mode with replace input and buttons", () => {
    const q = render(makeProps({ mode: "replace" }));
    expect(q.replaceInput?.value).toBe("hi");
    expect(q.replace).toBeTruthy();
    expect(q.replaceAll).toBeTruthy();
  });

  it("focuses and selects the term input on mount (Word behavior)", () => {
    const q = render(makeProps({ term: "hello" }));
    expect(document.activeElement).toBe(q.termInput);
    expect(q.termInput?.selectionStart).toBe(0);
    expect(q.termInput?.selectionEnd).toBe("hello".length);
  });

  it("emits onTermChange / onReplaceTermChange as the inputs change", () => {
    const props = makeProps({ mode: "replace" });
    const q = render(props);
    // React tracks input values through the native setter, so set it the way
    // a real keystroke would and dispatch the input event.
    const setNative = (el: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!
        .set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    act(() => {
      setNative(q.termInput!, "hey");
    });
    act(() => {
      setNative(q.replaceInput!, "yo");
    });
    expect(props.onTermChange).toHaveBeenLastCalledWith("hey");
    expect(props.onReplaceTermChange).toHaveBeenLastCalledWith("yo");
  });

  it("toggle buttons reflect state, show the active style, and emit onToggle", () => {
    const props = makeProps({ matchCase: true });
    render(props);
    const toggles = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".quillmd-find-toggle"),
    );
    expect(toggles[0].getAttribute("aria-pressed")).toBe("true");
    expect(toggles[0].classList.contains("active")).toBe(true);

    act(() => {
      toggles[1].click();
    });
    act(() => {
      toggles[2].click();
    });
    expect(props.onToggle).toHaveBeenNthCalledWith(1, "wholeWord");
    expect(props.onToggle).toHaveBeenNthCalledWith(2, "useRegex");
  });

  it("the mode toggle expands and collapses the replace row", () => {
    const props = makeProps();
    const q = render(props);
    expect(q.modeToggle?.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      q.modeToggle?.click();
    });
    expect(props.onModeChange).toHaveBeenLastCalledWith("replace");

    roots[roots.length - 1].unmount();
    const root2 = createRoot(container);
    roots.push(root2);
    act(() => {
      root2.render(<FindReplacePanel {...makeProps({ mode: "replace" })} />);
    });
    const mode2 = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle replace row"]',
    );
    expect(mode2?.getAttribute("aria-expanded")).toBe("true");
  });

  it("the close button calls onClose", () => {
    const props = makeProps();
    const q = render(props);
    act(() => {
      q.close?.click();
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("find panel counter and error states", () => {
  it("shows the 1-based active index over the total (n of m)", () => {
    for (const [active, count, text] of [
      [0, 1, "1 of 1"],
      [2, 17, "3 of 17"],
      [9, 10, "10 of 10"],
    ] as const) {
      const q = render(makeProps({ result: { count, active, error: null, activeCrossBlock: false } }));
      expect(q.counter?.textContent).toBe(text);
      expect(q.termInput?.classList.contains("error")).toBe(false);
      roots[roots.length - 1].unmount();
    }
  });

  it("shows No results with a red term input when the term has no matches", () => {
    const q = render(makeProps({ result: { count: 0, active: -1, error: null, activeCrossBlock: false } }));
    expect(q.counter?.textContent).toBe("No results");
    expect(q.counter?.classList.contains("error")).toBe(true);
    expect(q.termInput?.classList.contains("error")).toBe(true);
  });

  it("stays neutral (empty counter, no red) for an empty term", () => {
    const q = render(makeProps({ term: "", result: { count: 0, active: -1, error: null, activeCrossBlock: false } }));
    expect(q.counter?.textContent).toBe("");
    expect(q.termInput?.classList.contains("error")).toBe(false);
    expect(q.errorLine).toBeNull();
  });

  it("shows the regex error inline with a red input and suppressed search", () => {
    const q = render(
      makeProps({
        term: "([unclosed",
        useRegex: true,
        result: {
          count: 0,
          active: -1,
          error: "Invalid regular expression: /([unclosed/i: Unterminated group",
          activeCrossBlock: false,
        },
      }),
    );
    expect(q.errorLine?.textContent).toBe(
      "Invalid regular expression: /([unclosed/i: Unterminated group",
    );
    expect(q.counter?.textContent).toBe("Invalid regex");
    expect(q.termInput?.classList.contains("error")).toBe(true);
    // No search ran: navigation is unavailable.
    expect(q.prev?.disabled).toBe(true);
    expect(q.next?.disabled).toBe(true);
  });
});

describe("find panel keyboard model", () => {
  it("Esc closes the panel", () => {
    const props = makeProps();
    const q = render(props);
    key(q.termInput!, "Escape");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("F3 goes next, Shift+F3 goes previous", () => {
    const props = makeProps();
    const q = render(props);
    key(q.termInput!, "F3");
    expect(props.onNext).toHaveBeenCalledTimes(1);
    expect(props.onPrev).not.toHaveBeenCalled();
    key(q.termInput!, "F3", { shiftKey: true });
    expect(props.onPrev).toHaveBeenCalledTimes(1);
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it("Enter goes next, Shift+Enter goes previous", () => {
    const props = makeProps();
    const q = render(props);
    key(q.termInput!, "Enter");
    expect(props.onNext).toHaveBeenCalledTimes(1);
    key(q.termInput!, "Enter", { shiftKey: true });
    expect(props.onPrev).toHaveBeenCalledTimes(1);
  });

  it("ArrowDown goes next and ArrowUp goes previous from either input", () => {
    const props = makeProps({ mode: "replace" });
    const q = render(props);
    key(q.termInput!, "ArrowDown");
    key(q.replaceInput!, "ArrowUp");
    expect(props.onNext).toHaveBeenCalledTimes(1);
    expect(props.onPrev).toHaveBeenCalledTimes(1);
  });

  it("handled keys stop propagation so window-level shortcuts do not double-fire", () => {
    const props = makeProps();
    const q = render(props);
    let windowF3 = 0;
    let windowEsc = 0;
    const onF3 = () => {
      windowF3 += 1;
    };
    const onEsc = () => {
      windowEsc += 1;
    };
    window.addEventListener("keydown", onF3);
    window.addEventListener("keydown", onEsc);
    try {
      key(q.termInput!, "F3");
      key(q.termInput!, "Escape");
    } finally {
      window.removeEventListener("keydown", onF3);
      window.removeEventListener("keydown", onEsc);
    }
    expect(props.onNext).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(windowF3).toBe(0);
    expect(windowEsc).toBe(0);
  });

  it("navigation buttons are disabled without matches and wired with matches", () => {
    const none = render(makeProps({ result: { count: 0, active: -1, error: null, activeCrossBlock: false } }));
    expect(none.prev?.disabled).toBe(true);
    expect(none.next?.disabled).toBe(true);
    roots[roots.length - 1].unmount();

    const props = makeProps();
    const q = render(props);
    expect(q.prev?.disabled).toBe(false);
    expect(q.next?.disabled).toBe(false);
    act(() => {
      q.prev?.click();
    });
    act(() => {
      q.next?.click();
    });
    expect(props.onPrev).toHaveBeenCalledTimes(1);
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });
});

describe("find panel replace buttons", () => {
  it("Replace is disabled with a tooltip while the active match spans blocks", () => {
    const props = makeProps({
      mode: "replace",
      result: { count: 3, active: 1, error: null, activeCrossBlock: true },
    });
    const q = render(props);
    expect(q.replace?.disabled).toBe(true);
    expect(q.replace?.title).toContain("spans multiple blocks");
    // Replace All still works: cross-block matches are simply skipped there.
    expect(q.replaceAll?.disabled).toBe(false);
    act(() => {
      q.replaceAll?.click();
    });
    expect(props.onReplaceAll).toHaveBeenCalledTimes(1);
    act(() => {
      q.replace?.click();
    });
    expect(props.onReplace).not.toHaveBeenCalled();
  });

  it("Replace and Replace All are disabled without matches or on regex error", () => {
    const noMatch = render(
      makeProps({
        mode: "replace",
        result: { count: 0, active: -1, error: null, activeCrossBlock: false },
      }),
    );
    expect(noMatch.replace?.disabled).toBe(true);
    expect(noMatch.replaceAll?.disabled).toBe(true);
    roots[roots.length - 1].unmount();

    const error = render(
      makeProps({
        mode: "replace",
        result: { count: 0, active: -1, error: "bad regex", activeCrossBlock: false },
      }),
    );
    expect(error.replace?.disabled).toBe(true);
    expect(error.replaceAll?.disabled).toBe(true);
  });

  it("Replace and Replace All are wired when a match is active", () => {
    const props = makeProps({ mode: "replace" });
    const q = render(props);
    expect(q.replace?.disabled).toBe(false);
    expect(q.replaceAll?.disabled).toBe(false);
    act(() => {
      q.replace?.click();
    });
    act(() => {
      q.replaceAll?.click();
    });
    expect(props.onReplace).toHaveBeenCalledTimes(1);
    expect(props.onReplaceAll).toHaveBeenCalledTimes(1);
  });
});

// Panel position setting (plan 07 task 7.5, issue #73): the panel can be
// docked to the top (default) or bottom of the editor; the toggle button on
// the panel flips the position and the "bottom" class drives the CSS docking.
describe("find panel position", () => {
  it("defaults to the top: no bottom class, toggle offers to move to bottom", () => {
    const q = render(makeProps({ position: "top" }));
    expect(q.panel?.classList.contains("bottom")).toBe(false);
    expect(q.positionToggle?.getAttribute("aria-label")).toBe(
      "Move find panel to bottom",
    );
    // Downward chevron while docked at the top.
    expect(q.positionToggle?.textContent).toBe("\u25BE");
  });

  it("applies the bottom class and offers to move back to top", () => {
    const q = render(makeProps({ position: "bottom" }));
    expect(q.panel?.classList.contains("bottom")).toBe(true);
    expect(q.positionToggle?.getAttribute("aria-label")).toBe(
      "Move find panel to top",
    );
    // Upward chevron while docked at the bottom.
    expect(q.positionToggle?.textContent).toBe("\u25B4");
  });

  it("the toggle button calls onPositionToggle (and keeps focus)", () => {
    const props = makeProps({ position: "top" });
    const q = render(props);
    act(() => {
      q.positionToggle?.click();
    });
    expect(props.onPositionToggle).toHaveBeenCalledTimes(1);
  });

  it("the toggle does not steal focus from the term input on mousedown", () => {
    const props = makeProps({ position: "top" });
    const q = render(props);
    q.termInput?.focus();
    const evt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      q.positionToggle?.dispatchEvent(evt);
    });
    // keepFocus preventDefault'd the default focus transfer.
    expect(evt.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(q.termInput);
  });
});
