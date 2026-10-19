// AppImage host-library preference.
//
// Tauri's AppImage bundles GTK3 and WebKitGTK (linuxdeploy's GTK plugin) and
// the generated AppRun puts those bundled libraries first on LD_LIBRARY_PATH.
// On some systems the bundled WebKitGTK build aborts during startup with:
//
//   Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
//
// while the distribution's own WebKitGTK works (observed on Ubuntu 26.04 with
// Mesa 26 / AMD). The abort happens in the WebKit child process, after GTK is
// initialized, so there is no way to recover from inside the running process
// and no way to change the AppRun environment before it starts.
//
// Instead, re-exec once with the host's GTK/WebKit directories ahead of the
// bundled ones. Only a directory containing a complete pair is used, so a
// partial install cannot mix the two stacks. If the host has no GTK/WebKit,
// nothing changes and the self-contained bundled stack is used as before.
//
// Escape hatch: QUILLMD_NO_HOST_LIBS=1.

#![cfg(target_os = "linux")]

use std::path::PathBuf;

const REEXEC_MARKER: &str = "QUILLMD_HOST_LIBS_REEXEC";

// GTK/GIO path variables the AppImage's AppRun hook points at the bundled
// stack. They must not be forced on the host stack we are switching to (the
// module caches and schemas belong to a possibly different GTK build).
const BUNDLED_GTK_ENV: &[&str] = &[
    "GSETTINGS_SCHEMA_DIR",
    "GTK_DATA_PREFIX",
    "GTK_EXE_PREFIX",
    "GTK_PATH",
    "GTK_IM_MODULE_FILE",
    "GDK_PIXBUF_MODULE_FILE",
    "GIO_EXTRA_MODULES",
];

/// Re-executes the app with the host GTK/WebKit when running from an AppImage.
/// Does not return when the re-exec succeeds.
pub fn prefer_host_libraries() {
    if !is_appimage()
        || std::env::var_os(REEXEC_MARKER).is_some()
        || std::env::var_os("QUILLMD_NO_HOST_LIBS").is_some()
    {
        return;
    }

    let dirs = host_library_dirs();
    if dirs.is_empty() {
        return;
    }

    let Ok(exe) = std::env::current_exe() else {
        return;
    };

    let search_path = build_search_path(&dirs, std::env::var("LD_LIBRARY_PATH").ok().as_deref());

    let mut command = std::process::Command::new(exe);
    command
        .args(std::env::args_os().skip(1))
        .env("LD_LIBRARY_PATH", search_path)
        .env(REEXEC_MARKER, "1");
    remove_bundled_gtk_paths(&mut command);

    use std::os::unix::process::CommandExt;
    let error = command.exec();
    eprintln!("quillmd: could not switch to host GTK/WebKit libraries: {error}");
}

fn is_appimage() -> bool {
    std::env::var_os("APPDIR").is_some() || std::env::var_os("APPIMAGE").is_some()
}

// Drops the AppRun hook's GTK path overrides, but only when their value points
// into the AppImage; a value the user set elsewhere is left alone.
fn remove_bundled_gtk_paths(command: &mut std::process::Command) {
    let Some(appdir) = std::env::var_os("APPDIR") else {
        return;
    };
    let appdir = appdir.to_string_lossy();

    for key in BUNDLED_GTK_ENV {
        let Some(value) = std::env::var_os(key) else {
            continue;
        };
        if points_into_appdir(&value.to_string_lossy(), &appdir) {
            command.env_remove(key);
        }
    }
}

fn points_into_appdir(value: &str, appdir: &str) -> bool {
    !appdir.is_empty() && value.contains(appdir)
}

fn host_library_dirs() -> Vec<PathBuf> {
    host_library_candidates()
        .into_iter()
        .filter(|dir| {
            dir.join("libwebkit2gtk-4.1.so.0").is_file() && dir.join("libgtk-3.so.0").is_file()
        })
        .collect()
}

fn host_library_candidates() -> Vec<PathBuf> {
    let arch = std::env::consts::ARCH;
    let mut dirs: Vec<PathBuf> = Vec::new();

    // Debian/Ubuntu multiarch layout. `ARCH` matches the multiarch tuple for
    // the architectures the app is released for (x86_64, aarch64).
    if arch == "arm" {
        dirs.push("/usr/lib/arm-linux-gnueabihf".into());
        dirs.push("/lib/arm-linux-gnueabihf".into());
    } else {
        dirs.push(format!("/usr/lib/{arch}-linux-gnu").into());
        dirs.push(format!("/lib/{arch}-linux-gnu").into());
    }

    // Fedora/openSUSE (/usr/lib64) and Arch/others (/usr/lib).
    dirs.push("/usr/lib64".into());
    dirs.push("/lib64".into());
    dirs.push("/usr/lib".into());
    dirs.push("/lib".into());
    dirs
}

fn build_search_path(dirs: &[PathBuf], existing: Option<&str>) -> String {
    let mut value = dirs
        .iter()
        .map(|dir| dir.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join(":");

    if let Some(existing) = existing.filter(|value| !value.is_empty()) {
        value.push(':');
        value.push_str(existing);
    }

    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn search_path_puts_host_dirs_first_and_keeps_bundled_fallback() {
        let dirs = vec![PathBuf::from("/usr/lib/x86_64-linux-gnu")];

        assert_eq!(
            build_search_path(&dirs, Some("/tmp/.mount/usr/lib")),
            "/usr/lib/x86_64-linux-gnu:/tmp/.mount/usr/lib"
        );
        assert_eq!(build_search_path(&dirs, None), "/usr/lib/x86_64-linux-gnu");
        assert_eq!(
            build_search_path(&dirs, Some("")),
            "/usr/lib/x86_64-linux-gnu"
        );
    }

    #[test]
    fn candidates_include_multiarch_directory() {
        let dirs = host_library_candidates();
        let multiarch = format!("/usr/lib/{}-linux-gnu", std::env::consts::ARCH);
        assert!(dirs.iter().any(|dir| dir == Path::new(&multiarch)));
    }

    #[test]
    fn only_bundled_gtk_paths_are_stripped() {
        assert!(points_into_appdir(
            "/tmp/.mount/usr/lib/gtk-3.0:/usr/lib64/gtk-3.0",
            "/tmp/.mount"
        ));
        assert!(!points_into_appdir(
            "/usr/lib/x86_64-linux-gnu/gtk-3.0",
            "/tmp/.mount"
        ));
        assert!(!points_into_appdir("/tmp/.mount", ""));
    }

    #[test]
    fn host_dirs_contain_a_complete_gtk_webkit_pair() {
        for dir in host_library_dirs() {
            assert!(dir.join("libwebkit2gtk-4.1.so.0").is_file());
            assert!(dir.join("libgtk-3.so.0").is_file());
        }
    }
}
