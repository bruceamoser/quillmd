#!/usr/bin/env python3
"""QuillMD fixture corpus generator.

Generates the >=50 markdown fixtures required by spec.md §5.1 (round-trip
fidelity corpus). Every feature in §2.1.3 is covered, plus the special
byte-sensitivity fixtures (CRLF, BOM, mixed-EOL, emoji, Windows paths,
nested tasks, reference links, HTML passthrough).

Deterministic: same input -> same bytes. Run from repo root:
    python3 tools/gen-fixtures.py
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "fixtures"
CLEAN = FIX / "clean"
CRLF = FIX / "crlf"
MIXED = FIX / "mixed-eol"
BOM = FIX / "bom"
EMOJI = FIX / "emoji"
WINPATH = FIX / "windows-path"
NESTED = FIX / "nested-task"

for d in (CLEAN, CRLF, MIXED, BOM, EMOJI, WINPATH, NESTED):
    d.mkdir(parents=True, exist_ok=True)

fixtures = {}

# --- headings -----------------------------------------------------------
fixtures["headings.md"] = """# Heading One

## Heading Two

### Heading Three

#### Heading Four

##### Heading Five

###### Heading Six

A paragraph with *italic*, **bold**, ~~strikethrough~~, and `inline code`.
"""

fixtures["emphasis-delims.md"] = """Mixed emphasis delimiters:

*asterisk italic* and _underscore italic_ and **asterisk bold** and __underscore bold__.
Combined: **bold with *nested italic***. Escaped: \\*not emphasis\\* and \\_not underscore\\_.
"""

fixtures["links-inline.md"] = """Inline links:

[Example](https://example.com) and [with title](https://example.org "Title").
Auto-links: <https://example.net> and bare https://example.io.
"""

fixtures["links-reference.md"] = """Reference links:

[foo][bar] and [baz][1] and [shortcut].

[bar]: https://example.com/bar
[1]: https://example.com/one "One"
[shortcut]: https://example.com/short
"""

fixtures["images.md"] = """Images:

![Alt text](https://example.com/img.png)
![Local](images/photo.jpg "A local image")
![Referenced][img]

[img]: https://example.com/ref.png
"""

fixtures["lists-ul.md"] = """Unordered lists:

- one
- two
- three

Nested:
- outer
  - inner
    - deepest
- back to outer

Tight list: - a
- b
- c

Loose list:

- a

- b

- c
"""

fixtures["lists-ol.md"] = """Ordered lists:

1. first
2. second
3. third

Nested ordered:
1. one
   1. one-point-one
   2. one-point-two
2. two

Interrupted: 3. after a gap

4. continues
"""

fixtures["lists-task.md"] = """Task lists:

- [ ] open task
- [x] done task
- [ ] another open
"""

fixtures["blockquote.md"] = """> Simple quote.

> Multi-line quote
> spanning two lines.

> Outer quote
> > nested quote
> > > deepest
> back to outer.

> Quote with **bold** and `code` and a [link](https://example.com).
"""

fixtures["code-fenced.md"] = """Fenced code:

```python
def hello():
    return "world"
```

```js
const x = 1;
```

Fence with info string and language highlighting:

```rust {#example}
fn main() { println!("hi"); }
```

Tilde fence:

~~~text
tilde delimited
~~~
"""

fixtures["code-indented.md"] = """Indented code:

    def indented():
        return 4

Followed by more text.
"""

fixtures["tables.md"] = """GFM tables:

| Left | Center | Right |
|:-----|:------:|------:|
| a    |   b    |     c |
| d    |   e    |     f |

Single-row table:

| Only | Row |
|------|-----|
| 1    | 2   |

Table with code and links:

| Name | Value |
|------|-------|
| `x`  | [link](https://example.com) |
"""

fixtures["gfm-tables.md"] = """GFM table hardening (issue #61):

Alignment in every column:

| Left | Center | Right |
|:-----|:------:|------:|
| a    |   b    |     c |

Escaped pipes, emphasis, and code:

| Col | Escaped | Code |
|-----|---------|------|
| a \\| b | *em* | `x` |
| p   | b \\| c \\| d | `y \\| z` |

Links and hard breaks in cells:

| Name | Note |
|------|------|
| [site](https://example.com) | first line<br>second line |

Single column:

| Only |
|------|
| one  |

Empty cells:

| a |  | c |
|---|---|---|
| 1 |  | 3 |
"""

fixtures["hr.md"] = """Before.

---

After (asterisks).

* * *

After (spaced).

___

After (underscores).
"""

fixtures["html-passthrough.md"] = """Raw HTML:

<div class="note">
  <p>Block with <strong>nested</strong> HTML and <a href="#">link</a>.</p>
</div>

Inline: text with <span class="hl">highlighted span</span> and <br/> break.

<!-- an HTML comment -->

<https://example.com> is an autolink, not HTML.
"""

fixtures["footnotes.md"] = """Footnotes:

Here is a footnote reference[^1] and another[^longnote].

[^1]: The first footnote.
[^longnote]: A longer footnote with **formatting** and a [link](https://example.com).
"""

fixtures["def-lists.md"] = """Definition lists:

Term One
: Definition one.

Term Two
: Definition two, first part
: Definition two, second part
"""

fixtures["subsup-highlight.md"] = """Extensions:

H~2~O is water. E=mc^2^. ==Marked text== is highlighted.
"""

fixtures["front-matter.md"] = """---
title: Fixture Document
author: Bruce Moser
tags: [quillmd, test, roundtrip]
custom: { nested: { deep: value }, list: [1, 2, 3] }
---

# Front Matter Fixture

Body with [a link](https://example.com) and **bold**.
"""

fixtures["mixed-structure.md"] = """# Big Mixed Fixture

Intro paragraph with *em*, **strong**, `code`, ~~del~~, and [link](https://example.com).

> Quote block
> with two lines

1. ordered one
2. ordered two

- bullet one
- bullet two
  - nested bullet

```json
{"key": "value"}
```

| A | B |
|---|---|
| 1 | 2 |

Footnotes here[^fn].

[^fn]: The footnote.

---

Final paragraph with an image: ![pic](img.png)
"""

# --- special byte-sensitivity fixtures ----------------------------------
fixtures["windows-paths.md"] = """Windows path handling:

Image with backslash path: ![screenshot](C:\\Users\\bruce\\Pictures\\shot.png)
Inline path: C:\\Users\\bruce\\Documents\\notes.md
Backslash escapes: \\*not emphasis\\*
"""

fixtures["nested-task-list.md"] = """# Nested Task List

- [ ] top open
- [x] top done
  - [ ] nested open
    - [x] deeply nested done
  - [ ] second nested
- [ ] back to top level

Text after the list.
"""

fixtures["emoji.md"] = """# Emoji and Unicode

Emoji: 😀 🎉 🚀 👨‍👩‍👧‍👦 (ZWJ family)

Accented: café naïve résumé jalapeño

CJK: 中文测试，日本語のテスト，한국어 테스트

RTL: مرحبا بالعالم

Combining: e\u0301 (e + combining acute)
"""

# --- additional coverage to reach the >=50 fixture target ----------------
fixtures["list-interruptions.md"] = """Interruptions:

Paragraph.

- list
- items

Paragraph between.

1. ordered
2. items

Another paragraph.

---

Paragraph.

    indented code after paragraph
"""

fixtures["nested-quotes-lists.md"] = """> quote with a list:
>
> - item one
> - item two
>
> and back to quote

- list with a quote:
  > quoted inside list
- next item
"""

fixtures["links-many-styles.md"] = """[inline](https://a.com) [ref][r] <https://auto.com> ![img](img.png) [shortcut]

[r]: https://r.com "ref title"
[shortcut]: https://s.com

A second paragraph with [another inline](https://b.com/path?q=1&x=2#frag) link.
"""

fixtures["escape-sequences.md"] = """Escapes:

\\*not italic\\* \\_not underscore\\_ \\# not heading \\` not code \\[ not link \\] 

Backslash at end of line: \\\\
Double backslash: \\\\

Literal punctuation: * * * --- *** ___ ` ~ [ ] ( ) { } < > | ! @ # $ % ^ & 
"""

fixtures["empty-lines-spacing.md"] = """# Header

Paragraph one.

Paragraph two.

# Header Two

Paragraph three.
"""

fixtures["hard-breaks.md"] = """Two-space break:  
next line

Backslash break: \\
next line

No break:
next line is same paragraph? Actually no, single newline is a soft break.
"""

fixtures["table-complex.md"] = """| Col | Escaped | Code |
|-----|---------|------|
| a \| b | *em* | `code` |
| [link](https://x.com) | **bold** | <tag> |

Empty cells: | a | | c |
|----|----|----|
| 1 | | 3 |
"""

fixtures["headings-setext.md"] = """Setext heading one
===================

Setext heading two
------------------

Paragraph after.
"""

fixtures["code-tilde-info.md"] = """~~~python
tilde fence
~~~

```bash
echo "double fence"
```

Fence without language:

```
plain
```
"""

fixtures["images-local-relative.md"] = """![one](./img/a.png)
![two](../img/b.png)
![three](assets/c.png "title")
![four](images/sub/d.png)
"""

fixtures["blockquote-html.md"] = """> Quote with HTML: <div>block</div> and <span>inline</span>.
>
> ```
> code inside quote
> ```
"""

fixtures["deep-nesting.md"] = """> quote
> > nested quote
> > > deeper quote
> > > > deepest quote

- list
  - sub
    - subsub
      - subsubsub
"""

fixtures["front-matter-yaml-rich.md"] = """---
title: "Quoted Title"
author:
  name: Bruce Moser
  email: bruce@example.com
date: 2026-08-16
tags:
  - alpha
  - beta
numbers: [1, 2, 3]
nested:
  key: value
  list:
    - a
    - b
---

# Rich Front Matter

Content with [link](https://example.com).
"""

fixtures["multiple-code-blocks.md"] = """```js
first
```

Text between.

```py
second
```

More text.

```
third
```
"""

fixtures["spaces-tabs.md"] = """Indented with tabs:

\tindented tab line

Mixed:

    four spaces
\tone tab
"""

fixtures["thematic-breaks-many.md"] = """***

---

___

* * *

- - -

_ _ _
"""

fixtures["html-forms.md"] = """<form action="/submit">
  <label for="name">Name:</label>
  <input type="text" id="name" name="name" />
  <button type="submit">Go</button>
</form>

Inline: <kbd>Ctrl</kbd> + <kbd>S</kbd>
"""

fixtures["links-destinations.md"] = """[empty]() [spaces](  ) [parens](https://x.com/a_(b)) [query](?a=1&b=2) [hash](#section)

[ref-empty][]

[ref-empty]: 
"""

fixtures["ordered-start.md"] = """0. zero start
1. one
2. two

5. five start
6. six
"""

fixtures["blank-paragraph-lines.md"] = """Paragraph one.


Paragraph two with three blank lines above (two visible).



Paragraph three.
"""

fixtures["long-document.md"] = """# Long Document Fixture

## Section One

Intro paragraph with **bold**, *italic*, and [a link](https://example.com).

### Subsection A

- bullet one
- bullet two
  - nested bullet

### Subsection B

1. numbered one
2. numbered two

## Section Two

> A blockquote that spans
> multiple lines of text.

```python
def long_doc():
    return "fixture"
```

| Col A | Col B |
|-------|-------|
| 1     | 2     |
| 3     | 4     |

## Section Three

Final paragraph with a footnote[^1] and an image: ![img](img.png).

[^1]: The footnote text.
"""

fixtures["nested-task-list.md"] = """# Nested Task List

- [ ] top open
- [x] top done
  - [ ] nested open
    - [x] deeply nested done
  - [ ] second nested
- [ ] back to top level

Text after the list.
"""

# --- write files ---------------------------------------------------------
def write(path: Path, content: str):
    path.write_bytes(content.encode("utf-8"))

for name, content in fixtures.items():
    write(CLEAN / name, content)

# CRLF variants
write(CRLF / "crlf-basic.md", "line one\r\nline two\r\n\r\n# Heading\r\n")
write(CRLF / "crlf-lists.md", "- one\r\n- two\r\n  - nested\r\n- three\r\n")
write(CRLF / "crlf-code.md", "```python\r\ndef f():\r\n    return 1\r\n```\r\n")

# Mixed EOL
write(MIXED / "mixed-endings.md", "lf line\ncrlf line\r\nlf again\ncrlf again\r\n")

# BOM
write(BOM / "bom-lf.md", "\ufeff# BOM with LF\n\nbody\n")
write(BOM / "bom-crlf.md", "\ufeff# BOM with CRLF\r\n\r\nbody\r\n")

# Windows path (already LF in clean/; keep a dedicated copy for the matrix)
write(WINPATH / "winpath-deep.md", "![x](C:\\a\\b\\c.png)\n\nPath: D:\\very\\long\\path\\with\\spaces\\file name.md\n")

total = sum(len(fixtures) for _ in [1]) + len(list(CRLF.glob("*.md"))) + len(list(MIXED.glob("*.md"))) + len(list(BOM.glob("*.md"))) + len(list(WINPATH.glob("*.md"))) + len(list(NESTED.glob("*.md")))
# recount properly
total = len(list(CLEAN.glob("*.md"))) + len(list(CRLF.glob("*.md"))) + len(list(MIXED.glob("*.md"))) + len(list(BOM.glob("*.md"))) + len(list(WINPATH.glob("*.md"))) + len(list(NESTED.glob("*.md")))
print(f"Fixtures written: {total} files")
for sub in (CLEAN, CRLF, MIXED, BOM, EMOJI, WINPATH, NESTED):
    n = len(list(sub.glob("*.md")))
    if n:
        print(f"  {sub.name}: {n}")
