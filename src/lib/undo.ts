// Unified markdown-text undo stack shared by both editing surfaces
// (WYSIWYG and Source). It is deliberately decoupled from save: autosave or
// explicit save never clears or re-bases the stack, so undo past a save
// restores the pre-save markdown bytes (spec §2.1.6).

export interface UndoEntry {
  text: string;
  // Monotonic sequence number, used only for action grouping.
  seq: number;
}

export class UndoStack {
  private states: string[];
  private index: number;
  private grouping = false;
  private pending: string | null = null;
  private seq = 0;

  constructor(initial: string, private readonly maxSteps = 1000) {
    this.states = [initial];
    this.index = 0;
  }

  current(): string {
    return this.states[this.index];
  }

  // Opens an action group. Every push until endGroup() is coalesced into a
  // single undo step, so one user action equals one undo step.
  beginGroup(): void {
    this.grouping = true;
    this.pending = null;
  }

  endGroup(): void {
    if (this.grouping && this.pending !== null) {
      this.commit(this.pending);
      this.pending = null;
    }
    this.grouping = false;
  }

  // Records a new markdown-text snapshot. View toggles must NOT call this
  // (they never inject re-serializations into the chain).
  push(text: string): void {
    if (this.grouping) {
      this.pending = text;
      return;
    }
    this.commit(text);
  }

  private commit(text: string): void {
    if (text === this.current()) return;
    this.states = this.states.slice(0, this.index + 1);
    this.states.push(text);
    if (this.states.length > this.maxSteps) {
      this.states.shift();
    } else {
      this.index += 1;
    }
    this.seq += 1;
  }

  undo(): string | null {
    if (this.index <= 0) return null;
    this.index -= 1;
    return this.states[this.index];
  }

  redo(): string | null {
    if (this.index >= this.states.length - 1) return null;
    this.index += 1;
    return this.states[this.index];
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index < this.states.length - 1;
  }

  // Snapshot the full stack for diagnostics/tests.
  dump(): UndoEntry[] {
    return this.states.map((text, i) => ({ text, seq: i }));
  }
}
