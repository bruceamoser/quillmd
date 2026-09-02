// Linux WebKitGTK EGL pre-flight.
//
// WebKitGTK 2.44+ enables a DMA-BUF renderer by default. On many real
// machines that path is what fails:
//
//   Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
//
// (a documented, widespread WebKitGTK 2.44+ bug in Tauri apps — see
// gitbutlerapp/gitbutler#5282, kunkunsh/kunkun#107, louis-e/arnis#1290).
// The whole process aborts and there is no way to catch it from inside the
// app, so we neutralize it *before* the webview exists.
//
// Strategy:
//   1. If the user already set a WEBKIT_DISABLE_* variable, honor it exactly
//      and do nothing else.
//   2. Unconditionally disable the DMA-BUF renderer
//      (WEBKIT_DISABLE_DMABUF_RENDERER=1). This is the targeted, documented
//      fix for the abort. It is NOT gated on an EGL probe, because a bare
//      eglInitialize() succeeds on machines whose default (DMA-BUF /
//      surfaceless) display still fails — the probe is too weak to catch the
//      real failure, which is precisely why v0.2.2 shipped the fix but still
//      crashed. Cost is negligible (compositing falls back to the classic
//      path); it removes a hard launch abort.
//   3. Only if the EGL display is genuinely unusable (headless, no 3D
//      acceleration, broken driver), additionally force WebKit's full
//      software-rendering path (WEBKIT_DISABLE_COMPOSITING_MODE +
//      LIBGL_ALWAYS_SOFTWARE=1 for a working llvmpipe EGL).
//
// A user-supplied override always wins in step 1; steps 2-3 only fill in
// variables the user has not already chosen.

#[cfg(target_os = "linux")]
use std::ffi::c_void;

#[cfg(target_os = "linux")]
pub fn prepare_webview() {
    // A user-supplied override takes precedence over everything we would set.
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_some()
        || std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some()
    {
        return;
    }

    // Unconditional: the DMA-BUF renderer is the known source of the
    // "Could not create default EGL display" abort on WebKitGTK 2.44+.
    // Disabling it is safe and cheap, so we do not gate it on a probe.
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    // If the EGL display is genuinely unusable, go further and force the
    // full software-rendering path so the app still starts.
    if !egl_display_usable() {
        apply_fallback();
    }
}

// Forces WebKit's non-accelerated software-rendering path. Called only when
// the EGL display is unusable. (WEBKIT_DISABLE_DMABUF_RENDERER is set
// unconditionally in prepare_webview and is deliberately NOT repeated here,
// so the user-override check stays the single source of truth for it.)
#[cfg(target_os = "linux")]
fn apply_fallback() {
    //   - WEBKIT_DISABLE_COMPOSITING_MODE: tell WebKit not to use the
    //     accelerated compositing path at all.
    //   - LIBGL_ALWAYS_SOFTWARE: force Mesa to hand out a working software
    //     EGL (llvmpipe) for the software path.
    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
}

// Mirrors WebKit's own "default EGL display" creation: dlopen libEGL,
// eglGetDisplay(EGL_DEFAULT_DISPLAY), then eglInitialize. A failure here
// means the display is unusable and WebKit would need the full software
// path. NOTE: this is intentionally only used to decide the *extra* software
// fallback, never to gate the DMABUF disable — a passing eglInitialize does
// not guarantee the DMA-BUF default display works (that is the bug we fixed).
#[cfg(target_os = "linux")]
fn egl_display_usable() -> bool {
    unsafe {
        let lib = match libloading::Library::new("libEGL.so.1") {
            Ok(lib) => lib,
            Err(_) => return false,
        };

        // EGLDisplay eglGetDisplay(EGLNativeDisplayType display_id);
        // EGL_DEFAULT_DISPLAY is (EGLNativeDisplayType)0, i.e. a null ptr.
        let egl_get_display: libloading::Symbol<
            unsafe extern "C" fn(*const c_void) -> *mut c_void,
        > = match lib.get(b"eglGetDisplay") {
            Ok(sym) => sym,
            Err(_) => return false,
        };

        // EGLBoolean eglInitialize(EGLDisplay dpy, EGLint *major, EGLint *minor);
        let egl_initialize: libloading::Symbol<
            unsafe extern "C" fn(*mut c_void, *mut i32, *mut i32) -> i32,
        > = match lib.get(b"eglInitialize") {
            Ok(sym) => sym,
            Err(_) => return false,
        };

        let display = egl_get_display(std::ptr::null());
        if display.is_null() {
            return false;
        }
        let mut major = 0i32;
        let mut minor = 0i32;
        egl_initialize(display, &mut major, &mut minor) != 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    fn clear() {
        std::env::remove_var("WEBKIT_DISABLE_COMPOSITING_MODE");
        std::env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER");
        std::env::remove_var("LIBGL_ALWAYS_SOFTWARE");
    }

    // Process env vars are process-global, so all scenarios run in a single
    // sequential test to avoid cross-test races.
    #[test]
    fn fallback_wiring_contract() {
        clear();

        // 1. The unconditional DMABUF disable lives in prepare_webview, not
        //    in apply_fallback; apply_fallback adds only the two extra
        //    software-rendering vars for a genuinely broken EGL display.
        apply_fallback();
        assert_eq!(
            std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").as_deref(),
            Some(OsStr::new("1"))
        );
        assert_eq!(
            std::env::var_os("LIBGL_ALWAYS_SOFTWARE").as_deref(),
            Some(OsStr::new("1"))
        );
        assert!(std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none());
        clear();

        // 2. A user override wins: prepare_webview must skip our wiring and
        //    never overwrite the user's choice of either variable.
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "0");
        prepare_webview();
        assert_eq!(
            std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").as_deref(),
            Some(OsStr::new("0"))
        );
        assert!(std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none());
        clear();

        // 3. No override: prepare_webview ALWAYS disables the DMA-BUF
        //    renderer (the v0.2.3 fix — not gated on the EGL probe).
        prepare_webview();
        assert_eq!(
            std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").as_deref(),
            Some(OsStr::new("1"))
        );
        clear();

        // 4. Probe is total (no panic) and the fallback path applies.
        let _ = egl_display_usable();
        let _ = apply_fallback();
        assert!(std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_some());
        clear();
    }
}
