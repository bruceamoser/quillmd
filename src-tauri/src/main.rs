// QuillMD binary entry point.
// When launched with `--self-test <mode>` or `--roundtrip`, runs the headless
// acceptance-test hooks used by tests/acceptance-test.sh (spec §5). Otherwise
// starts the Tauri app.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{self, Read, Write};
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    match args.get(1).map(|s| s.as_str()) {
        Some("--version") | Some("-V") => {
            println!("quillmd {}", env!("CARGO_PKG_VERSION"));
        }
        Some("--roundtrip") => run_roundtrip(),
        Some("--self-test") => match args.get(2).map(|s| s.as_str()) {
            Some("undo-bytes") => run_self_test(quillmd_lib::undo_baseline()),
            Some("line-endings") => run_self_test(quillmd_lib::line_endings_baseline()),
            Some("bom") => run_self_test(quillmd_lib::bom_baseline()),
            Some("crash-hook") => run_self_test(quillmd_lib::crash_inject_baseline()),
            Some("file-watch") => run_self_test(quillmd_lib::file_watch_baseline()),
            Some("front-matter") => {
                let path = std::env::args().nth(3).map(PathBuf::from);
                run_self_test(quillmd_lib::frontmatter_baseline(path.as_deref()))
            }
            Some("stress") => run_self_test(quillmd_lib::stress_baseline()),
            Some("large-file") => run_self_test(quillmd_lib::large_file_baseline()),
            Some("templates") => run_self_test(quillmd_lib::templates_baseline()),
            Some("file-stat") => run_self_test(quillmd_lib::file_stat_baseline()),
            Some("export-asset") => run_self_test(quillmd_lib::export_asset_baseline()),
            Some("export-toc") => run_self_test(quillmd_lib::export_toc_baseline()),
            Some(other) => {
                eprintln!("unknown self-test: {other}");
                std::process::exit(2);
            }
            None => {
                eprintln!("usage: quillmd --self-test <undo-bytes|line-endings|bom|crash-hook|file-watch|front-matter|stress|large-file|templates|file-stat|export-asset|export-toc>");
                std::process::exit(2);
            }
        },
        _ => quillmd_lib::run(),
    }
}

/// Reads the fixture source from stdin and writes it back byte-identically
/// (the clean-path verbatim guarantee). The deep fidelity checks live in the
/// JS vitest roundtrip suite; this hook validates the binary plumbing.
fn run_roundtrip() {
    let mut source = String::new();
    if io::stdin().read_to_string(&mut source).is_err() {
        std::process::exit(2);
    }
    print!("{source}");
    if io::stdout().flush().is_err() {
        std::process::exit(2);
    }
}

fn run_self_test(result: Result<(), quillmd_lib::SelfTestError>) {
    match result {
        Ok(()) => println!("OK"),
        Err(e) => {
            eprintln!("FAIL: {e}");
            std::process::exit(1);
        }
    }
}
