use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;

use crate::fs::atomic;

/// Structured conversion error, serialized as JSON across IPC so the frontend
/// can distinguish "install pandoc" from "pick a different target" and real
/// failures. Never panics: every path returns one of these kinds.
#[derive(Debug, Serialize)]
pub struct ConvertError {
    pub kind: String,
    pub message: String,
}

impl ConvertError {
    fn tool_missing(tool: &str) -> Self {
        ConvertError {
            kind: "tool_missing".to_string(),
            message: format!("{tool} is not installed"),
        }
    }

    fn same_path() -> Self {
        ConvertError {
            kind: "same_path".to_string(),
            message: "export target must differ from the open document".to_string(),
        }
    }

    fn convert_failed(msg: String) -> Self {
        ConvertError {
            kind: "convert_failed".to_string(),
            message: msg,
        }
    }

    fn io(msg: String) -> Self {
        ConvertError {
            kind: "io".to_string(),
            message: msg,
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| {
            r#"{"kind":"io","message":"error serialization failed"}"#.to_string()
        })
    }
}

pub fn pandoc_available() -> bool {
    tool_available("pandoc")
}

pub fn typst_available() -> bool {
    tool_available("typst")
}

/// Resolves a conversion tool to an executable path. Order: (1) a bundled
/// sidecar shipped next to the running binary (Tauri `externalBin`), then
/// (2) the bare command name resolved from PATH. Returns `None` when no sidecar
/// is present; callers then run the bare name.
fn resolve_tool(name: &str) -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    resolve_in_dir(&dir, name)
}

/// Searches `dir` for a sidecar named `name`. Tauri bundles external binaries
/// as `<name>-<target-triple>[.exe]` and strips the triple suffix when copying
/// them next to the app, so we accept the bare name, a `.exe` suffix, and any
/// `<name>-*` prefix to survive naming variations without hardcoding triples.
fn resolve_in_dir(dir: &Path, name: &str) -> Option<PathBuf> {
    let bare = dir.join(name);
    if bare.is_file() {
        return Some(bare);
    }
    let exe = dir.join(format!("{name}.exe"));
    if exe.is_file() {
        return Some(exe);
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && entry.file_name().to_string_lossy().starts_with(&format!("{name}-")) {
                return Some(path);
            }
        }
    }
    None
}

fn tool_command(name: &str) -> Command {
    match resolve_tool(name) {
        Some(path) => Command::new(path),
        None => Command::new(name),
    }
}

fn tool_available(tool: &str) -> bool {
    tool_command(tool)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn require_pandoc() -> Result<(), ConvertError> {
    if pandoc_available() {
        Ok(())
    } else {
        Err(ConvertError::tool_missing("pandoc"))
    }
}

fn require_typst() -> Result<(), ConvertError> {
    if typst_available() {
        Ok(())
    } else {
        Err(ConvertError::tool_missing("typst"))
    }
}

/// Entry point used by the Tauri command: maps a format string to the matching
/// export. `format` is one of pdf, docx, epub, txt, txt-plain.
pub fn export(src: &Path, format: &str, out: &Path) -> Result<(), ConvertError> {
    match format {
        "pdf" => export_pdf(src, out),
        "docx" => export_docx(src, out),
        "epub" => export_epub(src, out),
        "txt" => export_txt(src, out, true),
        "txt-plain" => export_txt(src, out, false),
        other => Err(ConvertError::convert_failed(format!(
            "unknown export format: {other}"
        ))),
    }
}

pub fn export_pdf(src: &Path, out: &Path) -> Result<(), ConvertError> {
    ensure_export_target(src, out, "pdf")?;
    require_pandoc()?;
    require_typst()?;
    convert_to(src, out, &["-t", "pdf", "--pdf-engine=typst", "-V", "mainfont=DejaVu Sans"])
}

pub fn export_docx(src: &Path, out: &Path) -> Result<(), ConvertError> {
    ensure_export_target(src, out, "docx")?;
    require_pandoc()?;
    convert_to(src, out, &["-t", "docx"])
}

pub fn export_epub(src: &Path, out: &Path) -> Result<(), ConvertError> {
    ensure_export_target(src, out, "epub")?;
    require_pandoc()?;
    convert_to(src, out, &["-t", "epub"])
}

pub fn export_txt(src: &Path, out: &Path, raw: bool) -> Result<(), ConvertError> {
    ensure_export_target(src, out, "txt")?;
    if raw {
        let bytes = fs::read(src).map_err(|e| ConvertError::io(format!("read source: {e}")))?;
        atomic::write_file_atomic(out, &bytes)
            .map_err(|e| ConvertError::io(format!("write export: {e}")))?;
        Ok(())
    } else {
        require_pandoc()?;
        convert_to(src, out, &["-t", "plain"])
    }
}

pub fn import_docx(src: &Path, out_md: &Path) -> Result<(), ConvertError> {
    require_pandoc()?;
    ensure_extension(out_md, "md")?;
    convert_to(src, out_md, &["-t", "gfm"])
}

// --- Export assets (plan 11 task 11.5, issue #104) ---------------------------
//
// Mermaid diagrams are rendered to PNG in the frontend (SVG -> image ->
// canvas -> PNG at 2x scale) and written here, next to the temp export
// markdown, so pandoc can embed the relative image references when it
// produces PDF/DOCX/EPUB. The write is collision-safe and atomic and the
// name is gated by the same reserved-name check as the asset copy pipeline
// (golden rule 4), so an asset can never escape the export directory or
// clobber a file a crashed export left behind.

#[derive(Debug)]
pub enum ExportAssetError {
    /// `dir` is empty or not an absolute path.
    BadDir(String),
    /// `name` is not a safe single file name (traversal, Windows reserved
    /// name, trailing dot/space, empty, or too long).
    BadName(String),
    Io(String),
}

impl std::fmt::Display for ExportAssetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExportAssetError::BadDir(d) => write!(f, "export dir must be an absolute path: {d}"),
            ExportAssetError::BadName(n) => write!(f, "reserved or unsafe file name: {n}"),
            ExportAssetError::Io(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for ExportAssetError {}

/// Validates an export asset file name: one non-empty segment of at most 255
/// chars, no separators or `..`, and no Windows reserved device name
/// (golden rule 4 — the gate shared with the asset copy pipeline).
fn validate_asset_name(name: &str) -> Result<(), ExportAssetError> {
    let bad = || ExportAssetError::BadName(name.to_string());
    if name.is_empty() || name.len() > 255 {
        return Err(bad());
    }
    if name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err(bad());
    }
    if crate::fs::paths::is_windows_reserved(name) {
        return Err(bad());
    }
    Ok(())
}

/// Writes `bytes` into `dir` under `name` and returns the path actually
/// written. If `dir/name` already exists (a stale file from a crashed
/// export), the collision-safe naming shared with the asset copy pipeline
/// takes over: `stem-1.ext`, `stem-2.ext`, ... The write is atomic
/// (fs/atomic.rs) and `dir` is created when missing.
pub fn write_export_asset(dir: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, ExportAssetError> {
    if dir.as_os_str().is_empty() || !dir.is_absolute() {
        return Err(ExportAssetError::BadDir(dir.display().to_string()));
    }
    validate_asset_name(name)?;
    fs::create_dir_all(dir)
        .map_err(|e| ExportAssetError::Io(format!("create {}: {e}", dir.display())))?;
    let file_name = crate::fs::assets::free_name_in(dir, name);
    let target = dir.join(&file_name);
    atomic::write_file_atomic(&target, bytes)
        .map_err(|e| ExportAssetError::Io(format!("write {}: {e}", target.display())))?;
    Ok(target)
}

/// Best-effort removal of the export assets an export wrote (the temp export
/// markdown + the diagram PNGs). Only absolute paths whose file name passes
/// the same validation as `write_export_asset` and that are regular files
/// are removed; missing paths are skipped so cleanup can never fail an
/// export. Returns the paths actually removed.
pub fn remove_export_assets(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut removed = Vec::new();
    for path in paths {
        let name_ok = path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| validate_asset_name(n).is_ok());
        if !path.is_absolute() || !name_ok || !path.is_file() {
            continue;
        }
        if fs::remove_file(path).is_ok() {
            removed.push(path.clone());
        }
    }
    removed
}
fn ensure_export_target(src: &Path, out: &Path, ext: &str) -> Result<(), ConvertError> {
    ensure_extension(out, ext)?;
    if paths_resolve_same(src, out) {
        return Err(ConvertError::same_path());
    }
    Ok(())
}

fn ensure_extension(out: &Path, ext: &str) -> Result<(), ConvertError> {
    let actual = out
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    if actual.as_deref() == Some(ext) {
        Ok(())
    } else {
        Err(ConvertError::convert_failed(format!(
            "target must have a .{ext} extension"
        )))
    }
}

/// Compares two paths after canonicalizing what exists, resolving the parent
/// directory of a not-yet-created target so an export to the open document is
/// still detected even when the target file does not exist yet.
fn paths_resolve_same(a: &Path, b: &Path) -> bool {
    if let (Ok(ca), Ok(cb)) = (a.canonicalize(), b.canonicalize()) {
        return ca == cb;
    }
    let resolve = |p: &Path| -> Option<PathBuf> {
        let parent = p.parent().unwrap_or_else(|| Path::new("."));
        let name = p.file_name()?;
        Some(fs::canonicalize(parent).ok()?.join(name))
    };
    match (resolve(a), resolve(b)) {
        (Some(ra), Some(rb)) => ra == rb,
        _ => a == b,
    }
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_in_same_dir(target: &Path) -> Result<PathBuf, ConvertError> {
    let dir = match target.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
        _ => PathBuf::from("."),
    };
    let name = target
        .file_name()
        .ok_or_else(|| ConvertError::io("target path has no file name".to_string()))?;
    let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    Ok(dir.join(format!(
        ".{}.{}.{}.tmp",
        name.to_string_lossy(),
        std::process::id(),
        n
    )))
}

/// Runs pandoc into a temp file next to `out`, then atomically renames the temp
/// into place. A failed conversion leaves the target untouched.
fn convert_to(src: &Path, out: &Path, extra: &[&str]) -> Result<(), ConvertError> {
    let tmp = temp_in_same_dir(out)?;
    let mut args: Vec<OsString> = Vec::with_capacity(extra.len() + 3);
    args.push(src.as_os_str().to_owned());
    args.push(OsString::from("-o"));
    args.push(tmp.as_os_str().to_owned());
    args.extend(extra.iter().map(OsString::from));

    let result = run_pandoc(&args);
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
        return result;
    }
    atomic::rename_atomic(&tmp, out).map_err(|e| ConvertError::io(format!("finalize output: {e}")))
}

fn run_pandoc(args: &[OsString]) -> Result<(), ConvertError> {
    let output = tool_command("pandoc")
        .args(args)
        .output()
        .map_err(|e| ConvertError::io(format!("failed to run pandoc: {e}")))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let msg = if stderr.is_empty() {
            format!("pandoc exited with {}", output.status)
        } else {
            stderr
        };
        Err(ConvertError::convert_failed(msg))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_sample(dir: &Path) -> PathBuf {
        let p = dir.join("doc.md");
        fs::write(&p, b"# Hello\n\nA *sample* document.\n").unwrap();
        p
    }

    #[test]
    fn resolve_in_dir_finds_sidecar_variants() {
        let dir = tempdir().unwrap();
        let p = dir.path();

        fs::write(p.join("pandoc"), b"x").unwrap();
        assert_eq!(resolve_in_dir(p, "pandoc"), Some(p.join("pandoc")));

        fs::write(p.join("typst-x86_64-unknown-linux-gnu"), b"x").unwrap();
        assert_eq!(
            resolve_in_dir(p, "typst"),
            Some(p.join("typst-x86_64-unknown-linux-gnu"))
        );

        fs::write(p.join("pandoc-x86_64-pc-windows-msvc.exe"), b"x").unwrap();
        assert_eq!(
            resolve_in_dir(p, "pandoc"),
            Some(p.join("pandoc"))
        );

        assert_eq!(resolve_in_dir(p, "nope"), None);
    }

    #[test]
    fn export_docx_produces_nonempty_file() {
        if !pandoc_available() {
            eprintln!("SKIP: pandoc not installed");
            return;
        }
        let dir = tempdir().unwrap();
        let src = write_sample(dir.path());
        let out = dir.path().join("doc.docx");
        export_docx(&src, &out).unwrap();
        let bytes = fs::read(&out).unwrap();
        assert!(!bytes.is_empty());
    }

    #[test]
    fn export_pdf_produces_pdf() {
        if !pandoc_available() || !typst_available() {
            eprintln!("SKIP: pandoc or typst not installed");
            return;
        }
        let dir = tempdir().unwrap();
        let src = write_sample(dir.path());
        let out = dir.path().join("doc.pdf");
        export_pdf(&src, &out).unwrap();
        let bytes = fs::read(&out).unwrap();
        assert!(bytes.len() >= 4);
        assert_eq!(&bytes[..4], b"%PDF");
    }

    #[test]
    fn export_epub_produces_nonempty_file() {
        if !pandoc_available() {
            eprintln!("SKIP: pandoc not installed");
            return;
        }
        let dir = tempdir().unwrap();
        let src = write_sample(dir.path());
        let out = dir.path().join("doc.epub");
        export_epub(&src, &out).unwrap();
        let bytes = fs::read(&out).unwrap();
        assert!(!bytes.is_empty());
        assert_eq!(&bytes[..2], b"PK");
    }

    #[test]
    fn export_txt_raw_copies_bytes() {
        let dir = tempdir().unwrap();
        let src = write_sample(dir.path());
        let out = dir.path().join("doc.txt");
        export_txt(&src, &out, true).unwrap();
        assert_eq!(fs::read(&out).unwrap(), fs::read(&src).unwrap());
    }

    #[test]
    fn export_txt_plain_strips_markdown() {
        if !pandoc_available() {
            eprintln!("SKIP: pandoc not installed");
            return;
        }
        let dir = tempdir().unwrap();
        let src = write_sample(dir.path());
        let out = dir.path().join("doc.txt");
        export_txt(&src, &out, false).unwrap();
        let text = fs::read_to_string(&out).unwrap();
        assert!(!text.is_empty());
        assert!(!text.contains('#'));
    }

    #[test]
    fn export_refuses_same_path() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("notes.txt");
        fs::write(&src, b"hello").unwrap();
        let err = export_txt(&src, &src, true).unwrap_err();
        assert_eq!(err.kind, "same_path");
    }

    #[test]
    fn export_refuses_wrong_extension() {
        let dir = tempdir().unwrap();
        let src = write_sample(dir.path());
        let out = dir.path().join("result.md");
        let err = export_docx(&src, &out).unwrap_err();
        assert_eq!(err.kind, "convert_failed");
    }

    // --- export assets (plan 11 task 11.5, issue #104) -----------------------

    #[test]
    fn export_asset_writes_bytes_and_returns_path() {
        let dir = tempdir().unwrap();
        let target_dir = dir.path().join("exports");

        let path = write_export_asset(&target_dir, "diagram-1.png", b"png-bytes").unwrap();
        assert_eq!(path, target_dir.join("diagram-1.png"));
        assert_eq!(fs::read(&path).unwrap(), b"png-bytes");
    }

    #[test]
    fn export_asset_collision_appends_counter() {
        let dir = tempdir().unwrap();

        let a = write_export_asset(dir.path(), "diagram.png", b"first").unwrap();
        let b = write_export_asset(dir.path(), "diagram.png", b"second").unwrap();
        assert_eq!(a, dir.path().join("diagram.png"));
        assert_eq!(b, dir.path().join("diagram-1.png"));
        // The stale first file is untouched; the new bytes land in -1.
        assert_eq!(fs::read(&a).unwrap(), b"first");
        assert_eq!(fs::read(&b).unwrap(), b"second");
    }

    #[test]
    fn export_asset_hidden_temp_markdown_allowed() {
        let dir = tempdir().unwrap();

        let path = write_export_asset(dir.path(), ".quillmd-export.md", b"markdown").unwrap();
        assert_eq!(path, dir.path().join(".quillmd-export.md"));
        assert_eq!(fs::read(&path).unwrap(), b"markdown");
    }

    #[test]
    fn export_asset_rejects_unsafe_names() {
        let dir = tempdir().unwrap();
        for name in [
            "",
            ".",
            "..",
            "a/b.png",
            "a\\b.png",
            "CON.png",
            "con",
            "photo.",
            "photo ",
        ] {
            let err = write_export_asset(dir.path(), name, b"x")
                .err()
                .unwrap_or_else(|| panic!("{name:?} must be rejected"));
            let msg = err.to_string();
            assert!(msg.contains("unsafe file name"), "{name:?}: {msg}");
        }
        // Nothing was written for any of them.
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn export_asset_rejects_relative_or_empty_dir() {
        let res = write_export_asset(Path::new("relative"), "a.png", b"x");
        assert!(res.is_err(), "relative dir must be rejected");
        let msg = res.unwrap_err().to_string();
        assert!(msg.contains("absolute path"), "got {msg}");

        let res = write_export_asset(Path::new(""), "a.png", b"x");
        assert!(res.is_err(), "empty dir must be rejected");
    }

    #[test]
    fn export_asset_creates_missing_dir() {
        let dir = tempdir().unwrap();
        let target_dir = dir.path().join("deep").join("nested");
        assert!(!target_dir.exists());

        let path = write_export_asset(&target_dir, "diagram-2.png", b"y").unwrap();
        assert!(path.is_file());
        assert_eq!(fs::read(&path).unwrap(), b"y");
    }

    #[test]
    fn export_asset_removal_cleans_only_valid_files() {
        let dir = tempdir().unwrap();
        let png = write_export_asset(dir.path(), "diagram-1.png", b"x").unwrap();
        let md = write_export_asset(dir.path(), ".quillmd-export.md", b"y").unwrap();
        let stale = dir.path().join("keep.md");
        fs::write(&stale, b"not an export asset").unwrap();
        fs::create_dir(dir.path().join("subdir")).unwrap();

        let removed = remove_export_assets(&[
            png.clone(),
            md.clone(),
            dir.path().join("missing.png"),
            dir.path().join("subdir"),
            PathBuf::from("relative.png"),
        ]);
        assert_eq!(removed, vec![png.clone(), md.clone()]);
        assert!(!png.exists());
        assert!(!md.exists());
        // The unrelated file and the directory survive.
        assert!(stale.exists());
        assert!(dir.path().join("subdir").is_dir());
    }

    #[test]
    fn import_docx_produces_valid_markdown() {
        if !pandoc_available() {
            eprintln!("SKIP: pandoc not installed");
            return;
        }
        let dir = tempdir().unwrap();
        let src = write_sample(dir.path());
        let docx = dir.path().join("src.docx");
        let ok = tool_command("pandoc")
            .arg(&src)
            .arg("-o")
            .arg(&docx)
            .status()
            .unwrap();
        assert!(ok.success());

        let out = dir.path().join("imported.md");
        import_docx(&docx, &out).unwrap();
        let text = fs::read_to_string(&out).unwrap();
        assert!(text.contains("Hello"));
    }
}
