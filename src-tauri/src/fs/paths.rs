/// Returns true if `name` collides with a Windows reserved device name
/// (CON, PRN, AUX, NUL, COM1-9, LPT1-9) or ends with a trailing dot/space.
/// Comparison is case-insensitive and ignores the file extension.
pub fn is_windows_reserved(name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    if name.ends_with(' ') || name.ends_with('.') {
        return true;
    }
    let base = match name.split('.').next() {
        Some(b) => b.to_ascii_uppercase(),
        None => return false,
    };
    matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL") || is_com_lpt(&base)
}

fn is_com_lpt(base: &str) -> bool {
    if base.len() != 4 {
        return false;
    }
    let b = base.as_bytes();
    let com = b[0] == b'C' && b[1] == b'O' && b[2] == b'M';
    let lpt = b[0] == b'L' && b[1] == b'P' && b[2] == b'T';
    (com || lpt) && matches!(b[3], b'1'..=b'9')
}

/// Converts Windows-style backslash separators to forward slashes so paths can
/// be embedded in markdown without being mistaken for escape sequences.
pub fn to_forward_slashes(path: &str) -> String {
    path.replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserved_names() {
        for name in ["CON", "con", "NUL", "nul", "AUX", "aux", "PRN", "prn"] {
            assert!(is_windows_reserved(name), "{name} should be reserved");
        }
        for name in ["COM1", "com9", "LPT1", "lpt9", "LPT3"] {
            assert!(is_windows_reserved(name), "{name} should be reserved");
        }
        assert!(is_windows_reserved("CON.txt"));
        assert!(is_windows_reserved("con.md"));
        assert!(is_windows_reserved("COM1.log"));
    }

    #[test]
    fn trailing_dots_and_spaces() {
        assert!(is_windows_reserved("file."));
        assert!(is_windows_reserved("file "));
        assert!(is_windows_reserved("file. "));
        assert!(is_windows_reserved(".."));
    }

    #[test]
    fn non_reserved_names() {
        for name in ["file.md", "mycon", "COM10", "COM0", "LPT10", "console.txt", ""] {
            assert!(!is_windows_reserved(name), "{name} should not be reserved");
        }
    }

    #[test]
    fn forward_slashes() {
        assert_eq!(to_forward_slashes(r"C:\foo\bar.md"), "C:/foo/bar.md");
        assert_eq!(to_forward_slashes("/usr/local/bin"), "/usr/local/bin");
        assert_eq!(to_forward_slashes(r"a\b\c"), "a/b/c");
    }
}
