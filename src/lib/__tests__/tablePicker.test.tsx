// @vitest-environment jsdom
// Table size-picker popover + "Insert table…" dialog (plan 06 task 6.3,
// issue #63): the 10x10 hover grid (hover previews rows x cols, the pick
// reports the exact size) and the dialog's field validation (whole numbers
// in 1..99, header-row checkbox, Enter/Esc keyboard model).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import TableSizePicker from "../../components/TableSizePicker";
import InsertTableDialog from "../../components/InsertTableDialog";
import { TABLE_PICKER_SIZE, type TableInsertSpec } from "../tables";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  const r = root;
  if (r) {
    act(() => r.unmount());
    root = null;
  }
  document.body.innerHTML = "";
});

function render(ui: React.ReactNode): void {
  const r = createRoot(container);
  root = r;
  act(() => {
    r.render(ui);
  });
}

function cellAt(rows: number, cols: number): HTMLDivElement {
  const cell = container.querySelector<HTMLDivElement>(
    `.quillmd-table-picker-cell[data-row="${rows}"][data-col="${cols}"]`,
  );
  expect(cell, `cell ${rows}x${cols}`).not.toBeNull();
  return cell!;
}

// React synthesizes onMouseEnter/onMouseLeave from the native mouseover /
// mouseout events (no relatedTarget = the pointer came from outside), so the
// tests dispatch those, the same shape as fireEvent.mouseOver / mouseOut.
function hover(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }));
  });
}

function leave(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, cancelable: true }));
  });
}

function press(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  });
}

describe("TableSizePicker (issue #63)", () => {
  it("renders the plan 06 §3 10x10 grid", () => {
    render(<TableSizePicker onPick={vi.fn()} />);
    expect(container.querySelectorAll(".quillmd-table-picker-cell")).toHaveLength(
      TABLE_PICKER_SIZE * TABLE_PICKER_SIZE,
    );
    expect(cellAt(1, 1)).not.toBeNull();
    expect(cellAt(10, 10)).not.toBeNull();
    // No hover yet: nothing active, the readout shows the range.
    expect(container.querySelectorAll(".quillmd-table-picker-cell.active")).toHaveLength(0);
    expect(container.querySelector(".quillmd-table-picker-readout")?.textContent).toBe(
      "1 – 10",
    );
  });

  it("hovering a cell previews the rows x cols rectangle (rows from top, cols from left)", () => {
    render(<TableSizePicker onPick={vi.fn()} />);
    hover(cellAt(7, 2));
    // The active rectangle is rows <= 7 and cols <= 2: 7 * 2 cells.
    const active = container.querySelectorAll(".quillmd-table-picker-cell.active");
    expect(active).toHaveLength(14);
    expect(cellAt(7, 2).className).toContain("active");
    expect(cellAt(6, 1).className).toContain("active");
    // Just outside the rectangle: inactive.
    expect(cellAt(8, 1).className).not.toContain("active");
    expect(cellAt(1, 3).className).not.toContain("active");
    // The readout shows the hovered size.
    expect(container.querySelector(".quillmd-table-picker-readout")?.textContent).toBe("7 × 2");
  });

  it("hovering the top-left cell previews a 1x1", () => {
    render(<TableSizePicker onPick={vi.fn()} />);
    hover(cellAt(1, 1));
    expect(container.querySelectorAll(".quillmd-table-picker-cell.active")).toHaveLength(1);
    expect(container.querySelector(".quillmd-table-picker-readout")?.textContent).toBe("1 × 1");
  });

  it("moving the hover to another cell moves the rectangle", () => {
    render(<TableSizePicker onPick={vi.fn()} />);
    hover(cellAt(4, 4));
    expect(container.querySelectorAll(".quillmd-table-picker-cell.active")).toHaveLength(16);
    hover(cellAt(2, 3));
    const active = container.querySelectorAll(".quillmd-table-picker-cell.active");
    expect(active).toHaveLength(6);
    expect(cellAt(2, 3).className).toContain("active");
    expect(cellAt(4, 4).className).not.toContain("active");
  });

  it("leaving the grid clears the preview", () => {
    render(<TableSizePicker onPick={vi.fn()} />);
    hover(cellAt(5, 5));
    expect(container.querySelectorAll(".quillmd-table-picker-cell.active")).toHaveLength(25);
    leave(container.querySelector(".quillmd-table-picker-grid")!);
    expect(container.querySelectorAll(".quillmd-table-picker-cell.active")).toHaveLength(0);
    expect(container.querySelector(".quillmd-table-picker-readout")?.textContent).toBe(
      "1 – 10",
    );
  });

  it("the pick reports exactly the hovered size with a header row", () => {
    const onPick = vi.fn<(spec: TableInsertSpec) => void>();
    render(<TableSizePicker onPick={(s) => onPick(s)} />);
    hover(cellAt(7, 2));
    press(cellAt(7, 2));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({ rows: 7, cols: 2, withHeaderRow: true });

    onPick.mockClear();
    press(cellAt(10, 10));
    expect(onPick).toHaveBeenCalledWith({ rows: 10, cols: 10, withHeaderRow: true });
  });

  it("the pick works without a prior hover (the cell under the pointer wins)", () => {
    const onPick = vi.fn<(spec: TableInsertSpec) => void>();
    render(<TableSizePicker onPick={(s) => onPick(s)} />);
    press(cellAt(3, 5));
    expect(onPick).toHaveBeenCalledWith({ rows: 3, cols: 5, withHeaderRow: true });
  });
});

describe("InsertTableDialog (issue #63)", () => {
  function fields() {
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="number"]');
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(inputs).toHaveLength(2);
    expect(checkbox).not.toBeNull();
    return {
      rows: inputs[0]!,
      cols: inputs[1]!,
      header: checkbox!,
      insert: container.querySelector<HTMLButtonElement>(
        "button.quillmd-image-button.primary",
      )!,
      cancel: container.querySelector<HTMLButtonElement>(
        "button.quillmd-image-button:not(.primary)",
      )!,
    };
  }

  // React's value tracker swallows a direct `el.value = ...` (the instance
  // setter updates the tracker, so the input event reads "no change"). The
  // native prototype setter bypasses the tracker, so the input event reaches
  // React's onChange.
  function setNumber(el: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function pressKey(el: HTMLElement, key: string): void {
    act(() => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  }

  it("opens on the fixed 3x3 header table the picker replaces", () => {
    render(<InsertTableDialog onApply={vi.fn()} onClose={vi.fn()} />);
    const { rows, cols, header, insert } = fields();
    expect(rows.value).toBe("3");
    expect(cols.value).toBe("3");
    expect(header.checked).toBe(true);
    expect(insert.disabled).toBe(false);
    // The rows field is focused (plan 06 §3 keyboard model).
    expect(document.activeElement).toBe(rows);
  });

  it("submits the field values through onApply", () => {
    const onApply = vi.fn<(spec: TableInsertSpec) => void>();
    const onClose = vi.fn();
    render(<InsertTableDialog onApply={(s) => onApply(s)} onClose={onClose} />);
    const { rows, cols, header, insert } = fields();
    setNumber(rows, "7");
    setNumber(cols, "2");
    // Clicking toggles the checkbox and fires React's onChange.
    act(() => {
      header.click();
    });
    act(() => {
      insert.click();
    });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({ rows: 7, cols: 2, withHeaderRow: false });
    expect(onClose).not.toHaveBeenCalled(); // App closes the dialog after applying
  });

  it("submits the defaults (3x3 with header) untouched", () => {
    const onApply = vi.fn<(spec: TableInsertSpec) => void>();
    render(<InsertTableDialog onApply={(s) => onApply(s)} onClose={vi.fn()} />);
    act(() => {
      fields().insert.click();
    });
    expect(onApply).toHaveBeenCalledWith({ rows: 3, cols: 3, withHeaderRow: true });
  });

  it("disables Insert for blank, fractional, zero, and out-of-range values", () => {
    render(<InsertTableDialog onApply={vi.fn()} onClose={vi.fn()} />);
    const { rows, cols, insert } = fields();
    for (const bad of ["", "0", "100", "1.5", "-2"]) {
      setNumber(rows, bad);
      expect(insert.disabled, `rows=${JSON.stringify(bad)}`).toBe(true);
    }
    setNumber(rows, "3");
    for (const bad of ["", "0", "100", "1.5"]) {
      setNumber(cols, bad);
      expect(insert.disabled, `cols=${JSON.stringify(bad)}`).toBe(true);
    }
    // Back in range: enabled again.
    setNumber(cols, "99");
    expect(insert.disabled).toBe(false);
  });

  it("Enter on an invalid field shows the error and refuses to submit", () => {
    const onApply = vi.fn();
    render(<InsertTableDialog onApply={onApply} onClose={vi.fn()} />);
    const { rows } = fields();
    setNumber(rows, "150");
    pressKey(rows, "Enter");
    expect(onApply).not.toHaveBeenCalled();
    expect(container.querySelector(".quillmd-image-error")?.textContent).toBe(
      "Rows and columns must be whole numbers between 1 and 99.",
    );
    // Editing the field clears the error (live validation takes over).
    setNumber(rows, "7");
    expect(container.querySelector(".quillmd-image-error")).toBeNull();
  });

  it("Enter submits valid values", () => {
    const onApply = vi.fn<(spec: TableInsertSpec) => void>();
    render(<InsertTableDialog onApply={(s) => onApply(s)} onClose={vi.fn()} />);
    const { rows, cols } = fields();
    setNumber(rows, "12");
    setNumber(cols, "4");
    pressKey(cols, "Enter");
    expect(onApply).toHaveBeenCalledWith({ rows: 12, cols: 4, withHeaderRow: true });
  });

  it("Esc cancels without applying", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<InsertTableDialog onApply={onApply} onClose={onClose} />);
    const dialog = container.querySelector<HTMLElement>(".quillmd-table-dialog")!;
    pressKey(dialog, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("the Cancel button and the backdrop close; a dialog press does not", () => {
    const onClose = vi.fn();
    render(<InsertTableDialog onApply={vi.fn()} onClose={onClose} />);
    act(() => {
      fields().cancel.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    act(() => {
      container.querySelector(".quillmd-table-dialog-overlay")!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    });
    // The overlay's own press (e.target === e.currentTarget) cancels.
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    act(() => {
      container.querySelector(".quillmd-table-dialog-title")!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
