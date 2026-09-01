// Asset copy pipeline (plan 08 task 8.3, issue #78). A picked image is
// copied next to the open document — into an `assets/` subfolder or the
// doc's own folder (plan 08 §2.3) — and the markdown references the copy by
// a forward-slash relative path (plan 08 §3 relative-path invariant). The
// copy composes the fs safety core: the reserved-name gate (paths.rs,
// golden rule 4) and the crash-safe atomic write (atomic.rs), so a copy can
// never leave a half-written asset or escape the document's folder. The
// batch existence check backs the broken-image placeholder (task 8.5).

use std::fs;
use std::path::{Path, PathBuf};

use super::atomic::write_file_atomic;
use super::paths::is_windows_reserved;

/// Where copied assets land relative to the document (plan 08 §2.3 user
/// setting): the `assets/` subfolder next to the doc, or the doc's own
/// folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetFolder {
    /// `<doc_dir>/assets/` (the default).
    Assets,
    /// The document's own folder.
    Doc,
}

/// Parses the asset-folder setting as sent by the frontend ("assets" |
/// "doc"); anything else is refused rather than guessed.
pub fn parse_asset_folder(value: &str) -> Option<AssetFolder> {
    match value {
        "assets" => Some(AssetFolder::Assets),
        "doc" => Some(AssetFolder::Doc),
        _ => None,
    }
}

/// Name-collision behavior when a copied asset would reuse an existing file
/// name (plan 10 task 10.2, issue #94): "suffix" appends `-1`/`-2`/... until
/// the name is free (the plan 08 default), "never" keeps the picked (fixed)
/// name and overwrites the existing file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetCollision {
    /// Keep the picked name; overwrite any existing file of that name.
    Never,
    /// Append `-1`/`-2`/... until the name is free (the default).
    Suffix,
}

/// Parses the asset-collision setting as sent by the frontend ("never" |
/// "suffix"); anything else is refused rather than guessed.
pub fn parse_asset_collision(value: &str) -> Option<AssetCollision> {
    match value {
        "never" => Some(AssetCollision::Never),
        "suffix" => Some(AssetCollision::Suffix),
        _ => None,
    }
}

#[derive(Debug)]
pub enum AssetCopyError {
    /// `src` does not exist or has no usable file name.
    SourceNotFound(String),
    /// `src` is a directory (or neither a file nor a directory).
    SourceNotAFile(String),
    /// The document has no folder to copy into (an unsaved `:new:` tab).
    NoDocFolder,
    /// The picked file's name is a Windows reserved device name or ends
    /// with a dot/space (golden rule 4: reserved-name rejection).
    ReservedName(String),
    /// The computed copy target would escape the document's folder.
    Traversal(String),
    Io(String),
}

impl std::fmt::Display for AssetCopyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AssetCopyError::SourceNotFound(p) => write!(f, "source not found: {p}"),
            AssetCopyError::SourceNotAFile(p) => write!(f, "source is not a file: {p}"),
            AssetCopyError::NoDocFolder => write!(f, "document has no folder to copy into"),
            AssetCopyError::ReservedName(n) => {
                write!(f, "reserved or unsafe file name: {n}")
            }
            AssetCopyError::Traversal(p) => write!(f, "copy target escapes the document folder: {p}"),
            AssetCopyError::Io(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for AssetCopyError {}

/// The directory a copy lands in for the given setting: `<doc_dir>/assets`
/// or `<doc_dir>` itself.
pub fn asset_target_dir(doc_dir: &Path, folder: AssetFolder) -> PathBuf {
    match folder {
        AssetFolder::Assets => doc_dir.join("assets"),
        AssetFolder::Doc => doc_dir.to_path_buf(),
    }
}

/// Splits a file name into stem and extension for collision naming:
/// `photo.png` -> (`photo`, `.png`), `archive.tar.gz` -> (`archive.tar`,
/// `.gz`), `README` -> (`README`, ``), `.hidden` -> (`.hidden`, ``).
fn split_stem_ext(name: &str) -> (String, String) {
    match name.rfind('.') {
        Some(i) if i > 0 => (name[..i].to_string(), name[i..].to_string()),
        _ => (name.to_string(), String::new()),
    }
}

/// The first free file name in `dir` for `name`: `name`, `stem-1.ext`,
/// `stem-2.ext`, ... (plan 08 §2.3 collision-safe naming: inserting
/// `photo.png` twice yields `photo.png` + `photo-1.png`).
pub fn free_name_in(dir: &Path, name: &str) -> String {
    if !dir.join(name).exists() {
        return name.to_string();
    }
    let (stem, ext) = split_stem_ext(name);
    let mut n = 1u32;
    loop {
        let candidate = format!("{stem}-{n}{ext}");
        if !dir.join(&candidate).exists() {
            return candidate;
        }
        n += 1;
    }
}

/// Copies `src` into the document's asset location and returns the
/// markdown-relative path (forward slashes) to embed in the document:
/// `assets/photo.png` for the assets-subfolder setting, `photo.png` for the
/// same-folder setting. The copy is atomic (temp + fsync + rename, atomic.rs)
/// so a crash mid-copy never leaves a partial asset behind.
pub fn copy_asset(
    src: &Path,
    doc_dir: &Path,
    folder: AssetFolder,
    collision: AssetCollision,
) -> Result<String, AssetCopyError> {
    // Only the last path segment is ever used for the target, so a picked
    // path cannot smuggle separators or `..` into the document's folder.
    let src_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .ok_or_else(|| AssetCopyError::SourceNotFound(src.display().to_string()))?;
    if src_name.contains('/') || src_name.contains('\\') {
        return Err(AssetCopyError::Traversal(src.display().to_string()));
    }
    if is_windows_reserved(src_name) {
        return Err(AssetCopyError::ReservedName(src_name.to_string()));
    }

    let meta = match fs::metadata(src) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AssetCopyError::SourceNotFound(src.display().to_string()))
        }
        Err(e) => {
            return Err(AssetCopyError::Io(format!("stat {}: {e}", src.display())))
        }
    };
    if !meta.is_file() {
        return Err(AssetCopyError::SourceNotAFile(src.display().to_string()));
    }
    if doc_dir.as_os_str().is_empty() {
        return Err(AssetCopyError::NoDocFolder);
    }

    let target_dir = asset_target_dir(doc_dir, folder);
    fs::create_dir_all(&target_dir)
        .map_err(|e| AssetCopyError::Io(format!("create {}: {e}", target_dir.display())))?;

    // "never" keeps the picked (fixed) name and overwrites the existing file
    // (the atomic write below replaces it); "suffix" finds the first free
    // name so an existing asset is never clobbered (plan 08 §2.3).
    let file_name = match collision {
        AssetCollision::Never => src_name.to_string(),
        AssetCollision::Suffix => free_name_in(&target_dir, src_name),
    };
    let target = target_dir.join(&file_name);

    // The atomic write publishes the temp file (in target_dir) before the
    // rename, so the canonical target exists here and can be checked.
    let bytes =
        fs::read(src).map_err(|e| AssetCopyError::Io(format!("read {}: {e}", src.display())))?;
    write_file_atomic(&target, &bytes)
        .map_err(|e| AssetCopyError::Io(format!("write {}: {e}", target.display())))?;

    // Containment gate (plan 08 §3: path validation, no traversal): the
    // canonical copy must sit inside the canonical document folder.
    let root = fs::canonicalize(doc_dir)
        .map_err(|e| AssetCopyError::Io(format!("resolve {}: {e}", doc_dir.display())))?;
    let resolved = fs::canonicalize(&target)
        .map_err(|e| AssetCopyError::Io(format!("resolve {}: {e}", target.display())))?;
    if !resolved.starts_with(&root) {
        let _ = fs::remove_file(&target);
        return Err(AssetCopyError::Traversal(target.display().to_string()));
    }

    let relative = match folder {
        AssetFolder::Assets => format!("assets/{file_name}"),
        AssetFolder::Doc => file_name,
    };
    Ok(relative)
}

/// Batch existence check for the broken-image detection (plan 08 §3: one
/// Rust command, list in / list out). Each entry is the path exactly as
/// given; missing, unreadable, or empty paths read as `false`.
pub fn files_exist(paths: &[String]) -> Vec<bool> {
    paths
        .iter()
        .map(|p| Path::new(p).exists())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// Writes a one-byte marker file at `dir/name` (creating `dir` first).
    fn seed(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"x").unwrap();
        path
    }

    #[test]
    fn copy_into_assets_subfolder() {
        let work = tempdir().unwrap();
        let doc_dir = work.path().join("docs");
        let src = seed(work.path(), "photo.png");

        let rel = copy_asset(&src, &doc_dir, AssetFolder::Assets, AssetCollision::Suffix).unwrap();
        assert_eq!(rel, "assets/photo.png");
        let copied = doc_dir.join("assets").join("photo.png");
        assert!(copied.is_file());
        assert_eq!(fs::read(&copied).unwrap(), b"x");
    }

    #[test]
    fn copy_into_doc_folder_setting() {
        let work = tempdir().unwrap();
        let doc_dir = work.path().join("docs");
        let src = seed(work.path(), "photo.png");

        let rel = copy_asset(&src, &doc_dir, AssetFolder::Doc, AssetCollision::Suffix).unwrap();
        assert_eq!(rel, "photo.png");
        let copied = doc_dir.join("photo.png");
        assert!(copied.is_file());
        assert!(!doc_dir.join("assets").exists());
    }

    #[test]
    fn collision_naming_counters() {
        let work = tempdir().unwrap();
        let doc_dir = work.path().join("docs");
        let src = seed(work.path(), "photo.png");

        assert_eq!(
            copy_asset(&src, &doc_dir, AssetFolder::Assets, AssetCollision::Suffix).unwrap(),
            "assets/photo.png"
        );
        assert_eq!(
            copy_asset(&src, &doc_dir, AssetFolder::Assets, AssetCollision::Suffix).unwrap(),
            "assets/photo-1.png"
        );
        assert_eq!(
            copy_asset(&src, &doc_dir, AssetFolder::Assets, AssetCollision::Suffix).unwrap(),
            "assets/photo-2.png"
        );
        for name in ["photo.png", "photo-1.png", "photo-2.png"] {
            assert!(doc_dir.join("assets").join(name).is_file());
        }
    }

    #[test]
    fn collision_naming_without_extension() {
        let work = tempdir().unwrap();
        let dir = work.path().to_path_buf();

        let first = free_name_in(&dir, "README");
        assert_eq!(first, "README");
        fs::write(dir.join("README"), b"x").unwrap();
        assert_eq!(free_name_in(&dir, "README"), "README-1");
        fs::write(dir.join("README-1"), b"x").unwrap();
        assert_eq!(free_name_in(&dir, "README"), "README-2");
    }

    #[test]
    fn collision_never_keeps_the_picked_name_and_overwrites() {
        let work = tempdir().unwrap();
        let doc_dir = work.path().join("docs");
        let src = seed(work.path(), "photo.png");

        // First copy lands on the picked name.
        assert_eq!(
            copy_asset(&src, &doc_dir, AssetFolder::Assets, AssetCollision::Never).unwrap(),
            "assets/photo.png"
        );
        // The source bytes change; a second copy with "never" keeps the same
        // (fixed) name and overwrites the existing file rather than suffixing.
        fs::write(&src, b"v2").unwrap();
        assert_eq!(
            copy_asset(&src, &doc_dir, AssetFolder::Assets, AssetCollision::Never).unwrap(),
            "assets/photo.png"
        );
        let copied = doc_dir.join("assets").join("photo.png");
        assert_eq!(fs::read(&copied).unwrap(), b"v2");
        // No suffixed sibling was created.
        assert!(!doc_dir.join("assets").join("photo-1.png").exists());
    }

    #[test]
    fn parse_asset_collision_is_strict() {
        assert_eq!(parse_asset_collision("never"), Some(AssetCollision::Never));
        assert_eq!(parse_asset_collision("suffix"), Some(AssetCollision::Suffix));
        assert_eq!(parse_asset_collision("Never"), None);
        assert_eq!(parse_asset_collision(""), None);
    }

    #[test]
    fn copy_refuses_missing_source() {
        let work = tempdir().unwrap();
        let doc_dir = work.path().join("docs");
        let res = copy_asset(
            &work.path().join("nope.png"),
            &doc_dir,
            AssetFolder::Assets,
            AssetCollision::Suffix,
        );
        assert!(matches!(res, Err(AssetCopyError::SourceNotFound(_))));
    }

    #[test]
    fn copy_refuses_directory_source() {
        let work = tempdir().unwrap();
        let doc_dir = work.path().join("docs");
        let dir = work.path().join("adir");
        fs::create_dir(&dir).unwrap();
        let res = copy_asset(&dir, &doc_dir, AssetFolder::Assets, AssetCollision::Suffix);
        assert!(matches!(res, Err(AssetCopyError::SourceNotAFile(_))));
    }

    #[test]
    fn copy_refuses_reserved_windows_names() {
        let work = tempdir().unwrap();
        let doc_dir = work.path().join("docs");
        for name in ["CON", "con.txt", "NUL", "COM1", "LPT9"] {
            let src = seed(work.path(), name);
            let res = copy_asset(&src, &doc_dir, AssetFolder::Assets, AssetCollision::Suffix);
            assert!(
                matches!(res, Err(AssetCopyError::ReservedName(_))),
                "{name} should be refused"
            );
        }
        // Nothing was copied.
        assert!(!doc_dir.join("assets").exists());
    }

    #[test]
    fn copy_refuses_a_doc_dir_with_no_name() {
        let work = tempdir().unwrap();
        let src = seed(work.path(), "photo.png");
        let res = copy_asset(&src, Path::new(""), AssetFolder::Assets, AssetCollision::Suffix);
        assert!(matches!(res, Err(AssetCopyError::NoDocFolder)));
    }

    #[test]
    fn copy_creates_the_assets_subfolder_when_missing() {
        let work = tempdir().unwrap();
        let doc_dir = work.path().join("docs");
        let src = seed(work.path(), "a.png");

        let rel = copy_asset(&src, &doc_dir, AssetFolder::Assets, AssetCollision::Suffix).unwrap();
        assert_eq!(rel, "assets/a.png");
        assert!(doc_dir.join("assets").join("a.png").is_file());
    }

    #[test]
    fn copy_keeps_the_source_untouched() {
        let work = tempdir().unwrap();
        let doc_dir = work.path().join("docs");
        let src = seed(work.path(), "photo.png");
        fs::write(&src, b"the original").unwrap();

        copy_asset(&src, &doc_dir, AssetFolder::Assets, AssetCollision::Suffix).unwrap();
        assert_eq!(fs::read(&src).unwrap(), b"the original");
    }

    #[test]
    fn files_exist_reports_each_entry() {
        let work = tempdir().unwrap();
        let a = seed(work.path(), "a.png");
        let nested = seed(work.path().join("nested").as_path(), "c.png");
        let paths = vec![
            a.display().to_string(),
            work.path().join("missing.png").display().to_string(),
            nested.display().to_string(),
            String::new(),
        ];
        assert_eq!(files_exist(&paths), vec![true, false, true, false]);
        assert_eq!(files_exist(&[]), Vec::<bool>::new());
    }

    #[test]
    fn parse_asset_folder_is_strict() {
        assert_eq!(parse_asset_folder("assets"), Some(AssetFolder::Assets));
        assert_eq!(parse_asset_folder("doc"), Some(AssetFolder::Doc));
        assert_eq!(parse_asset_folder("Assets"), None);
        assert_eq!(parse_asset_folder(""), None);
    }
}
