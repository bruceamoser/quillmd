# Plan 08 — Links, Images & Media (P1)

Status: proposed · Milestone: Feature Parity (v2) · Parent issue: `P1/links-media`
Depends on: P0 (file pickers, confirm dialogs) · Unblocks: P3 (image/link
context menus)

## 1. Problem

Link insert is a prompt-less chain (registry command exists but the URL
entry UX is thin), and images insert by URL only. Word/Docs both support:
insert/edit link with URL + tooltip, insert picture **from file**, image
resize/caption/alt, and opening links. Local file support matters for a
desktop app: images should be insertable from disk and the file copied next
to the document (like Docs "uploading" a local picture).

## 2. Scope

1. **Link dialog (in-app, not prompt)** — Insert/Edit link: URL field,
   display text (defaults to selection), tooltip/title field, "Open"
   button, "Remove link". Validation (scheme check: http/https/mailto/
   tel/relative). Works from toolbar, Insert menu, and (P3) context menu.
2. **Autolink** — already on; keep. Add: plain-URL paste in WYSIWYG becomes
   a link (TipTap link extension handles; verify + test).
3. **Image insert from file** — Insert > Image > "From file…": native picker
   (P0), then the image bytes are **copied into the document's folder**
   (or an `assets/` subfolder next to the doc — user setting: same folder
   vs. `assets/`) and the markdown uses a **relative path**
   `![](assets/photo.png)`. New Rust command `copy_asset(src, docDir) ->
   relativePath` (collision-safe: `photo.png`, `photo-1.png`, …).
4. **Image insert by URL** — existing path, moved into the same Image
   submenu ("From URL…").
5. **Image edit** — click an image (or P3 context menu): Edit dialog with
   URL/path field, alt text, and **width** (px or % → `width` HTML attribute
   on the image, round-trips via HTML-in-markdown).
6. **Open links** — middle-click or context-menu "Open" launches the system
   browser via `plugin-opener` (already a dependency).
7. **Image preview in WYSIWYG** — broken images show a placeholder box with
   the filename (missing file detection via a `file_exists` check on load).
8. **Drag & drop image** into the editor → same from-file flow (P0 DnD
   foundation).

Out of scope: image cropping/editing (out of scope for a markdown editor),
video/audio embeds (defer), image compression.

## 3. Design notes

- **Asset copying rule:** only when the source is an absolute path outside
  the doc's folder. If the picked file is already relative to the doc,
  reference it directly (no copy). Copies go through the Rust safety module
  (path validation, no traversal). The copy is part of the document's
  working set — if the user deletes the doc tab, assets are **not** deleted
  (no auto-cleanup; documented).
- **Relative-path invariant:** markdown must stay portable — the file,
  opened from any folder, references `assets/…` relatively. If the user
  moves the .md without its assets, images break with the placeholder
  (expected, same as git repos).
- **Link dialog component** (`src/components/LinkDialog.tsx`): modal in-app
  (native dialogs can't do two fields); Enter submits, Esc cancels,
  autofocus URL.
- **Image node attributes:** extend the Image extension with `width` and
  `alt` (alt already standard) + `title`; serialize to
  `<img src="…" alt="…" width="320">` HTML when width set (GFM images
  support `{width=...}` via pandoc — decision: emit HTML `<img>` for
  maximum renderer compatibility; round-trip test covers it).
- **Broken image detection:** on doc load, batch-check `file_exists` for
  each image src (one Rust command, list in / list out); render
  `.quillmd-img-missing` placeholder with filename + "Re-link…" button
  (opens the file picker pre-filtered to the last folder).

## 4. Acceptance criteria

1. Insert link via toolbar → dialog → save: markdown contains `[text](url)`
   with title when provided; edit link reopens the dialog prefilled; remove
   link strips the markup keeping the text.
2. Pasting a bare URL creates a link (WYSIWYG).
3. Insert image from file: file copied to `assets/` (or same folder per
   setting), markdown has the relative path, image renders; doc folder +
   assets folder move together and images still render.
4. Collision: inserting `photo.png` twice yields `photo.png` + `photo-1.png`.
5. Image width set in Edit dialog persists in the saved file (HTML width
   attr) and re-applies on reopen.
6. Broken image (asset deleted on disk) shows the placeholder with
   filename; Re-link fixes it.
7. Context-menu "Open" (and middle-click) launches the browser for http(s)
   links; file:// links open in the OS handler.
8. Round-trip: doc with links + 2 images (1 relative, 1 HTML-width) is
   byte-identical on re-save.

## 5. Tasks (each → sub-issue)

1. **Link dialog + edit/remove** — component, validation, registry wiring
   (`link` command now takes the dialog flow), tests.
2. **Image submenu + from-URL** — Insert > Image (From file / From URL),
   toolbar button split.
3. **Asset copy pipeline** — `copy_asset` + `file_exists` Rust commands,
   asset folder setting, collision naming; unit tests via Rust.
4. **Image edit dialog** — URL/alt/width, HTML `<img>` serialization,
   round-trip fixture.
5. **Open links + broken-image placeholder** — plugin-opener wiring,
   missing-asset detection + Re-link flow.
6. **DnD image insert** — drop handler routing image files through the
   from-file flow.
 7. **Acceptance** — `p1-media` harness section; Windows manual pass (asset
    copy, open-link).

## 6. Manual acceptance checklist (Windows box)

The headless suites (`npm test`, `tests\acceptance-test.sh p1-media`) run
everywhere, but the native file picker, a real NTFS asset copy, and
launching the system browser can only be observed on a real desktop. After
`npm run tauri build` on a Windows 10/11 machine, run
`tests\acceptance-test.sh p1-media` (Git Bash) and then check §4 by hand,
focusing on the two Windows-specific areas:

- [ ] **AC3/AC4 — Asset copy.** With a document open in `C:\notes`, Insert
      > Image > From file… and pick a PNG from `C:\Pictures`. The file is
      copied to `C:\notes\assets\<name>.png` and the markdown contains the
      forward-slash relative path `![](assets/<name>.png)`; the image
      renders. Pick the same file again: the copy is `photo-1.png` (the
      collision counter), and the new image references it. Pick a file that
      already sits in the doc's folder: it is referenced relatively with no
      copy. Attempt to insert a file named `con.png` (or `NUL.png`): the
      insert is refused with the reserved-name error and nothing is written.
- [ ] **AC3 — Folder move.** Move the whole `C:\notes` folder (doc +
      `assets\`) to `D:\notes` and reopen the document: every image still
      renders (relative paths only — no `C:\` in the saved file).
- [ ] **AC7 — Open link.** Middle-click an http(s) link in the WYSIWYG view
      and in the preview: the default browser opens the destination in a new
      tab and the editor stays in the foreground (no in-app navigation, no
      new app window). A `file://` link opens in the OS handler. The link
      dialog's "Open" button does the same.
- [ ] **Golden rule 4 — CRLF.** In a CRLF document (the Windows default),
      insert an image and save: `git diff` shows only the new image line,
      and every other line keeps its CRLF ending byte-for-byte.
- [ ] **AC8 — Regressions.** `npm test` green on the Windows box;
      `tests\acceptance-test.sh p1-media` green; an untouched document
      (e.g. `fixtures\clean\images-edit-width.md`) saves byte-identically.
