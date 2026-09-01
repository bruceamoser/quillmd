// Vitest setup: two hermeticity guards for the ProseMirror test suite.
//
// 1. LAYOUT POLYFILLS — jsdom does not implement the browser layout APIs
//    ProseMirror's EditorView calls. `EditorView.scrollToSelection`
//    (triggered by any command that calls `.focus()`) reads
//    `target.getClientRects()` and `range.getBoundingClientRect()`. jsdom has
//    neither, so under load the call throws "target.getClientRects is not a
//    function" — sometimes loudly (a hard TypeError) and sometimes silently
//    interrupting the in-flight transaction (a mark never lands, e.g. the
//    Intense Quote bold follow-up). Both shapes were flaky failures in the
//    pipeline gate (issue #55). Real WebViews (WebView2 / WebKitGTK) have
//    these APIs; this shim only exists to make jsdom behave like a browser.
//
// 2. LEAKED-EDITOR TEARDOWN — a test that creates a raw `new Editor({...})`
//    but never calls `.destroy()` leaves ProseMirror's DOMObserver flush
//    timer pending. When that timer fires after vitest has torn down the
//    test file's jsdom environment, it throws `ReferenceError: document is
//    not defined` as an *uncaught* exception, which fails the whole run even
//    though every test passed (observed in the #42 gate: 1192/1192 green,
//    run red on the unhandled error, originating in tableMerge.test.ts /
//    clearFormatting.test.tsx). We wrap the TipTap Editor class so every
//    constructed editor is tracked, and a global afterEach destroys any that
//    are still alive — cancelling the pending flush timer while the file's
//    environment is still intact.
import { afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// 1. layout polyfills
// ---------------------------------------------------------------------------

const emptyRectList: DOMRectList = Object.assign([], {
  length: 0,
  item: () => null,
  [Symbol.iterator]: function* () {},
});

function installPolyfills(): void {
  if (typeof Element === "undefined") return;

  if (typeof Element.prototype.getClientRects !== "function") {
    Element.prototype.getClientRects = function (): DOMRectList {
      return emptyRectList;
    };
  }

  const rangeCtor = globalThis.Range;
  if (rangeCtor) {
    if (typeof rangeCtor.prototype.getClientRects !== "function") {
      rangeCtor.prototype.getClientRects = function (): DOMRectList {
        return emptyRectList;
      };
    }
    if (typeof rangeCtor.prototype.getBoundingClientRect !== "function") {
      rangeCtor.prototype.getBoundingClientRect = function (): DOMRect {
        return new DOMRect(0, 0, 0, 0);
      };
    }
  }
}

installPolyfills();

// ---------------------------------------------------------------------------
// 2. leaked-editor teardown
// ---------------------------------------------------------------------------

// The live editors created in the current test file (worker-global; the
// afterEach below drains it at the end of every test).
const liveEditors = new Set<object>();

// Wrap the TipTap Editor class so construction is observable. Every test
// that does `import { Editor } from "@tiptap/core"` (or a re-export of it,
// e.g. through components/Editor) receives this subclass, which registers
// itself on construction and unregisters on destroy(). Behavior is
// otherwise identical.
vi.mock("@tiptap/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tiptap/core")>();

  class TrackedEditor extends original.Editor {
    constructor(options: ConstructorParameters<typeof original.Editor>[0]) {
      super(options);
      liveEditors.add(this);
    }
    override destroy(): void {
      super.destroy();
      liveEditors.delete(this);
    }
  }

  // Copy every real export verbatim (no binding — binding would strip
  // class statics like Mark.create) and swap only the Editor binding.
  return { ...original, Editor: TrackedEditor };
});

// Destroy any editor a test forgot to, at the end of every test, while the
// file's jsdom environment is still alive. destroy() is idempotent in
// TipTap v2 (no-op once destroyed), so this is safe for editors tests do
// clean up themselves.
afterEach(() => {
  for (const editor of [...liveEditors]) {
    try {
      (editor as { destroy?: () => void }).destroy?.();
    } catch {
      // A view whose document is already gone can throw on teardown; the
      // timer is dead with the environment, so this is safe to ignore.
    }
    liveEditors.delete(editor);
  }
}, 10_000);
