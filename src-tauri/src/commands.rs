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
}
