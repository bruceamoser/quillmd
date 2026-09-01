// The markdown-side link operations (plan 03 task 3.5, issue #43): the
// preview link menu's Edit / Remove items act on the markdown source
// directly (the preview is read-only rendered HTML with no editor to run the
// link mark on). findMarkdownLink locates the link a rendered anchor
// identifies (destination + display text) by its mdast source position;
// unlinkMarkdownLink strips the link markup keeping the display text;
// relinkMarkdownLink applies the link dialog's result to the matched span.
// Pure over the source string — every other byte of the document is
// untouched, which is what keeps the save pipeline's round-trip intact.
import { describe, expect, it } from "vitest";
import {
  findMarkdownLink,
  relinkMarkdownLink,
  unlinkMarkdownLink,
} from "../markdownLinks";

describe("findMarkdownLink (plan 03 task 3.5, issue #43)", () => {
  it("finds an inline link by destination and display text", () => {
    const source = "See [the site](https://example.com) now";
    const ref = findMarkdownLink(source, {
      href: "https://example.com",
      text: "the site",
    });
    expect(ref).not.toBeNull();
    expect(ref!.href).toBe("https://example.com");
    expect(ref!.text).toBe("the site");
    expect(ref!.title).toBe("");
    // The span covers the full link syntax; the inner span the display text.
    expect(source.slice(ref!.start, ref!.end)).toBe("[the site](https://example.com)");
    expect(source.slice(ref!.innerStart, ref!.innerEnd)).toBe("the site");
  });

  it("carries the title of a titled link", () => {
    const source = 'a [t](https://example.com "The title") b';
    const ref = findMarkdownLink(source, { href: "https://example.com", text: "t" });
    expect(ref).not.toBeNull();
    expect(ref!.title).toBe("The title");
  });

  it("finds a reference link through its definition (url and title)", () => {
    const source = "a [the site][myref] b\n\n[myref]: https://example.com \"Ref title\"\n";
    const ref = findMarkdownLink(source, { href: "https://example.com", text: "the site" });
    expect(ref).not.toBeNull();
    expect(ref!.href).toBe("https://example.com");
    expect(ref!.title).toBe("Ref title");
    expect(source.slice(ref!.start, ref!.end)).toBe("[the site][myref]");
    expect(source.slice(ref!.innerStart, ref!.innerEnd)).toBe("the site");
  });

  it("finds an autolink (it parses as a link node)", () => {
    const source = "see <https://example.com/auto> end";
    const ref = findMarkdownLink(source, {
      href: "https://example.com/auto",
      text: "https://example.com/auto",
    });
    expect(ref).not.toBeNull();
    expect(source.slice(ref!.start, ref!.end)).toBe("<https://example.com/auto>");
  });

  it("flattens phrasing wrappers to the rendered anchor's text", () => {
    const source = "a [**bold** and *em*](https://example.com) b";
    const ref = findMarkdownLink(source, {
      href: "https://example.com",
      text: "bold and em",
    });
    expect(ref).not.toBeNull();
    // The inner span keeps the source syntax, not the flattened text.
    expect(source.slice(ref!.innerStart, ref!.innerEnd)).toBe("**bold** and *em*");
  });

  it("returns the first match in document order for duplicate links", () => {
    const source = "[dup](https://example.com) then [dup](https://example.com)";
    const ref = findMarkdownLink(source, { href: "https://example.com", text: "dup" });
    expect(ref).not.toBeNull();
    expect(ref!.start).toBe(0);
  });

  it("returns null when the destination or the text does not match", () => {
    const source = "a [the site](https://example.com) b";
    expect(
      findMarkdownLink(source, { href: "https://other.com", text: "the site" }),
    ).toBeNull();
    expect(
      findMarkdownLink(source, { href: "https://example.com", text: "other" }),
    ).toBeNull();
  });

  it("returns null when the source carries no link at all", () => {
    expect(findMarkdownLink("plain text only", { href: "https://x.com", text: "x" })).toBeNull();
  });

  it("addresses offsets in CRLF source correctly", () => {
    const source = "line one\r\n[the site](https://example.com)\r\nline three";
    const ref = findMarkdownLink(source, { href: "https://example.com", text: "the site" });
    expect(ref).not.toBeNull();
    expect(source.slice(ref!.start, ref!.end)).toBe("[the site](https://example.com)");
  });

  it("finds a link nested in a block (paragraph, list item, table cell)", () => {
    const source = "- item with [a link](https://example.com/x)\n";
    const ref = findMarkdownLink(source, { href: "https://example.com/x", text: "a link" });
    expect(ref).not.toBeNull();
    expect(source.slice(ref!.start, ref!.end)).toBe("[a link](https://example.com/x)");
  });
});

describe("unlinkMarkdownLink (plan 03 task 3.5, issue #43)", () => {
  it("removes the link markup and keeps the display text", () => {
    const source = "See [the site](https://example.com) now";
    const ref = findMarkdownLink(source, { href: "https://example.com", text: "the site" })!;
    expect(unlinkMarkdownLink(source, ref)).toBe("See the site now");
  });

  it("keeps the display text's source bytes (emphasis survives as written)", () => {
    const source = "a [**bold** link](https://example.com) b";
    const ref = findMarkdownLink(source, {
      href: "https://example.com",
      text: "bold link",
    })!;
    expect(unlinkMarkdownLink(source, ref)).toBe("a **bold** link b");
  });

  it("removes a reference link's usage and leaves the definition in place", () => {
    const source = "a [the site][myref] b\n\n[myref]: https://example.com\n";
    const ref = findMarkdownLink(source, { href: "https://example.com", text: "the site" })!;
    expect(unlinkMarkdownLink(source, ref)).toBe("a the site b\n\n[myref]: https://example.com\n");
  });

  it("leaves an empty link empty", () => {
    const source = "a [](https://example.com) b";
    const ref = findMarkdownLink(source, { href: "https://example.com", text: "" })!;
    expect(unlinkMarkdownLink(source, ref)).toBe("a  b");
  });

  it("returns the source unchanged for a ref outside the source", () => {
    const source = "a [x](https://example.com) b";
    const bad = {
      start: 10,
      end: 30,
      innerStart: 11,
      innerEnd: 12,
      href: "https://example.com",
      title: "",
      text: "x",
    };
    expect(unlinkMarkdownLink(source, bad)).toBe(source);
  });

  it("keeps every other byte (CRLF, surrounding blocks) intact", () => {
    const source = "one\r\n\r\nmid [the site](https://example.com) tail\r\n\r\nfour";
    const ref = findMarkdownLink(source, { href: "https://example.com", text: "the site" })!;
    expect(unlinkMarkdownLink(source, ref)).toBe("one\r\n\r\nmid the site tail\r\n\r\nfour");
  });
});

describe("relinkMarkdownLink (plan 03 task 3.5, issue #43)", () => {
  it("changes the destination, keeping the display text", () => {
    const source = "a [the site](https://old.example.com) b";
    const ref = findMarkdownLink(source, {
      href: "https://old.example.com",
      text: "the site",
    })!;
    const next = relinkMarkdownLink(source, ref, {
      href: "https://new.example.com",
      title: "",
      text: "",
    });
    expect(next).toBe("a [the site](https://new.example.com) b");
  });

  it("writes the tooltip into the markdown title", () => {
    const source = "a [the site](https://old.example.com) b";
    const ref = findMarkdownLink(source, {
      href: "https://old.example.com",
      text: "the site",
    })!;
    const next = relinkMarkdownLink(source, ref, {
      href: "https://new.example.com",
      title: "The tip",
      text: "",
    });
    expect(next).toBe('a [the site](https://new.example.com "The tip") b');
  });

  it("replaces the display text when it changed", () => {
    const source = "a [the site](https://old.example.com) b";
    const ref = findMarkdownLink(source, {
      href: "https://old.example.com",
      text: "the site",
    })!;
    const next = relinkMarkdownLink(source, ref, {
      href: "https://old.example.com",
      title: "",
      text: "renamed",
    });
    expect(next).toBe("a [renamed](https://old.example.com) b");
  });

  it("falls back to the link's current text, then to the destination", () => {
    const source = "a [the site](https://old.example.com) b";
    const ref = findMarkdownLink(source, {
      href: "https://old.example.com",
      text: "the site",
    })!;
    expect(
      relinkMarkdownLink(source, ref, { href: "https://old.example.com", title: "", text: "   " }),
    ).toBe(source);
    const empty = "a [](https://old.example.com) b";
    const emptyRef = findMarkdownLink(empty, {
      href: "https://old.example.com",
      text: "",
    })!;
    // Text falls back to the destination; the serializer writes the compact
    // autolink form when the display text equals the URL (the same link).
    expect(
      relinkMarkdownLink(empty, emptyRef, { href: "https://old.example.com", title: "", text: "" }),
    ).toBe("a <https://old.example.com> b");
  });

  it("trims the payload fields", () => {
    const source = "a [x](https://old.example.com) b";
    const ref = findMarkdownLink(source, { href: "https://old.example.com", text: "x" })!;
    expect(
      relinkMarkdownLink(source, ref, {
        href: "  https://new.example.com  ",
        title: "  T  ",
        text: "  y  ",
      }),
    ).toBe('a [y](https://new.example.com "T") b');
  });

  it("rejects an invalid destination and leaves the source untouched", () => {
    const source = "a [x](https://old.example.com) b";
    const ref = findMarkdownLink(source, { href: "https://old.example.com", text: "x" })!;
    expect(
      relinkMarkdownLink(source, ref, { href: "javascript:alert(1)", title: "", text: "" }),
    ).toBe(source);
  });

  it("converts a reference link's usage to an inline link, keeping the definition", () => {
    const source = "a [the site][myref] b\n\n[myref]: https://old.example.com\n";
    const ref = findMarkdownLink(source, { href: "https://old.example.com", text: "the site" })!;
    const next = relinkMarkdownLink(source, ref, {
      href: "https://new.example.com",
      title: "",
      text: "",
    });
    expect(next).toBe("a [the site](https://new.example.com) b\n\n[myref]: https://old.example.com\n");
  });

  it("escapes the display text when it carries link syntax", () => {
    const source = "a [brackets](https://old.example.com) b";
    const ref = findMarkdownLink(source, { href: "https://old.example.com", text: "brackets" })!;
    const next = relinkMarkdownLink(source, ref, {
      href: "https://old.example.com",
      title: "",
      text: "a]b",
    });
    expect(next).toBe("a [a\\]b](https://old.example.com) b");
  });

  it("returns the source unchanged for a ref outside the source", () => {
    const source = "a [x](https://old.example.com) b";
    const bad = {
      start: -1,
      end: 3,
      innerStart: 0,
      innerEnd: 1,
      href: "https://old.example.com",
      title: "",
      text: "x",
    };
    expect(relinkMarkdownLink(source, bad, { href: "https://new.example.com", title: "", text: "" })).toBe(
      source,
    );
  });
});
