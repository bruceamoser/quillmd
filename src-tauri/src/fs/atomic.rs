use std::fmt;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug)]
pub enum AtomicWriteError {
    NoFileName,
    Create(io::Error),
    Write(io::Error),
    Sync(io::Error),
    Rename(io::Error),
}

impl fmt::Display for AtomicWriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AtomicWriteError::NoFileName => write!(f, "target path has no file name"),
            AtomicWriteError::Create(e) => write!(f, "create temp file: {e}"),
            AtomicWriteError::Write(e) => write!(f, "write temp file: {e}"),
            AtomicWriteError::Sync(e) => write!(f, "fsync temp file: {e}"),
            AtomicWriteError::Rename(e) => write!(f, "rename temp file: {e}"),
        }
    }
}

impl std::error::Error for AtomicWriteError {}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_tag() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{}-{}", std::process::id(), nanos, counter)
}

/// Writes `bytes` to `path` atomically: a temp file is created in the same
/// directory, written, fsynced, then renamed over the target. If anything
/// fails the temp file is removed and the original target is untouched.
pub fn write_file_atomic(path: &Path, bytes: &[u8]) -> Result<(), AtomicWriteError> {
    let file_name = path
        .file_name()
        .ok_or(AtomicWriteError::NoFileName)?
        .to_string_lossy()
        .into_owned();

    let dir: PathBuf = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
        _ => PathBuf::from("."),
    };

    let tmp_path = dir.join(format!(".{}.{}.tmp", file_name, temp_tag()));

    let result = (|| -> Result<(), AtomicWriteError> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)
            .map_err(AtomicWriteError::Create)?;
        file.write_all(bytes).map_err(AtomicWriteError::Write)?;
        file.sync_all().map_err(AtomicWriteError::Sync)?;
        drop(file);
        fs::rename(&tmp_path, path).map_err(AtomicWriteError::Rename)?;
        fsync_dir(&dir);
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&tmp_path);
    }

    result
}

#[cfg(unix)]
fn fsync_dir(dir: &Path) {
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
}

#[cfg(not(unix))]
fn fsync_dir(_dir: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn write_succeeds() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("doc.md");
        write_file_atomic(&path, b"hello world").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hello world");

        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left behind");
    }

    #[test]
    fn overwrites_existing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("doc.md");
        fs::write(&path, b"old content").unwrap();
        write_file_atomic(&path, b"new content").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new content");
    }

    #[test]
    fn failure_leaves_original_intact() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("target.md");
        fs::create_dir(&target).unwrap();

        let result = write_file_atomic(&target, b"should not land");
        assert!(result.is_err());
        assert!(target.is_dir(), "original directory must remain");

        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left behind");
    }
}
