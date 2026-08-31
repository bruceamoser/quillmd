// Vitest setup: polyfill the browser layout APIs that jsdom does not
// implement but ProseMirror's EditorView calls. `EditorView.scrollToSelection`
// (triggered by any command that calls `.focus()`) reads
// `target.getClientRects()` and `range.getBoundingClientRect()`. jsdom has
// neither, so under load the call throws "target.getClientRects is not a
// function" — sometimes loudly (a hard TypeError) and sometimes silently
// interrupting the in-flight transaction (a mark never lands, e.g. the
// Intense Quote bold follow-up). Both shapes were flaky failures in the
// pipeline gate (issue #55). Real WebViews (WebView2 / WebKitGTK) have these
// APIs; this shim only exists to make jsdom behave like a browser for the
// test suite.

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
