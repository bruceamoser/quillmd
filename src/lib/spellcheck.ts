// Spell check (plan 09 task 9.5, issue #88): scan-and-flag mode. The webview
// exposes no reliable misspelling API, so the bundled English wordlist
// (wordlist.txt, ~90k words, a Tauri resource) is loaded lazily into a Set
// and the document's prose is scanned against it. Flagged terms are grouped
// and the "Spelling…" dialog (SpellCheckDialog.tsx) offers, per term,
// "Ignore" (session only — in-memory, never persisted) and "Add to
// dictionary" (the personal dictionary, persisted in app config).
//
// Scope: prose only. Code is never spell-checked — fenced code blocks
// (codeBlock), diagrams (mermaidBlock), front matter (a codeBlock with
// language "frontmatter"), and inline code (the "code" mark) are all
// skipped, so a typo in a code fence is never flagged and a real word in
// code is never mistaken for prose.
//
// Word rules (honest, low false positives):
//   - a token is a run of ASCII letters, optionally with interior apostrophes
//     (contractions are one token: "don't");
//   - a token adjacent to a digit is skipped ("3rd", "markdown2" — the
//     letter run is not a stand-alone word);
//   - single-letter tokens are skipped ("a", "I");
//   - all-uppercase tokens are skipped (acronyms and initialisms: "NASA");
//   - matching is case-insensitive: a token checks against its lowercase
//     form, and the wordlist is lowercase.
//
// Storage (plan 09 §3): the personal dictionary is app config — a JSON file
// in the Tauri app config dir (~/.config/quillmd/wordlist-settings.json)
// written through the Rust get_wordlist_settings / set_wordlist_settings
// commands, which keeps config-dir access in the Rust layer (the same
// posture as the style overrides). In browser dev there is no Rust layer, so
// the same payload falls back to localStorage. The session ignore list is
// never persisted (plan 09 AC4: ignore-all suppresses for the session only;
// "add to dictionary" is what survives a restart).

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Node } from "@tiptap/pm/model";

export interface WordToken {
  // The token as it appears in the text (original casing).
  word: string;
  // Start index of the token in the text.
  start: number;
  // End index (exclusive) of the token in the text.
  end: number;
}

export interface FlaggedWord {
  // The lowercase form the term was flagged under.
  word: string;
  // How many times the term occurs in the scanned text.
  count: number;
  // Position of the first occurrence (text index for scanText, absolute
  // doc position for scanDoc).
  firstPos: number;
}

// --- tokenization (pure) ------------------------------------------------------

// A token: a run of ASCII letters not adjacent to another letter or digit
// (the lookarounds), optionally followed by apostrophe + letter runs, so a
// contraction or possessive stays one token ("don't", "rock'n'roll").
const TOKEN_RE = /(?<![A-Za-z0-9])[A-Za-z]+(?:'[A-Za-z]+)*(?![A-Za-z0-9])/g;

// Extracts every word token of a flat text, in document order, with its
// text offsets (the offsets let a caller select the first misspelling).
export function extractWordTokens(text: string): WordToken[] {
  const out: WordToken[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// Whether a token is a checkable word: at least two letters, and not
// all-uppercase (the acronym / initialism heuristic — "NASA" is not
// spelled, "nasa" is).
export function isCheckableToken(token: string): boolean {
  if (token.length < 2) return false;
  if (token === token.toUpperCase()) return false;
  return true;
}

// The dictionary form of a token (lowercase).
export function normalizeWord(token: string): string {
  return token.toLowerCase();
}

// --- scanning (pure) ----------------------------------------------------------

// Scans a flat text against `known` (wordlist ∪ personal dictionary ∪
// session ignores) and returns the flagged terms, grouped by lowercase form
// with an occurrence count, in first-occurrence order.
export function scanText(text: string, known: ReadonlySet<string>): FlaggedWord[] {
  const seen = new Map<string, { count: number; firstPos: number }>();
  for (const t of extractWordTokens(text)) {
    if (!isCheckableToken(t.word)) continue;
    const w = normalizeWord(t.word);
    if (known.has(w)) continue;
    const entry = seen.get(w);
    if (entry) entry.count += 1;
    else seen.set(w, { count: 1, firstPos: t.start });
  }
  const out: FlaggedWord[] = [];
  for (const [word, e] of seen) out.push({ word, count: e.count, firstPos: e.firstPos });
  out.sort((a, b) => a.firstPos - b.firstPos);
  return out;
}

// The node types that are never spell-checked (code is not prose).
const SKIP_NODE_TYPES = new Set(["codeBlock", "mermaidBlock"]);

// The inline-code mark name (inline code is skipped token-wise).
const INLINE_CODE_MARK = "code";

// Scans a ProseMirror doc like scanText, but returns absolute doc positions
// for firstPos (so the caller can select the first misspelling) and walks
// the live model, skipping code subtrees and inline-code marks. Front matter
// is a codeBlock (language "frontmatter"), so it is skipped by the same rule.
export function scanDoc(doc: Node, known: ReadonlySet<string>): FlaggedWord[] {
  const seen = new Map<string, { count: number; firstPos: number }>();
  doc.descendants((node, pos) => {
    if (SKIP_NODE_TYPES.has(node.type.name)) return false;
    if (node.isText) {
      if (node.marks.some((mk) => mk.type.name === INLINE_CODE_MARK)) return true;
      const text = node.text ?? "";
      for (const t of extractWordTokens(text)) {
        if (!isCheckableToken(t.word)) continue;
        const w = normalizeWord(t.word);
        if (known.has(w)) continue;
        const entry = seen.get(w);
        if (entry) entry.count += 1;
        else seen.set(w, { count: 1, firstPos: pos + t.start });
      }
    }
    return true;
  });
  const out: FlaggedWord[] = [];
  for (const [word, e] of seen) out.push({ word, count: e.count, firstPos: e.firstPos });
  out.sort((a, b) => a.firstPos - b.firstPos);
  return out;
}

// --- wordlist (lazy, cached) ---------------------------------------------------

// The wordlist text the tests / dev server can substitute (the App passes
// the loaded resource text; the scanner itself stays pure).
export function wordsToSet(text: string): Set<string> {
  const set = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const w = line.trim().toLowerCase();
    if (w.length > 0) set.add(w);
  }
  return set;
}

let wordlistCache: Set<string> | null = null;

// Test hook: drop the cached wordlist (a reloaded resource is picked up on
// the next loadWordlist).
export function resetWordlistCache(): void {
  wordlistCache = null;
}

// Loads the bundled wordlist into a lowercase Set, lazily and once per
// session. Tauri: the load_wordlist command (resource file, embedded
// fallback). Browser dev: the dev server serves the same file at
// /wordlist.txt (see vite.config.ts).
export async function loadWordlist(): Promise<Set<string>> {
  if (wordlistCache) return wordlistCache;
  let text: string;
  if (isTauri()) {
    text = await invoke<string>("load_wordlist");
  } else {
    const res = await fetch("wordlist.txt");
    if (!res.ok) throw new Error(`wordlist fetch failed: ${res.status}`);
    text = await res.text();
  }
  wordlistCache = wordsToSet(text);
  return wordlistCache;
}

// --- settings (personal dictionary; session ignore is memory only) ------------

export interface SpellcheckSettings {
  // The personal dictionary: lowercase words the user added permanently.
  personal: string[];
}

const SPELLCHECK_STORAGE_KEY = "quillmd.spellcheckSettings";

// The session ignore list (plan 09 AC4): in-memory only, so "ignore"
// suppresses a term for this session and nothing survives a restart —
// "add to dictionary" is the permanent path.
const sessionIgnored = new Set<string>();

export function sessionIgnoredWords(): ReadonlySet<string> {
  return sessionIgnored;
}

export function ignoreWordForSession(word: string): void {
  sessionIgnored.add(normalizeWord(word));
}

// Test hook: clear the session ignore list.
export function resetSessionIgnored(): void {
  sessionIgnored.clear();
}

// Merges a possibly-corrupted stored record onto the clean state so a bad
// payload can never take down the app (same posture as styleOverrides.ts):
// personal must be a string array; entries are lowercased, trimmed, deduped,
// and non-words (empty, or containing non-letter characters) are dropped.
export function normalizeSpellcheckSettings(raw: unknown): SpellcheckSettings {
  const out: SpellcheckSettings = { personal: [] };
  if (typeof raw !== "object" || raw === null) return out;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.personal)) return out;
  const seen = new Set<string>();
  for (const entry of record.personal) {
    if (typeof entry !== "string") continue;
    const w = entry.trim().toLowerCase();
    if (w.length === 0 || seen.has(w)) continue;
    if (!/^[a-z]+(['][a-z]+)*$/.test(w)) continue;
    seen.add(w);
    out.personal.push(w);
  }
  return out;
}

// The skip set the scanner checks against: wordlist ∪ personal dictionary ∪
// session ignores. Building it once per scan keeps the scan a pure Set
// lookup.
export function buildKnownSet(
  wordlist: ReadonlySet<string>,
  settings: SpellcheckSettings,
  ignored: ReadonlySet<string> = sessionIgnored,
): Set<string> {
  const known = new Set<string>(wordlist);
  for (const w of settings.personal) known.add(w);
  for (const w of ignored) known.add(w);
  return known;
}

// --- storage (plan 09 §3: Rust commands, app config dir) -----------------------

export async function loadSpellcheckSettings(): Promise<SpellcheckSettings> {
  if (isTauri()) {
    try {
      const raw = await invoke<string>("get_wordlist_settings");
      return normalizeSpellcheckSettings(JSON.parse(raw || "{}"));
    } catch {
      return { personal: [] };
    }
  }
  try {
    const raw = localStorage.getItem(SPELLCHECK_STORAGE_KEY);
    if (!raw) return { personal: [] };
    return normalizeSpellcheckSettings(JSON.parse(raw));
  } catch {
    return { personal: [] };
  }
}

export async function saveSpellcheckSettings(settings: SpellcheckSettings): Promise<void> {
  const payload = JSON.stringify(settings);
  if (isTauri()) {
    await invoke("set_wordlist_settings", { json: payload });
    return;
  }
  try {
    localStorage.setItem(SPELLCHECK_STORAGE_KEY, payload);
  } catch {
    // localStorage may be unavailable (private mode); the personal
    // dictionary is best-effort in browser dev.
  }
}
