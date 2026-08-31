// @vitest-environment jsdom
// Theme screenshot baselines (plan 05 task 5.6, issue #59; plan 05 §4 AC4):
// "All 5 themes pass a visual screenshot diff on a standard fixture doc
// (baseline screenshots committed)."
//
// The app has no pixel-rendering driver in a headless environment (a full
// GUI screenshot needs the WebDriver harness, spec §6), so the committed
// baseline for each theme is the headless visual fingerprint of the standard
// fixture doc:
//   1. element inventory — the fixture rendered through the app's own
//      document pipeline (markdown -> TipTap -> the WYSIWYG HTML), counted
//      per element type;
//   2. resolved visual style — for every element the theme variables that
//      App.css consumes on that element, resolved from the theme's own CSS
//      variable sheet (src/themes/<id>.css) with the same var() fallbacks,
//      and em sizes resolved to px against the theme's base size.
// Any change to a theme's look (a variable value, or a variable the
// document surface consumes) changes exactly one baseline file, so the
// diff is CI-reviewable with no human eyeballs (council §2). Regenerate an
// intentional change with:
//   QUILLMD_UPDATE_BASELINES=1 npm test -- src/lib/__tests__/themescreenshots.test.tsx
//
// jsdom cannot resolve var() in getComputedStyle, hence the explicit
// resolution below; the consumption map mirrors src/App.css
// (.quillmd-prosemirror rules) and is kept honest by the App.css
// var()-string assertions in theme.test.tsx.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Strike from "@tiptap/extension-strike";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { markdownToTiptap } from "../pm";
import { THEMES, type ThemeId } from "../theme";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..");
const FIXTURE_REL = join("fixtures", "clean", "theme-standard.md");
const BASELINE_DIR = join(ROOT, "tests", "theme-baselines");

// The standard fixture doc of AC4: one clean GFM document exercising every
// block type the themes restyle (headings 1-6, paragraph + inline marks,
// quote, ordered/unordered lists, fenced code, table). It is a member of the
// round-trip contract corpus (fixtures/clean), so its bytes are stable.
const FIXTURE_PATH = join(ROOT, FIXTURE_REL);

// --- theme sheet parsing ----------------------------------------------------

// A theme sheet is a flat custom-property list scoped to the content
// container (plan 05 §3): `.quillmd-content[data-theme="<id>"] { --x: v; }`.
// Values may wrap across lines (font stacks); they never contain ';'.
function parseThemeSheet(theme: ThemeId, css: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const match of css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    vars[`--${match[1]}`] = match[2].replace(/\s+/g, " ").trim();
  }
  expect(Object.keys(vars).length, `${theme}.css must define variables`).toBeGreaterThan(0);
  return vars;
}

// --- element inventory -------------------------------------------------------

// The app editor's importable extension set (Editor.tsx minus its private
// footnote nodes, which the standard fixture doc does not use): the DOM this
// renders is the WYSIWYG surface the themes restyle.
function makeEditor(markdown: string): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      Strike,
      Underline,
      Highlight,
      Link,
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
      Subscript,
      Superscript,
      Table,
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: markdownToTiptap(markdown),
  });
}

interface Inventory {
  counts: Record<string, number>;
  samples: Record<string, string>;
}

// Walks the rendered WYSIWYG HTML and counts every element type (a code
// element inside a fenced block is counted as "pre>code": it renders with
// the block's surface, not the inline-code look).
function renderInventory(markdown: string): Inventory {
  const editor = makeEditor(markdown);
  try {
    const doc = new DOMParser().parseFromString(editor.getHTML(), "text/html");
    const counts: Record<string, number> = {};
    const samples: Record<string, string> = {};
    const walk = (el: Element, inPre: boolean): void => {
      for (const child of Array.from(el.children)) {
        const tag = child.tagName.toLowerCase();
        const key = inPre && tag === "code" ? "pre>code" : tag;
        if (key !== "html" && key !== "head" && key !== "body") {
          counts[key] = (counts[key] ?? 0) + 1;
          if (!samples[key]) {
            samples[key] = (child.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
          }
        }
        walk(child, inPre || tag === "pre");
      }
    };
    walk(doc.body, false);
    return { counts, samples };
  } finally {
    editor.destroy();
  }
}

// --- visual style resolution ---------------------------------------------------

// App.css consumes the theme on the WYSIWYG surface (.quillmd-prosemirror)
// through exactly these var() expressions (theme.test.tsx asserts each
// literal is present in App.css). `inherited` entries carry the container's
// values to the element, as the browser cascade does.
type Decl = string; // "property: var(--x, fallback)"
const CONSUMPTION: Record<string, Decl[]> = {
  ".quillmd-prosemirror": [
    "color: var(--text)",
    "font-family: var(--quillmd-editor-font, var(--font-text))",
    "font-size: var(--quillmd-editor-font-size, var(--quillmd-base-size, 15px))",
    "line-height: var(--quillmd-line-spacing, var(--quillmd-line-height, 1.7))",
  ],
  h1: [
    "border-bottom: 1px solid var(--border)",
    "color: var(--text-bright)",
    "font-size: var(--quillmd-h1, 2em)",
    "font-weight: var(--quillmd-heading-weight, 600)",
    "line-height: 1.25",
  ],
  h2: [
    "border-bottom: 1px solid var(--border)",
    "color: var(--text-bright)",
    "font-size: var(--quillmd-h2, 1.6em)",
    "font-weight: var(--quillmd-heading-weight, 600)",
    "line-height: 1.25",
  ],
  h3: [
    "color: var(--text-bright)",
    "font-size: var(--quillmd-h3, 1.3em)",
    "font-weight: var(--quillmd-heading-weight, 600)",
    "line-height: 1.25",
  ],
  h4: [
    "color: var(--text-bright)",
    "font-size: var(--quillmd-h4, 1.1em)",
    "font-weight: var(--quillmd-heading-weight, 600)",
    "line-height: 1.25",
  ],
  h5: [
    "color: var(--text-bright)",
    "font-size: var(--quillmd-h5, 1em)",
    "font-weight: var(--quillmd-heading-weight, 600)",
    "line-height: 1.25",
  ],
  h6: [
    "color: var(--text-muted)",
    "font-size: var(--quillmd-h6, 0.9em)",
    "font-weight: var(--quillmd-heading-weight, 600)",
    "line-height: 1.25",
  ],
  p: [
    "color: var(--text)",
    "font-family: var(--quillmd-editor-font, var(--font-text))",
    "font-size: var(--quillmd-editor-font-size, var(--quillmd-base-size, 15px))",
    "line-height: var(--quillmd-line-spacing, var(--quillmd-line-height, 1.7))",
  ],
  strong: ["color: var(--text-bright)"],
  s: ["color: var(--text-muted)"],
  a: ["color: var(--quillmd-link, #4fc1ff)"],
  "code": [
    "background: var(--quillmd-code-bg, rgba(128, 128, 128, 0.16))",
    "color: var(--quillmd-code-text, #f0a070)",
    "font-family: var(--font-mono)",
    "font-size: 0.9em",
  ],
  "pre": [
    "background: var(--bg-elevated)",
    "border: 1px solid var(--border)",
    "font-family: var(--font-mono)",
    "font-size: 13px",
  ],
  "pre>code": [
    "background: none",
    "color: var(--text)",
    "font-size: inherit",
  ],
  "blockquote": [
    "border-left: 3px solid var(--accent)",
    "color: var(--text-muted)",
  ],
  "table": ["border: 1px solid var(--border)"],
  "th": ["border: 1px solid var(--border)"],
  "td": ["border: 1px solid var(--border)"],
};

// The baseline renders the default look: no per-app editor font, no per-doc
// line-spacing preset, no zoom — so the unset --quillmd-editor-font /
// --quillmd-editor-font-size / --quillmd-line-spacing variables fall through
// to the theme's own values.
// Resolves every var(--name, fallback) reference inside a CSS value against
// the theme sheet, including references embedded in shorthand values
// ("1px solid var(--border)") and nested fallbacks
// ("var(--a, var(--b, 15px))"). A name with no sheet value and no fallback
// resolves to "unset" (it cannot happen for the variables App.css consumes:
// every theme sheet defines them).
function resolveInValue(value: string, vars: Record<string, string>, depth = 0): string {
  if (depth > 8) return value;
  let out = "";
  let i = 0;
  while (i < value.length) {
    if (value.startsWith("var(", i)) {
      let parens = 0;
      let j = i;
      for (; j < value.length; j += 1) {
        if (value[j] === "(") parens += 1;
        else if (value[j] === ")") {
          parens -= 1;
          if (parens === 0) break;
        }
      }
      if (j >= value.length) {
        out += value.slice(i);
        break;
      }
      const inner = value.slice(i + 4, j);
      const m = inner.match(/^\s*(--[\w-]+)\s*(?:,([\s\S]*)\s*)?$/);
      if (m) {
        const own = vars[m[1]];
        if (own !== undefined) out += resolveInValue(own, vars, depth + 1);
        else if (m[2] !== undefined) out += resolveInValue(m[2], vars, depth + 1);
        else out += "unset";
      } else {
        out += value.slice(i, j + 1);
      }
      i = j + 1;
    } else {
      out += value[i];
      i += 1;
    }
  }
  return out;
}

function resolveValue(expr: string, vars: Record<string, string>): string {
  return resolveInValue(expr, vars).trim();
}

// "2em" -> px against the theme's base size; "13px" and bare values pass
// through. Numbers keep at most two decimals.
function resolveLength(value: string, basePx: number): string {
  const em = value.match(/^([\d.]+)em$/);
  if (!em) return value;
  const px = Math.round(parseFloat(em[1]) * basePx * 100) / 100;
  return `${px}px`;
}

function resolveBasePx(vars: Record<string, string>): number {
  const base = resolveValue("var(--quillmd-base-size, 15px)", vars);
  const px = base.match(/^([\d.]+)px$/);
  expect(px, `theme base size must be px, got ${base}`).not.toBeNull();
  return parseFloat(px![1]);
}

// The element order of the styles section (fixed, so the diff is stable).
const STYLE_ELEMENT_ORDER = [
  ".quillmd-prosemirror",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "strong",
  "s",
  "a",
  "code",
  "pre",
  "pre>code",
  "blockquote",
  "ol",
  "ul",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

function resolveElementStyle(
  element: string,
  vars: Record<string, string>,
  basePx: number,
): string {
  const decls = CONSUMPTION[element];
  const parts: string[] = [];
  for (const decl of [...decls].sort()) {
    const [property, ...rest] = decl.split(": ");
    const expr = rest.join(": ");
    let value = resolveValue(expr, vars);
    if (property === "font-size" && value !== "inherit" && value !== "unset") {
      value = resolveLength(value, basePx);
    }
    parts.push(`${property}=${value}`);
  }
  return parts.join(" ");
}

function inventorySection(inv: Inventory): string {
  return Object.keys(inv.counts)
    .sort()
    .map((tag) => `${tag} x${inv.counts[tag]}: "${inv.samples[tag]}"`)
    .join("\n");
}

function stylesSection(inv: Inventory, vars: Record<string, string>): string {
  const basePx = resolveBasePx(vars);
  return STYLE_ELEMENT_ORDER.filter(
    (element) => inv.counts[element] && CONSUMPTION[element],
  ).map((element) => {
    return element === ".quillmd-prosemirror"
      ? `.quillmd-prosemirror: ${resolveElementStyle(element, vars, basePx)}`
      : `${element}: ${resolveElementStyle(element, vars, basePx)}`;
  }).join("\n");
}

function fingerprint(themeId: ThemeId, fixture: string): { text: string; styles: string } {
  const theme = THEMES.find((t) => t.id === themeId)!;
  const sheet = readFileSync(join(ROOT, "src", "themes", `${themeId}.css`), "utf8");
  const vars = parseThemeSheet(themeId, sheet);
  const inv = renderInventory(fixture);
  const styles = stylesSection(inv, vars);
  const text = [
    "# QuillMD theme screenshot baseline (headless visual fingerprint)",
    `# theme: ${themeId}`,
    `# label: ${theme.label}`,
    `# fixture: ${FIXTURE_REL}`,
    `# fixture-sha256: ${createHash("sha256").update(fixture).digest("hex")}`,
    "# surface: .quillmd-prosemirror (WYSIWYG); default view settings (no editor",
    "# font, no line-spacing preset, no zoom) — unset variables fall through to",
    "# the theme's own sheet values",
    "# regenerate: QUILLMD_UPDATE_BASELINES=1 npm test -- src/lib/__tests__/themescreenshots.test.tsx",
    "#",
    "# --- theme variables (src/themes/" + `${themeId}.css) ---`,
    ...Object.keys(vars)
      .sort()
      .map((name) => `${name}: ${vars[name]}`),
    "#",
    "# --- element inventory (rendered through the app document pipeline) ---",
    inventorySection(inv),
    "#",
    "# --- resolved visual style per element (App.css consumption) ---",
    styles,
    "",
  ].join("\n");
  return { text, styles };
}

// --- tests ---------------------------------------------------------------------

describe("theme screenshot baselines (issue #59, plan 05 AC4)", () => {
  let fixture = "";
  let inventory: Inventory | null = null;

  afterEach(() => {
    inventory = null;
  });

  function loadFixture(): string {
    if (!fixture) fixture = readFileSync(FIXTURE_PATH, "utf8");
    return fixture;
  }

  function loadInventory(): Inventory {
    if (!inventory) inventory = renderInventory(loadFixture());
    return inventory;
  }

  it("the standard fixture doc renders every block type the themes restyle", () => {
    const inv = loadInventory();
    for (const tag of [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "em",
      "strong",
      "s",
      "a",
      "code",
      "blockquote",
      "ol",
      "ul",
      "li",
      "pre",
      "pre>code",
      "table",
      "tbody",
      "tr",
      "th",
      "td",
    ]) {
      expect(inv.counts[tag], `the standard fixture must render ${tag}`).toBeGreaterThan(0);
    }
  });

  it.each(THEMES.map((theme) => [theme.id] as [ThemeId]))(
    "the %s theme screenshot matches the committed baseline",
    (id) => {
      const { text } = fingerprint(id, loadFixture());
      const baselinePath = join(BASELINE_DIR, `${id}.txt`);
      if (process.env.QUILLMD_UPDATE_BASELINES === "1") {
        if (!existsSync(BASELINE_DIR)) mkdirSync(BASELINE_DIR, { recursive: true });
        writeFileSync(baselinePath, text);
        expect(readFileSync(baselinePath, "utf8")).toBe(text);
        return;
      }
      expect(
        existsSync(baselinePath),
        `missing baseline ${baselinePath} — run with QUILLMD_UPDATE_BASELINES=1 and commit it`,
      ).toBe(true);
      expect(text).toBe(readFileSync(baselinePath, "utf8"));
    },
  );

  it("every theme variable the document surface consumes is resolved in the styles section", () => {
    const fixtureText = loadFixture();
    for (const theme of THEMES) {
      const { styles } = fingerprint(theme.id, fixtureText);
      // One probe per theme-variable family on the document surface: the
      // body text color, the heading scale, the link, the code surface, the
      // quote accent, the pre surface, and the borders.
      for (const probe of [
        "color=",
        "font-size=",
        "font-family=",
        "line-height=",
        "font-weight=",
        "border=",
        "background=",
      ]) {
        expect(styles, `${theme.id} must resolve ${probe}`).toContain(probe);
      }
    }
  });

  it("the five themes render visually distinct screenshots (pairwise diff)", () => {
    const fixtureText = loadFixture();
    const styles = new Map<string, string>(
      THEMES.map((theme) => [theme.id, fingerprint(theme.id, fixtureText).styles]),
    );
    const ids = THEMES.map((theme) => theme.id);
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        expect(
          styles.get(ids[i]),
          `${ids[i]} and ${ids[j]} must render differently`,
        ).not.toBe(styles.get(ids[j]));
      }
    }
  });
});
