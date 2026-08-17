use sha2::{Digest, Sha256};

use serde::{Deserialize, Serialize};

use std::path::Path;

use super::atomic::{write_file_atomic, AtomicWriteError};

pub fn hash_bytes(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[derive(Debug, Clone)]
pub struct OpenRecord {
    pub hash: String,
    pub mtime: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExternalStatus {
    Unchanged,
    Modified,
    Deleted,
}

#[derive(Debug)]
pub enum SafetyError {
    ExternalChange,
    Read(std::io::Error),
    Backup(AtomicWriteError),
    Write(AtomicWriteError),
}

impl std::fmt::Display for SafetyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SafetyError::ExternalChange => {
                write!(f, "file changed on disk since it was opened")
            }
            SafetyError::Read(e) => write!(f, "read on-disk file: {e}"),
            SafetyError::Backup(e) => write!(f, "write backup file: {e}"),
            SafetyError::Write(e) => write!(f, "atomic write: {e}"),
        }
    }
}

impl std::error::Error for SafetyError {}

pub fn check_external(path: &Path, expected_hash: &str) -> ExternalStatus {
    match std::fs::read(path) {
        Ok(bytes) => {
            if hash_bytes(&bytes) == expected_hash {
                ExternalStatus::Unchanged
            } else {
                ExternalStatus::Modified
            }
        }
        Err(_) => ExternalStatus::Deleted,
    }
}

fn bak_path(path: &Path) -> std::path::PathBuf {
    let mut os = path.as_os_str().to_os_string();
    os.push(".bak");
    std::path::PathBuf::from(os)
}

/// Writes `bytes` to `path` guarded by a hash-compare-before-write. If the
/// on-disk hash differs from `expected_hash`, the write is refused with
/// `ExternalChange` unless `overwrite` is true, in which case the current
/// on-disk content is backed up to `{path}.bak` before the write proceeds.
pub fn write_with_guard(
    path: &Path,
    bytes: &[u8],
    expected_hash: &str,
    overwrite: bool,
) -> Result<(), SafetyError> {
    let current = std::fs::read(path);
    let current_hash = match &current {
        Ok(bytes) => hash_bytes(bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(SafetyError::Read(std::io::Error::new(e.kind(), e.to_string()))),
    };

    if current_hash == expected_hash {
        return write_file_atomic(path, bytes).map_err(SafetyError::Write);
    }

    if !overwrite {
        return Err(SafetyError::ExternalChange);
    }

    if let Ok(existing) = current {
        write_file_atomic(&bak_path(path), &existing).map_err(SafetyError::Backup)?;
    }

    write_file_atomic(path, bytes).map_err(SafetyError::Write)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn hash_is_stable() {
        assert_eq!(hash_bytes(b"abc"), hash_bytes(b"abc"));
        assert_ne!(hash_bytes(b"abc"), hash_bytes(b"abd"));
        assert_eq!(
            hash_bytes(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn check_external_statuses() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("a.md");

        assert_eq!(check_external(&path, "anything"), ExternalStatus::Deleted);

        fs::write(&path, b"hello").unwrap();
        let h = hash_bytes(b"hello");
        assert_eq!(check_external(&path, &h), ExternalStatus::Unchanged);

        fs::write(&path, b"changed").unwrap();
        assert_eq!(check_external(&path, &h), ExternalStatus::Modified);
    }

    #[test]
    fn write_with_guard_refuses_on_mismatch() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("a.md");
        fs::write(&path, b"on disk").unwrap();
        let expected = hash_bytes(b"what we opened");

        let err = write_with_guard(&path, b"new", &expected, false).unwrap_err();
        assert!(matches!(err, SafetyError::ExternalChange));
        assert_eq!(fs::read(&path).unwrap(), b"on disk");
    }

    #[test]
    fn write_with_guard_writes_when_matching() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("a.md");
        fs::write(&path, b"on disk").unwrap();
        let expected = hash_bytes(b"on disk");

        write_with_guard(&path, b"new", &expected, false).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new");
    }

    #[test]
    fn write_with_guard_overwrite_backs_up() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("a.md");
        fs::write(&path, b"on disk").unwrap();
        let expected = hash_bytes(b"different");

        write_with_guard(&path, b"new", &expected, true).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new");

        let bak = dir.path().join("a.md.bak");
        assert_eq!(fs::read(&bak).unwrap(), b"on disk");
    }

    #[test]
    fn write_with_guard_overwrite_without_existing_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("missing.md");
        let expected = hash_bytes(b"never existed");

        write_with_guard(&path, b"new", &expected, true).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new");
        assert!(!dir.path().join("missing.md.bak").exists());
    }
}
