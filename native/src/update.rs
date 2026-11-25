// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
//! Signed updates from GitHub Releases. Nothing here runs by itself: the user opens the updater and confirms.
//! The signature is the only thing trusted, not GitHub and not the network.
use crate::install;
use crate::util::*;
use ed25519_dalek::{Signature, VerifyingKey};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use windows::core::PCWSTR;
use windows::Win32::Networking::WinHttp::*;

pub const PRODUCT: &str = "sharedtabs-bridge-windows";
const NO_WINDOW: u32 = 0x0800_0000;

/// Built in, never read from a file: { "repo": "owner/name", "publicKey": base64 of the 32-byte key }
fn config() -> Result<(String, VerifyingKey), String> {
    let none = || "This copy has no update address. Download the new version by hand.".to_string();
    let v: Value = serde_json::from_str(option_env!("SHAREDTABS_UPDATE").unwrap_or(include_str!("../update.json"))).map_err(|_| none())?;
    let repo = v["repo"].as_str().unwrap_or("");
    let ok = repo.split('/').count() == 2 && repo.split('/').all(|p| !p.is_empty() && p != "." && p != ".." && p.len() <= 100 && p.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b)));
    let key = from_base64(v["publicKey"].as_str().unwrap_or("")).and_then(|k| <[u8; 32]>::try_from(k).ok()).and_then(|k| VerifyingKey::from_bytes(&k).ok());
    match (ok, key) {
        (true, Some(k)) if !k.is_weak() => Ok((repo.to_string(), k)),
        _ => Err(none()),
    }
}
pub fn configured() -> bool {
    config().is_ok()
}

#[derive(Debug, Clone)]
pub struct Release {
    pub version: String,
    pub notes: String,
    file: String,
    sha256: String,
    size: u64,
}

pub fn verify(bytes: &[u8], signature: &str, key: &VerifyingKey) -> Result<Release, String> {
    let bad_sig = "The update is not signed by the makers of SharedTabs. Nothing was changed.";
    let sig = from_base64(signature).and_then(|s| <[u8; 64]>::try_from(s).ok()).ok_or(bad_sig)?;
    key.verify_strict(bytes, &Signature::from_bytes(&sig)).map_err(|_| bad_sig)?;
    let invalid = "The update description is not valid. Nothing was changed.";
    let v: Value = serde_json::from_slice(bytes).map_err(|_| invalid)?;
    if v["product"] != PRODUCT {
        return Err("That update is for something else. Nothing was changed.".into());
    }
    let ver = v["version"].as_str().filter(|x| version(x).is_some()).ok_or(invalid)?;
    let size = v["size"].as_u64().filter(|n| (1..=30_000_000).contains(n)).ok_or(invalid)?;
    let sha = v["sha256"].as_str().filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))).ok_or(invalid)?;
    let notes = v["notes"].as_str().filter(|n| n.len() <= 4000).ok_or(invalid)?;
    if v["file"].as_str() != Some(&format!("SharedTabsSetup-{ver}.exe")) {
        return Err(invalid.into());
    }
    Ok(Release {
        version: ver.into(),
        notes: notes.chars().filter(|c| *c == '\n' || !c.is_control()).collect(),
        file: format!("SharedTabsSetup-{ver}.exe"),
        sha256: sha.into(),
        size,
    })
}

struct Handle(*mut core::ffi::c_void);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe { let _ = WinHttpCloseHandle(self.0); }
    }
}
/// https only, through Windows' own networking and certificates. Redirects to http are refused by it.
fn download(url: &str, max: u64) -> Result<Vec<u8>, String> {
    let failed = || "The download failed. Check your connection and try again.".to_string();
    let (secure, rest) = match (url.strip_prefix("https://"), url.strip_prefix("http://")) {
        (Some(r), _) => (true, r),
        (_, Some(r)) if r.starts_with("127.0.0.1:") => (false, r),
        _ => return Err(failed()),
    };
    let (host, path) = rest.split_once('/').ok_or_else(failed)?;
    let (name, port) = match host.split_once(':') {
        Some((n, p)) => (n, p.parse::<u16>().map_err(|_| failed())?),
        None => (host, if secure { 443 } else { 80 }),
    };
    let (agent, name, path, get) = (wide(&format!("SharedTabs/{VERSION}")), wide(name), wide(&format!("/{path}")), wide("GET"));
    unsafe {
        let s = Handle(WinHttpOpen(pcw(&agent), WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, PCWSTR::null(), PCWSTR::null(), 0));
        if s.0.is_null() { return Err(failed()); }
        let _ = WinHttpSetTimeouts(s.0, 15000, 15000, 30000, 30000);
        let c = Handle(WinHttpConnect(s.0, pcw(&name), port, 0));
        if c.0.is_null() { return Err(failed()); }
        let r = Handle(WinHttpOpenRequest(c.0, pcw(&get), pcw(&path), PCWSTR::null(), PCWSTR::null(), std::ptr::null(), if secure { WINHTTP_FLAG_SECURE } else { WINHTTP_OPEN_REQUEST_FLAGS(0) }));
        if r.0.is_null() { return Err(failed()); }
        WinHttpSendRequest(r.0, None, None, 0, 0, 0).map_err(|_| failed())?;
        WinHttpReceiveResponse(r.0, std::ptr::null_mut()).map_err(|_| failed())?;
        let (mut status, mut len) = (0u32, 4u32);
        WinHttpQueryHeaders(r.0, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, PCWSTR::null(), Some(&mut status as *mut u32 as *mut _), &mut len, std::ptr::null_mut()).map_err(|_| failed())?;
        match status {
            200 => {}
            404 => return Err("No release was found.".into()),
            n => return Err(format!("The download failed ({n}).")),
        }
        let mut out = Vec::new();
        let mut buf = vec![0u8; 64 * 1024];
        let until = Instant::now() + Duration::from_secs(180);
        loop {
            let mut n = 0u32;
            WinHttpReadData(r.0, buf.as_mut_ptr() as *mut _, buf.len() as u32, &mut n).map_err(|_| failed())?;
            if n == 0 { return Ok(out); }
            out.extend_from_slice(&buf[..n as usize]);
            if out.len() as u64 > max {
                return Err("The download is larger than expected. Nothing was changed.".into());
            }
            if Instant::now() > until {
                return Err("The download took too long. Nothing was changed.".into());
            }
        }
    }
}
fn base() -> Result<String, String> {
    if let Ok(b) = std::env::var("SHAREDTABS_TEST_RELEASES") {
        if b.starts_with("http://127.0.0.1:") {
            return Ok(b); // a stand-in for GitHub; the signature is still required
        }
    }
    Ok(format!("https://github.com/{}/releases", config()?.0))
}

/// A newer signed release, or None. Never older or the same: an old, genuinely signed release could have a known flaw.
pub fn check() -> Result<Option<Release>, String> {
    let (_, key) = config()?;
    let from = base()?;
    let bytes = download(&format!("{from}/latest/download/release.json"), 20_000)?;
    let sig = download(&format!("{from}/latest/download/release.json.sig"), 1000)?;
    let r = verify(&bytes, &String::from_utf8_lossy(&sig), &key)?;
    let now = install::installed_version().unwrap_or_else(|| VERSION.into());
    Ok((version(&r.version) > version(&now)).then_some(r))
}

/// Runs a program with a time limit; returns whether it succeeded, and its output.
fn run(exe: &Path, args: &[&str], secs: u64) -> Option<String> {
    let mut c = Command::new(exe).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).creation_flags(NO_WINDOW).spawn().ok()?;
    let until = Instant::now() + Duration::from_secs(secs);
    loop {
        match c.try_wait().ok()? {
            Some(s) => {
                let mut out = String::new();
                use std::io::Read;
                let _ = c.stdout.take().map(|mut o| o.read_to_string(&mut out));
                return s.success().then_some(out);
            }
            None if Instant::now() > until => {
                let _ = c.kill();
                return None;
            }
            None => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

pub fn apply(r: &Release) -> Result<(), String> {
    let data = download(&format!("{}/download/v{}/{}", base()?, r.version, r.file), r.size)?;
    let sha: String = Sha256::digest(&data).iter().map(|b| format!("{b:02x}")).collect();
    if data.len() as u64 != r.size || sha != r.sha256 {
        return Err("The downloaded file does not match the signed release. Nothing was changed.".into());
    }
    let work = install::dir().join(format!("update-{}", random_hex(6)));
    let fail = |e: std::io::Error| format!("The update could not be saved ({e}). Nothing was changed.");
    fs::create_dir_all(&work).map_err(fail)?;
    let result = (|| {
        let setup = work.join(&r.file);
        fs::write(&setup, &data).map_err(fail)?;
        // Held open so nothing can replace it between this check and running it. Others may read, not write or delete.
        let hold = fs::OpenOptions::new().read(true).share_mode(1).open(&setup).map_err(fail)?;
        if Sha256::digest(fs::read(&setup).map_err(fail)?).iter().map(|b| format!("{b:02x}")).collect::<String>() != r.sha256 {
            return Err("The downloaded file changed on disk. Nothing was changed.".to_string());
        }
        if run(&setup, &["selftest"], 20).as_deref() != Some(&format!("sharedtabs {} ok", r.version)) {
            return Err("The new version did not start, so nothing was changed.".into());
        }
        let backup = work.join("previous.exe");
        fs::copy(install::exe(), &backup).map_err(fail)?;
        let done = run(&setup, &["install", "/S"], 60).is_some()
            && run(&install::exe(), &["selftest"], 20).as_deref() == Some(&format!("sharedtabs {} ok", r.version));
        drop(hold);
        if !done {
            let back = put_back(&backup);
            return Err(format!("Setting up the new version failed. {}", if back { "The previous version was put back." } else { "Download SharedTabs again to repair it." }));
        }
        Ok(())
    })();
    let _ = fs::remove_dir_all(&work);
    result
}
fn put_back(backup: &PathBuf) -> bool {
    let to = install::exe();
    let aside = install::dir().join(format!("sharedtabs.old-{}.exe", random_hex(4)));
    if to.exists() && fs::rename(&to, &aside).is_err() {
        return false;
    }
    fs::copy(backup, &to).is_ok() && run(&to, &["install", "/S"], 60).is_some()
}

/// Opens the updater in its own process, so it survives Chrome closing the bridge.
pub fn open_window() {
    if let Ok(me) = std::env::current_exe() {
        let spawn = |flags: u32| Command::new(&me).arg("update").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(flags).spawn();
        let _ = spawn(0x0100_0000).or_else(|_| spawn(0)); // leave Chrome's job when allowed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use serde_json::json;
    fn good() -> Value {
        json!({ "product": PRODUCT, "version": "1.2.3", "file": "SharedTabsSetup-1.2.3.exe", "size": 100, "sha256": "a".repeat(64), "notes": "Better.\u{1b}[31m\nFaster." })
    }
    #[test]
    fn signatures() {
        let k = SigningKey::from_bytes(&[7; 32]);
        let other = SigningKey::from_bytes(&[8; 32]);
        let b = good().to_string().into_bytes();
        let s = to_base64(&k.sign(&b).to_bytes());
        let r = verify(&b, &format!("{s}\n"), &k.verifying_key()).unwrap();
        assert_eq!((r.version.as_str(), r.notes.as_str()), ("1.2.3", "Better.[31m\nFaster."));
        assert!(verify(&b, &s, &other.verifying_key()).unwrap_err().contains("not signed"));
        let mut c = b.clone();
        *c.last_mut().unwrap() = b' ';
        assert!(verify(&c, &s, &k.verifying_key()).unwrap_err().contains("not signed"));
        for junk in ["", "AAAA", "not base64 !!", &"A".repeat(88)] {
            assert!(verify(&b, junk, &k.verifying_key()).unwrap_err().contains("not signed"), "{junk}");
        }
    }
    #[test]
    fn signed_descriptions_must_make_sense() {
        let k = SigningKey::from_bytes(&[7; 32]);
        for (f, v) in [("product", json!("other")), ("product", json!("sharedtabs-bridge")), ("version", json!("2")), ("version", json!("1.2.4")), ("file", json!("..\\evil.exe")), ("file", json!("https://evil.example/x.exe")), ("sha256", json!("x")), ("sha256", json!("A".repeat(64))), ("size", json!(0)), ("size", json!(1e12)), ("size", json!(-1)), ("notes", json!(5)), ("notes", json!("x".repeat(5000)))] {
            let mut m = good();
            m[f] = v.clone();
            let b = m.to_string().into_bytes();
            assert!(verify(&b, &to_base64(&k.sign(&b).to_bytes()), &k.verifying_key()).is_err(), "{f}={v}");
        }
        assert!(verify(b"[]", &to_base64(&k.sign(b"[]").to_bytes()), &k.verifying_key()).is_err());
    }
    #[test]
    fn insecure_addresses_are_refused() {
        for u in ["http://example.com/x", "ftp://example.com/x", "http://127.0.0.1.example.com:80/x", "file:///C:/x", "https://nohost"] {
            assert!(download(u, 10).is_err(), "{u}");
        }
    }
}
