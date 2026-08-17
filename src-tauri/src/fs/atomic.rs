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

/// Removes the temp file on drop unless disarmed. This guarantees the temp
/// file is cleaned up even when a write panics mid-flight (crash injection),
/// because Rust runs the guard's Drop during stack unwinding.
struct TempGuard {
    path: PathBuf,
    armed: bool,
}

impl TempGuard {
    fn new(path: PathBuf) -> Self {
        TempGuard { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TempGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

/// Crash-injection hook for the acceptance harness (spec §5.8): when the
/// `QUILLMD_PANIC_AFTER` environment variable names a byte count, the atomic
/// write panics after that many bytes have been written, simulating a crash
/// mid-save. The temp file is still cleaned up (via the guard) and the target
/// file is never touched.
fn crash_after_bytes() -> Option<usize> {
    std::env::var("QUILLMD_PANIC_AFTER")
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
}

/// Writes `bytes` to `path` atomically: a temp file is created in the same
/// directory, written, fsynced, then renamed over the target. If anything
/// fails the temp file is removed and the original target is untouched.
pub fn write_file_atomic(path: &Path, bytes: &[u8]) -> Result<(), AtomicWriteError> {
    write_file_atomic_impl(path, bytes, crash_after_bytes())
}

fn write_file_atomic_impl(
    path: &Path,
    bytes: &[u8],
    crash_after: Option<usize>,
) -> Result<(), AtomicWriteError> {
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
    let mut guard = TempGuard::new(tmp_path.clone());

    let result = (|| -> Result<(), AtomicWriteError> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)
            .map_err(AtomicWriteError::Create)?;
        write_with_crash_hook(&mut file, bytes, crash_after).map_err(AtomicWriteError::Write)?;
        file.sync_all().map_err(AtomicWriteError::Sync)?;
        drop(file);
        fs::rename(&tmp_path, path).map_err(AtomicWriteError::Rename)?;
        fsync_dir(&dir);
        Ok(())
    })();

    if result.is_ok() {
        guard.disarm();
    }
    result
}

fn write_with_crash_hook(
    file: &mut fs::File,
    bytes: &[u8],
    crash_after: Option<usize>,
) -> io::Result<()> {
    match crash_after {
        Some(limit) if limit < bytes.len() => {
            file.write_all(&bytes[..limit])?;
            panic!("QUILLMD_PANIC_AFTER reached after {limit} bytes");
        }
        _ => file.write_all(bytes),
    }
}

/// Atomically moves an already-written temp file (in the target directory)
/// over the final target, then fsyncs the directory. Used by the conversion
/// service to publish pandoc output without exposing a half-written file.
pub fn rename_atomic(tmp_path: &Path, target: &Path) -> Result<(), AtomicWriteError> {
    fs::rename(tmp_path, target).map_err(AtomicWriteError::Rename)?;
    let dir: PathBuf = match target.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
        _ => PathBuf::from("."),
    };
    fsync_dir(&dir);
    Ok(())
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

    #[test]
    fn crash_injection_cleans_temp_and_preserves_original() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("doc.md");
        fs::write(&path, b"original content").unwrap();

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            write_file_atomic_impl(&path, b"0123456789", Some(4)).unwrap();
        }));

        assert!(result.is_err(), "the injected crash must panic");
        assert_eq!(fs::read(&path).unwrap(), b"original content");

        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left behind: {leftovers:?}");
    }

    #[test]
    fn crash_during_save_keeps_snapshot_recoverable() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("doc.md");
        fs::write(&path, b"original").unwrap();

        crate::fs::snapshot::write_snapshot(&path, b"unsaved edit").unwrap();

        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            write_file_atomic_impl(&path, b"new content", Some(3)).unwrap();
        }));

        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert!(
            crate::fs::snapshot::snapshot_newer_than(&path).is_some(),
            "snapshot must remain recoverable after a crash"
        );
    }
}
