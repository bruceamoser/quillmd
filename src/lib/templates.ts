// Built-in template set (plan 01 §2 item 3, task 1.3). The template sources
// live in src/templates/*.md and are bundled verbatim through Vite's ?raw
// imports, so a "New from template" tab starts with the exact shipped bytes.
// The template ids must stay in sync with the File > New from Template
// submenu built in src-tauri/src/menu.rs.

import blank from "../templates/blank.md?raw";
import blogPost from "../templates/blog-post.md?raw";
import meetingNotes from "../templates/meeting-notes.md?raw";
import projectPlan from "../templates/project-plan.md?raw";
import proposalSkeleton from "../templates/proposal-skeleton.md?raw";
import readme from "../templates/readme.md?raw";

export interface Template {
  // Stable id, also used to derive the native menu item id
  // (file-new-template-<id>).
  id: string;
  // Display label in the menu and the status bar.
  label: string;
  // Markdown content seeded into the new untitled tab.
  content: string;
}

export const TEMPLATES: Template[] = [
  { id: "blank", label: "Blank", content: blank },
  { id: "meeting-notes", label: "Meeting Notes", content: meetingNotes },
  { id: "blog-post", label: "Blog Post", content: blogPost },
  { id: "readme", label: "README", content: readme },
  { id: "project-plan", label: "Project Plan", content: projectPlan },
  { id: "proposal-skeleton", label: "Proposal Skeleton", content: proposalSkeleton },
];

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
