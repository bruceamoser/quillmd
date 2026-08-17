use std::fmt::Display;
use std::fs;
use std::path::PathBuf;

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

#[tauri::command]
pub fn recover_snapshot(path: String) -> Option<Vec<u8>> {
    let p = PathBuf::from(&path);
    fs::read(snapshot::snapshot_path_for(&p)).ok()
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
}
