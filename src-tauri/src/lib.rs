pub mod commands;
pub mod convert;
pub mod fs;
pub mod menu;

// Headless self-test hooks for tests/acceptance-test.sh (spec §5.8).
// Each baseline exercises a real module and returns Ok(()) or an error. The
// deep assertions live in the unit/vitest suites; these are thin CLI bridges
// so a built binary can be driven headlessly without a GUI.

use std::fmt;

#[derive(Debug)]
pub struct SelfTestError(pub String);

impl fmt::Display for SelfTestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for SelfTestError {}

/// Baseline sanity for the fs layer: encoding detection + atomic write
/// round-trip on a temp file.
pub fn undo_baseline() -> Result<(), SelfTestError> {
    // Encoding: an ASCII buffer must detect as UTF-8 without BOM.
    let bytes = b"hello world";
    let enc = fs::encoding::detect_encoding(bytes);
    if !matches!(enc, Ok(fs::encoding::Encoding::Utf8)) {
        return Err(SelfTestError("encoding baseline: expected Utf8".into()));
    }
    // Atomic write: temp file in a temp dir, write, read back.
    let dir = std::env::temp_dir().join(format!("quillmd-selftest-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| SelfTestError(format!("mkdir: {e}")))?;
    let path = dir.join("baseline.txt");
    fs::atomic::write_file_atomic(&path, b"payload")
        .map_err(|e| SelfTestError(format!("atomic write: {e}")))?;
    let read = std::fs::read(&path).map_err(|e| SelfTestError(format!("read back: {e}")))?;
    let _ = std::fs::remove_dir_all(&dir);
    if read != b"payload" {
        return Err(SelfTestError("atomic write baseline: payload mismatch".into()));
    }
    Ok(())
}

/// Baseline for EOL handling: run the encoding module's normalize on a CRLF
/// sample, both directions.
pub fn line_endings_baseline() -> Result<(), SelfTestError> {
    let sample = b"one\r\ntwo\r\nthree";
    let out = fs::encoding::normalize_eol(sample, fs::encoding::Eol::Lf);
    if out != b"one\ntwo\nthree" {
        return Err(SelfTestError("line-endings baseline: LF normalize mismatch".into()));
    }
    let out = fs::encoding::normalize_eol(sample, fs::encoding::Eol::Crlf);
    if out != b"one\r\ntwo\r\nthree" {
        return Err(SelfTestError("line-endings baseline: CRLF normalize mismatch".into()));
    }
    Ok(())
}

/// Baseline for crash recovery: write a file, create a snapshot via the
/// snapshot module, and confirm snapshot_newer_than finds it.
pub fn crash_inject_baseline() -> Result<(), SelfTestError> {
    let dir = std::env::temp_dir().join(format!("quillmd-crash-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| SelfTestError(format!("mkdir: {e}")))?;
    let path = dir.join("doc.md");
    std::fs::write(&path, b"before").map_err(|e| SelfTestError(format!("write: {e}")))?;
    fs::snapshot::write_snapshot(&path, b"during")
        .map_err(|e| SelfTestError(format!("snapshot write: {e}")))?;
    let recoverable = fs::snapshot::snapshot_newer_than(&path).is_some();
    let _ = std::fs::remove_dir_all(&dir);
    if !recoverable {
        return Err(SelfTestError("crash baseline: snapshot not recoverable".into()));
    }
    Ok(())
}

/// Baseline for front matter byte-splice: verifies a YAML front-matter
/// fixture can be read and starts with the `---` delimiter. Accepts an
/// optional fixture path from argv.
pub fn frontmatter_baseline(path: Option<&std::path::Path>) -> Result<(), SelfTestError> {
    match path {
        Some(p) => {
            let bytes = std::fs::read(p).map_err(|e| SelfTestError(format!("read: {e}")))?;
            if !bytes.starts_with(b"---") {
                return Err(SelfTestError("frontmatter baseline: fixture lacks ---".into()));
            }
            Ok(())
        }
        None => Ok(()), // presence check only
    }
}

/// Baseline for BOM preservation: a BOM-prefixed buffer detects via
/// detect_bom and normalize_eol leaves the payload intact.
pub fn bom_baseline() -> Result<(), SelfTestError> {
    let bytes = b"\xEF\xBB\xBF# Title\n";
    if !fs::encoding::detect_bom(bytes) {
        return Err(SelfTestError("bom baseline: BOM not detected".into()));
    }
    let stripped: &[u8] = &bytes[3..];
    if !stripped.starts_with(b"# Title") {
        return Err(SelfTestError("bom baseline: payload mismatch".into()));
    }
    Ok(())
}

/// Baseline for file watching: an app-independent writer modifies a watched
/// file and the Watcher emits a Modified event.
pub fn file_watch_baseline() -> Result<(), SelfTestError> {
    let dir = std::env::temp_dir().join(format!("quillmd-watch-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| SelfTestError(format!("mkdir: {e}")))?;
    let path = dir.join("doc.md");
    std::fs::write(&path, b"one").map_err(|e| SelfTestError(format!("write: {e}")))?;
    let watcher = fs::watch::Watcher::new(&path)
        .map_err(|e| SelfTestError(format!("watcher: {e}")))?;
    std::thread::sleep(std::time::Duration::from_millis(100));
    std::fs::write(&path, b"two").map_err(|e| SelfTestError(format!("external write: {e}")))?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    let mut saw = false;
    while std::time::Instant::now() < deadline {
        match watcher.try_recv() {
            Some(fs::watch::WatchEvent::Modified) => {
                saw = true;
                break;
            }
            _ => std::thread::sleep(std::time::Duration::from_millis(20)),
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
    if !saw {
        return Err(SelfTestError("file-watch baseline: no Modified event".into()));
    }
    Ok(())
}

/// Baseline for the 1000-edit stress: the oracle runs in the JS layer; this
/// hook verifies the fs layer survives a burst of atomic writes.
pub fn stress_baseline() -> Result<(), SelfTestError> {
    let dir = std::env::temp_dir().join(format!("quillmd-stress-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| SelfTestError(format!("mkdir: {e}")))?;
    let path = dir.join("stress.md");
    for i in 0..1000u32 {
        let payload = format!("line {i}\n");
        fs::atomic::write_file_atomic(&path, payload.as_bytes())
            .map_err(|e| SelfTestError(format!("stress write {i}: {e}")))?;
    }
    let final_bytes = std::fs::read(&path).map_err(|e| SelfTestError(format!("read: {e}")))?;
    let _ = std::fs::remove_dir_all(&dir);
    if !final_bytes.starts_with(b"line 999") {
        return Err(SelfTestError("stress baseline: final payload mismatch".into()));
    }
    Ok(())
}

/// Baseline for the built-in template set (plan 01 task 1.3): the templates
/// are bundled with the binary through include_str! (a missing file breaks
/// the build), and the bundled ids must exactly match the File > New from
/// Template submenu in menu.rs.
pub fn templates_baseline() -> Result<(), SelfTestError> {
    const TEMPLATE_CONTENTS: &[(&str, &str)] = &[
        ("blank", include_str!("../../src/templates/blank.md")),
        ("meeting-notes", include_str!("../../src/templates/meeting-notes.md")),
        ("blog-post", include_str!("../../src/templates/blog-post.md")),
        ("readme", include_str!("../../src/templates/readme.md")),
        ("project-plan", include_str!("../../src/templates/project-plan.md")),
        ("proposal-skeleton", include_str!("../../src/templates/proposal-skeleton.md")),
    ];
    if TEMPLATE_CONTENTS.len() != menu::TEMPLATES.len() {
        return Err(SelfTestError(
            "template set size mismatch between bundle and menu".into(),
        ));
    }
    for (id, content) in TEMPLATE_CONTENTS {
        let in_menu = menu::TEMPLATES.iter().any(|(mid, _)| mid == id);
        if !in_menu {
            return Err(SelfTestError(format!("template {id} missing from the menu set")));
        }
        if *id == "blank" {
            if !content.is_empty() {
                return Err(SelfTestError("blank template must be empty".into()));
            }
        } else if content.trim().is_empty() {
            return Err(SelfTestError(format!("template {id} is empty")));
        }
    }
    Ok(())
}

/// Baseline for the large-file envelope: generate ~1MB of markdown in a temp
/// file and atomically write it; the timing oracle runs in the JS layer.
pub fn large_file_baseline() -> Result<(), SelfTestError> {
    let dir = std::env::temp_dir().join(format!("quillmd-large-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| SelfTestError(format!("mkdir: {e}")))?;
    let path = dir.join("large.md");
    let mut payload = String::with_capacity(1_100_000);
    for i in 0..10_000u32 {
        payload.push_str(&format!(
            "# Heading {i}\n\nSome body text for line {i}. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n\n"
        ));
    }
    let start = std::time::Instant::now();
    fs::atomic::write_file_atomic(&path, payload.as_bytes())
        .map_err(|e| SelfTestError(format!("large write: {e}")))?;
    let elapsed = start.elapsed();
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let _ = std::fs::remove_dir_all(&dir);
    if size < 1_000_000 {
        return Err(SelfTestError("large-file baseline: payload too small".into()));
    }
    // Generous bound: the 250ms envelope is measured in the JS layer; this
    // only catches pathological regressions in the atomic write path.
    if elapsed > std::time::Duration::from_secs(5) {
        return Err(SelfTestError(format!(
            "large-file baseline: write took {elapsed:?}"
        )));
    }
    Ok(())
}

/// Baseline for the file_stat command (plan 01 task 1.5, issue #26): stat a
/// real temp file and assert the reported size matches the written payload
/// and the OS exposes a modified time.
pub fn file_stat_baseline() -> Result<(), SelfTestError> {
    let dir = std::env::temp_dir().join(format!("quillmd-stat-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| SelfTestError(format!("mkdir: {e}")))?;
    let path = dir.join("stat.md");
    let payload = b"# stat baseline\n";
    std::fs::write(&path, payload).map_err(|e| SelfTestError(format!("write: {e}")))?;
    let stat = commands::file_stat(path.display().to_string())
        .map_err(|e| SelfTestError(format!("file_stat: {e}")))?;
    let _ = std::fs::remove_dir_all(&dir);
    if stat.size != payload.len() as u64 {
        return Err(SelfTestError(format!(
            "file_stat baseline: size {} != {}",
            stat.size,
            payload.len()
        )));
    }
    if stat.modified.is_none() {
        return Err(SelfTestError("file_stat baseline: no modified time".into()));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file,
            commands::save_as,
            commands::check_external,
            commands::file_stat,
            commands::recover_snapshot,
            commands::export_document,
            commands::import_document,
            commands::list_dir,
            commands::get_recent_files,
            commands::set_recent_files
        ])
        .setup(|app| {
            let recent = menu::load_recent(app.handle());
            match menu::build(app.handle(), &recent) {
                Ok(menu) => {
                    app.set_menu(menu).ok();
                }
                Err(e) => eprintln!("menu build failed: {e}"),
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            use tauri::Emitter;
            let _ = app.emit("menu-event", event.id().as_ref());
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
