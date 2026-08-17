#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Eol {
    Lf,
    Crlf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    Utf8,
    Utf16Le,
    Utf16Be,
    Latin1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NonUtf8 {
    pub encoding: Encoding,
}

pub fn detect_bom(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xEF, 0xBB, 0xBF])
}

/// Detects the dominant line ending by counting `\r\n` sequences against lone
/// `\n` sequences. Ties resolve to `Lf`.
pub fn detect_eol(bytes: &[u8]) -> Eol {
    let mut crlf = 0usize;
    let mut lf = 0usize;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\r' {
            if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                crlf += 1;
                i += 1;
            }
        } else if bytes[i] == b'\n' {
            lf += 1;
        }
        i += 1;
    }
    if crlf > lf {
        Eol::Crlf
    } else {
        Eol::Lf
    }
}

/// Normalizes all line endings (`\r\n`, lone `\r`, lone `\n`) to `target`.
pub fn normalize_eol(bytes: &[u8], target: Eol) -> Vec<u8> {
    let nl: &[u8] = match target {
        Eol::Lf => b"\n",
        Eol::Crlf => b"\r\n",
    };
    let mut out = Vec::with_capacity(bytes.len() + 8);
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\r' {
            if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                i += 1;
            }
            out.extend_from_slice(nl);
        } else if bytes[i] == b'\n' {
            out.extend_from_slice(nl);
        } else {
            out.push(bytes[i]);
        }
        i += 1;
    }
    out
}

/// Detects the text encoding without ever converting lossily. Returns
/// `Ok(Utf8)` for valid UTF-8 and `Err(NonUtf8)` (with the detected encoding)
/// for UTF-16 and Latin-1, so the caller can offer an explicit conversion.
pub fn detect_encoding(bytes: &[u8]) -> Result<Encoding, NonUtf8> {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Err(NonUtf8 {
            encoding: Encoding::Utf16Le,
        });
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Err(NonUtf8 {
            encoding: Encoding::Utf16Be,
        });
    }
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Ok(Encoding::Utf8);
    }

    // UTF-16 heuristic FIRST: ASCII-only UTF-16 (e.g. A\0B\0) is also valid
    // UTF-8 because NUL is a valid code point, so the from_utf8 check below
    // would miss it. A strong NUL-at-regular-intervals pattern wins.
    if bytes.len() >= 4 {
        let sample_len = bytes.len().min(256);
        let sample = &bytes[..sample_len];
        let mut even_zero = 0usize;
        let mut odd_zero = 0usize;
        for (i, &b) in sample.iter().enumerate() {
            if b == 0 {
                if i % 2 == 0 {
                    even_zero += 1;
                } else {
                    odd_zero += 1;
                }
            }
        }
        let nuls = even_zero + odd_zero;
        if nuls > 0 && (even_zero >= sample_len / 8 || odd_zero >= sample_len / 8) {
            if odd_zero >= even_zero {
                return Err(NonUtf8 {
                    encoding: Encoding::Utf16Le,
                });
            } else {
                return Err(NonUtf8 {
                    encoding: Encoding::Utf16Be,
                });
            }
        }
    }

    match std::str::from_utf8(bytes) {
        Ok(_) => Ok(Encoding::Utf8),
        Err(_) => {
            let sample = &bytes[..bytes.len().min(256)];
            let mut even_zero = 0usize;
            let mut odd_zero = 0usize;
            for (i, &b) in sample.iter().enumerate() {
                if b == 0 {
                    if i % 2 == 0 {
                        even_zero += 1;
                    } else {
                        odd_zero += 1;
                    }
                }
            }
            if odd_zero > even_zero && odd_zero > 0 {
                Err(NonUtf8 {
                    encoding: Encoding::Utf16Le,
                })
            } else if even_zero > odd_zero && even_zero > 0 {
                Err(NonUtf8 {
                    encoding: Encoding::Utf16Be,
                })
            } else {
                Err(NonUtf8 {
                    encoding: Encoding::Latin1,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bom_detect() {
        assert!(detect_bom(&[0xEF, 0xBB, 0xBF, b'a']));
        assert!(!detect_bom(b"abc"));
        assert!(!detect_bom(&[0xFF, 0xFE]));
        assert!(!detect_bom(b""));
    }

    #[test]
    fn eol_dominant() {
        assert_eq!(detect_eol(b"a\r\nb\r\n"), Eol::Crlf);
        assert_eq!(detect_eol(b"a\nb\n"), Eol::Lf);
        assert_eq!(detect_eol(b"a\r\nb\nc\r\n"), Eol::Crlf);
        assert_eq!(detect_eol(b""), Eol::Lf);
        assert_eq!(detect_eol(b"no newlines"), Eol::Lf);
    }

    #[test]
    fn normalize_eol_to_target() {
        assert_eq!(normalize_eol(b"a\r\nb\nc", Eol::Lf), b"a\nb\nc");
        assert_eq!(normalize_eol(b"a\r\nb\nc", Eol::Crlf), b"a\r\nb\r\nc");
        assert_eq!(normalize_eol(b"a\rb", Eol::Lf), b"a\nb");
        assert_eq!(normalize_eol(b"a\rb", Eol::Crlf), b"a\r\nb");
    }

    #[test]
    fn non_utf8_detection() {
        assert_eq!(
            detect_encoding(&[0x41, 0x00, 0x42, 0x00]).unwrap_err().encoding,
            Encoding::Utf16Le
        );
        assert_eq!(
            detect_encoding(&[0xFF, 0xFE, 0x41, 0x00])
                .unwrap_err()
                .encoding,
            Encoding::Utf16Le
        );
        assert_eq!(
            detect_encoding(&[0x00, 0x41, 0x00, 0x42])
                .unwrap_err()
                .encoding,
            Encoding::Utf16Be
        );
        assert_eq!(
            detect_encoding(&[0xFE, 0xFF, 0x00, 0x41])
                .unwrap_err()
                .encoding,
            Encoding::Utf16Be
        );
        assert_eq!(
            detect_encoding(&[0xE9, 0x20]).unwrap_err().encoding,
            Encoding::Latin1
        );
    }

    #[test]
    fn utf8_detection() {
        assert_eq!(detect_encoding("hello".as_bytes()).unwrap(), Encoding::Utf8);
        assert_eq!(
            detect_encoding("héllo wörld".as_bytes()).unwrap(),
            Encoding::Utf8
        );
        assert_eq!(
            detect_encoding(&[0xEF, 0xBB, 0xBF, b'a']).unwrap(),
            Encoding::Utf8
        );
    }
}
