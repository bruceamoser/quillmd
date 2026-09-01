// @vitest-environment jsdom
// Spell check (plan 09 task 9.5, issue #88): the dialog component (flagged
// terms with counts, per-term Ignore / Add to dictionary, keyboard model,
// empty state), the registry command that requests it (Tools > Spelling…,
// Ctrl+Shift+F7), and the App wiring — the menu event and the shortcut open
// the dialog with the doc's flagged terms, "Ignore" suppresses a term for the
// session only, and "Add to dictionary" persists the term to the personal
// dictionary (plan 09 AC4).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import App from "../../App";
import { currentFindEditor } from "../find";
import type { Editor as CoreEditor } from "@tiptap/core";
import {
  EDITOR_COMMANDS,
  registerSpellCheckDialogListener,
  requestSpellCheckDialog,
} from "../editorCommands";
import SpellCheckDialog from "../../components/SpellCheckDialog";
import type { FlaggedWord } from "../spellcheck";
import { resetSessionIgnored, resetWordlistCache, sessionIgnoredWords } from "../spellcheck";

// React 19 act() requires the environment flag in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("menu.rs Tools > Spelling… item (issue #88)", () => {
  it("offers the spell-check dialog with the Ctrl+Shift+F7 accelerator", () => {
    const src = repoFile("../../../src-tauri/src/menu.rs");
    expect(src).toContain(
      'MenuItem::with_id(app, "tools-spelling", "Spelling…", true, Some("Ctrl+Shift+F7"))',
    );
    expect(src).toContain('SubmenuBuilder::new(app, "Tools")');
    // Tools sits between Format and Help on the menu bar.
    expect(src).toContain("[&file, &edit, &view, &insert, &format, &tools, &help]");
  });
});

describe("App.tsx Tools > Spelling… routing (issue #88)", () => {
  it("routes the menu id and the Ctrl+Shift+F7 shortcut to the dialog", () => {
    const app = repoFile("../../App.tsx");
    expect(app).toContain('id === "tools-spelling"');
    expect(app).toContain("registerSpellCheckDialogListener");
    expect(app).toContain('key === "f7" && e.shiftKey');
    expect(app).toContain("Ctrl+Shift+F7: spelling (Tools > Spelling…)");
  });
});

describe("the spelling registry command (issue #88)", () => {
  it("keeps its label and shortcut", () => {
    const cmd = EDITOR_COMMANDS.find((c) => c.id === "spelling");
    expect(cmd).toBeTruthy();
    expect(cmd!.label).toBe("Spelling…");
    expect(cmd!.shortcut).toBe("Ctrl+Shift+F7");
  });

  it("is distinct from the contenteditable spellcheck toggle (issue #36)", () => {
    const toggle = EDITOR_COMMANDS.find((c) => c.id === "spellcheck");
    expect(toggle).toBeTruthy();
    expect(toggle!.id).not.toBe("spelling");
  });

  it("requests the dialog through the renderer channel", () => {
    const seen: CoreEditor[] = [];
    const dispose = registerSpellCheckDialogListener((e) => seen.push(e));
    const editor = {} as CoreEditor;
    expect(requestSpellCheckDialog(editor)).toBe(true);
    expect(seen).toEqual([editor]);
    dispose();
    // Without a renderer the request is a no-op (returns false).
    expect(requestSpellCheckDialog(editor)).toBe(false);
  });
});

describe("SpellCheckDialog component", () => {
  const FLAGS: FlaggedWord[] = [
    { word: "teh", count: 3, firstPos: 6 },
    { word: "recieve", count: 1, firstPos: 20 },
  ];

  interface Harness {
    container: HTMLDivElement;
    onIgnore: ReturnType<typeof vi.fn>;
    onAddToDictionary: ReturnType<typeof vi.fn>;
    onClose: ReturnType<typeof vi.fn>;
    button: (text: string) => HTMLButtonElement;
    termButtons: (word: string) => { ignore: HTMLButtonElement; add: HTMLButtonElement };
  }

  function renderDialog(flags: FlaggedWord[]): Harness {
    const onIgnore = vi.fn();
    const onAddToDictionary = vi.fn();
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(
        <SpellCheckDialog
          flags={flags}
          onIgnore={onIgnore}
          onAddToDictionary={onAddToDictionary}
          onClose={onClose}
        />,
      );
    });
    const dialog = container.querySelector(".quillmd-spellcheck-dialog")!;
    return {
      container,
      onIgnore,
      onAddToDictionary,
      onClose,
      button: (text) =>
        Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
          (b) => b.textContent === text,
        )!,
      termButtons: (word) => {
        const li = Array.from(dialog.querySelectorAll(".quillmd-spellcheck-term")).find(
          (el) => el.querySelector(".quillmd-spellcheck-word")!.textContent!.startsWith(word),
        )!;
        const buttons = Array.from(li.querySelectorAll<HTMLButtonElement>("button"));
        return {
          ignore: buttons.find((b) => b.textContent === "Ignore")!,
          add: buttons.find((b) => b.textContent === "Add to dictionary")!,
        };
      },
    };
  }

  let roots: Root[] = [];
  beforeEach(() => {
    document.body.innerHTML = "";
    roots = [];
  });
  afterEach(() => {
    for (const r of roots) act(() => r.unmount());
    roots = [];
    vi.restoreAllMocks();
  });

  it("shows every flagged term in order with its occurrence count", () => {
    const h = renderDialog(FLAGS);
    expect(h.container.querySelector(".quillmd-spellcheck-title")!.textContent).toBe("Spelling…");
    expect(h.container.querySelector(".quillmd-spellcheck-scope")!.textContent).toBe(
      "2 flagged terms",
    );
    const words = Array.from(
      h.container.querySelectorAll(".quillmd-spellcheck-word"),
    ).map((el) => el.textContent);
    expect(words).toEqual(["teh (3)", "recieve"]);
  });

  it("labels the singular scope for one term", () => {
    const h = renderDialog([FLAGS[0]]);
    expect(h.container.querySelector(".quillmd-spellcheck-scope")!.textContent).toBe(
      "1 flagged term",
    );
  });

  it("fires onIgnore with the term's lowercase word", () => {
    const h = renderDialog(FLAGS);
    act(() => {
      h.termButtons("teh").ignore.click();
    });
    expect(h.onIgnore).toHaveBeenCalledWith("teh");
  });

  it("fires onAddToDictionary with the term's lowercase word", () => {
    const h = renderDialog(FLAGS);
    act(() => {
      h.termButtons("recieve").add.click();
    });
    expect(h.onAddToDictionary).toHaveBeenCalledWith("recieve");
  });

  it("autofocuses the Close button; Enter closes", () => {
    const h = renderDialog(FLAGS);
    expect(document.activeElement).toBe(h.button("Close"));
    act(() => {
      h.container
        .querySelector(".quillmd-spellcheck-dialog")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter on a per-term button does not close the dialog", () => {
    const h = renderDialog(FLAGS);
    const ignoreBtn = h.termButtons("teh").ignore;
    act(() => {
      ignoreBtn.focus();
    });
    act(() => {
      ignoreBtn.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(h.onClose).not.toHaveBeenCalled();
  });

  it("cancels on Esc", () => {
    const h = renderDialog(FLAGS);
    act(() => {
      h.container
        .querySelector(".quillmd-spellcheck-dialog")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("a backdrop press closes; a press inside the dialog does not", () => {
    const h = renderDialog(FLAGS);
    act(() => {
      h.container
        .querySelector(".quillmd-spellcheck-overlay")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h.onClose).toHaveBeenCalledTimes(1);

    const h2 = renderDialog(FLAGS);
    act(() => {
      h2.container
        .querySelector(".quillmd-spellcheck-dialog")!
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(h2.onClose).not.toHaveBeenCalled();
  });

  it("shows the all-clear empty state when nothing is flagged", () => {
    const h = renderDialog([]);
    expect(h.container.querySelector(".quillmd-spellcheck-scope")!.textContent).toBe(
      "No misspellings found",
    );
    expect(h.container.querySelector(".quillmd-spellcheck-empty")!.textContent).toBe(
      "The document's prose is clear. Code blocks are never spell-checked.",
    );
    expect(h.container.querySelector(".quillmd-spellcheck-terms")).toBeNull();
  });
});

describe("App menu-event e2e: Tools > Spelling… (issue #88)", () => {
  const g = globalThis as Record<string, unknown>;
  let container: HTMLDivElement;
  let root: Root | null = null;
  let settingsStore: { json: string };

  // "Hello teh world recieve." — "hello" and "world" are in the (mocked)
  // wordlist; "teh" and "recieve" are the planted misspellings.
  const DOC_MD = "Hello teh world recieve.";
  const WORDLIST = "hello\nworld\n";

  beforeEach(() => {
    localStorage.clear();
    g.isTauri = true;
    settingsStore = { json: "{}" };
    mockIPC(
      (cmd, payload) => {
        if (cmd === "get_recent_files") return [];
        if (cmd === "load_wordlist") return WORDLIST;
        if (cmd === "get_wordlist_settings") return settingsStore.json;
        if (cmd === "set_wordlist_settings") {
          settingsStore.json = (payload as { json: string }).json;
          return undefined;
        }
        return undefined;
      },
      { shouldMockEvents: true },
    );
    mockWindows("main");
    resetWordlistCache();
    resetSessionIgnored();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Unmount before clearMocks: the App's effect cleanup unlistens through
    // the event-plugin internals the mock installed.
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    clearMocks();
    delete g.isTauri;
    container.remove();
    vi.restoreAllMocks();
  });

  async function renderApp(): Promise<void> {
    const r = createRoot(container);
    root = r;
    await act(async () => {
      r.render(<App />);
    });
  }

  async function openFile(name: string, content: string): Promise<void> {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("file input not found");
    const file = new File([content], name, { type: "text/markdown" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function waitFor(cond: () => boolean, what: string): Promise<void> {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > 4000) throw new Error(`timeout waiting for ${what}`);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
  }

  async function emitMenu(id: string): Promise<void> {
    await act(async () => {
      await emit("menu-event", id);
    });
  }

  function hasDialog(): boolean {
    return container.querySelector(".quillmd-spellcheck-dialog") !== null;
  }

  function dialog(): HTMLDivElement {
    const el = container.querySelector<HTMLDivElement>(".quillmd-spellcheck-dialog");
    expect(el, "spell check dialog").not.toBeNull();
    return el!;
  }

  function flaggedWords(): string[] {
    return Array.from(dialog().querySelectorAll(".quillmd-spellcheck-word")).map(
      (el) => el.textContent!,
    );
  }

  function termButton(word: string, label: string): HTMLButtonElement {
    const li = Array.from(dialog().querySelectorAll(".quillmd-spellcheck-term")).find(
      (el) => el.querySelector(".quillmd-spellcheck-word")!.textContent!.startsWith(word),
    )!;
    return Array.from(li.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === label,
    )!;
  }

  async function renderDoc(): Promise<void> {
    await renderApp();
    await openFile("spell.md", DOC_MD);
    await waitFor(() => currentFindEditor() !== null, "live editor");
  }

  it("the menu opens the dialog with the doc's flagged terms in order (AC4)", async () => {
    await renderDoc();
    await emitMenu("tools-spelling");
    await waitFor(hasDialog, "dialog");
    expect(dialog().querySelector(".quillmd-spellcheck-scope")!.textContent).toBe(
      "2 flagged terms",
    );
    expect(flaggedWords()).toEqual(["teh", "recieve"]);
    // The known words are not flagged.
    expect(flaggedWords().join(" ")).not.toMatch(/hello|world/);
  });

  it("Ctrl+Shift+F7 opens the dialog in browser dev", async () => {
    await renderDoc();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F7",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await waitFor(hasDialog, "dialog");
    expect(flaggedWords()).toEqual(["teh", "recieve"]);
  });

  it("a term in a fenced code block is never flagged (AC4 scope)", async () => {
    await renderApp();
    await openFile(
      "code.md",
      "Hello world.\n\n```\ntechnicaly teh\n```\n",
    );
    await waitFor(() => currentFindEditor() !== null, "live editor");
    await emitMenu("tools-spelling");
    await waitFor(hasDialog, "dialog");
    // The code fence's misspellings are out of scope; the prose is clean.
    expect(dialog().querySelector(".quillmd-spellcheck-scope")!.textContent).toBe(
      "No misspellings found",
    );
  });

  it("Ignore suppresses the term for the session only (not persisted) (AC4)", async () => {
    await renderDoc();
    await emitMenu("tools-spelling");
    await waitFor(hasDialog, "dialog");
    act(() => {
      termButton("teh", "Ignore").click();
    });
    // The term is gone from the list…
    expect(flaggedWords()).toEqual(["recieve"]);
    // …it is in the session ignore list…
    expect(sessionIgnoredWords().has("teh")).toBe(true);
    // …and it was NOT written to the persisted settings.
    expect(JSON.parse(settingsStore.json)).toEqual({});
  });

  it("Add to dictionary suppresses the term and persists it (AC4 restart)", async () => {
    await renderDoc();
    await emitMenu("tools-spelling");
    await waitFor(hasDialog, "dialog");
    act(() => {
      termButton("teh", "Add to dictionary").click();
    });
    // The term is gone from the list…
    expect(flaggedWords()).toEqual(["recieve"]);
    // …and it is persisted to the personal dictionary (survives a restart).
    expect(JSON.parse(settingsStore.json)).toEqual({ personal: ["teh"] });
  });

  it("Esc closes the dialog and the document is untouched", async () => {
    await renderDoc();
    await emitMenu("tools-spelling");
    await waitFor(hasDialog, "dialog");
    await act(async () => {
      dialog().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(container.querySelector(".quillmd-spellcheck-dialog")).toBeNull();
    // Read-only tool: the document text is unchanged.
    const editor = currentFindEditor()!;
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n")).toBe(
      "Hello teh world recieve.",
    );
  });
});
