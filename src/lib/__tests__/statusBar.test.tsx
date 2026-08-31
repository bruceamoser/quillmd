// @vitest-environment jsdom
// Status-bar zoom readout (plan 02 task 2.6, issue #35): the current percent
// is displayed, and when a reset handler is provided the readout is a button
// that invokes it (Word behavior: click the zoom to reset to 100%).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import StatusBar from "../../components/StatusBar";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe("statusBar zoom readout (issue #35)", () => {
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

  const render = (props: Parameters<typeof StatusBar>[0]) => {
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<StatusBar {...props} />);
    });
    return container;
  };

  const baseProps = {
    mode: "wysiwyg" as const,
    wordCount: 3,
    charCount: 12,
    eol: "lf" as const,
    dirty: false,
    fileName: "a.md",
  };

  it("shows the current percent as a plain label without a reset handler", () => {
    render({ ...baseProps, zoom: 120 });
    const readout = container.querySelector(".quillmd-status-zoom");
    expect(readout?.textContent).toBe("120%");
    // No reset handler -> not a button.
    expect(readout?.tagName).not.toBe("BUTTON");
  });

  it("shows the default 100% when at the default zoom", () => {
    render({ ...baseProps, zoom: 100 });
    expect(container.querySelector(".quillmd-status-zoom")?.textContent).toBe("100%");
  });

  it("renders a reset button that invokes onZoomReset", () => {
    let resets = 0;
    render({ ...baseProps, zoom: 150, onZoomReset: () => { resets += 1; } });
    const button = container.querySelector<HTMLButtonElement>("button.quillmd-status-zoom");
    expect(button?.textContent).toBe("150%");
    act(() => {
      button?.click();
    });
    expect(resets).toBe(1);
  });
});

describe("statusBar spellcheck indicator (plan 02 §2.8, issue #36)", () => {
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

  const render = (props: Parameters<typeof StatusBar>[0]) => {
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<StatusBar {...props} />);
    });
    return container;
  };

  const baseProps = {
    mode: "wysiwyg" as const,
    wordCount: 3,
    charCount: 12,
    eol: "lf" as const,
    dirty: false,
    fileName: "a.md",
    zoom: 100,
  };

  it("shows the default on state as a plain label without a toggle handler", () => {
    render({ ...baseProps });
    const indicator = container.querySelector(".quillmd-status-spellcheck");
    expect(indicator?.textContent).toBe("Spellcheck: on");
    expect(indicator?.tagName).not.toBe("BUTTON");
  });

  it("shows the off state dimmed", () => {
    render({ ...baseProps, spellcheck: false });
    const indicator = container.querySelector(".quillmd-status-spellcheck");
    expect(indicator?.textContent).toBe("Spellcheck: off");
    expect(indicator?.classList.contains("off")).toBe(true);
  });

  it("renders a toggle button that invokes onSpellcheckToggle", () => {
    let toggles = 0;
    render({ ...baseProps, spellcheck: false, onSpellcheckToggle: () => { toggles += 1; } });
    const button = container.querySelector<HTMLButtonElement>("button.quillmd-status-spellcheck");
    expect(button?.textContent).toBe("Spellcheck: off");
    act(() => {
      button?.click();
    });
    expect(toggles).toBe(1);
  });
});
