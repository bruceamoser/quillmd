// Find panel state (plan 07 task 7.5, issue #73): the last search term and
// its options are remembered per document path, and the find panel position
// (top/bottom) is a global setting. Both are view-only UI state persisted in
// localStorage (the same posture as viewModes.ts and docSettings.ts) and
// never touch the save pipeline or the round-trip contract.

export interface FindMemory {
  // The doc's last search term; "" when the doc was never searched.
  term: string;
  matchCase: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

export const DEFAULT_FIND_MEMORY: FindMemory = {
  term: "",
  matchCase: false,
  wholeWord: false,
  useRegex: false,
};

const MEMORY_KEY = "quillmd.findMemory";

// Merge a possibly-partial or corrupted stored record onto the defaults so a
// bad localStorage payload can never take down a tab (same posture as
// loadDocSettings).
function normalizeMemory(raw: unknown): FindMemory {
  const out: FindMemory = { ...DEFAULT_FIND_MEMORY };
  if (typeof raw !== "object" || raw === null) return out;
  const record = raw as Record<string, unknown>;
  if (typeof record.term === "string") out.term = record.term;
  if (typeof record.matchCase === "boolean") out.matchCase = record.matchCase;
  if (typeof record.wholeWord === "boolean") out.wholeWord = record.wholeWord;
  if (typeof record.useRegex === "boolean") out.useRegex = record.useRegex;
  return out;
}

export function loadFindMemory(path: string): FindMemory {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return { ...DEFAULT_FIND_MEMORY };
    const map = JSON.parse(raw) as Record<string, unknown>;
    return normalizeMemory(map[path]);
  } catch {
    return { ...DEFAULT_FIND_MEMORY };
  }
}

export function saveFindMemory(path: string, memory: FindMemory): void {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    const map: Record<string, unknown> = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    map[path] = memory;
    localStorage.setItem(MEMORY_KEY, JSON.stringify(map));
  } catch {
    // localStorage may be unavailable (private mode); memory is best-effort.
  }
}

// --- panel position (global setting, plan 07 §2.4) --------------------------

// Where the find panel docks inside the content area. "top" is the default
// (the historical position); "bottom" docks the bar at the lower edge.
export type FindPanelPosition = "top" | "bottom";

export const DEFAULT_FIND_PANEL_POSITION: FindPanelPosition = "top";

const POSITION_KEY = "quillmd.findPanelPosition";

export function isFindPanelPosition(value: unknown): value is FindPanelPosition {
  return value === "top" || value === "bottom";
}

export function loadFindPanelPosition(): FindPanelPosition {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (raw === null) return DEFAULT_FIND_PANEL_POSITION;
    const parsed: unknown = JSON.parse(raw);
    return isFindPanelPosition(parsed) ? parsed : DEFAULT_FIND_PANEL_POSITION;
  } catch {
    return DEFAULT_FIND_PANEL_POSITION;
  }
}

export function saveFindPanelPosition(position: FindPanelPosition): void {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  } catch {
    // best-effort
  }
}
