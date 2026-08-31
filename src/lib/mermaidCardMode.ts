// Mermaid card mode channel (plan 11 task 11.6, issue #105). The diagram
// node's context-menu item set (diagramMenu.ts) switches a diagram between
// edit and preview mode through the diagramEdit / diagramPreview registry
// commands (editorCommands.ts), but the mode itself is the React state of
// the mounted MermaidCard NodeView (MermaidCard.tsx) — a view artifact that
// never touches the document bytes. This module is the channel between the
// two: every mounted card registers itself (its doc position plus a mode
// getter/setter), and a command request is routed to the card that owns the
// diagram under the selection. The same request/listener shape the
// link/image dialog and table picker commands use (editorCommands.ts).

export type MermaidCardMode = "edit" | "preview";

export interface MermaidCardModeHandler {
  // The card's current doc position, or null once the node is gone (the
  // request then never matches it).
  getPos: () => number | null;
  setMode: (mode: MermaidCardMode) => void;
  getMode: () => MermaidCardMode;
}

const handlers = new Set<MermaidCardModeHandler>();

// Registers a mounted card with the channel; returns the unregister function
// (the card calls it on unmount). Multiple cards coexist — one per diagram
// in the document — and requests are matched by doc position.
export function registerMermaidCardModeHandler(
  handler: MermaidCardModeHandler,
): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

// The card that owns the mermaidBlock at `pos`, or null when no card is
// mounted for it (source/preview view, read-only, or the node view not
// mounted yet).
function handlerAt(pos: number): MermaidCardModeHandler | null {
  for (const handler of handlers) {
    if (handler.getPos() === pos) return handler;
  }
  return null;
}

// Requests the card at `pos` to switch to `mode`. Returns false when no card
// owns the position (nothing to switch) so the command reports a no-op.
export function requestMermaidCardMode(pos: number, mode: MermaidCardMode): boolean {
  const handler = handlerAt(pos);
  if (!handler) return false;
  handler.setMode(mode);
  return true;
}

// The mode the card at `pos` reports, or null when no card is mounted there.
export function mermaidCardModeAt(pos: number): MermaidCardMode | null {
  const handler = handlerAt(pos);
  return handler ? handler.getMode() : null;
}
