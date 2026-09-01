// Native OS menu bar (VSCode-class). Real menus built with the tauri::menu
// API render as native OS menus on Windows and Linux; they are not HTML
// buttons. Every leaf item carries a stable id that is emitted to the webview
// as a "menu-event" so the frontend can dispatch the same editor/app commands
// that the toolbar and keyboard shortcuts use.

use std::fs;
use std::path::PathBuf;

use tauri::menu::{Menu, MenuBuilder, MenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Manager, Runtime};

pub const RECENT_CAP: usize = 10;

fn recent_file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("recent.json"))
}

pub fn load_recent<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    let Some(path) = recent_file(app) else {
        return Vec::new();
    };
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
        .unwrap_or_default()
}

pub fn save_recent<R: Runtime>(app: &AppHandle<R>, recent: &[String]) {
    let Some(path) = recent_file(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string(recent) {
        let _ = fs::write(&path, json);
    }
}

/// Rebuilds the menu from a fresh recent-files list and installs it as the
/// active application menu.
pub fn refresh<R: Runtime>(app: &AppHandle<R>, recent: &[String]) -> tauri::Result<()> {
    let menu = build(app, recent)?;
    app.set_menu(menu)?;
    Ok(())
}

pub fn build<R: Runtime>(app: &AppHandle<R>, recent: &[String]) -> tauri::Result<Menu<R>> {
    let file = build_file_menu(app, recent)?;
    let edit = build_edit_menu(app)?;
    let view = build_view_menu(app)?;
    let insert = build_insert_menu(app)?;
    let format = build_format_menu(app)?;
    let tools = build_tools_menu(app)?;
    let help = build_help_menu(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&file, &edit, &view, &insert, &format, &tools, &help])
        .build()?;
    Ok(menu)
}

// Built-in template set (plan 01 task 1.3). The ids must stay in sync with
// src/lib/templates.ts; the frontend resolves file-new-template-<id> to the
// template content bundled in src/templates/<id>.md.
pub const TEMPLATES: &[(&str, &str)] = &[
    ("blank", "Blank"),
    ("meeting-notes", "Meeting Notes"),
    ("blog-post", "Blog Post"),
    ("readme", "README"),
    ("project-plan", "Project Plan"),
    ("proposal-skeleton", "Proposal Skeleton"),
];

// Font submenu lists (plan 04 task 4.4, issue #50). These mirror the
// frontend constants — src/lib/editorCommands.ts FONT_FAMILIES / FONT_SIZES
// and src/lib/colors.ts COLOR_PALETTE — so the native menu offers exactly the
// same families, sizes, and swatches the toolbar font cluster does; the
// vitest suite (src/lib/__tests__/fontmenu.test.tsx) asserts the two stay in
// sync, the same contract as TEMPLATES above. The colors are the palette
// hex digits without the leading "#"; the menu ids carry the bare digits and
// the frontend re-adds the "#" when it dispatches the color command.
pub const FONT_FAMILIES: &[&str] = &[
    "Arial",
    "Arial Black",
    "Book Antiqua",
    "Brush Script MT",
    "Calibri",
    "Cambria",
    "Century Gothic",
    "Comic Sans MS",
    "Consolas",
    "Courier New",
    "Franklin Gothic Medium",
    "Garamond",
    "Georgia",
    "Impact",
    "Lucida Console",
    "MS Gothic",
    "MS Mincho",
    "Palatino Linotype",
    "Segoe UI",
    "Tahoma",
    "Times New Roman",
    "Trebuchet MS",
    "Verdana",
];
pub const FONT_SIZES: &[u8] = &[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];
// Editor-chrome font lists (plan 04 task 4.5, issue #51). These mirror the
// frontend constants — src/lib/editorFont.ts EDITOR_FONT_FAMILIES /
// EDITOR_FONT_SIZES — so the View > Editor font submenu offers exactly the
// picks the frontend applies; the vitest suite
// (src/lib/__tests__/editorfont.test.tsx) asserts the two stay in sync, the
// same contract as the document font lists above.
pub const EDITOR_FONT_FAMILIES: &[&str] = &["sans-serif", "serif", "monospace"];
pub const EDITOR_FONT_SIZES: &[u8] = &[12, 13, 14, 15, 16, 18, 20, 24];
pub const FONT_COLORS: &[&str] = &[
    "000000", "7f0000", "9c5700", "7f6000", "375623", "1f4e79",
    "595959", "c00000", "ed7d31", "ffc000", "70ad47", "4472c4",
    "a6a6a6", "ff6b6b", "f4b183", "ffd966", "a9d18e", "9dc3e6",
    "d9d9d9", "ffc7ce", "fbe2d5", "fff2cc", "e2efda", "ddebf7",
];

// Styles submenu (plan 05 task 5.2, issue #55). These mirror the frontend's
// built-in style registry — src/lib/styles.ts BUILT_IN_STYLES, as (id, label)
// pairs — so the native menu offers exactly the styles the toolbar's style
// gallery shows; the vitest suite (src/lib/__tests__/stylemenu.test.tsx)
// asserts the two stay in sync, the same contract as the Font submenu lists.
// The ids are the stable style ids the frontend resolves with styleById.
pub const STYLES: &[(&str, &str)] = &[
    ("normal", "Normal"),
    ("title", "Title"),
    ("heading1", "Heading 1"),
    ("heading2", "Heading 2"),
    ("heading3", "Heading 3"),
    ("heading4", "Heading 4"),
    ("heading5", "Heading 5"),
    ("heading6", "Heading 6"),
    ("subtitle", "Subtitle"),
    ("quote", "Quote"),
    ("intense-quote", "Intense Quote"),
    ("list-paragraph", "List Paragraph"),
    ("no-spacing", "No Spacing"),
    ("source-code", "Source Code"),
    ("code", "Code"),
    ("emphasis", "Emphasis"),
    ("strong", "Strong"),
];

// Theme submenu (plan 05 task 5.3, issue #56). These mirror the frontend's
// built-in theme set — src/lib/theme.ts THEMES, as (id, label) pairs — so the
// native View > Theme and View > Default theme submenus offer exactly the
// themes the CSS variable sheets (src/themes/*.css) define; the vitest suite
// (src/lib/__tests__/theme.test.tsx) asserts the two stay in sync, the same
// contract as STYLES above. The ids are the stable theme ids the frontend
// resolves with isThemeId.
pub const THEMES: &[(&str, &str)] = &[
    ("quill", "Quill"),
    ("minimal", "Minimal"),
    ("serif", "Serif / Book"),
    ("dark", "Dark"),
    ("high-contrast", "High Contrast"),
];

// The family-name slug used in the format-font-family-<slug> menu ids:
// lowercase, every run of non-alphanumerics collapsed to a single "-". Must
// stay byte-identical to fontFamilySlug in src/lib/editorCommands.ts, which
// resolves the id back to the family name on the frontend.
fn family_slug(family: &str) -> String {
    let mapped: String = family
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    mapped.split('-').filter(|s| !s.is_empty()).collect::<Vec<_>>().join("-")
}

fn build_file_menu<R: Runtime>(
    app: &AppHandle<R>,
    recent: &[String],
) -> tauri::Result<Submenu<R>> {
    let new_doc = MenuItem::with_id(app, "file-new", "New", true, Some("Ctrl+N"))?;
    let mut new_template = SubmenuBuilder::new(app, "New from Template");
    for (id, label) in TEMPLATES {
        new_template = new_template.text(format!("file-new-template-{id}"), *label);
    }
    let new_template = new_template.build()?;
    let open = MenuItem::with_id(app, "file-open", "Open...", true, Some("Ctrl+O"))?;
    let open_folder =
        MenuItem::with_id(app, "file-open-folder", "Open Folder...", true, Some("Ctrl+Shift+O"))?;
    let save = MenuItem::with_id(app, "file-save", "Save", true, Some("Ctrl+S"))?;
    let save_as = MenuItem::with_id(app, "file-save-as", "Save As...", true, Some("Ctrl+Shift+S"))?;
    let make_copy =
        MenuItem::with_id(app, "file-make-a-copy", "Make a Copy", true, None::<&str>)?;
    let close = MenuItem::with_id(app, "file-close", "Close", true, Some("Ctrl+W"))?;
    let close_all =
        MenuItem::with_id(app, "file-close-all", "Close All", true, None::<&str>)?;
    let info = MenuItem::with_id(app, "file-info", "Info", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "file-exit", "Exit", true, Some("Ctrl+Q"))?;

    let mut recent_menu = SubmenuBuilder::new(app, "Recent Files");
    if recent.is_empty() {
        let empty =
            MenuItem::with_id(app, "file-recent-empty", "No Recent Files", false, None::<&str>)?;
        recent_menu = recent_menu.item(&empty);
    } else {
        for (i, path) in recent.iter().take(RECENT_CAP).enumerate() {
            let id = format!("file-recent-{i}");
            recent_menu = recent_menu.text(id, path.as_str());
        }
    }
    recent_menu = recent_menu.separator();
    let clear = MenuItem::with_id(app, "file-recent-clear", "Clear Recent Files", true, None::<&str>)?;
    recent_menu = recent_menu.item(&clear);
    let recent_menu = recent_menu.build()?;

    let export = SubmenuBuilder::new(app, "Export")
        .text("export-pdf", "PDF")
        .text("export-docx", "DOCX")
        .text("export-epub", "EPUB")
        .text("export-txt", "TXT")
        .build()?;
    let import = MenuItem::with_id(app, "import-docx", "Import DOCX...", true, None::<&str>)?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&new_doc)
        .item(&new_template)
        .separator()
        .items(&[&open, &open_folder, &make_copy])
        .separator()
        .items(&[&save, &save_as, &close, &close_all, &info])
        .separator()
        .item(&recent_menu)
        .separator()
        .item(&export)
        .item(&import)
        .separator()
        .item(&exit)
        .build()?;
    Ok(file)
}

fn build_edit_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let undo = MenuItem::with_id(app, "edit-undo", "Undo", true, Some("Ctrl+Z"))?;
    let redo = MenuItem::with_id(app, "edit-redo", "Redo", true, Some("Ctrl+Shift+Z"))?;
    let cut = MenuItem::with_id(app, "edit-cut", "Cut", true, Some("Ctrl+X"))?;
    let copy = MenuItem::with_id(app, "edit-copy", "Copy", true, Some("Ctrl+C"))?;
    let paste = MenuItem::with_id(app, "edit-paste", "Paste", true, Some("Ctrl+V"))?;
    // Paste-as-text (plan 02 §2.9, issue #36): strips the clipboard to plain
    // text. The accelerator is the Word parity Ctrl+Shift+V; the frontend
    // dispatches the pasteAsText registry command with the clipboard payload.
    let paste_as_text =
        MenuItem::with_id(app, "edit-paste-as-text", "Paste as Text", true, Some("Ctrl+Shift+V"))?;
    let find = MenuItem::with_id(app, "edit-find", "Find", true, Some("Ctrl+F"))?;
    // Find & replace panel (plan 07 task 7.2, issue #70): Ctrl+F opens the
    // panel in find mode, Ctrl+H in replace mode; Find Next / Find Previous
    // cycle the active match (F3 / Shift+F3, the frontend no-ops them without
    // a match).
    let find_replace =
        MenuItem::with_id(app, "edit-find-replace", "Find and Replace", true, Some("Ctrl+H"))?;
    let find_next = MenuItem::with_id(app, "edit-find-next", "Find Next", true, Some("F3"))?;
    let find_prev =
        MenuItem::with_id(app, "edit-find-prev", "Find Previous", true, Some("Shift+F3"))?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .items(&[&undo, &redo])
        .separator()
        .items(&[&cut, &copy, &paste, &paste_as_text])
        .separator()
        .items(&[&find, &find_replace, &find_next, &find_prev])
        .build()?;
    Ok(edit)
}

fn build_view_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let wysiwyg = MenuItem::with_id(app, "view-wysiwyg", "WYSIWYG", true, None::<&str>)?;
    let source = MenuItem::with_id(app, "view-source", "Source", true, None::<&str>)?;
    let split = MenuItem::with_id(app, "view-split", "Split", true, None::<&str>)?;
    let preview = MenuItem::with_id(app, "view-preview", "Preview", true, None::<&str>)?;
    let toggle = MenuItem::with_id(
        app,
        "view-toggle",
        "Toggle WYSIWYG/Source",
        true,
        Some("Ctrl+/"),
    )?;
    let explorer = MenuItem::with_id(app, "view-explorer", "Toggle Explorer", true, Some("Ctrl+Shift+E"))?;
    // Navigation pane (plan 09 task 9.3, issue #86): the right-hand heading
    // rail. The accelerator is the Word parity one (Ctrl+Shift+8); the open
    // state persists per doc on the frontend.
    let navigation = MenuItem::with_id(app, "view-navigation", "Toggle Navigation Pane", true, Some("Ctrl+Shift+8"))?;
    let statusbar = MenuItem::with_id(app, "view-statusbar", "Toggle Status Bar", true, None::<&str>)?;
    // Full screen (plan 10 task 10.3, issue #95): hides the menu bar, toolbar,
    // status bar, and side rails, leaving the editor only; F11 enters/exits
    // and Esc exits (the browser/OS when the fullscreen API is active, the
    // frontend keydown in the chrome-hide-only fallback). The frontend
    // (App.tsx) resolves the id.
    let full_screen = MenuItem::with_id(app, "view-fullscreen", "Full Screen", true, Some("F11"))?;

    // View-level document preferences (plan 02 task 2.5, issue #34): line
    // spacing presets, formatting marks, and word wrap. These are view-only —
    // they persist per path on the frontend and never touch the markdown.
    let mut line_spacing = SubmenuBuilder::new(app, "Line Spacing");
    line_spacing = line_spacing.text("view-spacing-single", "Single");
    line_spacing = line_spacing.text("view-spacing-1.15", "1.15");
    line_spacing = line_spacing.text("view-spacing-1.5", "1.5");
    line_spacing = line_spacing.text("view-spacing-double", "Double");
    let line_spacing = line_spacing.build()?;
    let show_marks =
        MenuItem::with_id(app, "view-show-marks", "Show Formatting Marks", true, None::<&str>)?;
    let word_wrap =
        MenuItem::with_id(app, "view-word-wrap", "Word Wrap", true, None::<&str>)?;
    // Spellcheck (plan 02 §2.8, issue #36): toggles the contenteditable
    // spellcheck attribute in the WYSIWYG view; per-doc persisted on the
    // frontend. The source view (CodeMirror) is always off.
    let spellcheck = MenuItem::with_id(app, "view-spellcheck", "Spellcheck", true, None::<&str>)?;

    // Editor font (plan 04 task 4.5, issue #51): the editor's own chrome
    // font/size — the font the WYSIWYG content renders in. Per-app (not
    // per-doc), persisted on the frontend; purely cosmetic, never touches
    // the document.
    let mut editor_font = SubmenuBuilder::new(app, "Editor font");
    for family in EDITOR_FONT_FAMILIES {
        let mut label = String::from(*family);
        if let Some(first) = label.get_mut(0..1) {
            first.make_ascii_uppercase();
        }
        editor_font = editor_font.text(format!("view-editor-font-{family}"), label);
    }
    editor_font = editor_font.separator();
    for size in EDITOR_FONT_SIZES {
        editor_font = editor_font.text(
            format!("view-editor-font-size-{size}"),
            format!("{size} px"),
        );
    }
    let editor_font = editor_font.build()?;

    // Document themes (plan 05 task 5.3, issue #56). View > Theme sets the
    // active document's per-doc override (or "Use App Default" clears it);
    // View > Default theme sets the app-wide default. Both are view-only —
    // the frontend renders the pick as the data-theme attribute on the
    // content container and never touches the document bytes.
    let mut theme = SubmenuBuilder::new(app, "Theme");
    for (id, label) in THEMES {
        theme = theme.text(format!("view-theme-{id}"), *label);
    }
    theme = theme.separator();
    let use_app_default =
        MenuItem::with_id(app, "view-theme-reset", "Use App Default", true, None::<&str>)?;
    theme = theme.item(&use_app_default);
    let theme = theme.build()?;

    let mut default_theme = SubmenuBuilder::new(app, "Default theme");
    for (id, label) in THEMES {
        default_theme = default_theme.text(format!("view-theme-default-{id}"), *label);
    }
    let default_theme = default_theme.build()?;

    // Zoom (plan 02 task 2.6, issue #35): 50-200% in 10% steps, per-doc
    // persisted on the frontend. The accelerators are the Word parity ones:
    // Ctrl+= zooms in, Ctrl+- out, Ctrl+0 resets.
    let zoom_in = MenuItem::with_id(app, "view-zoom-in", "Zoom In", true, Some("Ctrl+="))?;
    let zoom_out = MenuItem::with_id(app, "view-zoom-out", "Zoom Out", true, Some("Ctrl+-"))?;
    let zoom_reset = MenuItem::with_id(app, "view-zoom-reset", "Reset Zoom", true, Some("Ctrl+0"))?;
    let zoom = SubmenuBuilder::new(app, "Zoom")
        .items(&[&zoom_in, &zoom_out, &zoom_reset])
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .items(&[&wysiwyg, &source, &split, &preview])
        .separator()
        .item(&toggle)
        .separator()
        .item(&line_spacing)
        .item(&zoom)
        .item(&show_marks)
        .item(&word_wrap)
        .item(&spellcheck)
        .item(&editor_font)
        .item(&theme)
        .item(&default_theme)
        .separator()
        .items(&[&explorer, &navigation, &statusbar, &full_screen])
        .build()?;
    Ok(view)
}

fn build_insert_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let mut heading = SubmenuBuilder::new(app, "Heading");
    for level in 1..=6u8 {
        heading = heading.text(format!("insert-h{level}"), format!("H{level}"));
    }
    let heading = heading.build()?;

    let bold = MenuItem::with_id(app, "insert-bold", "Bold", true, Some("Ctrl+B"))?;
    let italic = MenuItem::with_id(app, "insert-italic", "Italic", true, Some("Ctrl+I"))?;
    let strike =
        MenuItem::with_id(app, "insert-strike", "Strikethrough", true, Some("Ctrl+Shift+X"))?;
    let code = MenuItem::with_id(app, "insert-code", "Inline Code", true, Some("Ctrl+E"))?;
    let link = MenuItem::with_id(app, "insert-link", "Link", true, Some("Ctrl+K"))?;
    // Image submenu (plan 08 task 8.2, issue #77): the flat "Image" item
    // (URL prompt) becomes Insert > Image with the two flows — "From file..."
    // runs the native picker, "From URL..." the in-app dialog. Both dispatch
    // to the shared frontend commands (App.tsx MENU_TO_COMMAND).
    let mut image = SubmenuBuilder::new(app, "Image");
    image = image.text("insert-image-from-file", "From file...");
    image = image.text("insert-image-from-url", "From URL...");
    let image = image.build()?;
    // Plan 06 task 6.3 (issue #63): the menu item opens the "Insert table…"
    // dialog (the toolbar's Table button carries the hover size-picker
    // popover, which cannot be anchored to a native menu item).
    let table = MenuItem::with_id(app, "insert-table", "Insert Table...", true, None::<&str>)?;
    let codeblock = MenuItem::with_id(app, "insert-codeblock", "Code Block", true, None::<&str>)?;
    // Plan 11 task 11.1 (issue #100): Insert > Diagram (Mermaid) inserts a
    // ```mermaid fenced block with the starter template through the shared
    // frontend "diagram" command (App.tsx MENU_TO_COMMAND) — the same path as
    // /diagram and the toolbar button.
    let diagram = MenuItem::with_id(app, "insert-diagram", "Diagram (Mermaid)", true, None::<&str>)?;
    let hr = MenuItem::with_id(app, "insert-hr", "Horizontal Rule", true, None::<&str>)?;
    // Plan 09 task 9.7 (issue #90): Insert > Page Break inserts the pageBreak
    // atom at the caret through the shared frontend "pageBreak" command
    // (App.tsx MENU_TO_COMMAND); the node serializes to the fixed
    // <div class="quillmd-page-break"></div> block, which the Typst/PDF export
    // maps to #pagebreak().
    let page_break = MenuItem::with_id(app, "insert-page-break", "Page Break", true, None::<&str>)?;
    let footnote = MenuItem::with_id(app, "insert-footnote", "Footnote", true, None::<&str>)?;
    let tasklist = MenuItem::with_id(app, "insert-tasklist", "Task List", true, None::<&str>)?;
    let blockquote = MenuItem::with_id(app, "insert-blockquote", "Blockquote", true, None::<&str>)?;
    let emoji = MenuItem::with_id(app, "insert-emoji", "Emoji", true, None::<&str>)?;
    // Plan 09 task 9.6 (issue #89): Insert > Date & Time opens the in-app
    // date/time dialog (live format samples; the click inserts the picked
    // format for the current date as plain text), and Special Characters...
    // opens the symbol popover (name search, categories, recents). Both
    // dispatch to the shared frontend commands (App.tsx handleMenuEvent).
    let date_time = MenuItem::with_id(app, "insert-date-time", "Date & Time", true, None::<&str>)?;
    let symbol = MenuItem::with_id(app, "insert-symbol", "Special Characters...", true, None::<&str>)?;

    let insert = SubmenuBuilder::new(app, "Insert")
        .item(&heading)
        .separator()
        .items(&[&bold, &italic, &strike, &code, &link])
        .item(&image)
        .separator()
        .items(&[
            &table, &codeblock, &diagram, &hr, &page_break, &footnote, &tasklist, &blockquote,
            &emoji, &date_time, &symbol,
        ])
        .build()?;
    Ok(insert)
}

fn build_format_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let bold = MenuItem::with_id(app, "format-bold", "Bold", true, Some("Ctrl+B"))?;
    let italic = MenuItem::with_id(app, "format-italic", "Italic", true, Some("Ctrl+I"))?;
    let underline =
        MenuItem::with_id(app, "format-underline", "Underline", true, Some("Ctrl+U"))?;
    let strike =
        MenuItem::with_id(app, "format-strike", "Strikethrough", true, Some("Ctrl+Shift+X"))?;
    let code = MenuItem::with_id(app, "format-code", "Inline Code", true, Some("Ctrl+E"))?;
    let highlight = MenuItem::with_id(app, "format-highlight", "Highlight", true, None::<&str>)?;
    let subscript = MenuItem::with_id(app, "format-subscript", "Subscript", true, None::<&str>)?;
    let superscript =
        MenuItem::with_id(app, "format-superscript", "Superscript", true, None::<&str>)?;
    let clear = MenuItem::with_id(app, "format-clear", "Clear Formatting", true, None::<&str>)?;
    // The bracket accelerators use the named key forms: muda displays them
    // as Ctrl+]/Ctrl+[ and parses the literals identically, but the names
    // keep the string delimiters unambiguous.
    let indent = MenuItem::with_id(app, "format-indent", "Indent", true, Some("Ctrl+BracketRight"))?;
    let outdent = MenuItem::with_id(app, "format-outdent", "Outdent", true, Some("Ctrl+BracketLeft"))?;

    // Word parity (plan 02 §2.5): the Paragraph group carries alignment plus
    // indent/outdent (list nesting and quote levels) on Ctrl+]/Ctrl+['.
    let mut paragraph = SubmenuBuilder::new(app, "Paragraph");
    paragraph = paragraph.text("format-align-left", "Align Left");
    paragraph = paragraph.text("format-align-center", "Align Center");
    paragraph = paragraph.text("format-align-right", "Align Right");
    let paragraph = paragraph.separator().item(&indent).item(&outdent).build()?;

    // Font submenu (plan 04 task 4.4, issue #50): family list, size list,
    // color, highlight, underline, and clear. The native menu carries no
    // parameters, so every family, size, and swatch is its own menu id;
    // App.tsx resolves the ids back to (registry command, param) through
    // fontMenuCommand in src/lib/editorCommands.ts and dispatches the same
    // commands the toolbar font cluster uses. "Custom…" prompts on the
    // frontend; the submenu Underline carries no accelerator (Ctrl+U stays
    // on the top-level item).
    let mut family = SubmenuBuilder::new(app, "Font family");
    family = family.text("format-font-family-normal", "Normal (document default)");
    for name in FONT_FAMILIES {
        family = family.text(format!("format-font-family-{}", family_slug(name)), *name);
    }
    family = family.text("format-font-family-custom", "Custom\u{2026}");
    let family = family.build()?;

    let mut size = SubmenuBuilder::new(app, "Font size");
    size = size.text("format-font-size-normal", "Normal");
    for n in FONT_SIZES {
        size = size.text(format!("format-font-size-{n}"), format!("{n}"));
    }
    let size = size.build()?;

    let mut font_color = SubmenuBuilder::new(app, "Font color");
    font_color = font_color.text("format-font-color-auto", "Auto");
    for color in FONT_COLORS {
        font_color = font_color.text(format!("format-font-color-{color}"), format!("#{color}"));
    }
    let font_color = font_color.build()?;

    let mut highlight_color = SubmenuBuilder::new(app, "Highlight color");
    highlight_color = highlight_color.text("format-highlight-color-auto", "Auto");
    for color in FONT_COLORS {
        highlight_color =
            highlight_color.text(format!("format-highlight-color-{color}"), format!("#{color}"));
    }
    let highlight_color = highlight_color.build()?;

    let font_underline =
        MenuItem::with_id(app, "format-font-underline", "Underline", true, None::<&str>)?;
    let font_clear =
        MenuItem::with_id(app, "format-font-clear", "Clear Formatting", true, None::<&str>)?;

    let font = SubmenuBuilder::new(app, "Font")
        .items(&[&family, &size, &font_color, &highlight_color])
        .separator()
        .items(&[&font_underline, &font_clear])
        .build()?;

    // Styles submenu (plan 05 task 5.2, issue #55): every built-in style is
    // its own menu id (the native menu carries no parameters, same contract
    // as the Font submenu above); App.tsx resolves the ids back to the style
    // registry (src/lib/styles.ts) through styleMenuCommand and dispatches
    // the style's registry command — the identical path the toolbar's style
    // gallery takes, so menu and gallery apply the same styles.
    let mut styles = SubmenuBuilder::new(app, "Styles");
    for (id, label) in STYLES {
        styles = styles.text(format!("format-style-{id}"), *label);
    }
    // Modify Style (plan 05 task 5.4, issue #57): opens the in-app style
    // editor (fields + live preview). The native menu carries no parameters,
    // so the single id opens the dialog with the style under the cursor
    // preselected; the overrides persist in the app config dir, never in the
    // document.
    let modify_style =
        MenuItem::with_id(app, "format-style-modify", "Modify...", true, None::<&str>)?;
    let styles = styles.separator().item(&modify_style).build()?;

    let format = SubmenuBuilder::new(app, "Format")
        .items(&[&bold, &italic, &underline, &strike, &code, &highlight, &subscript, &superscript])
        .separator()
        .item(&styles)
        .item(&font)
        .separator()
        .item(&paragraph)
        .separator()
        .item(&clear)
        .build()?;
    Ok(format)
}

fn build_tools_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    // Word count (plan 09 task 9.4, issue #87): the read-only counts dialog
    // (words, characters, sentences, paragraphs, reading time). The frontend
    // (App.tsx) resolves the id and scopes the counts to the selection when
    // text is selected; the accelerator matches the browser-dev shortcut.
    let word_count =
        MenuItem::with_id(app, "tools-word-count", "Word Count", true, Some("Ctrl+Shift+F5"))?;
    // Spell check (plan 09 task 9.5, issue #88): the scan-and-flag "Spelling…"
    // dialog. The frontend (App.tsx) resolves the id; the accelerator matches
    // the browser-dev shortcut.
    let spelling =
        MenuItem::with_id(app, "tools-spelling", "Spelling…", true, Some("Ctrl+Shift+F7"))?;
    // Clear formatting (plan 10 task 10.4, issue #96): the shared
    // clearFormatting registry command (also Format > Clear Formatting,
    // `format-clear`) — the frontend (App.tsx) dispatches the same command
    // from both menu ids.
    let clear_formatting =
        MenuItem::with_id(app, "tools-clear-formatting", "Clear Formatting", true, None::<&str>)?;
    // Clear document (plan 09 task 9.7, issue #90): the frontend (App.tsx)
    // gates the destructive clear on a native confirm, then empties the active
    // doc through one undoable change on the active surface (WYSIWYG or the
    // CodeMirror source view), so a single Ctrl+Z restores the full prior text.
    let clear_document =
        MenuItem::with_id(app, "tools-clear-document", "Clear Document", true, None::<&str>)?;
    // Settings (plan 10 task 10.2, issue #94): the tabbed app-settings dialog
    // (General/Appearance/Editor/Advanced). The frontend (App.tsx) resolves
    // the id; the accelerator matches the browser-dev Ctrl+, shortcut.
    let settings = MenuItem::with_id(app, "tools-settings", "Settings…", true, Some("Ctrl+,"))?;
    let tools = SubmenuBuilder::new(app, "Tools")
        .item(&word_count)
        .item(&spelling)
        .item(&clear_formatting)
        .item(&clear_document)
        .item(&settings)
        .build()?;
    Ok(tools)
}

fn build_help_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let about = MenuItem::with_id(app, "help-about", "About QuillMD", true, None::<&str>)?;
    let shortcuts =
        MenuItem::with_id(app, "help-shortcuts", "Keyboard Shortcuts", true, None::<&str>)?;
    let help = SubmenuBuilder::new(app, "Help")
        .items(&[&about, &shortcuts])
        .build()?;
    Ok(help)
}

#[cfg(test)]
mod tests {
    use super::*;

    // The format-font-family-<slug> ids must be unique, otherwise two menu
    // items would emit the same menu-event id and the frontend could not tell
    // the families apart.
    #[test]
    fn font_family_slugs_are_unique_and_nonempty() {
        let mut seen = std::collections::HashSet::new();
        for family in FONT_FAMILIES {
            let slug = family_slug(family);
            assert!(!slug.is_empty(), "empty slug for {family}");
            assert!(seen.insert(slug.clone()), "duplicate slug {slug}");
        }
    }

    // The frontend mirrors these lists (fontmenu.test.tsx asserts the sync);
    // a duplicate entry would produce a duplicate menu id or a dead swatch.
    #[test]
    fn font_menu_lists_are_nonempty_and_unique() {
        assert!(!FONT_FAMILIES.is_empty());
        let mut sizes = FONT_SIZES.to_vec();
        sizes.sort_unstable();
        sizes.dedup();
        assert_eq!(sizes.len(), FONT_SIZES.len());
        let mut colors = FONT_COLORS.to_vec();
        colors.sort_unstable();
        colors.dedup();
        assert_eq!(colors.len(), FONT_COLORS.len());
        for color in FONT_COLORS {
            assert_eq!(color.len(), 6, "swatch {color} is not 6 hex digits");
            assert!(color.bytes().all(|b| b.is_ascii_hexdigit()));
        }
    }

    #[test]
    fn family_slug_lowercases_and_collapses_separators() {
        assert_eq!(family_slug("Comic Sans MS"), "comic-sans-ms");
        assert_eq!(family_slug("Arial Black"), "arial-black");
        assert_eq!(family_slug("Georgia"), "georgia");
    }

    // Styles submenu (plan 05 task 5.2, issue #55); the frontend mirrors the
    // list (stylemenu.test.tsx asserts the sync). A duplicate or empty id
    // would produce a duplicate menu id the frontend could not resolve.
    #[test]
    fn style_menu_ids_are_nonempty_and_unique() {
        let mut seen = std::collections::HashSet::new();
        for (id, label) in STYLES {
            assert!(!id.is_empty(), "empty style id");
            assert!(!label.is_empty(), "empty label for {id}");
            assert!(seen.insert(*id), "duplicate id {id}");
        }
    }

    // Theme lists (plan 05 task 5.3, issue #56); the frontend mirrors them
    // (theme.test.tsx asserts the sync). A duplicate or empty id would produce
    // a duplicate menu id the frontend could not resolve.
    #[test]
    fn theme_menu_ids_are_nonempty_and_unique() {
        let mut seen = std::collections::HashSet::new();
        for (id, label) in THEMES {
            assert!(!id.is_empty(), "empty theme id");
            assert!(!label.is_empty(), "empty label for {id}");
            assert!(seen.insert(*id), "duplicate id {id}");
        }
    }

    // Editor-chrome font lists (plan 04 task 4.5, issue #51); the frontend
    // mirrors them (editorfont.test.tsx asserts the sync). A duplicate entry
    // would produce a duplicate menu id.
    #[test]
    fn editor_font_lists_are_nonempty_and_unique() {
        assert!(!EDITOR_FONT_FAMILIES.is_empty());
        let mut families = EDITOR_FONT_FAMILIES.to_vec();
        families.sort_unstable();
        families.dedup();
        assert_eq!(families.len(), EDITOR_FONT_FAMILIES.len());
        assert!(!EDITOR_FONT_SIZES.is_empty());
        let mut sizes = EDITOR_FONT_SIZES.to_vec();
        sizes.sort_unstable();
        sizes.dedup();
        assert_eq!(sizes.len(), EDITOR_FONT_SIZES.len());
    }
}
