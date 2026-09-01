// @vitest-environment jsdom
// Spell check scanner (plan 09 task 9.5, issue #88): the tokenization rules
// (letters, contractions, digit-adjacent skip, single-letter skip, acronym
// skip, case-insensitive matching), the flat-text scan (grouping, counts,
// first-occurrence order), the ProseMirror doc scan (code is never scanned —
// fenced blocks, front matter, and inline code are all skipped), the known-set
// merge (wordlist ∪ personal ∪ session), the settings normalization, and the
// storage bridge (localStorage in browser dev, Rust commands under Tauri).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { Node as PmNode } from "@tiptap/pm/model";
import { markdownToTiptap } from "../pm";
import {
  buildKnownSet,
  extractWordTokens,
  ignoreWordForSession,
  isCheckableToken,
  loadSpellcheckSettings,
  loadWordlist,
  normalizeSpellcheckSettings,
  normalizeWord,
  resetSessionIgnored,
  resetWordlistCache,
  saveSpellcheckSettings,
  scanDoc,
  scanText,
  sessionIgnoredWords,
  wordsToSet,
  type FlaggedWord,
} from "../spellcheck";

let editors: Editor[] = [];

function docOf(markdown: string): PmNode {
  const editor = new Editor({
    extensions: [StarterKit],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  return editor.state.doc;
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  resetWordlistCache();
  resetSessionIgnored();
  clearMocks();
  vi.restoreAllMocks();
});

// --- tokenization (pure) ------------------------------------------------------

describe("extractWordTokens", () => {
  it("splits runs of ASCII letters with offsets", () => {
    expect(extractWordTokens("Hello world")).toEqual([
      { word: "Hello", start: 0, end: 5 },
      { word: "world", start: 6, end: 11 },
    ]);
  });

  it("keeps a contraction as one token", () => {
    expect(extractWordTokens("don't stop")).toEqual([
      { word: "don't", start: 0, end: 5 },
      { word: "stop", start: 6, end: 10 },
    ]);
  });

  it("keeps a multi-apostrophe token together (rock'n'roll)", () => {
    expect(extractWordTokens("rock'n'roll")).toEqual([
      { word: "rock'n'roll", start: 0, end: 11 },
    ]);
  });

  it("skips letter runs adjacent to a digit", () => {
    // "3rd" / "2nd" — the letter run touches a digit, so it is not a
    // stand-alone word and is not matched at all.
    expect(extractWordTokens("3rd place 2nd")).toEqual([
      { word: "place", start: 4, end: 9 },
    ]);
  });
});

describe("isCheckableToken", () => {
  it("checks words of at least two letters", () => {
    expect(isCheckableToken("word")).toBe(true);
    expect(isCheckableToken("ab")).toBe(true);
  });

  it("skips single letters", () => {
    expect(isCheckableToken("a")).toBe(false);
    expect(isCheckableToken("I")).toBe(false);
  });

  it("skips all-uppercase acronyms", () => {
    expect(isCheckableToken("NASA")).toBe(false);
    expect(isCheckableToken("OK")).toBe(false);
  });

  it("keeps mixed-case words", () => {
    expect(isCheckableToken("Hello")).toBe(true);
    expect(isCheckableToken("iPhone")).toBe(true);
  });
});

describe("normalizeWord", () => {
  it("lowercases", () => {
    expect(normalizeWord("Hello")).toBe("hello");
    expect(normalizeWord("NASA")).toBe("nasa");
  });
});

// --- flat-text scan (pure) ------------------------------------------------------

describe("scanText", () => {
  const known = wordsToSet("hello\nworld\nrecieve");

  it("flags unknown terms and skips known ones", () => {
    expect(scanText("hello teh recieve", known).map((f) => f.word)).toEqual(["teh"]);
  });

  it("is case-insensitive: the flag is the lowercase form", () => {
    expect(scanText("Teh TEH teh", known).map((f) => f.word)).toEqual(["teh"]);
  });

  it("groups by lowercase form and counts occurrences", () => {
    // "Teh" is mixed-case (checkable); an all-uppercase "TEH" would be the
    // acronym heuristic and skipped.
    const flags = scanText("teh hello Teh", known);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toEqual({ word: "teh", count: 2, firstPos: 0 });
  });

  it("orders flags by first occurrence", () => {
    const flags = scanText("zebra apple teh", known);
    expect(flags.map((f) => f.word)).toEqual(["zebra", "apple", "teh"]);
    expect(flags[0].firstPos).toBe(0);
    expect(flags[1].firstPos).toBe(6);
    expect(flags[2].firstPos).toBe(12);
  });

  it("skips digit-adjacent, single-letter, and all-uppercase tokens", () => {
    expect(scanText("3rd a NASA teh", known).map((f) => f.word)).toEqual(["teh"]);
  });

  it("returns nothing when every term is known", () => {
    expect(scanText("hello world", known)).toEqual([]);
  });
});

// --- ProseMirror doc scan (code is never scanned) ------------------------------

describe("scanDoc", () => {
  const known = wordsToSet("hello\nworld");

  it("flags prose terms with absolute doc positions", () => {
    const doc = docOf("hello teh world");
    const flags = scanDoc(doc, known);
    expect(flags.map((f) => f.word)).toEqual(["teh"]);
    // The flag's firstPos points at the term in the doc.
    const f = flags[0];
    expect(doc.textBetween(f.firstPos, f.firstPos + f.word.length).toLowerCase()).toBe("teh");
  });

  it("never scans fenced code blocks", () => {
    const doc = docOf("hello teh\n\n```\nrecieve teh\n```\n");
    const flags = scanDoc(doc, known);
    // Both "teh" occurrences are in the same lowercase group; the code fence's
    // "recieve" and "teh" must not add to the count.
    expect(flags.map((f) => f.word)).toEqual(["teh"]);
    expect(flags[0].count).toBe(1);
  });

  it("never scans inline code", () => {
    const doc = docOf("hello `recieve` teh");
    const flags = scanDoc(doc, known);
    expect(flags.map((f) => f.word)).toEqual(["teh"]);
    expect(flags[0].count).toBe(1);
  });

  it("skips front matter (a codeBlock with language frontmatter)", () => {
    const doc = docOf("---\ntitle: recieve teh\n---\n\nhello world\n");
    const flags = scanDoc(doc, known);
    expect(flags).toEqual([]);
  });

  it("returns nothing for a clean doc", () => {
    const doc = docOf("hello world\n\n```\nnot a word\n```\n");
    expect(scanDoc(doc, known)).toEqual([]);
  });
});

// --- known-set merge -----------------------------------------------------------

describe("buildKnownSet", () => {
  it("merges the wordlist, personal dictionary, and session ignores", () => {
    const wordlist = wordsToSet("alpha");
    const settings = { personal: ["beta"] };
    const ignored = wordsToSet("gamma");
    const known = buildKnownSet(wordlist, settings, ignored);
    expect(known.has("alpha")).toBe(true);
    expect(known.has("beta")).toBe(true);
    expect(known.has("gamma")).toBe(true);
    expect(known.has("delta")).toBe(false);
  });

  it("defaults the ignored set to the session ignore list", () => {
    ignoreWordForSession("sessionword");
    const known = buildKnownSet(new Set(), { personal: [] });
    expect(known.has("sessionword")).toBe(true);
  });
});

// --- session ignore (in-memory only) ------------------------------------------

describe("session ignore list", () => {
  it("adds the lowercase form and reports it", () => {
    ignoreWordForSession("Teh");
    expect(sessionIgnoredWords().has("teh")).toBe(true);
    expect(sessionIgnoredWords().has("Teh")).toBe(false);
  });

  it("resets", () => {
    ignoreWordForSession("Teh");
    resetSessionIgnored();
    expect(sessionIgnoredWords().has("teh")).toBe(false);
  });
});

// --- settings normalization ----------------------------------------------------

describe("normalizeSpellcheckSettings", () => {
  it("lowercases, trims, and dedupes the personal dictionary", () => {
    expect(
      normalizeSpellcheckSettings({ personal: ["  Foo ", "foo", "BAR", "don't"] }).personal,
    ).toEqual(["foo", "bar", "don't"]);
  });

  it("drops non-words and non-strings", () => {
    expect(
      normalizeSpellcheckSettings({ personal: ["", "  ", "foo bar", "foo2", 42, "ok"] }),
    ).toEqual({ personal: ["ok"] });
  });

  it("normalizes non-object and non-array payloads to empty", () => {
    expect(normalizeSpellcheckSettings(null)).toEqual({ personal: [] });
    expect(normalizeSpellcheckSettings("nope")).toEqual({ personal: [] });
    expect(normalizeSpellcheckSettings({ personal: "nope" })).toEqual({ personal: [] });
    expect(normalizeSpellcheckSettings({})).toEqual({ personal: [] });
  });
});

// --- wordlist (lazy, cached) ---------------------------------------------------

describe("wordsToSet", () => {
  it("splits on newlines, trims, lowercases, and drops blanks", () => {
    const set = wordsToSet("Alpha\nbeta\r\n\n  GAMMA  \n");
    expect(set.has("alpha")).toBe(true);
    expect(set.has("beta")).toBe(true);
    expect(set.has("gamma")).toBe(true);
    expect(set.size).toBe(3);
  });
});

describe("loadWordlist", () => {
  const g = globalThis as Record<string, unknown>;

  it("loads through the Rust command under Tauri", async () => {
    g.isTauri = true;
    mockIPC((cmd) => {
      if (cmd === "load_wordlist") return "alpha\nbeta\n";
      return undefined;
    });
    const set = await loadWordlist();
    expect(set.has("alpha")).toBe(true);
    expect(set.has("beta")).toBe(true);
    delete g.isTauri;
  });

  it("loads through fetch in browser dev and caches", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "gamma\ndelta\n",
    });
    vi.stubGlobal("fetch", fetchMock);
    const first = await loadWordlist();
    expect(first.has("gamma")).toBe(true);
    // A second load is served from the cache (no second fetch).
    const second = await loadWordlist();
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a fetch failure in browser dev", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "" }),
    );
    await expect(loadWordlist()).rejects.toThrow("wordlist fetch failed: 404");
  });
});

// --- storage bridge (localStorage dev / Rust commands) --------------------------

describe("storage bridge", () => {
  const g = globalThis as Record<string, unknown>;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete g.isTauri;
  });

  it("round-trips through localStorage in browser dev", async () => {
    await saveSpellcheckSettings({ personal: ["quixotic"] });
    expect(JSON.parse(localStorage.getItem("quillmd.spellcheckSettings")!)).toEqual({
      personal: ["quixotic"],
    });
    expect(await loadSpellcheckSettings()).toEqual({ personal: ["quixotic"] });
  });

  it("loads an empty dictionary when nothing is stored or the payload is corrupt", async () => {
    expect(await loadSpellcheckSettings()).toEqual({ personal: [] });
    localStorage.setItem("quillmd.spellcheckSettings", "not json {");
    expect(await loadSpellcheckSettings()).toEqual({ personal: [] });
  });

  it("talks to the Rust commands under Tauri", async () => {
    g.isTauri = true;
    const store = { json: '{"personal":["kerfuffle"]}' };
    mockIPC((cmd, payload) => {
      if (cmd === "get_wordlist_settings") return store.json;
      if (cmd === "set_wordlist_settings") {
        store.json = (payload as { json: string }).json;
        return undefined;
      }
      return undefined;
    });
    expect(await loadSpellcheckSettings()).toEqual({ personal: ["kerfuffle"] });
    await saveSpellcheckSettings({ personal: ["flimflam"] });
    expect(JSON.parse(store.json)).toEqual({ personal: ["flimflam"] });
  });

  it("normalizes a corrupt Tauri payload instead of throwing", async () => {
    g.isTauri = true;
    mockIPC((cmd) => {
      if (cmd === "get_wordlist_settings") return "{ definitely not json";
      return undefined;
    });
    expect(await loadSpellcheckSettings()).toEqual({ personal: [] });
  });
});

// --- end-to-end scan semantics (AC4) -------------------------------------------

describe("scan semantics (plan 09 AC4)", () => {
  it("a planted misspelling is flagged, then suppressed by ignore or dictionary", () => {
    const wordlist = wordsToSet("hello\nworld");
    const text = "hello teh world";
    const flags = (known: ReadonlySet<string>): FlaggedWord[] => scanText(text, known);

    // Fresh session: the misspelling is flagged.
    expect(flags(buildKnownSet(wordlist, { personal: [] })).map((f) => f.word)).toEqual(["teh"]);

    // "Ignore" (session) suppresses it for the session…
    ignoreWordForSession("teh");
    expect(flags(buildKnownSet(wordlist, { personal: [] }))).toEqual([]);
    resetSessionIgnored();

    // …and "add to dictionary" suppresses it permanently (in the settings).
    expect(
      flags(buildKnownSet(wordlist, { personal: ["teh"] })),
    ).toEqual([]);
  });
});
