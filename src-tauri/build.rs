fn main() {
    tauri_build::build();

    // Embed the git HEAD SHA so the About dialog (plan 10 §2.5) can show
    // which build is running. Outside a git checkout (release archives) this
    // is skipped and the frontend falls back to "unknown" — a build must
    // never fail because git is missing.
    let Ok(output) = std::process::Command::new("git").args(["rev-parse", "HEAD"]).output() else {
        return;
    };
    if !output.status.success() {
        return;
    }
    let sha = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !sha.is_empty() {
        println!("cargo:rustc-env=QUILLMD_BUILD_HASH={sha}");
    }
}
