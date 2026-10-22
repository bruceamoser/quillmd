// GitHub release updates.
//
// QuillMD is distributed through GitHub Releases (see
// .github/workflows/release.yml). This module is the whole update path:
//
//   1. `check_now` asks the GitHub API for the newest published release,
//      compares its tag with CARGO_PKG_VERSION, and picks the asset that fits
//      this platform (AppImage/deb/rpm on Linux, NSIS setup/MSI on Windows).
//   2. `install_now` streams that asset into the app cache dir (emitting
//      progress events), verifies it against the release's SHA256SUMS asset,
//      and applies it: an AppImage is replaced in place, a Windows installer
//      is queued for the restart step, and a distro package is handed to the
//      system package installer.
//   3. `restart_now` relaunches the new AppImage / runs the queued Windows
//      installer and exits, so the update finishes on restart.
//
// Nothing is installed silently: the UI only calls `install_now` after the
// user picks "Download & Install". Downloads always come from the release's
// own `github.com/.../releases/download/...` URLs over HTTPS, and every byte
// is checked against the checksum file published in that same release before
// anything is executed or moved into place.

use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Emitter;
use tauri::Manager;

/// The GitHub repository releases are published to.
pub const REPO: &str = "bruceamoser/quillmd";
const LATEST_RELEASE_API: &str = "https://api.github.com/repos/bruceamoser/quillmd/releases/latest";
/// The human-facing releases page (fallback for platforms with no package).
pub const RELEASES_URL: &str = "https://github.com/bruceamoser/quillmd/releases";

const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// How much download progress accumulates between two progress events.
const PROGRESS_STEP_BYTES: u64 = 256 * 1024;
/// The Tauri event the download reports progress on.
pub const PROGRESS_EVENT: &str = "update-progress";

// --- versions ---------------------------------------------------------------

/// A `major.minor.patch` version (the release tags and CARGO_PKG_VERSION are
/// plain three-part versions; a leading `v` and a pre-release/build suffix are
/// tolerated and ignored).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
}

fn numeric(part: Option<&str>) -> Option<u64> {
    let part = part?;
    if part.is_empty() || !part.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    part.parse().ok()
}

/// Parses a release tag (`v0.2.5`, `0.2.5`, `v1.0.0-rc.1`) into a comparable
/// version. A tag that is not numeric (the workflow's `draft-<date>` fallback)
/// yields None and is never treated as an update.
pub fn parse_version(raw: &str) -> Option<Version> {
    let trimmed = raw.trim();
    let core = trimmed.trim_start_matches(|c: char| c == 'v' || c == 'V');
    let core = core.split(['-', '+']).next().unwrap_or(core);
    let mut parts = core.split('.');
    let major = numeric(parts.next())?;
    let minor = numeric(parts.next()).unwrap_or(0);
    let patch = numeric(parts.next()).unwrap_or(0);
    // A fourth numeric segment is not a release version we understand.
    if parts.next().is_some() {
        return None;
    }
    Some(Version {
        major,
        minor,
        patch,
    })
}

/// True when `candidate` is a strictly newer release than `current`. Tags that
/// do not parse never count as an update.
pub fn is_newer(candidate: &str, current: &str) -> bool {
    match (parse_version(candidate), parse_version(current)) {
        (Some(candidate), Some(current)) => candidate > current,
        _ => false,
    }
}

// --- release payload --------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
    #[serde(default)]
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Release {
    #[serde(default)]
    pub tag_name: String,
    #[serde(default)]
    pub html_url: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub assets: Vec<ReleaseAsset>,
}

// --- platform / asset selection ---------------------------------------------

/// How an update package is applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallMethod {
    /// A self-contained Linux AppImage: replace the file and relaunch.
    AppImage,
    /// A Windows NSIS setup executable: run it silently.
    Nsis,
    /// A Windows MSI: run it through msiexec.
    Msi,
    /// A Debian package: hand it to the system package installer.
    Deb,
    /// An RPM package: hand it to the system package installer.
    Rpm,
    /// No package for this platform.
    None,
}

/// The platform facts asset selection depends on. A struct (not environment
/// calls) so the selection rules are unit-testable.
#[derive(Debug, Clone, Copy)]
pub struct Platform {
    pub os: &'static str,
    pub arch: &'static str,
    /// True when the running binary is an AppImage (the `APPIMAGE` env var is
    /// set): only then can the update replace the app in place.
    pub appimage: bool,
}

/// The platform this build runs on.
pub fn current_platform() -> Platform {
    Platform {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        appimage: std::env::var_os("APPIMAGE").is_some(),
    }
}

/// The install method an asset name maps to (by extension).
pub fn asset_method(name: &str) -> Option<InstallMethod> {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".appimage") {
        Some(InstallMethod::AppImage)
    } else if lower.ends_with(".deb") {
        Some(InstallMethod::Deb)
    } else if lower.ends_with(".rpm") {
        Some(InstallMethod::Rpm)
    } else if lower.ends_with(".msi") {
        Some(InstallMethod::Msi)
    } else if lower.ends_with(".exe") {
        Some(InstallMethod::Nsis)
    } else {
        None
    }
}

/// True for the release's checksum file (named `SHA256SUMS-<version>.txt`).
fn is_checksum_asset(name: &str) -> bool {
    name.starts_with("SHA256SUMS")
}

/// The order in which this platform prefers package types. Linux prefers the
/// AppImage only when the app *is* an AppImage (it can replace itself); a
/// distro install gets its native package instead.
fn method_order(platform: &Platform) -> &'static [InstallMethod] {
    match platform.os {
        "linux" if platform.appimage => &[
            InstallMethod::AppImage,
            InstallMethod::Deb,
            InstallMethod::Rpm,
        ],
        "linux" => &[
            InstallMethod::Deb,
            InstallMethod::Rpm,
            InstallMethod::AppImage,
        ],
        "windows" => &[InstallMethod::Nsis, InstallMethod::Msi],
        _ => &[],
    }
}

/// Whether an asset name matches this CPU architecture. A name with no arch
/// marker at all is accepted (a single-arch release); a name marked with a
/// different architecture is rejected.
fn arch_matches(name: &str, arch: &str) -> bool {
    const MARKERS: [&str; 6] = ["x86_64", "x64", "amd64", "aarch64", "arm64", "i686"];
    let lower = name.to_ascii_lowercase();
    if !MARKERS.iter().any(|marker| lower.contains(marker)) {
        return true;
    }
    let wanted: &[&str] = match arch {
        "x86_64" => &["x86_64", "x64", "amd64"],
        "aarch64" => &["aarch64", "arm64"],
        _ => &[],
    };
    wanted.iter().any(|marker| lower.contains(marker))
}

/// The asset to install on this platform, if the release ships one.
pub fn pick_asset<'a>(assets: &'a [ReleaseAsset], platform: &Platform) -> Option<&'a ReleaseAsset> {
    for method in method_order(platform) {
        if let Some(asset) = assets.iter().find(|asset| {
            asset_method(&asset.name) == Some(*method) && arch_matches(&asset.name, platform.arch)
        }) {
            return Some(asset);
        }
    }
    None
}

// --- checksums --------------------------------------------------------------

/// Parses a `sha256sum` file into `(file name, lowercase hex digest)` pairs.
/// Both the text (`  name`) and binary (` *name`) separators are accepted;
/// malformed lines are skipped.
pub fn parse_sha256sums(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let digest = parts.next()?;
            let name = parts.next()?.trim_start_matches('*');
            if digest.len() != 64 || !digest.chars().all(|c| c.is_ascii_hexdigit()) {
                return None;
            }
            Some((name.to_string(), digest.to_ascii_lowercase()))
        })
        .collect()
}

/// The expected digest for `name`, if the checksum file lists it.
pub fn checksum_for<'a>(sums: &'a [(String, String)], name: &str) -> Option<&'a str> {
    sums.iter()
        .find(|(entry, _)| entry == name)
        .map(|(_, digest)| digest.as_str())
}

// --- check result -----------------------------------------------------------

/// What the UI shows after a check. `available` is true only for a published
/// (non-draft, non-prerelease) release whose tag is newer than this build.
#[derive(Debug, Clone, Serialize)]
pub struct UpdateCheck {
    pub current: String,
    pub latest: String,
    pub available: bool,
    pub notes: String,
    pub release_url: String,
    pub asset_name: Option<String>,
    pub asset_size: u64,
    pub method: InstallMethod,
    pub checksum_available: bool,
}

/// Pure assembly of the check result (no network) — unit-tested directly.
pub fn build_check(release: &Release, current: &str, platform: &Platform) -> UpdateCheck {
    let latest = release
        .tag_name
        .trim()
        .trim_start_matches(|c: char| c == 'v' || c == 'V')
        .to_string();
    let available = !release.draft && !release.prerelease && is_newer(&release.tag_name, current);
    let asset = pick_asset(&release.assets, platform);
    let method = asset
        .and_then(|asset| asset_method(&asset.name))
        .unwrap_or(InstallMethod::None);
    UpdateCheck {
        current: current.to_string(),
        latest,
        available,
        notes: release.body.trim().to_string(),
        release_url: if release.html_url.is_empty() {
            RELEASES_URL.to_string()
        } else {
            release.html_url.clone()
        },
        asset_name: asset.map(|asset| asset.name.clone()),
        asset_size: asset.map_or(0, |asset| asset.size),
        method,
        checksum_available: release
            .assets
            .iter()
            .any(|asset| is_checksum_asset(&asset.name)),
    }
}

/// The install result the UI reports before the optional restart.
#[derive(Debug, Clone, Serialize)]
pub struct UpdateOutcome {
    pub version: String,
    pub method: InstallMethod,
    pub path: String,
    /// True when the update finishes on restart (the restart step relaunches
    /// the new AppImage or runs the queued Windows installer).
    pub restart_required: bool,
}

/// Download progress, emitted on [`PROGRESS_EVENT`].
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdatePhase {
    Download,
    Verify,
    Install,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct UpdateProgress {
    pub phase: UpdatePhase,
    pub downloaded: u64,
    pub total: u64,
}

// --- HTTP -------------------------------------------------------------------

fn http_agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .user_agent(format!("quillmd/{}", env!("CARGO_PKG_VERSION")))
        .timeout_global(Some(timeout))
        .build()
        .new_agent()
}

/// Maps a transport error to the message the update dialog shows.
fn http_error(err: ureq::Error) -> String {
    match err {
        ureq::Error::StatusCode(404) => "no published release was found on GitHub".into(),
        ureq::Error::StatusCode(code) => format!("GitHub returned HTTP {code}"),
        other => format!("could not reach GitHub: {other}"),
    }
}

/// The newest published release, straight from the GitHub API.
pub fn fetch_latest_release() -> Result<Release, String> {
    let mut response = http_agent(CHECK_TIMEOUT)
        .get(LATEST_RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(http_error)?;
    let text = response
        .body_mut()
        .read_to_string()
        .map_err(|e| format!("could not read the GitHub response: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("unexpected GitHub response: {e}"))
}

/// Downloads the release's SHA256SUMS file and returns the digest for `asset`.
fn fetch_expected_checksum(
    agent: &ureq::Agent,
    assets: &[ReleaseAsset],
    asset: &str,
) -> Result<String, String> {
    let sums = assets
        .iter()
        .find(|candidate| is_checksum_asset(&candidate.name))
        .ok_or_else(|| {
            "This release has no SHA256SUMS file, so the download cannot be verified.".to_string()
        })?;
    let mut response = agent
        .get(&sums.browser_download_url)
        .call()
        .map_err(|e| format!("could not download the checksum file: {e}"))?;
    let text = response
        .body_mut()
        .read_to_string()
        .map_err(|e| format!("could not read the checksum file: {e}"))?;
    let parsed = parse_sha256sums(&text);
    checksum_for(&parsed, asset)
        .map(str::to_string)
        .ok_or_else(|| format!("the checksum file does not list {asset}"))
}

fn emit_progress(app: &tauri::AppHandle, phase: UpdatePhase, downloaded: u64, total: u64) {
    let _ = app.emit(
        PROGRESS_EVENT,
        UpdateProgress {
            phase,
            downloaded,
            total,
        },
    );
}

/// Streams `url` into `dest` (via a `.part` sibling) and reports progress
/// through `report(phase, downloaded, total)`. The callback keeps the network
/// code independent of Tauri so the download can be exercised in a test.
fn download_asset(
    report: &dyn Fn(UpdatePhase, u64, u64),
    agent: &ureq::Agent,
    url: &str,
    dest: &Path,
    declared_size: u64,
) -> Result<(), String> {
    let mut response = agent
        .get(url)
        .call()
        .map_err(|e| format!("download failed: {e}"))?;
    let total = response
        .body_mut()
        .content_length()
        .unwrap_or(declared_size);
    let partial = dest.with_extension("part");
    let mut file = File::create(&partial)
        .map_err(|e| format!("could not create {}: {e}", partial.display()))?;
    let mut downloaded = 0u64;
    let mut reported = 0u64;
    let mut buffer = vec![0u8; 64 * 1024];
    report(UpdatePhase::Download, 0, total);
    {
        let mut reader = response.body_mut().as_reader();
        loop {
            let read = reader
                .read(&mut buffer)
                .map_err(|e| format!("download failed: {e}"))?;
            if read == 0 {
                break;
            }
            file.write_all(&buffer[..read])
                .map_err(|e| format!("could not write {}: {e}", partial.display()))?;
            downloaded += read as u64;
            if downloaded - reported >= PROGRESS_STEP_BYTES {
                reported = downloaded;
                report(UpdatePhase::Download, downloaded, total);
            }
        }
    }
    file.flush()
        .map_err(|e| format!("could not write {}: {e}", partial.display()))?;
    drop(file);
    report(UpdatePhase::Download, downloaded, total);
    std::fs::rename(&partial, dest).map_err(|e| {
        let _ = std::fs::remove_file(&partial);
        format!("could not finish the download: {e}")
    })?;
    Ok(())
}

/// The SHA-256 of a file, lowercase hex.
pub fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("could not read the download: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("could not read the download: {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

// --- applying the update ----------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct PendingUpdate {
    method: InstallMethod,
    path: String,
}

fn updates_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("app cache dir unavailable: {e}"))?
        .join("updates");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn pending_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(updates_dir(app)?.join("pending-update.json"))
}

fn write_pending(app: &tauri::AppHandle, method: InstallMethod, path: &Path) -> Result<(), String> {
    let pending = PendingUpdate {
        method,
        path: path.to_string_lossy().to_string(),
    };
    let json = serde_json::to_string(&pending).map_err(|e| format!("pending update: {e}"))?;
    std::fs::write(pending_path(app)?, json)
        .map_err(|e| format!("could not record the pending update: {e}"))
}

/// A download file name that cannot escape the updates directory (the asset
/// name comes from the network, so it is treated as untrusted).
fn safe_asset_name(name: &str) -> Result<String, String> {
    let base = Path::new(name)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("invalid asset name: {name}"))?;
    if base.is_empty() || base.starts_with('.') {
        return Err(format!("invalid asset name: {name}"));
    }
    Ok(base.to_string())
}

/// Replaces the running AppImage with the downloaded one. The running process
/// keeps the old inode open, so the rename is safe while the app runs.
fn replace_appimage(download: &Path) -> Result<(), String> {
    let appimage = std::env::var("APPIMAGE").map_err(|_| {
        "QuillMD is not running from an AppImage; download the new release from GitHub instead."
            .to_string()
    })?;
    let target = PathBuf::from(appimage);
    let dir = target
        .parent()
        .ok_or_else(|| "the AppImage has no parent directory".to_string())?;
    let staged = dir.join(format!(".quillmd-update-{}.AppImage", std::process::id()));
    std::fs::copy(download, &staged)
        .map_err(|e| format!("could not stage the new AppImage: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755)) {
            let _ = std::fs::remove_file(&staged);
            return Err(format!("could not make the new AppImage executable: {e}"));
        }
    }
    std::fs::rename(&staged, &target).map_err(|e| {
        let _ = std::fs::remove_file(&staged);
        format!("could not replace {}: {e}", target.display())
    })
}

/// Hands a distro package to the system installer (the desktop's default
/// handler for .deb/.rpm files). The app keeps running; the package manager
/// finishes the install.
fn open_package(download: &Path) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(download)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("could not open the package installer: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = download;
        Err("this build cannot open a package installer on this platform".into())
    }
}

/// Runs the queued Windows installer silently (NSIS `/S`, or msiexec `/qb`).
fn spawn_windows_installer(path: &Path, msi: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut command = if msi {
            let mut command = std::process::Command::new("msiexec");
            command.arg("/i").arg(path).arg("/qb");
            command
        } else {
            let mut command = std::process::Command::new(path);
            command.arg("/S");
            command
        };
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("could not start the installer: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (path, msi);
        Err("this build cannot run a Windows installer".into())
    }
}

/// Relaunches the freshly replaced AppImage (Linux) or the app binary
/// (Windows, when the installer already replaced it).
fn relaunch_current_app() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let appimage = std::env::var("APPIMAGE").map_err(|_| {
            "QuillMD is not running from an AppImage; start the new release manually.".to_string()
        })?;
        // `sh` waits a moment so this process can exit cleanly first, then
        // execs the new AppImage in its place.
        std::process::Command::new("sh")
            .arg("-c")
            .arg("sleep 1; exec \"$0\"")
            .arg(&appimage)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("could not relaunch QuillMD: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let exe =
            std::env::current_exe().map_err(|e| format!("could not locate the executable: {e}"))?;
        std::process::Command::new(exe)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("could not relaunch QuillMD: {e}"))?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        Err("this build cannot relaunch itself on this platform".into())
    }
}

/// Launches the program that finishes the queued update.
fn spawn_pending_installer(pending: &PendingUpdate) -> Result<(), String> {
    let path = PathBuf::from(&pending.path);
    match pending.method {
        InstallMethod::AppImage => relaunch_current_app(),
        InstallMethod::Nsis => spawn_windows_installer(&path, false),
        InstallMethod::Msi => spawn_windows_installer(&path, true),
        InstallMethod::Deb | InstallMethod::Rpm => {
            Err("this update is already handed to the package manager".into())
        }
        InstallMethod::None => Err("there is no pending update to finish".into()),
    }
}

/// Checks GitHub for a newer release.
pub fn check_now() -> Result<UpdateCheck, String> {
    let release = fetch_latest_release()?;
    Ok(build_check(
        &release,
        env!("CARGO_PKG_VERSION"),
        &current_platform(),
    ))
}

/// Downloads, verifies, and applies the newest release. The AppImage and
/// Windows installers finish in [`restart_now`]; the distro packages are
/// handed to the system installer here.
pub fn install_now(app: &tauri::AppHandle) -> Result<UpdateOutcome, String> {
    let platform = current_platform();
    let release = fetch_latest_release()?;
    let check = build_check(&release, env!("CARGO_PKG_VERSION"), &platform);
    if !check.available {
        return Err("QuillMD is already up to date".into());
    }
    let asset = pick_asset(&release.assets, &platform).ok_or_else(|| {
        "This release has no package for this platform; download it from GitHub.".to_string()
    })?;
    let method = asset_method(&asset.name)
        .ok_or_else(|| format!("unrecognized package type: {}", asset.name))?;
    let client = http_agent(DOWNLOAD_TIMEOUT);
    let checksum = fetch_expected_checksum(&client, &release.assets, &asset.name)?;
    let dir = updates_dir(app)?;
    let dest = dir.join(safe_asset_name(&asset.name)?);

    download_asset(
        &|phase, downloaded, total| emit_progress(app, phase, downloaded, total),
        &client,
        &asset.browser_download_url,
        &dest,
        asset.size,
    )?;
    emit_progress(app, UpdatePhase::Verify, 0, 0);
    let actual = sha256_file(&dest)?;
    if actual != checksum {
        let _ = std::fs::remove_file(&dest);
        return Err(format!(
            "The downloaded update failed its checksum check (expected {checksum}, got {actual}); nothing was installed."
        ));
    }

    emit_progress(app, UpdatePhase::Install, 0, 0);
    let outcome = |restart_required: bool| UpdateOutcome {
        version: check.latest.clone(),
        method,
        path: dest.to_string_lossy().to_string(),
        restart_required,
    };
    match method {
        InstallMethod::AppImage => {
            replace_appimage(&dest)?;
            write_pending(app, method, &dest)?;
            Ok(outcome(true))
        }
        InstallMethod::Deb | InstallMethod::Rpm => {
            open_package(&dest)?;
            Ok(outcome(false))
        }
        InstallMethod::Nsis | InstallMethod::Msi => {
            write_pending(app, method, &dest)?;
            Ok(outcome(true))
        }
        InstallMethod::None => Err("there is no update package to install".into()),
    }
}

/// Runs the queued update program and exits so the update can finish.
pub fn restart_now(app: &tauri::AppHandle) -> Result<(), String> {
    let pending_file = pending_path(app)?;
    let raw = std::fs::read_to_string(&pending_file)
        .map_err(|e| format!("no pending update to finish: {e}"))?;
    let pending: PendingUpdate = serde_json::from_str(&raw)
        .map_err(|e| format!("could not read the pending update: {e}"))?;
    spawn_pending_installer(&pending)?;
    let _ = std::fs::remove_file(&pending_file);
    // Give a Windows installer a moment to start before this process exits: it
    // may need the app closed before it can replace the executable. (The
    // AppImage path already relaunches itself after a one-second delay.)
    #[cfg(target_os = "windows")]
    std::thread::sleep(std::time::Duration::from_millis(1500));
    app.exit(0);
    Ok(())
}

// --- Tauri commands ---------------------------------------------------------

/// `update_check`: the newest release vs. this build (network work runs off
/// the main thread).
#[tauri::command]
pub async fn update_check() -> Result<UpdateCheck, String> {
    tauri::async_runtime::spawn_blocking(check_now)
        .await
        .map_err(|e| format!("update check failed: {e}"))?
}

/// Serializes installs: a second Download & Install while one is already
/// running is rejected instead of racing on the same partial download. Managed
/// by the Tauri app (lib.rs) and cloned into the blocking task.
#[derive(Clone, Default)]
pub struct InstallLock(std::sync::Arc<std::sync::atomic::AtomicBool>);

impl InstallLock {
    /// False when another install already holds the lock.
    fn try_begin(&self) -> bool {
        !self.0.swap(true, std::sync::atomic::Ordering::SeqCst)
    }

    fn finish(&self) {
        self.0.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

/// `update_install`: download + verify + apply. Never exits the app; the
/// frontend asks for the restart separately so it can show the outcome first.
#[tauri::command]
pub async fn update_install(
    app: tauri::AppHandle,
    lock: tauri::State<'_, InstallLock>,
) -> Result<UpdateOutcome, String> {
    let lock = lock.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !lock.try_begin() {
            return Err("an update is already downloading".to_string());
        }
        let result = install_now(&app);
        lock.finish();
        result
    })
    .await
    .map_err(|e| format!("update install failed: {e}"))?
}

/// `update_restart`: relaunch the new AppImage / run the queued installer and
/// exit. The command's reply never reaches the webview (the process exits).
#[tauri::command]
pub fn update_restart(app: tauri::AppHandle) -> Result<(), String> {
    restart_now(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str) -> ReleaseAsset {
        ReleaseAsset {
            name: name.to_string(),
            browser_download_url: format!("https://example.com/{name}"),
            size: 1_000,
        }
    }

    fn release(tag: &str, assets: Vec<ReleaseAsset>) -> Release {
        Release {
            tag_name: tag.to_string(),
            html_url: format!("https://github.com/bruceamoser/quillmd/releases/tag/{tag}"),
            body: "notes".to_string(),
            draft: false,
            prerelease: false,
            assets,
        }
    }

    fn platform(os: &'static str, arch: &'static str, appimage: bool) -> Platform {
        Platform { os, arch, appimage }
    }

    #[test]
    fn versions_parse_with_and_without_prefixes() {
        assert_eq!(
            parse_version("v0.2.5"),
            Some(Version {
                major: 0,
                minor: 2,
                patch: 5
            })
        );
        assert_eq!(
            parse_version("1.10.0"),
            Some(Version {
                major: 1,
                minor: 10,
                patch: 0
            })
        );
        assert_eq!(
            parse_version("V2.0.0-rc.1"),
            Some(Version {
                major: 2,
                minor: 0,
                patch: 0
            })
        );
        assert_eq!(
            parse_version("0.3"),
            Some(Version {
                major: 0,
                minor: 3,
                patch: 0
            })
        );
        assert_eq!(parse_version("draft-2026-01-01"), None);
        assert_eq!(parse_version(""), None);
        assert_eq!(parse_version("1.2.3.4"), None);
    }

    #[test]
    fn newer_versions_are_detected_componentwise() {
        assert!(is_newer("v0.2.6", "0.2.5"));
        assert!(is_newer("0.10.0", "0.9.9"));
        assert!(is_newer("1.0.0", "0.99.99"));
        assert!(!is_newer("v0.2.5", "0.2.5"));
        assert!(!is_newer("0.2.4", "0.2.5"));
        assert!(!is_newer("draft", "0.2.5"));
    }

    #[test]
    fn asset_extensions_map_to_install_methods() {
        assert_eq!(
            asset_method("quillmd_0.2.5_amd64.AppImage"),
            Some(InstallMethod::AppImage)
        );
        assert_eq!(
            asset_method("quillmd_0.2.5_amd64.deb"),
            Some(InstallMethod::Deb)
        );
        assert_eq!(
            asset_method("quillmd-0.2.5-1.x86_64.rpm"),
            Some(InstallMethod::Rpm)
        );
        assert_eq!(
            asset_method("quillmd_0.2.5_x64-setup.exe"),
            Some(InstallMethod::Nsis)
        );
        assert_eq!(
            asset_method("quillmd_0.2.5_x64_en-US.msi"),
            Some(InstallMethod::Msi)
        );
        assert_eq!(asset_method("SHA256SUMS-0.2.5.txt"), None);
    }

    #[test]
    fn appimage_is_preferred_only_when_running_as_one() {
        let assets = vec![
            asset("quillmd_0.2.5_amd64.AppImage"),
            asset("quillmd_0.2.5_amd64.deb"),
        ];
        let from_appimage = pick_asset(&assets, &platform("linux", "x86_64", true)).unwrap();
        assert_eq!(from_appimage.name, "quillmd_0.2.5_amd64.AppImage");
        let from_deb = pick_asset(&assets, &platform("linux", "x86_64", false)).unwrap();
        assert_eq!(from_deb.name, "quillmd_0.2.5_amd64.deb");
    }

    #[test]
    fn windows_prefers_the_nsis_setup_over_the_msi() {
        let assets = vec![
            asset("quillmd_0.2.5_x64_en-US.msi"),
            asset("quillmd_0.2.5_x64-setup.exe"),
        ];
        let picked = pick_asset(&assets, &platform("windows", "x86_64", false)).unwrap();
        assert_eq!(picked.name, "quillmd_0.2.5_x64-setup.exe");
    }

    #[test]
    fn other_architectures_are_not_offered_x86_assets() {
        let assets = vec![asset("quillmd_0.2.5_amd64.AppImage")];
        assert!(pick_asset(&assets, &platform("linux", "aarch64", true)).is_none());
        // An unmarked name is accepted (single-arch release).
        let unmarked = vec![asset("quillmd.AppImage")];
        assert!(pick_asset(&unmarked, &platform("linux", "aarch64", true)).is_some());
    }

    #[test]
    fn unsupported_platforms_get_no_asset() {
        let assets = vec![asset("quillmd_0.2.5_amd64.AppImage")];
        assert!(pick_asset(&assets, &platform("macos", "aarch64", false)).is_none());
    }

    #[test]
    fn checksum_files_parse_text_and_binary_separators() {
        let digest = "a".repeat(64);
        let text = format!("{digest}  quillmd.AppImage\n{digest} *quillmd.deb\nnot-a-line\n");
        let parsed = parse_sha256sums(&text);
        assert_eq!(parsed.len(), 2);
        assert_eq!(
            checksum_for(&parsed, "quillmd.AppImage"),
            Some(digest.as_str())
        );
        assert_eq!(checksum_for(&parsed, "quillmd.deb"), Some(digest.as_str()));
        assert_eq!(checksum_for(&parsed, "missing.deb"), None);
    }

    #[test]
    fn build_check_reports_updates_and_picks_the_platform_asset() {
        let release = release(
            "v0.2.6",
            vec![
                asset("quillmd_0.2.6_amd64.AppImage"),
                asset("SHA256SUMS-0.2.6.txt"),
            ],
        );
        let check = build_check(&release, "0.2.5", &platform("linux", "x86_64", true));
        assert!(check.available);
        assert_eq!(check.latest, "0.2.6");
        assert_eq!(check.method, InstallMethod::AppImage);
        assert_eq!(
            check.asset_name.as_deref(),
            Some("quillmd_0.2.6_amd64.AppImage")
        );
        assert!(check.checksum_available);
        assert_eq!(check.notes, "notes");
        assert_eq!(
            check.release_url,
            "https://github.com/bruceamoser/quillmd/releases/tag/v0.2.6"
        );
    }

    #[test]
    fn build_check_ignores_drafts_prereleases_and_old_tags() {
        let platform = platform("linux", "x86_64", true);
        let mut newer = release("v0.2.6", vec![asset("quillmd_0.2.6_amd64.AppImage")]);
        newer.draft = true;
        assert!(!build_check(&newer, "0.2.5", &platform).available);
        newer.draft = false;
        newer.prerelease = true;
        assert!(!build_check(&newer, "0.2.5", &platform).available);
        newer.prerelease = false;
        assert!(build_check(&newer, "0.2.5", &platform).available);
        let same = release("v0.2.5", vec![asset("quillmd_0.2.5_amd64.AppImage")]);
        assert!(!build_check(&same, "0.2.5", &platform).available);
    }

    #[test]
    fn build_check_marks_a_missing_package_as_none() {
        let release = release("v0.3.0", vec![asset("SHA256SUMS-0.3.0.txt")]);
        let check = build_check(&release, "0.2.5", &platform("windows", "x86_64", false));
        assert!(check.available);
        assert_eq!(check.method, InstallMethod::None);
        assert_eq!(check.asset_name, None);
        assert!(check.checksum_available);
    }

    #[test]
    fn asset_names_cannot_escape_the_updates_directory() {
        assert_eq!(
            safe_asset_name("quillmd.AppImage").unwrap(),
            "quillmd.AppImage"
        );
        assert_eq!(
            safe_asset_name("../evil/../../quillmd.deb").unwrap(),
            "quillmd.deb"
        );
        assert!(safe_asset_name("").is_err());
        assert!(safe_asset_name(".hidden").is_err());
    }

    // Live GitHub check: pins the real payload shape (trust roots, API headers,
    // JSON fields) without making the normal test run depend on the network.
    // Run with: cargo test --lib live_release_check -- --ignored --nocapture
    #[test]
    #[ignore = "hits the GitHub releases API"]
    fn live_release_check() {
        let check = check_now().expect("GitHub release check");
        assert!(!check.current.is_empty());
        assert!(!check.latest.is_empty());
        assert!(
            parse_version(&check.latest).is_some(),
            "latest tag {:?} does not parse as a version",
            check.latest
        );
        assert!(check.release_url.starts_with("https://github.com/"));
        println!(
            "current={} latest={} available={} method={:?} asset={:?} checksums={}",
            check.current,
            check.latest,
            check.available,
            check.method,
            check.asset_name,
            check.checksum_available
        );
    }

    // Live download + checksum: streams the published package to a temp file
    // and verifies it against the release's SHA256SUMS. Run manually:
    // cargo test --lib live_download_and_verify -- --ignored --nocapture
    #[test]
    #[ignore = "downloads the latest package from GitHub"]
    fn live_download_and_verify() {
        let platform = platform("linux", "x86_64", false);
        let release = fetch_latest_release().expect("latest release");
        let asset = pick_asset(&release.assets, &platform).expect("a Linux package");
        let agent = http_agent(DOWNLOAD_TIMEOUT);
        let expected =
            fetch_expected_checksum(&agent, &release.assets, &asset.name).expect("checksum");
        let dir = std::env::temp_dir().join(format!("quillmd-download-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let dest = dir.join(safe_asset_name(&asset.name).expect("safe name"));
        let events = std::cell::Cell::new(0usize);
        download_asset(
            &|phase, downloaded, total| {
                if let UpdatePhase::Download = phase {
                    events.set(events.get() + 1);
                    assert!(downloaded <= total || total == 0);
                }
            },
            &agent,
            &asset.browser_download_url,
            &dest,
            asset.size,
        )
        .expect("download");
        assert!(
            events.get() >= 2,
            "progress only reported {} times",
            events.get()
        );
        assert_eq!(
            std::fs::metadata(&dest).expect("metadata").len(),
            asset.size,
            "downloaded size does not match the release asset"
        );
        let actual = sha256_file(&dest).expect("sha256");
        assert_eq!(actual, expected, "downloaded bytes do not match SHA256SUMS");
        println!(
            "verified {} ({} bytes) against SHA256SUMS",
            asset.name, asset.size
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
