use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use windows::core::PCWSTR;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};
use windows::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

pub const VERSION: &str = match option_env!("SHAREDTABS_VERSION") {
    Some(v) => v, // test builds only
    None => env!("CARGO_PKG_VERSION"),
};
pub const HOST_NAME: &str = "com.hermes.chrome_bridge";
pub const MAX_REQUEST: usize = 900 * 1024; // Chrome refuses host -> extension messages over 1 MB
pub const MAX_RESPONSE: usize = 48 * 1024 * 1024;

/// Extensions that may start the bridge: the development one, then the Chrome Web Store one once it is known.
pub fn extension_ids() -> Vec<&'static str> {
    include_str!("../../extension-id.txt")
        .split_whitespace()
        .filter(|id| id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b)))
        .collect()
}

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}
pub fn pcw(v: &[u16]) -> PCWSTR {
    PCWSTR(v.as_ptr())
}

pub fn home() -> PathBuf {
    PathBuf::from(std::env::var_os("USERPROFILE").unwrap_or_else(|| "C:\\".into()))
}
/// In the home folder rather than AppData: AppData writes made by packaged (MSIX) apps get redirected
/// to a private copy, so Chrome and an agent could disagree about what is there.
pub fn state_dir() -> PathBuf {
    std::env::var_os("HERMES_CHROME_STATE").map(PathBuf::from).unwrap_or_else(|| home().join(".hermes-chrome"))
}
pub fn endpoint_dir() -> PathBuf {
    state_dir().join("endpoints")
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// UTC date and time as (y, m, d, h, min, s).
pub fn utc() -> (i64, u32, u32, u64, u64, u64) {
    let secs = now_ms() / 1000;
    let z = (secs / 86400) as i64 + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    let t = secs % 86400;
    (y, m, d, t / 3600, t / 60 % 60, t % 60)
}

pub fn log(text: &str) {
    let file = state_dir().join("host.log");
    if fs::metadata(&file).map(|m| m.len() > 512 * 1024).unwrap_or(false) {
        let _ = fs::remove_file(&file);
    }
    let (y, mo, d, h, mi, s) = utc();
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(file) {
        let _ = writeln!(f, "{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z [{}] {text}", std::process::id());
    }
}

pub fn random_hex(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    let ok = unsafe { BCryptGenRandom(None, &mut b, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
    // A predictable name or marker would weaken the protections that rely on it, so never carry on without randomness.
    if ok.is_err() {
        std::process::exit(70);
    }
    b.iter().map(|x| format!("{x:02x}")).collect()
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
pub fn to_base64(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= c.len() {
                out.push(B64[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}
pub fn from_base64(s: &str) -> Option<Vec<u8>> {
    let s = s.trim().trim_end_matches('=');
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0);
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };
        acc = acc << 6 | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    (s.len() % 4 != 1).then_some(out)
}

pub fn process_alive(pid: u32) -> bool {
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return windows::Win32::Foundation::GetLastError() == windows::Win32::Foundation::ERROR_ACCESS_DENIED;
        };
        let mut code = 0u32;
        let ok = GetExitCodeProcess(h, &mut code).is_ok();
        let _ = CloseHandle(h);
        ok && code == 259 // STILL_ACTIVE
    }
}

/// Running bridges' pipe names, newest first. Entries left by dead processes are removed.
pub fn endpoints() -> Vec<String> {
    let mut found = Vec::new();
    let Ok(dir) = fs::read_dir(endpoint_dir()) else { return vec![] };
    for e in dir.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(pid) = name.strip_suffix(".json").and_then(|p| p.parse::<u32>().ok()) else { continue };
        let Ok(v) = fs::read_to_string(e.path()).map_err(|_| ()).and_then(|s| serde_json::from_str::<Value>(&s).map_err(|_| ())) else { continue };
        if !process_alive(pid) {
            let _ = fs::remove_file(e.path());
            continue;
        }
        if let Some(p) = v["pipe"].as_str() {
            if p.starts_with("\\\\.\\pipe\\hermes-chrome-") {
                found.push((v["createdAt"].as_u64().unwrap_or(0), p.to_string()));
            }
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|f| f.1).collect()
}

/// Whether Chrome is connected through this version of the bridge.
pub fn chrome_connected() -> bool {
    let Ok(dir) = fs::read_dir(endpoint_dir()) else { return false };
    dir.flatten().any(|e| {
        let name = e.file_name().to_string_lossy().into_owned();
        name.strip_suffix(".json").and_then(|p| p.parse::<u32>().ok()).is_some_and(process_alive)
            && fs::read_to_string(e.path()).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).is_some_and(|v| v["bridge"] == VERSION)
    })
}

/// Versions as three numbers, or None. Leading zeros and suffixes are refused, so one version has one spelling.
pub fn version(v: &str) -> Option<[u32; 3]> {
    let p: Vec<&str> = v.split('.').collect();
    if p.len() != 3 || p.iter().any(|x| x.is_empty() || x.len() > 4 || !x.bytes().all(|b| b.is_ascii_digit()) || (x.len() > 1 && x.starts_with('0'))) {
        return None;
    }
    Some([p[0].parse().ok()?, p[1].parse().ok()?, p[2].parse().ok()?])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn base64() {
        for n in 0..70usize {
            let d: Vec<u8> = (0..n).map(|i| (i * 37 + 11) as u8).collect();
            assert_eq!(from_base64(&to_base64(&d)).unwrap(), d);
        }
        assert_eq!(to_base64(b"hello"), "aGVsbG8=");
        assert!(from_base64("a b").is_none() && from_base64("AAAAA").is_none());
    }
    #[test]
    fn versions() {
        assert!(version("0.10.0") > version("0.9.9"));
        for v in ["1.0", "v1.0.0", "1.0.0-b", "1.0.0.0", "", "99999.0.0", "01.0.0", "+1.0.0"] {
            assert!(version(v).is_none(), "{v}");
        }
    }
    #[test]
    fn date() {
        let (y, m, d, ..) = utc();
        assert!(y >= 2026 && (1..=12).contains(&m) && (1..=31).contains(&d));
    }
}
