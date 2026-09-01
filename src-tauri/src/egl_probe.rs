// Linux WebKitGTK EGL pre-flight.
//
// WebKitGTK 2.44+ requires a working EGL display for accelerated
// compositing. On machines where that fails - VMs without 3D
// acceleration, remote/headless sessions, broken or mismatched GPU
// drivers, NVIDIA + Wayland quirks - WebKit aborts the whole process:
//
//   Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
//
// There is no way to catch that abort from inside the app, so we probe
// EGL ourselves before the webview exists and, when it is unusable,
// switch WebKit to its software rendering path. The app then starts on
// any modern Linux machine without the user setting anything by hand.
//
// An explicit WEBKIT_DISABLE_* variable set by the user always wins.

#[cfg(target_os = "linux")]
use std::ffi::c_void;

#[cfg(target_os = "linux")]
pub fn prepare_webview() {
    // A user-supplied override takes precedence over the probe.
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_some()
        || std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some()
    {
        return;
    }

    if egl_display_usable() {
        return;
    }

    apply_fallback();
}

// Sets the WebKit software-rendering fallback. Split out so the decision
// wiring is unit-testable without dlopen.
#[cfg(target_os = "linux")]
fn apply_fallback() {
    // EGL is missing or broken: force WebKit's non-accelerated path so
    // rendering works via software. Three variables are set because the
    // failure modes differ:
    //   - WEBKIT_DISABLE_COMPOSITING_MODE / _DMABUF_RENDERER: tell WebKit
    //     not to use the accelerated compositing paths at all.
    //   - LIBGL_ALWAYS_SOFTWARE: when EGL *exists* but is broken
    //     (EGL_BAD_PARAMETER, bad driver, VM without 3D accel), force Mesa
    //     to hand out a working software EGL (llvmpipe) instead.
    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
}

// Mirrors WebKit's own "default EGL display" creation: dlopen libEGL,
// eglGetDisplay(EGL_DEFAULT_DISPLAY), then eglInitialize. Any failure at
// these steps means WebKit would abort later, so we treat it as unusable.
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

    // Process env vars are process-global, so all three scenarios run in a
    // single sequential test to avoid cross-test races.
    #[test]
    fn fallback_wiring_contract() {
        clear();

        // 1. apply_fallback sets the WebKit software-rendering vars plus
        //    the Mesa software-EGL fallback.
        apply_fallback();
        assert_eq!(
            std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").as_deref(),
            Some(OsStr::new("1"))
        );
        assert_eq!(
            std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").as_deref(),
            Some(OsStr::new("1"))
        );
        assert_eq!(
            std::env::var_os("LIBGL_ALWAYS_SOFTWARE").as_deref(),
            Some(OsStr::new("1"))
        );
        clear();

        // 2. A user override wins: prepare_webview must skip the probe and
        //    never overwrite the user's choice.
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "0");
        prepare_webview();
        assert_eq!(
            std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").as_deref(),
            Some(OsStr::new("0"))
        );
        assert!(std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none());
        clear();

        // 3. Probe is total (no panic) and the fallback path applies.
        let _ = egl_display_usable();
        let _ = apply_fallback();
        assert!(std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_some());
        clear();
    }
}
