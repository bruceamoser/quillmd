use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::atomic::write_file_atomic;
use super::atomic::AtomicWriteError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotInfo {
    pub path: String,
    pub mtime: Option<u64>,
}

/// Returns the sidecar snapshot path for a file: `{file}.quillmd-snapshot.md`.
pub fn snapshot_path_for(file: &Path) -> PathBuf {
    let mut os = file.as_os_str().to_os_string();
    os.push(".quillmd-snapshot.md");
    PathBuf::from(os)
}

fn millis(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn info_for(path: &Path) -> Option<SnapshotInfo> {
    let mtime = fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .map(millis);
    Some(SnapshotInfo {
        path: path.display().to_string(),
        mtime,
    })
}

pub fn write_snapshot(file: &Path, bytes: &[u8]) -> Result<SnapshotInfo, AtomicWriteError> {
    let snap = snapshot_path_for(file);
    write_file_atomic(&snap, bytes)?;
    Ok(info_for(&snap).expect("snapshot was just written"))
}

/// Returns `Some(info)` when a snapshot exists and is newer than the target
/// file (or the target is missing), signalling unsaved recoverable content.
pub fn snapshot_newer_than(file: &Path) -> Option<SnapshotInfo> {
    let snap = snapshot_path_for(file);
    let snap_mtime = fs::metadata(&snap).and_then(|m| m.modified()).ok()?;
    match fs::metadata(file).and_then(|m| m.modified()) {
        Ok(file_mtime) if file_mtime > snap_mtime => None,
        _ => info_for(&snap),
    }
}

pub fn cleanup_snapshot(file: &Path) {
    let _ = fs::remove_file(snapshot_path_for(file));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;
    use tempfile::tempdir;

    #[test]
    fn snapshot_path() {
        let p = Path::new("/tmp/doc.md");
        assert_eq!(
            snapshot_path_for(p),
            PathBuf::from("/tmp/doc.md.quillmd-snapshot.md")
        );
    }

    #[test]
    fn write_and_cleanup() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("doc.md");
        fs::write(&file, b"orig").unwrap();

        let info = write_snapshot(&file, b"snap").unwrap();
        assert!(info.path.ends_with(".quillmd-snapshot.md"));
        assert!(info.mtime.is_some());
        assert!(snapshot_path_for(&file).exists());

        cleanup_snapshot(&file);
        assert!(!snapshot_path_for(&file).exists());
    }

    #[test]
    fn newer_detection() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("doc.md");
        fs::write(&file, b"orig").unwrap();

        assert!(snapshot_newer_than(&file).is_none(), "no snapshot yet");

        write_snapshot(&file, b"snap").unwrap();
        assert!(snapshot_newer_than(&file).is_some(), "snapshot newer than file");

        thread::sleep(Duration::from_millis(1100));
        fs::write(&file, b"newer").unwrap();
        assert!(
            snapshot_newer_than(&file).is_none(),
            "file newer than snapshot"
        );
    }
}
