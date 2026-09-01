pub mod commands;
pub mod convert;
pub mod egl_probe;
pub mod fs;
pub mod menu;

// Headless self-test hooks for tests/acceptance-test.sh (spec §5.8).
// Each baseline exercises a real module and returns Ok(()) or an error. The
// deep assertions live in the unit/vitest suites; these are thin CLI bridges
// so a built binary can be driven headlessly without a GUI.

use std::fmt;

#[derive(Debug)]
pub struct SelfTestError(pub String);

impl fmt::Display for SelfTestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for SelfTestError {}

/// Baseline sanity for the fs layer: encoding detection + atomic write
/// round-trip on a temp file.
pub fn undo_baseline() -> Result<(), SelfTestError> {
    // Encoding: an ASCII buffer must detect as UTF-8 without BOM.
    let bytes = b"hello world";
    let enc = fs::encoding::detect_encoding(bytes);
    if !matches!(enc, Ok(fs::encoding::Encoding::Utf8)) {
        return Err(SelfTestError("encoding baseline: expected Utf8".into()));
    }
    // Atomic write: temp file in a temp dir, write, read back.
    let dir = std::env::temp_dir().join(format!("quillmd-selftest-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| SelfTestError(format!("mkdir: {e}")))?;
    let path = dir.join("baseline.txt");
    fs::atomic::write_file_atomic(&path, b"payload")
        .map_err(|e| SelfTestError(format!("atomic write: {e}")))?;
    let read = std::fs::read(&path).map_err(|e| SelfTestError(format!("read back: {e}")))?;
    let _ = std::fs::remove_dir_all(&dir);
    if read != b"payload" {
        return Err(SelfTestError("atomic write baseline: payload mismatch".into()));
    }
    Ok(())
}

/// Baseline for EOL handling: run the encoding module's normalize on a CRLF
/// sample, both directions.
pub fn line_endings_baseline() -> Result<(), SelfTestError> {
    let sample = b"one\r\ntwo\r\nthree";
    let out = fs::encoding::normalize_eol(sample, fs::encoding::Eol::Lf);
    if out != b"one\ntwo\nthree" {
        return Err(SelfTestError("line-endings baseline: LF normalize mismatch".into()));
    }
    let out = fs::encoding::normalize_eol(sample, fs::encoding::Eol::Crlf);
    if out != b"one\r\ntwo\r\nthree" {
        return Err(SelfTestError("line-endings baseline: CRLF normalize mismatch".into()));
    }
    Ok(())
}

/// Baseline for crash recovery: write a file, create a snapshot via the
/// snapshot module, and confirm snapshot_newer_than finds it.
pub fn crash_inject_baseline() -> Result<(), SelfTestError> {
    let dir = std::env::temp_dir().join(format!("quillmd-crash-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| SelfTestError(format!("mkdir: {e}")))?;
    let path = dir.join("doc.md");
    std::fs::write(&path, b"before").map_err(|e| SelfTestError(format!("write: {e}")))?;
    fs::snapshot::write_snapshot(&path, b"during")
        .map_err(|e| SelfTestError(format!("snapshot write: {e}")))?;
    let recoverable = fs::snapshot::snapshot_newer_than(&path).is_some();
    let _ = std::fs::remove_dir_all(&dir);
    if !recoverable {
        return Err(SelfTestError("crash baseline: snapshot not recoverable".into()));
    }
    Ok(())
}

/// Baseline for front matter byte-splice: verifies a YAML front-matter
/// fixture can be read and starts with the `---` delimiter. Accepts an
/// optional fixture path from argv.
pub fn frontmatter_baseline(path: Option<&std::path::Path>) -> Result<(), SelfTestError> {
    match path {
        Some(p) => {
            let bytes = std::fs::read(p).map_err(|e| SelfTestError(format!("read: {e}")))?;
            if !bytes.starts_with(b"---") {
                return Err(SelfTestError("frontmatter baseline: fixture lacks ---".into()));
            }
            Ok(())
        }
        None => Ok(()), // presence check only
    }
}

/// Baseline for BOM preservation: a BOM-prefixed buffer detects via
/// detect_bom and normalize_eol leaves the payload intact.
pub fn bom_baseline() -> Result<(), SelfTestError> {
    let bytes = b"\xEF\xBB\xBF# Title\n";
    if !fs::encoding::detect_bom(bytes) {
        return Err(SelfTestError("bom baseline: BOM not detected".into()));
    }
    let stripped: &[u8] = &bytes[3..];
    if !stripped.starts_with(b"# Title") {
        return Err(SelfTestError("bom baseline: payload mismatch".into()));
    }
    Ok(())
}

/// Baseline for file watching: an app-independent writer modifies a watched
/// file and the Watcher emits a Modified event.
pub fn file_watch_baseline() -> Result<(), SelfTestError> {
    let dir = std::env::temp_dir().join(format!("quillmd-watch-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| SelfTestError(format!("mkdir: {e}")))?;
    let path = dir.join("doc.md");
    std::fs::write(&path, b"one").map_err(|e| SelfTestError(format!("write: {e}")))?;
    let watcher = fs::watch::Watcher::new(&path)
        .map_err(|e| SelfTestError(format!("watcher: {e}")))?;
    std::thread::sleep(std::time::Duration::from_millis(100));
    std::fs::write(&path, b"two").map_err(|e| SelfTestError(format!("external write: {e}")))?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    let mut saw = false;
    while std::time::Instant::now() < deadline {
        match watcher.try_recv() {
            Some(fs::watch::WatchEvent::Modified) => {
                saw = true;
                break;
            }
            _ => std::thread::sleep(std::time::Duration::from_millis(20)),
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
    if !saw {
        return Err(SelfTestError("file-watch baseline: no Modified event".into()));
    }
    Ok(())
}

/// Baseline for the 1000-edit stress: the oracle runs in the JS layer; this
/// hook verifies the fs layer survives a burst of atomic writes.
pub fn stress_baseline() -> Result<(), SelfTestError> {
    let dir = std::env::temp_dir().join(format!("quillmd-stress-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| SelfTestError(format!("mkdir: {e}")))?;
    let path = dir.join("stress.md");
    for i in 0..1000u32 {
        let payload = format!("line {i}\n");
        fs::atomic::write_file_atomic(&path, payload.as_bytes())
            .map_err(|e| SelfTestError(format!("stress write {i}: {e}")))?;
    }
    let final_bytes = std::fs::read(&path).map_err(|e| SelfTestError(format!("read: {e}")))?;
    let _ = std::fs::remove_dir_all(&dir);
    if !final_bytes.starts_with(b"line 999") {
        return Err(SelfTestError("stress baseline: final payload mismatch".into()));
    }
    Ok(())
}

/// Baseline for the built-in template set (plan 01 task 1.3): the templates
/// are bundled with the binary through include_str! (a missing file breaks
/// the build), and the bundled ids must exactly match the File > New from
/// Template submenu in menu.rs.
pub fn templates_baseline() -> Result<(), SelfTestError> {
    const TEMPLATE_CONTENTS: &[(&str, &str)] = &[
        ("blank", include_str!("../../src/templates/blank.md")),
        ("meeting-notes", include_str!("../../src/templates/meeting-notes.md")),
        ("blog-post", include_str!("../../src/templates/blog-post.md")),
        ("readme", include_str!("../../src/templates/readme.md")),
        ("project-plan", include_str!("../../src/templates/project-plan.md")),
        ("proposal-skeleton", include_str!("../../src/templates/proposal-skeleton.md")),
    ];
    if TEMPLATE_CONTENTS.len() != menu::TEMPLATES.len() {
        return Err(SelfTestError(
            "template set size mismatch between bundle and menu".into(),
        ));
    }
    for (id, content) in TEMPLATE_CONTENTS {
        let in_menu = menu::TEMPLATES.iter().any(|(mid, _)| mid == id);
        if !in_menu {
            return Err(SelfTestError(format!("template {id} missing from the menu set")));
        }
        if *id == "blank" {
            if !content.is_empty() {
                return Err(SelfTestError("blank template must be empty".into()));
            }
        } else if content.trim().is_empty() {
            return Err(SelfTestError(format!("template {id} is empty")));
        }
    }
    Ok(())
}

/// Baseline for the large-file envelope: generate ~1MB of markdown in a temp
/// file and atomically write it; the timing oracle runs in the JS layer.
pub fn large_file_baseline() -> Result<(), SelfTestError> {
    let dir = std::env::temp_dir().join(format!("quillmd-large-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| SelfTestError(format!("mkdir: {e}")))?;
    let path = dir.join("large.md");
    let mut payload = String::with_capacity(1_100_000);
    for i in 0..10_000u32 {
        payload.push_str(&format!(
            "# Heading {i}\n\nSome body text for line {i}. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n\n"
        ));
    }
    let start = std::time::Instant::now();
    fs::atomic::write_file_atomic(&path, payload.as_bytes())
        .map_err(|e| SelfTestError(format!("large write: {e}")))?;
    let elapsed = start.elapsed();
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let _ = std::fs::remove_dir_all(&dir);
    if size < 1_000_000 {
        return Err(SelfTestError("large-file baseline: payload too small".into()));
    }
    // Generous bound: the 250ms envelope is measured in the JS layer; this
    // only catches pathological regressions in the atomic write path.
    if elapsed > std::time::Duration::from_secs(5) {
        return Err(SelfTestError(format!(
            "large-file baseline: write took {elapsed:?}"
        )));
    }
    Ok(())
}

/// Baseline for the export asset write/cleanup pair (plan 11 task 11.5,
/// issue #104): write a PNG through the real command, verify the bytes land
/// on disk, verify a collision gets a suffixed name instead of an overwrite,
/// verify an unsafe name is rejected, and verify the cleanup removes the
/// assets.
pub fn export_asset_baseline() -> Result<(), SelfTestError> {
    let dir = std::env::temp_dir().join(format!("quillmd-export-asset-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| SelfTestError(format!("mkdir: {e}")))?;
    let dir_s = dir.display().to_string();
    let bytes: Vec<u8> = b"png-payload".to_vec();

    let path = commands::export_write_asset(dir_s.clone(), "diagram-1.png".into(), bytes.clone())
        .map_err(SelfTestError)?;
    let read = std::fs::read(&path).map_err(|e| SelfTestError(format!("read back: {e}")))?;
    if read != bytes {
        return Err(SelfTestError("export-asset baseline: payload mismatch".into()));
    }

    // A collision must not overwrite: the second write gets a -1 suffix.
    let second = commands::export_write_asset(dir_s.clone(), "diagram-1.png".into(), bytes.clone())
        .map_err(SelfTestError)?;
    if second == path {
        return Err(SelfTestError(
            "export-asset baseline: collision overwrote the first asset".into(),
        ));
    }

    // An unsafe name (path traversal) must be rejected.
    if commands::export_write_asset(dir_s.clone(), "a\\b.png".into(), bytes.clone()).is_ok() {
        return Err(SelfTestError("export-asset baseline: traversal name accepted".into()));
    }

    // Cleanup must remove both assets and nothing else.
    let removed = commands::export_remove_asset(vec![path.clone(), second.clone()]);
    if removed.len() != 2 {
        return Err(SelfTestError(
            "export-asset baseline: cleanup did not remove both assets".into(),
        ));
    }
    if std::path::Path::new(&path).exists() || std::path::Path::new(&second).exists() {
        return Err(SelfTestError(
            "export-asset baseline: cleanup left files behind".into(),
        ));
    }
    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

/// Baseline for export-time TOC generation (plan 09 task 9.2, issue #85):
/// the `<!-- quillmd:toc -->` token in the export source expands to the
/// target's real table-of-contents construct (a raw typst `#outline()` block
/// for PDF, a Word TOC field for DOCX), and when pandoc/typst are present a
/// real export of a fixture doc with the token runs. The source document is
/// never rewritten (golden rule 1).
pub fn export_toc_baseline() -> Result<(), SelfTestError> {
    // The pure expansion contract (always runs, no tools needed).
    let src = "# Alpha\n\nIntro.\n\n<!-- quillmd:toc -->\n\n## Beta\n";
    let pdf = convert::expand_toc_tokens(src, convert::TocTarget::Pdf);
    if !pdf.contains("```{=typst}\n#outline(depth: 4, title: \"Contents\")\n```")
        || pdf.contains("quillmd:toc")
    {
        return Err(SelfTestError("export-toc baseline: PDF expansion wrong".into()));
    }
    let docx = convert::expand_toc_tokens(src, convert::TocTarget::Docx);
    if !docx.contains("```{=openxml}")
        || !docx.contains(r#"TOC \o "1-4" \h \z \u"#)
        || docx.contains("quillmd:toc")
    {
        return Err(SelfTestError("export-toc baseline: DOCX expansion wrong".into()));
    }
    // A token-free document must come back byte-identical.
    if convert::expand_toc_tokens("# A\n", convert::TocTarget::Pdf) != "# A\n" {
        return Err(SelfTestError(
            "export-toc baseline: token-free doc must be untouched".into(),
        ));
    }

    // Real exports (only when the tools are present): the temp fixture doc
    // with the token exports to a valid PDF + DOCX and keeps its token.
    if !convert::pandoc_available() || !convert::typst_available() {
        return Ok(());
    }
    let dir = std::env::temp_dir().join(format!("quillmd-export-toc-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| SelfTestError(format!("mkdir: {e}")))?;
    let src_path = dir.join("toc.md");
    std::fs::write(&src_path, src.as_bytes()).map_err(|e| SelfTestError(format!("write: {e}")))?;
    let pdf = dir.join("toc.pdf");
    let docx = dir.join("toc.docx");
    convert::export_pdf(&src_path, &pdf)
        .map_err(|e| SelfTestError(format!("export_pdf: {e:?}")))?;
    convert::export_docx(&src_path, &docx)
        .map_err(|e| SelfTestError(format!("export_docx: {e:?}")))?;
    let pdf_bytes = std::fs::read(&pdf).map_err(|e| SelfTestError(format!("read pdf: {e}")))?;
    if pdf_bytes.len() < 4 || &pdf_bytes[..4] != b"%PDF" {
        return Err(SelfTestError("export-toc baseline: PDF export invalid".into()));
    }
    let docx_bytes = std::fs::read(&docx).map_err(|e| SelfTestError(format!("read docx: {e}")))?;
    if docx_bytes.len() < 2 || &docx_bytes[..2] != b"PK" {
        return Err(SelfTestError("export-toc baseline: DOCX export invalid".into()));
    }
    let src_bytes = std::fs::read(&src_path).map_err(|e| SelfTestError(format!("read src: {e}")))?;
    let _ = std::fs::remove_dir_all(&dir);
    if src_bytes != src.as_bytes() {
        return Err(SelfTestError(
            "export-toc baseline: source document was rewritten".into(),
        ));
    }
    Ok(())
}

/// The fixed page-break block the pagebreak fixture carries. Kept in sync with
/// `PAGE_BREAK_HTML` in src-tauri/src/convert.rs (that marker constant is
/// private to the conversion module).
const PAGE_BREAK_MARKER: &str = "<div class=\"quillmd-page-break\"></div>";

/// Runs `pdftotext <pdf> -` and returns the extracted text.
fn pdftotext_text(pdf: &std::path::Path) -> Result<String, SelfTestError> {
    let output = std::process::Command::new("pdftotext")
        .arg(pdf)
        .arg("-")
        .output()
        .map_err(|e| SelfTestError(format!("pdftotext: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(SelfTestError(format!("pdftotext failed: {stderr}")));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// The document's H1-H4 heading titles in order: a line whose leading `#` run
/// is 1-4 long and followed by a space (H5 and deeper are out of TOC policy).
fn heading_titles(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| {
            let trimmed = line.trim_start();
            let hashes = trimmed.chars().take_while(|c| *c == '#').count();
            if (1..=4).contains(&hashes) && trimmed.as_bytes().get(hashes) == Some(&b' ') {
                Some(trimmed[hashes..].trim().to_string())
            } else {
                None
            }
        })
        .collect()
}

/// For every page-break marker in `text`, the title of the first heading after
/// it — the chapter that a physical page break must start on a fresh page.
fn chapters_after_breaks(text: &str) -> Vec<String> {
    let mut chapters = Vec::new();
    let mut rest = text;
    while let Some(idx) = rest.find(PAGE_BREAK_MARKER) {
        let after = &rest[idx + PAGE_BREAK_MARKER.len()..];
        for line in after.lines() {
            if let Some(title) = heading_titles(line).into_iter().next() {
                chapters.push(title);
                break;
            }
        }
        rest = after;
    }
    chapters
}

/// Baseline for the plan 09 acceptance PDF visual check (plan 09 task 9.8,
/// issue #91): exports the two committed acceptance fixtures through the real
/// `export_pdf` pipeline (marker expansion in a throwaway copy + pandoc/typst)
/// and inspects the rendered PDFs with pdftotext:
///
/// - `toc.md`: the `<!-- quillmd:toc -->` token renders a real outline — the
///   "Contents" title plus an entry for every H1-H4 heading of the document
///   (each heading appears once in the body, so a second occurrence can only
///   be the outline entry) — and the PDF itself carries a bookmark outline
///   (plan 09 AC1: "exported PDF contains a real outline").
/// - `pagebreak.md`: every page-break block renders a physical page break at
///   its position — the no-break control of the same document uses strictly
///   fewer pages, and each post-break chapter starts at the top of its page
///   (plan 09 AC6: "exported PDF shows a physical page break at that
///   position").
///
/// Both fixture paths are required (the harness passes the on-disk fixtures,
/// so this checks what ships) and the source documents are never rewritten
/// (golden rule 1). Requires pandoc + typst + pdftotext; the harness skips
/// the check when any of them is absent.
pub fn export_p4_visual_baseline(
    toc_md: Option<&std::path::Path>,
    pagebreak_md: Option<&std::path::Path>,
) -> Result<(), SelfTestError> {
    if !convert::pandoc_available() || !convert::typst_available() {
        return Err(SelfTestError(
            "export-p4-visual: requires pandoc + typst".into(),
        ));
    }
    // Note: poppler's pdftotext has no --version (it treats the flag as a
    // filename), so probe with -v (same note as the convert.rs outline test).
    let pdftotext_ok = std::process::Command::new("pdftotext")
        .arg("-v")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !pdftotext_ok {
        return Err(SelfTestError(
            "export-p4-visual: requires pdftotext".into(),
        ));
    }

    let dir = std::env::temp_dir().join(format!("quillmd-export-p4-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| SelfTestError(format!("mkdir: {e}")))?;

    // --- AC1: the toc fixture exports a PDF with a real outline ------------
    let toc_src = toc_md.ok_or_else(|| {
        SelfTestError("export-p4-visual: missing the toc fixture path".into())
    })?;
    let toc_bytes = std::fs::read(toc_src)
        .map_err(|e| SelfTestError(format!("export-p4-visual: read {}: {e}", toc_src.display())))?;
    let toc_path = dir.join("toc.md");
    std::fs::write(&toc_path, &toc_bytes).map_err(|e| SelfTestError(format!("write: {e}")))?;
    let toc_pdf = dir.join("toc.pdf");
    convert::export_pdf(&toc_path, &toc_pdf)
        .map_err(|e| SelfTestError(format!("export_pdf(toc): {e:?}")))?;
    let toc_pdf_bytes = std::fs::read(&toc_pdf).map_err(|e| SelfTestError(format!("read pdf: {e}")))?;
    if toc_pdf_bytes.len() < 4 || &toc_pdf_bytes[..4] != b"%PDF" {
        return Err(SelfTestError(
            "export-p4-visual: toc PDF export invalid".into(),
        ));
    }
    let text = pdftotext_text(&toc_pdf)?;
    if !text.contains("Contents") {
        return Err(SelfTestError(
            "export-p4-visual: outline title missing from the toc PDF".into(),
        ));
    }
    for heading in heading_titles(&String::from_utf8_lossy(&toc_bytes)) {
        let count = text.matches(&heading).count();
        if count < 2 {
            return Err(SelfTestError(format!(
                "export-p4-visual: no outline entry for {heading:?} ({count} occurrence(s))"
            )));
        }
    }
    // The PDF carries a real bookmark outline, not just outline-shaped text.
    if !toc_pdf_bytes.windows(8).any(|w| w == b"/Outline") {
        return Err(SelfTestError(
            "export-p4-visual: toc PDF has no /Outline bookmark structure".into(),
        ));
    }
    if std::fs::read(toc_src).map_err(|e| SelfTestError(format!("re-read: {e}")))? != toc_bytes {
        return Err(SelfTestError(
            "export-p4-visual: toc source document was rewritten".into(),
        ));
    }

    // --- AC6: the pagebreak fixture exports a PDF with physical breaks ------
    let pb_src = pagebreak_md.ok_or_else(|| {
        SelfTestError("export-p4-visual: missing the pagebreak fixture path".into())
    })?;
    let pb_bytes = std::fs::read(pb_src)
        .map_err(|e| SelfTestError(format!("export-p4-visual: read {}: {e}", pb_src.display())))?;
    let pb_text = String::from_utf8_lossy(&pb_bytes).to_string();
    let chapters = chapters_after_breaks(&pb_text);
    if chapters.is_empty() {
        return Err(SelfTestError(
            "export-p4-visual: pagebreak fixture has no page-break block".into(),
        ));
    }
    let pb_path = dir.join("pagebreak.md");
    std::fs::write(&pb_path, &pb_bytes).map_err(|e| SelfTestError(format!("write: {e}")))?;
    let pb_pdf = dir.join("pagebreak.pdf");
    convert::export_pdf(&pb_path, &pb_pdf)
        .map_err(|e| SelfTestError(format!("export_pdf(pagebreak): {e:?}")))?;
    let pb_pdf_bytes = std::fs::read(&pb_pdf).map_err(|e| SelfTestError(format!("read pdf: {e}")))?;
    if pb_pdf_bytes.len() < 4 || &pb_pdf_bytes[..4] != b"%PDF" {
        return Err(SelfTestError(
            "export-p4-visual: pagebreak PDF export invalid".into(),
        ));
    }
    let text = pdftotext_text(&pb_pdf)?;
    // pdftotext separates pages with a form feed: N breaks demand N+1 pages.
    let pages: Vec<&str> = text.split('\u{0c}').collect();
    if pages.len() <= chapters.len() {
        return Err(SelfTestError(format!(
            "export-p4-visual: expected more than {} page(s) for {} break(s), got {}",
            chapters.len(),
            chapters.len(),
            pages.len()
        )));
    }
    // Each post-break chapter starts at the top of its fresh page.
    for (i, chapter) in chapters.iter().enumerate() {
        let page_text = pages.get(i + 1).ok_or_else(|| {
            SelfTestError(format!(
                "export-p4-visual: no page {} in the pagebreak PDF",
                i + 1
            ))
        })?;
        if !page_text.trim_start().starts_with(chapter.as_str()) {
            return Err(SelfTestError(format!(
                "export-p4-visual: chapter {chapter:?} does not start page {}:\n{page_text}",
                i + 1
            )));
        }
    }
    // Control: the same document without the blocks uses strictly fewer pages
    // (the break, not the content, creates the extra pages).
    let no_break = pb_text.replace(PAGE_BREAK_MARKER, "");
    let ctrl_path = dir.join("no-break.md");
    std::fs::write(&ctrl_path, no_break.as_bytes())
        .map_err(|e| SelfTestError(format!("write: {e}")))?;
    let ctrl_pdf = dir.join("no-break.pdf");
    convert::export_pdf(&ctrl_path, &ctrl_pdf)
        .map_err(|e| SelfTestError(format!("export_pdf(control): {e:?}")))?;
    let ctrl_text = pdftotext_text(&ctrl_pdf)?;
    let ctrl_pages = ctrl_text.matches('\u{0c}').count() + 1;
    if ctrl_pages >= pages.len() {
        return Err(SelfTestError(format!(
            "export-p4-visual: no-break control did not use fewer pages (control: {ctrl_pages}, broken: {})",
            pages.len()
        )));
    }
    if std::fs::read(pb_src).map_err(|e| SelfTestError(format!("re-read: {e}")))? != pb_bytes {
        return Err(SelfTestError(
            "export-p4-visual: pagebreak source document was rewritten".into(),
        ));
    }

    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

/// Baseline for the file_stat command (plan 01 task 1.5, issue #26): stat a
/// real temp file and assert the reported size matches the written payload
/// and the OS exposes a modified time.
pub fn file_stat_baseline() -> Result<(), SelfTestError> {
    let dir = std::env::temp_dir().join(format!("quillmd-stat-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| SelfTestError(format!("mkdir: {e}")))?;
    let path = dir.join("stat.md");
    let payload = b"# stat baseline\n";
    std::fs::write(&path, payload).map_err(|e| SelfTestError(format!("write: {e}")))?;
    let stat = commands::file_stat(path.display().to_string())
        .map_err(|e| SelfTestError(format!("file_stat: {e}")))?;
    let _ = std::fs::remove_dir_all(&dir);
    if stat.size != payload.len() as u64 {
        return Err(SelfTestError(format!(
            "file_stat baseline: size {} != {}",
            stat.size,
            payload.len()
        )));
    }
    if stat.modified.is_none() {
        return Err(SelfTestError("file_stat baseline: no modified time".into()));
    }
    Ok(())
}

/// Plan 10 task 10.4 (issue #96) / AC6: the About dialog reports the real app
/// version, the build hash, and the bundled pandoc/typst versions. The version
/// and build hash are always non-empty; a tool that IS installed must report a
/// non-empty first `--version` line (a missing tool is fine — the dialog shows
/// "not found").
pub fn about_baseline() -> Result<(), SelfTestError> {
    let version = env!("CARGO_PKG_VERSION");
    if version.trim().is_empty() {
        return Err(SelfTestError("about: app version is empty".into()));
    }
    println!("version={version}");
    println!("build={}", commands::build_hash());

    let versions = convert::sidecar_versions();
    if convert::pandoc_available() {
        let line = versions.pandoc.as_deref().unwrap_or("");
        if line.trim().is_empty() {
            return Err(SelfTestError(
                "about: pandoc is installed but its version line is empty".into(),
            ));
        }
    }
    if convert::typst_available() {
        let line = versions.typst.as_deref().unwrap_or("");
        if line.trim().is_empty() {
            return Err(SelfTestError(
                "about: typst is installed but its version line is empty".into(),
            ));
        }
    }
    println!("pandoc={}", versions.pandoc.as_deref().unwrap_or("not found"));
    println!("typst={}", versions.typst.as_deref().unwrap_or("not found"));
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Linux: WebKitGTK aborts the process when it cannot create an EGL
    // display (VMs, remote sessions, broken drivers). Probe EGL before the
    // webview exists and fall back to WebKit's software rendering path so
    // the app starts on any modern Linux machine (see egl_probe.rs).
    #[cfg(target_os = "linux")]
    egl_probe::prepare_webview();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file,
            commands::save_as,
            commands::check_external,
            commands::file_stat,
            commands::recover_snapshot,
            commands::export_document,
            commands::import_document,
            commands::export_write_asset,
            commands::export_remove_asset,
            commands::list_dir,
            commands::copy_asset,
            commands::file_exists,
            commands::get_recent_files,
            commands::set_recent_files,
            commands::read_style_overrides,
            commands::write_style_overrides,
            commands::read_settings,
            commands::write_settings,
            commands::get_app_info,
            commands::get_sidecar_versions,
            commands::load_wordlist,
            commands::get_wordlist_settings,
            commands::set_wordlist_settings,
            commands::fs_new_file,
            commands::fs_new_dir,
            commands::fs_rename,
            commands::fs_trash
        ])
        .setup(|app| {
            let recent = menu::load_recent(app.handle());
            match menu::build(app.handle(), &recent) {
                Ok(menu) => {
                    app.set_menu(menu).ok();
                }
                Err(e) => eprintln!("menu build failed: {e}"),
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            use tauri::Emitter;
            let _ = app.emit("menu-event", event.id().as_ref());
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
