import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TEMPLATES, templateById } from "../templates";

const repoFile = (rel: string): string => {
  const url = new URL(rel, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
};

describe("Built-in template set (#24)", () => {
  it("ships the plan's six templates with stable ids and labels", () => {
    expect(TEMPLATES.map((t) => [t.id, t.label])).toEqual([
      ["blank", "Blank"],
      ["meeting-notes", "Meeting Notes"],
      ["blog-post", "Blog Post"],
      ["readme", "README"],
      ["project-plan", "Project Plan"],
      ["proposal-skeleton", "Proposal Skeleton"],
    ]);
  });

  it("has unique, menu-safe ids", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("bundles each template verbatim from src/templates/<id>.md", () => {
    for (const t of TEMPLATES) {
      expect(t.content, `${t.id} must equal the shipped file`).toBe(
        repoFile(`../../templates/${t.id}.md`),
      );
    }
  });

  it("blank is empty; every other template is non-empty markdown with a title", () => {
    expect(templateById("blank")?.content).toBe("");
    for (const t of TEMPLATES) {
      if (t.id === "blank") continue;
      expect(t.content.length, t.id).toBeGreaterThan(0);
      expect(t.content.startsWith("# "), t.id).toBe(true);
    }
  });

  it("templateById resolves known ids and rejects unknown ones", () => {
    expect(templateById("readme")?.label).toBe("README");
    expect(templateById("meeting-notes")?.content).toContain("# Meeting Notes");
    expect(templateById("nope")).toBeUndefined();
  });

  it("stays in sync with the native File > New from Template submenu", () => {
    const menu = repoFile("../../../src-tauri/src/menu.rs");
    // The submenu item ids are derived at build time as file-new-template-<id>.
    expect(menu).toContain('format!("file-new-template-{id}")');
    for (const t of TEMPLATES) {
      expect(menu, `menu.rs template entry for ${t.id}`).toContain(`("${t.id}", "${t.label}")`);
    }
  });
});
