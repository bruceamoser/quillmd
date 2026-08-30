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
    let help = build_help_menu(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[&file, &edit, &view, &insert, &format, &help])
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
    let find = MenuItem::with_id(app, "edit-find", "Find", true, Some("Ctrl+F"))?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .items(&[&undo, &redo])
        .separator()
        .items(&[&cut, &copy, &paste])
        .separator()
        .item(&find)
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
    let statusbar = MenuItem::with_id(app, "view-statusbar", "Toggle Status Bar", true, None::<&str>)?;

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
        .separator()
        .items(&[&explorer, &statusbar])
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
    let image = MenuItem::with_id(app, "insert-image", "Image", true, None::<&str>)?;
    let table = MenuItem::with_id(app, "insert-table", "Table", true, None::<&str>)?;
    let codeblock = MenuItem::with_id(app, "insert-codeblock", "Code Block", true, None::<&str>)?;
    let hr = MenuItem::with_id(app, "insert-hr", "Horizontal Rule", true, None::<&str>)?;
    let footnote = MenuItem::with_id(app, "insert-footnote", "Footnote", true, None::<&str>)?;
    let tasklist = MenuItem::with_id(app, "insert-tasklist", "Task List", true, None::<&str>)?;
    let blockquote = MenuItem::with_id(app, "insert-blockquote", "Blockquote", true, None::<&str>)?;
    let emoji = MenuItem::with_id(app, "insert-emoji", "Emoji", true, None::<&str>)?;

    let insert = SubmenuBuilder::new(app, "Insert")
        .item(&heading)
        .separator()
        .items(&[&bold, &italic, &strike, &code, &link, &image])
        .separator()
        .items(&[&table, &codeblock, &hr, &footnote, &tasklist, &blockquote, &emoji])
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
    // indent/outdent (list nesting and quote levels) on Ctrl+]/Ctrl+[.
    let mut paragraph = SubmenuBuilder::new(app, "Paragraph");
    paragraph = paragraph.text("format-align-left", "Align Left");
    paragraph = paragraph.text("format-align-center", "Align Center");
    paragraph = paragraph.text("format-align-right", "Align Right");
    let paragraph = paragraph.separator().item(&indent).item(&outdent).build()?;

    let format = SubmenuBuilder::new(app, "Format")
        .items(&[&bold, &italic, &underline, &strike, &code, &highlight, &subscript, &superscript])
        .separator()
        .item(&paragraph)
        .separator()
        .item(&clear)
        .build()?;
    Ok(format)
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
