use std::fmt::Display;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

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
}
