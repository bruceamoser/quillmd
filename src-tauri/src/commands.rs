use std::fmt::Display;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::Manager;

use crate::fs::assets;
use crate::fs::encoding::{self, Eol};
use crate::fs::safety::{self, ExternalStatus};
use crate::fs::snapshot::{self, SnapshotInfo};

#[derive(Debug, Serialize)]
pub struct OpenResult {
    pub bytes: Vec<u8>,
    pub hash: String,
    pub eol: String,
    pub bom: bool,
    pub snapshot: Option<SnapshotInfo>,
}

#[derive(Debug, Serialize)]
pub struct SaveResult {
    pub hash: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

fn err(kind: &str, msg: impl Display) -> String {
    format!("{kind}:{msg}")
}

#[tauri::command]
pub fn open_file(path: String) -> Result<OpenResult, String> {
    let p = PathBuf::from(&path);
    let bytes = fs::read(&p).map_err(|e| err("io", format!("read {}: {e}", p.display())))?;

    let hash = safety::hash_bytes(&bytes);

    if let Err(non_utf8) = encoding::detect_encoding(&bytes) {
        return Err(err("encoding", format!("non-utf8 encoding {:?}", non_utf8.encoding)));
    }

    let eol = match encoding::detect_eol(&bytes) {
        Eol::Lf => "lf".to_string(),
        Eol::Crlf => "crlf".to_string(),
    };
    let bom = encoding::detect_bom(&bytes);
    let snapshot = snapshot::snapshot_newer_than(&p);

    Ok(OpenResult {
        bytes,
        hash,
        eol,
        bom,
        snapshot,
    })
}

#[tauri::command]
pub fn save_file(path: String, bytes: Vec<u8>, expected_hash: String) -> Result<SaveResult, String> {
    let p = PathBuf::from(&path);
    safety::write_with_guard(&p, &bytes, &expected_hash, false).map_err(|e| match e {
        safety::SafetyError::ExternalChange => {
            err("external_change", "file changed on disk since it was opened")
        }
        other => err("save", other),
    })?;
    snapshot::cleanup_snapshot(&p);
    Ok(SaveResult {
        hash: safety::hash_bytes(&bytes),
    })
}

#[tauri::command]
pub fn save_as(path: String, bytes: Vec<u8>) -> Result<SaveResult, String> {
    let p = PathBuf::from(&path);
    crate::fs::atomic::write_file_atomic(&p, &bytes).map_err(|e| err("atomic", e))?;
    Ok(SaveResult {
        hash: safety::hash_bytes(&bytes),
    })
}

#[tauri::command]
pub fn check_external(path: String, expected_hash: String) -> ExternalStatus {
    safety::check_external(std::path::Path::new(&path), &expected_hash)
}

/// OS metadata for the File > Info panel (plan 01 task 1.5, issue #26):
/// size on disk plus the OS created/modified times in epoch milliseconds.
/// `created` is `None` where the OS does not expose a birth time (Linux);
/// `modified` is `None` only if the stat succeeded but the time query failed.
#[derive(Debug, Serialize)]
pub struct FileStat {
    pub size: u64,
    pub created: Option<u64>,
    pub modified: Option<u64>,
}

fn millis(t: SystemTime) -> Option<u64> {
    t.duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

#[tauri::command]
pub fn file_stat(path: String) -> Result<FileStat, String> {
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|e| err("io", format!("stat {}: {e}", p.display())))?;
    Ok(FileStat {
        size: meta.len(),
        created: meta.created().ok().and_then(millis),
        modified: meta.modified().ok().and_then(millis),
    })
}

#[tauri::command]
pub fn export_document(path: String, format: String, out_path: String) -> Result<(), String> {
    let src = PathBuf::from(&path);
    let dst = PathBuf::from(&out_path);
    crate::convert::export(&src, &format, &dst).map_err(|e| e.to_json())
}

#[tauri::command]
pub fn import_document(path: String, out_md_path: String) -> Result<(), String> {
    let src = PathBuf::from(&path);
    let dst = PathBuf::from(&out_md_path);
    crate::convert::import_docx(&src, &dst).map_err(|e| e.to_json())
}

/// Writes one export asset (a diagram PNG or the temp export markdown) into
/// `dir` under `name`, using the collision-safe + reserved-name-validated
/// core in convert.rs. Returns the path actually written.
#[tauri::command]
pub fn export_write_asset(dir: String, name: String, bytes: Vec<u8>) -> Result<String, String> {
    let written =
        crate::convert::write_export_asset(&PathBuf::from(&dir), &name, &bytes)
            .map_err(|e| err("export_asset", e.to_string()))?;
    Ok(written.to_string_lossy().into_owned())
}

/// Best-effort cleanup of the assets an export wrote. Only absolute paths
/// with validated file names that exist as regular files are removed; the
/// command never fails.
#[tauri::command]
pub fn export_remove_asset(paths: Vec<String>) -> Vec<String> {
    let ps: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    crate::convert::remove_export_assets(&ps)
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
pub fn recover_snapshot(path: String) -> Option<Vec<u8>> {
    let p = PathBuf::from(&path);
    fs::read(snapshot::snapshot_path_for(&p)).ok()
}

/// Lists one directory level (non-recursive, on-demand expansion). Directories
/// sort first, then files, case-insensitively. Reserved Windows names and
/// unreadable entries are skipped so the explorer stays robust across
/// platforms.
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let p = PathBuf::from(&path);
    let rd = fs::read_dir(&p).map_err(|e| err("io", format!("read_dir {}: {e}", p.display())))?;
    let mut entries: Vec<DirEntry> = Vec::new();
    for item in rd {
        let Ok(item) = item else { continue };
        let name = item.file_name().to_string_lossy().to_string();
        if crate::fs::paths::is_windows_reserved(&name) {
            continue;
        }
        let is_dir = item.file_type().map(|t| t.is_dir()).unwrap_or(false);
        entries.push(DirEntry {
            name,
            path: item.path().to_string_lossy().to_string(),
            is_dir,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// Copies a picked file next to the open document and returns the
/// markdown-relative path to embed in the document (plan 08 task 8.3,
/// issue #78). `asset_folder` is "assets" (an `assets/` subfolder next to
/// the doc, the default) or "doc" (the doc's own folder). Collision-safe:
/// `photo.png`, `photo-1.png`, ... The copy is atomic and the target is
/// validated to stay inside the document's folder.
#[tauri::command]
pub fn copy_asset(src: String, doc_dir: String, asset_folder: String) -> Result<String, String> {
    let folder = assets::parse_asset_folder(&asset_folder)
        .ok_or_else(|| err("bad_request", format!("unknown asset folder setting: {asset_folder}")))?;
    assets::copy_asset(&PathBuf::from(&src), &PathBuf::from(&doc_dir), folder)
        .map_err(|e| err("asset_copy", e))
}

/// Batch existence check for asset paths (plan 08 §3 broken-image
/// detection): one list in, one list out, in input order. Used to flag
/// images whose src no longer exists on disk.
#[tauri::command]
pub fn file_exists(paths: Vec<String>) -> Vec<bool> {
    assets::files_exist(&paths)
}

#[tauri::command]
pub fn get_recent_files(app: tauri::AppHandle) -> Vec<String> {
    crate::menu::load_recent(&app)
}

/// Persists the recent-files list and rebuilds the native menu so the File >
/// Recent Files submenu stays in sync with the frontend.
#[tauri::command]
pub fn set_recent_files(app: tauri::AppHandle, recent: Vec<String>) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    let deduped: Vec<String> = recent
        .into_iter()
        .filter(|p| !p.is_empty() && seen.insert(p.clone()))
        .collect();
    let capped: Vec<String> = deduped
        .into_iter()
        .take(crate::menu::RECENT_CAP)
        .collect();
    crate::menu::save_recent(&app, &capped);
    crate::menu::refresh(&app, &capped).map_err(|e| e.to_string())?;
    Ok(())
}

/// User style overrides (plan 05 task 5.4, issue #57): the Word-style
/// "Modify Style" look of built-in styles, stored as JSON in the app config
/// dir (~/.config/quillmd/style-overrides.json) — machine-local by design,
/// never part of a document. The path-based helpers keep the logic
/// testable; the #[tauri::command] wrappers resolve the config dir.

fn overrides_file<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("style-overrides.json"))
}

/// Reads the overrides file as raw JSON text; missing or unreadable files
/// read as an empty object so a first run (or a hand-deleted file) is a
/// clean state, not an error.
pub fn read_overrides_file(path: &std::path::Path) -> String {
    match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => "{}".to_string(),
    }
}

/// Writes the overrides payload after validating it is a JSON object. The
/// frontend owns the schema (and normalizes it); the Rust side only guards
/// the file shape so a stray payload can never turn the config file into
/// something the frontend cannot parse back.
pub fn write_overrides_file(path: &std::path::Path, json: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| err("invalid_json", e))?;
    if !value.is_object() {
        return Err(err("invalid_json", "overrides payload must be a JSON object"));
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| err("io", format!("create {}: {e}", dir.display())))?;
    }
    fs::write(path, json).map_err(|e| err("io", format!("write {}: {e}", path.display())))
}

#[tauri::command]
pub fn read_style_overrides(app: tauri::AppHandle) -> String {
    overrides_file(&app)
        .map(|p| read_overrides_file(&p))
        .unwrap_or_else(|| "{}".to_string())
}

#[tauri::command]
pub fn write_style_overrides(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let path =
        overrides_file(&app).ok_or_else(|| err("config_dir", "app config dir unavailable"))?;
    write_overrides_file(&path, &json)
}

// --- spell check (plan 09 task 9.5, issue #88) --------------------------------
//
// The bundled English wordlist (resources/wordlist.txt, ~90k words) ships as
// a Tauri resource; load_wordlist reads it from the resource dir and falls
// back to the embedded copy (include_str!) so dev builds and the test suite
// work even before the resource is in place. The include_str! also makes a
// missing wordlist file a build error, not a runtime surprise.
//
// Wordlist settings (the personal dictionary; the session ignore list is
// frontend memory only and never persists) are stored as JSON in the app
// config dir (~/.config/quillmd/wordlist-settings.json) — machine-local by
// design, the same posture as the style overrides. The path-based helpers
// keep the logic testable; the #[tauri::command] wrappers resolve the dirs.

pub const WORDLIST_RESOURCE_NAME: &str = "wordlist.txt";

/// The embedded wordlist copy (a missing resource file breaks the build).
pub const EMBEDDED_WORDLIST: &str = include_str!("../resources/wordlist.txt");

/// The bundled wordlist's path in the resource dir.
pub fn wordlist_file_for<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|d| d.join(WORDLIST_RESOURCE_NAME))
}

/// Reads a wordlist file; a missing, unreadable, or blank file reads as None
/// (the caller falls back to the embedded copy).
pub fn read_wordlist_file(path: &std::path::Path) -> Option<String> {
    fs::read_to_string(path).ok().filter(|text| !text.trim().is_empty())
}

/// The bundled wordlist: the resource file when present, else the embedded
/// copy.
#[tauri::command]
pub fn load_wordlist(app: tauri::AppHandle) -> Result<String, String> {
    if let Some(path) = wordlist_file_for(&app) {
        if let Some(text) = read_wordlist_file(&path) {
            return Ok(text);
        }
    }
    Ok(EMBEDDED_WORDLIST.to_string())
}

fn wordlist_settings_file<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("wordlist-settings.json"))
}

/// Reads the wordlist-settings file as raw JSON text; a missing or unreadable
/// file reads as an empty object so a first run (or a hand-deleted file) is a
/// clean state, not an error.
pub fn read_wordlist_settings_file(path: &std::path::Path) -> String {
    match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => "{}".to_string(),
    }
}

/// Writes the wordlist-settings payload after validating it is a JSON object.
/// The frontend owns the schema (and normalizes it); the Rust side only guards
/// the file shape so a stray payload can never turn the config file into
/// something the frontend cannot parse back.
pub fn write_wordlist_settings_file(path: &std::path::Path, json: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| err("invalid_json", e))?;
    if !value.is_object() {
        return Err(err(
            "invalid_json",
            "wordlist settings payload must be a JSON object",
        ));
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| err("io", format!("create {}: {e}", dir.display())))?;
    }
    fs::write(path, json).map_err(|e| err("io", format!("write {}: {e}", path.display())))
}

#[tauri::command]
pub fn get_wordlist_settings(app: tauri::AppHandle) -> String {
    wordlist_settings_file(&app)
        .map(|p| read_wordlist_settings_file(&p))
        .unwrap_or_else(|| "{}".to_string())
}

#[tauri::command]
pub fn set_wordlist_settings(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let path =
        wordlist_settings_file(&app).ok_or_else(|| err("config_dir", "app config dir unavailable"))?;
    write_wordlist_settings_file(&path, &json)
}

// --- explorer file operations (plan 03 task 3.6, issue #44) ----------------
//
// The Explorer context menu (New file / New folder / Rename / Delete) runs on
// these four commands. Every name is validated through the safety module's
// Windows reserved-name check, nothing is ever overwritten silently, and
// Delete moves to the app-local trash (never a direct unlink) so the
// status-bar Undo can restore the entry through fs_rename.

/// Validates an explorer entry name: a single non-empty path segment that is
/// not "." / ".." and not a Windows reserved name (the safety check also
/// rejects trailing dots and spaces).
fn validate_entry_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err(err("bad_name", "name must not be empty"));
    }
    if name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return Err(err("bad_name", "name must be a single path segment"));
    }
    if crate::fs::paths::is_windows_reserved(name) {
        return Err(err("bad_name", format!("\"{name}\" is not an allowed file name")));
    }
    Ok(())
}

/// Creates an empty file at `parent/name` (the explorer's "New file"). The
/// parent must be an existing directory and the name a validated segment
/// that does not exist yet (no overwrite). Returns the created file's path.
#[tauri::command]
pub fn fs_new_file(parent: String, name: String) -> Result<String, String> {
    let parent_p = PathBuf::from(&parent);
    validate_entry_name(&name)?;
    if !parent_p.is_dir() {
        return Err(err("io", format!("not a directory: {}", parent_p.display())));
    }
    let path = parent_p.join(&name);
    if path.exists() {
        return Err(err("exists", format!("{} already exists", path.display())));
    }
    fs::File::create(&path)
        .map_err(|e| err("io", format!("create {}: {e}", path.display())))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Creates a directory at `parent/name` (the explorer's "New folder"). Same
/// rules as fs_new_file. Returns the created directory's path.
#[tauri::command]
pub fn fs_new_dir(parent: String, name: String) -> Result<String, String> {
    let parent_p = PathBuf::from(&parent);
    validate_entry_name(&name)?;
    if !parent_p.is_dir() {
        return Err(err("io", format!("not a directory: {}", parent_p.display())));
    }
    let path = parent_p.join(&name);
    if path.exists() {
        return Err(err("exists", format!("{} already exists", path.display())));
    }
    fs::create_dir(&path)
        .map_err(|e| err("io", format!("create {}: {e}", path.display())))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Moves (renames) an entry from `from` to `to` (the explorer's Rename and
/// the trash Undo's restore). `to` is a full path: its parent must exist, it
/// must not exist yet (no silent overwrite), and its file name must be a
/// validated segment. A cross-device move falls back to copy + remove.
#[tauri::command]
pub fn fs_rename(from: String, to: String) -> Result<String, String> {
    let from_p = PathBuf::from(&from);
    let to_p = PathBuf::from(&to);
    let to_name = to_p
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| err("bad_name", "target has no file name"))?;
    validate_entry_name(to_name)?;
    if !from_p.exists() {
        return Err(err("io", format!("source not found: {}", from_p.display())));
    }
    if to_p.exists() {
        return Err(err("exists", format!("{} already exists", to_p.display())));
    }
    let to_parent = to_p
        .parent()
        .ok_or_else(|| err("bad_name", "target has no parent"))?;
    if !to_parent.is_dir() {
        return Err(err("io", format!("not a directory: {}", to_parent.display())));
    }
    if let Err(e) = fs::rename(&from_p, &to_p) {
        if e.kind() != std::io::ErrorKind::CrossesDevices {
            return Err(err("io", format!("rename: {e}")));
        }
        move_recursive(&from_p, &to_p)
            .map_err(|e| err("io", format!("move {}: {e}", from_p.display())))?;
    }
    Ok(to_p.to_string_lossy().into_owned())
}

/// Recursive copy + remove: the cross-device fallback for fs_rename and
/// fs_trash when a plain rename cannot cross the device boundary.
fn move_recursive(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    if fs::metadata(from)?.is_dir() {
        fs::create_dir(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            move_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
        fs::remove_dir(from)?;
    } else {
        fs::copy(from, to)?;
        fs::remove_file(from)?;
    }
    Ok(())
}

/// The app-local trash root: `app_config_dir()/trash` (plan 03 §3: the
/// explorer's Delete moves here instead of unlinking, so a status-bar Undo
/// can restore the entry).
pub fn trash_dir_for<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("trash"))
}

/// Collision-safe trash target: `name` when free, otherwise `name-1`,
/// `name-2`, ... (the counter goes before the extension, the asset-copy
/// convention: `photo.png` → `photo-1.png`; extension-less names get a
/// plain `name-1`).
pub fn unique_trash_path(trash_dir: &std::path::Path, name: &str) -> PathBuf {
    if !trash_dir.join(name).exists() {
        return trash_dir.join(name);
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    for i in 1u32.. {
        let candidate = format!("{stem}-{i}{ext}");
        if !trash_dir.join(&candidate).exists() {
            return trash_dir.join(candidate);
        }
    }
    unreachable!("a collision-free trash name must exist")
}

/// Moves `path` into `trash_dir` under a collision-safe name, creating the
/// trash dir if needed. Never unlinks: the entry is moved, and the returned
/// trash path is the Undo restore's source (a fs_rename back to the
/// original location).
pub fn move_to_trash(trash_dir: &std::path::Path, path: &std::path::Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(err("io", format!("not found: {}", path.display())));
    }
    let base = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| err("bad_name", "entry has no file name"))?;
    fs::create_dir_all(trash_dir)
        .map_err(|e| err("io", format!("create {}: {e}", trash_dir.display())))?;
    let target = unique_trash_path(trash_dir, base);
    fs::rename(path, &target).or_else(|e| {
        if e.kind() == std::io::ErrorKind::CrossesDevices {
            move_recursive(path, &target)
        } else {
            Err(e)
        }
    })
    .map_err(|e| err("io", format!("trash {}: {e}", path.display())))?;
    Ok(target)
}

/// Moves an explorer entry into the app-local trash (the explorer menu's
/// "Delete", plan 03 task 3.6, issue #44). Returns the trash path; the
/// frontend's Undo restores from it through fs_rename.
#[tauri::command]
pub fn fs_trash(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let trash_dir = trash_dir_for(&app).ok_or_else(|| err("config_dir", "app config dir unavailable"))?;
    move_to_trash(&trash_dir, &PathBuf::from(&path)).map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs::snapshot;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn open_save_roundtrip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("doc.md");
        fs::write(&path, b"# Hello\nworld").unwrap();

        let opened = open_file(path.display().to_string()).unwrap();
        assert_eq!(opened.bytes, b"# Hello\nworld".to_vec());
        assert_eq!(opened.hash, safety::hash_bytes(b"# Hello\nworld"));
        assert_eq!(opened.eol, "lf");
        assert!(!opened.bom);
        assert!(opened.snapshot.is_none());

        let saved = save_file(
            path.display().to_string(),
            b"# Changed\n".to_vec(),
            opened.hash.clone(),
        )
        .unwrap();
        assert_eq!(saved.hash, safety::hash_bytes(b"# Changed\n"));
        assert_eq!(fs::read(&path).unwrap(), b"# Changed\n");
    }

    #[test]
    fn open_detects_crlf_and_bom() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("doc.md");
        fs::write(&path, b"\xEF\xBB\xBFa\r\nb\r\n").unwrap();

        let opened = open_file(path.display().to_string()).unwrap();
        assert_eq!(opened.eol, "crlf");
        assert!(opened.bom);
    }

    #[test]
    fn open_rejects_non_utf8() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("doc.md");
        fs::write(&path, [0xFF, 0xFE, 0x41, 0x00]).unwrap();

        let res = open_file(path.display().to_string());
        assert!(res.is_err());
        assert!(res.unwrap_err().starts_with("encoding:"));
    }

    #[test]
    fn save_refuses_after_external_change() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("doc.md");
        fs::write(&path, b"v1").unwrap();

        let opened = open_file(path.display().to_string()).unwrap();
        fs::write(&path, b"v2").unwrap();

        let res = save_file(path.display().to_string(), b"v3".to_vec(), opened.hash.clone());
        let msg = res.unwrap_err();
        assert!(msg.starts_with("external_change:"), "got {msg}");
        assert_eq!(fs::read(&path).unwrap(), b"v2");
    }

    #[test]
    fn save_as_writes_new_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("new.md");

        let saved = save_as(path.display().to_string(), b"content".to_vec()).unwrap();
        assert_eq!(saved.hash, safety::hash_bytes(b"content"));
        assert_eq!(fs::read(&path).unwrap(), b"content");
    }

    #[test]
    fn check_external_and_recover_snapshot() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("doc.md");
        fs::write(&path, b"x").unwrap();

        let h = safety::hash_bytes(b"x");
        assert_eq!(
            check_external(path.display().to_string(), h),
            ExternalStatus::Unchanged
        );
        assert_eq!(
            check_external(path.display().to_string(), "different".to_string()),
            ExternalStatus::Modified
        );

        snapshot::write_snapshot(&path, b"recovered").unwrap();
        assert_eq!(
            recover_snapshot(path.display().to_string()),
            Some(b"recovered".to_vec())
        );
        assert_eq!(
            recover_snapshot(dir.path().join("nope.md").display().to_string()),
            None
        );
    }

    #[test]
    fn list_dir_sorts_dirs_first() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("b.md"), b"b").unwrap();
        fs::write(dir.path().join("a.md"), b"a").unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();

        let entries = list_dir(dir.path().display().to_string()).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["sub", "a.md", "b.md"]);
        assert!(entries[0].is_dir);
        assert!(!entries[1].is_dir);
        assert_eq!(entries[1].path, dir.path().join("a.md").display().to_string());
    }

    #[test]
    fn list_dir_skips_reserved_names() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("CON"), b"x").unwrap();
        fs::write(dir.path().join("ok.md"), b"x").unwrap();

        let entries = list_dir(dir.path().display().to_string()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "ok.md");
    }

    #[test]
    fn list_dir_errors_on_missing_path() {
        let res = list_dir("/nonexistent/quillmd/probe".to_string());
        assert!(res.is_err());
    }

    #[test]
    fn file_stat_reports_size_and_modified() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("doc.md");
        let payload = b"# Hello\nworld";
        fs::write(&path, payload).unwrap();

        let stat = file_stat(path.display().to_string()).unwrap();
        assert_eq!(stat.size, payload.len() as u64);
        let modified = stat.modified.expect("modified time must be present");
        assert!(modified > 0, "modified must be a positive epoch-millis value");
    }

    #[test]
    fn file_stat_empty_file_has_zero_size() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("empty.md");
        fs::write(&path, b"").unwrap();

        let stat = file_stat(path.display().to_string()).unwrap();
        assert_eq!(stat.size, 0);
    }

    #[test]
    fn file_stat_errors_on_missing_path() {
        let res = file_stat("/nonexistent/quillmd/stat.md".to_string());
        let msg = res.unwrap_err();
        assert!(msg.starts_with("io:"), "got {msg}");
    }

    // --- asset copy pipeline (plan 08 task 8.3, issue #78) ----------------

    #[test]
    fn copy_asset_command_copies_and_relativizes() {
        let dir = tempdir().unwrap();
        let doc_dir = dir.path().join("docs");
        let src = dir.path().join("photo.png");
        fs::write(&src, b"img-bytes").unwrap();

        let rel = copy_asset(
            src.display().to_string(),
            doc_dir.display().to_string(),
            "assets".to_string(),
        )
        .unwrap();
        assert_eq!(rel, "assets/photo.png");
        let copied = doc_dir.join("assets").join("photo.png");
        assert_eq!(fs::read(&copied).unwrap(), b"img-bytes");

        // Collision: the same source again gets photo-1.png.
        let rel = copy_asset(
            src.display().to_string(),
            doc_dir.display().to_string(),
            "assets".to_string(),
        )
        .unwrap();
        assert_eq!(rel, "assets/photo-1.png");
    }

    #[test]
    fn copy_asset_command_doc_folder_setting() {
        let dir = tempdir().unwrap();
        let doc_dir = dir.path().join("docs");
        let src = dir.path().join("pic.jpg");
        fs::write(&src, b"img").unwrap();

        let rel = copy_asset(
            src.display().to_string(),
            doc_dir.display().to_string(),
            "doc".to_string(),
        )
        .unwrap();
        assert_eq!(rel, "pic.jpg");
        assert_eq!(fs::read(doc_dir.join("pic.jpg")).unwrap(), b"img");
    }

    #[test]
    fn copy_asset_command_rejects_bad_settings_and_sources() {
        let dir = tempdir().unwrap();
        let doc_dir = dir.path().join("docs");

        let bad_setting = copy_asset(
            dir.path().join("a.png").display().to_string(),
            doc_dir.display().to_string(),
            "everywhere".to_string(),
        )
        .unwrap_err();
        assert!(bad_setting.starts_with("bad_request:"), "got {bad_setting}");

        let missing = copy_asset(
            dir.path().join("missing.png").display().to_string(),
            doc_dir.display().to_string(),
            "assets".to_string(),
        )
        .unwrap_err();
        assert!(missing.starts_with("asset_copy:"), "got {missing}");
        assert!(missing.contains("not found"), "got {missing}");

        let reserved = {
            let con = dir.path().join("CON");
            fs::write(&con, b"x").unwrap();
            copy_asset(
                con.display().to_string(),
                doc_dir.display().to_string(),
                "assets".to_string(),
            )
            .unwrap_err()
        };
        assert!(reserved.contains("reserved"), "got {reserved}");
    }

    #[test]
    fn file_exists_command_reports_each_path() {
        let dir = tempdir().unwrap();
        let a = dir.path().join("a.png");
        fs::write(&a, b"x").unwrap();
        let b = dir.path().join("b.png");

        let out = file_exists(vec![
            a.display().to_string(),
            b.display().to_string(),
            String::new(),
        ]);
        assert_eq!(out, vec![true, false, false]);
        assert_eq!(file_exists(vec![]), Vec::<bool>::new());
    }

    // --- style overrides (plan 05 task 5.4, issue #57) ----------------------

    #[test]
    fn overrides_read_missing_file_is_empty_object() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("style-overrides.json");
        assert_eq!(read_overrides_file(&path), "{}");
    }

    #[test]
    fn overrides_write_roundtrips() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("style-overrides.json");
        let payload = r#"{"h2": {"fontFamily": "Georgia", "fontSize": "18pt"}}"#;

        write_overrides_file(&path, payload).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), payload);
        assert_eq!(read_overrides_file(&path), payload);
    }

    #[test]
    fn overrides_write_creates_parent_dirs() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nested").join("deep").join("style-overrides.json");

        write_overrides_file(&path, "{}").unwrap();
        assert!(path.is_file());
    }

    #[test]
    fn overrides_write_rejects_non_object_payloads() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("style-overrides.json");

        for payload in [r#"[1, 2]"#, r#""h2""#, "not json", "42"] {
            let res = write_overrides_file(&path, payload);
            assert!(res.is_err(), "{payload} must be rejected");
            let msg = res.unwrap_err();
            assert!(msg.starts_with("invalid_json:"), "got {msg}");
        }
        // Nothing was written.
        assert!(!path.exists());
    }

    // --- spell check (plan 09 task 9.5, issue #88) ----------------------------

    #[test]
    fn embedded_wordlist_is_populated_and_correct() {
        let words: Vec<&str> = EMBEDDED_WORDLIST
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();
        assert!(words.len() >= 50_000, "wordlist has only {} words", words.len());
        let set: std::collections::HashSet<&str> = words.iter().copied().collect();
        // Common words are present, so prose is not flagged...
        for w in ["the", "quick", "brown", "fox", "markdown", "spellcheck", "wordlist"] {
            assert!(set.contains(w), "{w} missing from the wordlist");
        }
        // ...and the classic planted misspellings are absent (the scanner's
        // whole job is to flag exactly these).
        for w in ["teh", "recieve", "seperate", "occured", "definately", "wierd"] {
            assert!(!set.contains(w), "{w} must not be in the wordlist");
        }
    }

    #[test]
    fn read_wordlist_file_reads_and_missing_or_blank_is_none() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("wordlist.txt");
        assert_eq!(read_wordlist_file(&path), None);

        fs::write(&path, "alpha\nbeta\n").unwrap();
        assert_eq!(
            read_wordlist_file(&path),
            Some("alpha\nbeta\n".to_string())
        );

        let blank = dir.path().join("blank.txt");
        fs::write(&blank, "   \n").unwrap();
        assert_eq!(read_wordlist_file(&blank), None);
    }

    #[test]
    fn wordlist_settings_read_missing_is_empty_object() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("wordlist-settings.json");
        assert_eq!(read_wordlist_settings_file(&path), "{}");
    }

    #[test]
    fn wordlist_settings_write_roundtrips() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("wordlist-settings.json");
        let payload = r#"{"personal": ["quillmd", "serendipity"]}"#;

        write_wordlist_settings_file(&path, payload).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), payload);
        assert_eq!(read_wordlist_settings_file(&path), payload);
    }

    #[test]
    fn wordlist_settings_write_creates_parent_dirs() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nested").join("wordlist-settings.json");

        write_wordlist_settings_file(&path, "{}").unwrap();
        assert!(path.is_file());
    }

    #[test]
    fn wordlist_settings_write_rejects_non_object_payloads() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("wordlist-settings.json");

        for payload in [r#"[1, 2]"#, r#""personal""#, "not json", "42"] {
            let res = write_wordlist_settings_file(&path, payload);
            assert!(res.is_err(), "{payload} must be rejected");
            let msg = res.unwrap_err();
            assert!(msg.starts_with("invalid_json:"), "got {msg}");
        }
        // Nothing was written.
        assert!(!path.exists());
    }

    // --- explorer file operations (plan 03 task 3.6, issue #44) -------------

    #[test]
    fn fs_new_file_creates_empty_file() {
        let dir = tempdir().unwrap();
        let path = fs_new_file(dir.path().display().to_string(), "note.md".to_string()).unwrap();
        assert_eq!(path, dir.path().join("note.md").display().to_string());
        assert_eq!(fs::read(dir.path().join("note.md")).unwrap(), b"");
    }

    #[test]
    fn fs_new_file_refuses_existing_and_bad_names() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.md"), b"x").unwrap();

        let exists = fs_new_file(dir.path().display().to_string(), "a.md".to_string()).unwrap_err();
        assert!(exists.starts_with("exists:"), "got {exists}");
        assert_eq!(fs::read(dir.path().join("a.md")).unwrap(), b"x");

        for name in ["", ".", "..", "a/b", "a\\b", "CON", "NUL.md", "trailing.", "space "] {
            let res = fs_new_file(dir.path().display().to_string(), name.to_string());
            assert!(res.is_err(), "{name:?} must be rejected");
        }
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn fs_new_file_requires_existing_parent() {
        let res = fs_new_file("/nonexistent/quillmd/fs-new".to_string(), "a.md".to_string());
        let msg = res.unwrap_err();
        assert!(msg.starts_with("io:"), "got {msg}");
    }

    #[test]
    fn fs_new_dir_creates_directory() {
        let dir = tempdir().unwrap();
        let path = fs_new_dir(dir.path().display().to_string(), "chapters".to_string()).unwrap();
        assert_eq!(path, dir.path().join("chapters").display().to_string());
        assert!(dir.path().join("chapters").is_dir());
    }

    #[test]
    fn fs_new_dir_refuses_existing_and_bad_names() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();

        let exists = fs_new_dir(dir.path().display().to_string(), "sub".to_string()).unwrap_err();
        assert!(exists.starts_with("exists:"), "got {exists}");

        let reserved = fs_new_dir(dir.path().display().to_string(), "COM1".to_string());
        assert!(reserved.is_err());
    }

    #[test]
    fn fs_rename_moves_within_parent() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("old.md"), b"keep").unwrap();

        let to = dir.path().join("new.md").display().to_string();
        let out = fs_rename(dir.path().join("old.md").display().to_string(), to.clone()).unwrap();
        assert_eq!(out, to);
        assert!(!dir.path().join("old.md").exists());
        assert_eq!(fs::read(dir.path().join("new.md")).unwrap(), b"keep");
    }

    #[test]
    fn fs_rename_moves_across_directories() {
        let dir = tempdir().unwrap();
        let other = dir.path().join("other");
        fs::create_dir(&other).unwrap();
        fs::write(dir.path().join("doc.md"), b"move me").unwrap();

        let to = other.join("doc.md").display().to_string();
        fs_rename(dir.path().join("doc.md").display().to_string(), to.clone()).unwrap();
        assert_eq!(fs::read(other.join("doc.md")).unwrap(), b"move me");
    }

    #[test]
    fn fs_rename_refuses_existing_target_and_bad_names() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.md"), b"a").unwrap();
        fs::write(dir.path().join("b.md"), b"b").unwrap();

        let exists =
            fs_rename(dir.path().join("a.md").display().to_string(), dir.path().join("b.md").display().to_string());
        let msg = exists.unwrap_err();
        assert!(msg.starts_with("exists:"), "got {msg}");
        assert_eq!(fs::read(dir.path().join("a.md")).unwrap(), b"a");
        assert_eq!(fs::read(dir.path().join("b.md")).unwrap(), b"b");

        let missing = fs_rename(dir.path().join("nope.md").display().to_string(), dir.path().join("c.md").display().to_string());
        assert!(missing.unwrap_err().starts_with("io:"));

        let reserved =
            fs_rename(dir.path().join("a.md").display().to_string(), dir.path().join("CON.md").display().to_string());
        assert!(reserved.unwrap_err().starts_with("bad_name:"));
    }

    #[test]
    fn unique_trash_path_appends_counters_before_extension() {
        let dir = tempdir().unwrap();
        let trash = dir.path().join("trash");
        fs::create_dir(&trash).unwrap();

        assert_eq!(unique_trash_path(&trash, "note.md"), trash.join("note.md"));
        fs::write(trash.join("note.md"), b"x").unwrap();
        assert_eq!(unique_trash_path(&trash, "note.md"), trash.join("note-1.md"));
        fs::write(trash.join("note-1.md"), b"x").unwrap();
        assert_eq!(unique_trash_path(&trash, "note.md"), trash.join("note-2.md"));

        // Extension-less names get a plain counter.
        assert_eq!(unique_trash_path(&trash, "notes"), trash.join("notes"));
        fs::write(trash.join("notes"), b"x").unwrap();
        assert_eq!(unique_trash_path(&trash, "notes"), trash.join("notes-1"));
    }

    #[test]
    fn move_to_trash_moves_file_and_never_unlinks() {
        let dir = tempdir().unwrap();
        let trash = dir.path().join("trash");
        let file = dir.path().join("doomed.md");
        fs::write(&file, b"salvage me").unwrap();

        let target = move_to_trash(&trash, &file).unwrap();
        assert!(!file.exists());
        assert_eq!(fs::read(&target).unwrap(), b"salvage me");
        assert!(target.starts_with(&trash));
    }

    #[test]
    fn move_to_trash_moves_directories_and_dedupes_names() {
        let dir = tempdir().unwrap();
        let trash = dir.path().join("trash");
        let folder = dir.path().join("chapter");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("one.md"), b"1").unwrap();

        let first = move_to_trash(&trash, &folder).unwrap();
        assert!(first.is_dir());
        assert_eq!(fs::read(first.join("one.md")).unwrap(), b"1");

        // A second entry with the same name gets the -1 suffix.
        fs::create_dir(&folder).unwrap();
        let second = move_to_trash(&trash, &folder).unwrap();
        assert_ne!(first, second);
        assert!(second.ends_with("chapter-1"));
    }

    #[test]
    fn move_to_trash_restorable_via_fs_rename() {
        let dir = tempdir().unwrap();
        let trash = dir.path().join("trash");
        let file = dir.path().join("undo-me.md");
        fs::write(&file, b"round trip").unwrap();

        let target = move_to_trash(&trash, &file).unwrap();
        let restored = fs_rename(target.display().to_string(), file.display().to_string()).unwrap();
        assert_eq!(restored, file.display().to_string());
        assert_eq!(fs::read(&file).unwrap(), b"round trip");
        assert!(!target.exists());
    }

    #[test]
    fn move_to_trash_errors_on_missing_entry() {
        let dir = tempdir().unwrap();
        let trash = dir.path().join("trash");
        let res = move_to_trash(&trash, &dir.path().join("ghost.md"));
        let msg = res.unwrap_err();
        assert!(msg.starts_with("io:"), "got {msg}");
        assert!(!trash.exists());
    }
}
