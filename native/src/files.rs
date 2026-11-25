// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
//! Decides which files agents may upload, and reads them. The settings come from the extension.
use crate::util::{pcw, wide};
use regex_lite::Regex;
use serde_json::Value;
use std::fs::File;
use std::io::Read;
use std::os::windows::io::AsRawHandle;
use std::sync::OnceLock;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Storage::FileSystem::{GetFileType, GetFinalPathNameByHandleW, GetFullPathNameW, FILE_NAME_NORMALIZED, FILE_TYPE_DISK};

pub const MAX_FILE: u64 = 20 * 1024 * 1024;

// Never uploaded, whatever the setting or folder.
fn protected_name(name: &str) -> bool {
    static R: OnceLock<Vec<Regex>> = OnceLock::new();
    R.get_or_init(|| {
        [
            r"^\.env(\..*)?$",
            r"\.(env|pem|key|pfx|p12|ppk|kdbx?|jks|keystore|ovpn|rdp|wallet)$",
            r"^id_(rsa|dsa|ecdsa|ed25519)",
            r"^(client_?)?(credentials?|secrets?|auth|tokens?)([._-].*)?\.(json|ya?ml|toml|ini|txt|db)$",
            r"(client_secret|_token|credentials)\.json$",
            r"^\.?(git-credentials|npmrc|pypirc)$",
            r"^[._]netrc$",
            r"^(login data|cookies|web data|local state|key4\.db|logins\.json|wallet\.dat)$",
            r"^ntuser\.dat",
        ]
        .iter()
        .map(|r| Regex::new(r).expect("pattern"))
        .collect()
    })
    .iter()
    .any(|r| r.is_match(name))
}
// Not uploaded unless the user listed a folder inside them.
const PROTECTED_DIRS: [&str; 18] = [
    "appdata", ".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".git", ".hermes", ".hermes-chrome", ".claude", ".codex",
    "windows", "programdata", "program files", "program files (x86)", "$recycle.bin", "system volume information",
];
fn protected_dir(dir: &str) -> bool {
    dir.split('\\').any(|s| PROTECTED_DIRS.contains(&s.to_lowercase().as_str()))
}

fn parent(p: &str) -> &str {
    p.rfind('\\').map(|i| &p[..i]).unwrap_or("")
}
fn base(p: &str) -> &str {
    p.rfind('\\').map(|i| &p[i + 1..]).unwrap_or(p)
}
/// The part of file below folder, or None.
fn below<'a>(file: &'a str, folder: &str) -> Option<&'a str> {
    let f = folder.trim_end_matches('\\');
    let (lf, lo) = (file.to_lowercase(), f.to_lowercase());
    // Lower-casing can change lengths outside ASCII, so compare whole components instead of slicing by length.
    let a: Vec<&str> = lf.split('\\').collect();
    let b: Vec<&str> = lo.split('\\').collect();
    if a.len() <= b.len() || a[..b.len()] != b[..] {
        return None;
    }
    let mut at = 0;
    for c in file.split('\\').take(b.len()) {
        at += c.len() + 1;
    }
    Some(&file[at..])
}

/// A plain drive path: no network or device paths, no alternate data streams.
fn local_path(p: &str) -> Result<String, String> {
    let c: Vec<char> = p.chars().collect();
    let plain = c.len() <= 1000
        && c.len() >= 3
        && c[0].is_ascii_alphabetic()
        && c[1] == ':'
        && (c[2] == '\\' || c[2] == '/')
        && !c[2..].iter().any(|x| "<>:\"|?*".contains(*x) || (*x as u32) < 32);
    let refuse = || format!("Use a full local path such as C:\\Users\\me\\Documents\\cv.pdf, not {}.", Value::from(p));
    if !plain {
        return Err(refuse());
    }
    let w = wide(p);
    let mut out = vec![0u16; 2048];
    let n = unsafe { GetFullPathNameW(pcw(&w), Some(&mut out), None) } as usize;
    if n == 0 || n >= out.len() {
        return Err(refuse());
    }
    let full = String::from_utf16_lossy(&out[..n]);
    // Names such as C:\x\nul become device paths here.
    if full.starts_with('\\') {
        return Err(refuse());
    }
    Ok(full)
}

/// Where an open file really is, after links and junctions. Asked of the open file itself, so it cannot be swapped.
fn real_path(f: &File) -> Option<String> {
    let mut out = vec![0u16; 4096];
    let n = unsafe { GetFinalPathNameByHandleW(HANDLE(f.as_raw_handle()), &mut out, FILE_NAME_NORMALIZED) } as usize;
    if n == 0 || n >= out.len() {
        return None;
    }
    let p = String::from_utf16_lossy(&out[..n]);
    let p = p.strip_prefix("\\\\?\\").unwrap_or(&p).to_string();
    (p.as_bytes().get(1) == Some(&b':')).then_some(p) // a drive path, so not a network share
}
fn real_dir(p: &str) -> Option<String> {
    use std::os::windows::fs::OpenOptionsExt;
    let full = local_path(p).ok()?;
    let f = std::fs::OpenOptions::new().access_mode(0).custom_flags(0x0200_0000).open(full).ok()?; // FILE_FLAG_BACKUP_SEMANTICS, for folders
    real_path(&f)
}

/// Refuses unless the real path may be uploaded. policy: { mode: off | folders | any, folders }
pub fn check_allowed(real: &str, policy: &Value) -> Result<(), String> {
    let name = base(real);
    if protected_name(&name.to_lowercase()) {
        return Err(format!("{name} looks like a key, password or account file, which can't be uploaded."));
    }
    let mode = policy["mode"].as_str().unwrap_or("");
    let listed: Vec<String> = policy["folders"].as_array().map(|a| a.iter().filter_map(|f| f.as_str()).filter_map(real_dir).collect()).unwrap_or_default();
    let under: Vec<&str> = listed.iter().filter_map(|f| below(real, f)).collect();
    if mode == "folders" && under.is_empty() {
        return Err("That file is not in a folder the user's upload settings allow. Ask the user to add the folder or move the file.".into());
    }
    if mode != "folders" && mode != "any" {
        return Err("File uploads are turned off.".into());
    }
    // A listed folder vouches for its own location, but not for protected folders below it.
    let vouched = under.iter().any(|rest| !protected_dir(parent(rest)));
    if !vouched && protected_dir(parent(real)) {
        return Err("That file is in a protected folder (system, app data or account settings), which can't be uploaded.".into());
    }
    Ok(())
}

pub fn read_upload(requested: &Value, policy: &Value) -> Result<(String, Vec<u8>), String> {
    let asked = local_path(requested.as_str().unwrap_or("")).map_err(|e| if requested.is_string() { e } else { "Use a full local path such as C:\\Users\\me\\Documents\\cv.pdf.".into() })?;
    let mut f = File::open(&asked).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => format!("There is no file at {asked}."),
        _ => "That path could not be opened as a file.".to_string(),
    })?;
    if unsafe { GetFileType(HANDLE(f.as_raw_handle())) } != FILE_TYPE_DISK {
        return Err("That is not a file.".into());
    }
    let real = real_path(&f).ok_or("That path could not be resolved to a local file.")?;
    check_allowed(&real, policy)?;
    let meta = f.metadata().map_err(|_| "That file could not be read.")?;
    if !meta.is_file() {
        return Err("That is not a file.".into());
    }
    if meta.len() > MAX_FILE {
        return Err("That file is larger than 20 MB.".into());
    }
    let mut data = Vec::with_capacity(meta.len() as usize);
    (&mut f).take(MAX_FILE + 1).read_to_end(&mut data).map_err(|_| "That file could not be read.")?;
    if data.len() as u64 > MAX_FILE {
        return Err("That file is larger than 20 MB.".into());
    }
    Ok((base(&real).to_string(), data))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::path::{Path, PathBuf};

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }
    fn tmp() -> Tmp {
        let d = std::env::temp_dir().join(format!("sharedtabs files {}", crate::util::random_hex(6)));
        for s in ["ok\\sub", "ok\\.ssh", "other", "ok-evil"] { fs::create_dir_all(d.join(s)).unwrap(); }
        Tmp(d)
    }
    fn put(p: PathBuf) -> Value { fs::write(&p, "data").unwrap(); json!(p.to_str().unwrap()) }
    fn folders(p: &Path) -> Value { json!({ "mode": "folders", "folders": [p.to_str().unwrap()] }) }
    fn refused(p: &Value, policy: &Value, why: &str) {
        let e = read_upload(p, policy).expect_err(&format!("{p} was allowed"));
        assert!(e.contains(why), "{p}: {e}");
    }

    #[test]
    fn any_type_in_a_listed_folder() {
        let t = tmp();
        let ok = t.0.join("ok");
        for n in ["cv.pdf", "photo.JPG", "clip.mp4", "no-extension", "sub\\letter.docx", "key findings.docx", "tokens explained.pdf", "r\u{e9}sum\u{e9} \u{130}.pdf"] {
            let p = put(ok.join(n));
            assert_eq!(read_upload(&p, &folders(&ok)).unwrap().1, b"data", "{n}");
            assert_eq!(read_upload(&json!(p.as_str().unwrap().replace('\\', "/")), &folders(&ok)).unwrap().1, b"data", "{n}");
        }
        assert_eq!(read_upload(&json!(ok.join("CV.PDF").to_str().unwrap()), &folders(&ok)).unwrap().0, "cv.pdf");
    }
    #[test]
    fn outside_is_refused() {
        let t = tmp();
        let ok = t.0.join("ok");
        for p in [put(t.0.join("other\\cv.pdf")), put(t.0.join("ok-evil\\cv.pdf")), json!(ok.join("..\\other\\cv.pdf").to_str().unwrap())] {
            refused(&p, &folders(&ok), "not in a folder");
        }
    }
    #[test]
    fn junction_out_of_the_folder_is_refused() {
        let t = tmp();
        let ok = t.0.join("ok");
        put(t.0.join("other\\cv.pdf"));
        assert!(std::process::Command::new("cmd").args(["/c", "mklink", "/J"]).arg(ok.join("link")).arg(t.0.join("other")).output().unwrap().status.success());
        refused(&json!(ok.join("link\\cv.pdf").to_str().unwrap()), &folders(&ok), "not in a folder");
    }
    #[test]
    fn odd_paths_are_refused() {
        let t = tmp();
        let cv = put(t.0.join("ok\\cv.pdf"));
        for p in [json!("\\\\server\\share\\cv.pdf"), json!("//server/share/a"), json!("\\\\?\\C:\\x.pdf"), json!("\\\\.\\pipe\\x"), json!("cv.pdf"), json!("C:cv.pdf"), json!(format!("{}:hidden", cv.as_str().unwrap())), json!("file:///C:/x"), json!(""), json!(null), json!(5), json!("C:\\a\u{0}b")] {
            refused(&p, &json!({ "mode": "any", "folders": [] }), "full local path");
        }
        for p in ["C:\\Windows\\nul", "C:\\con", "C:\\Users\\com1.txt"] {
            assert!(read_upload(&json!(p), &json!({ "mode": "any", "folders": [] })).is_err(), "{p}");
        }
    }
    #[test]
    fn secrets_are_refused_everywhere() {
        let t = tmp();
        let ok = t.0.join("ok");
        for n in [".env", ".env.local", "prod.env", "server.pem", "PRIVATE.KEY", "id_rsa", "id_ed25519.pub", "vault.kdbx", "credentials.json", "client_secret.json", "google_client_secret.json", "google_token.json", "auth.json", ".npmrc", ".git-credentials", "Login Data", "Cookies"] {
            let p = put(ok.join(n));
            for mode in ["folders", "any"] {
                refused(&p, &json!({ "mode": mode, "folders": [ok.to_str().unwrap()] }), "can't be uploaded");
            }
        }
    }
    #[test]
    fn protected_folders() {
        let t = tmp();
        let ok = t.0.join("ok");
        refused(&put(ok.join(".ssh\\config")), &folders(&ok), "protected folder");
        refused(&put(t.0.join("other\\a.pdf")), &json!({ "mode": "any", "folders": [] }), "protected folder"); // the temp folder is in AppData
        assert!(check_allowed("C:\\WINDOWS\\System32\\drivers\\etc\\hosts", &json!({ "mode": "any" })).is_err());
        assert!(check_allowed("D:\\Photos\\a.jpg", &json!({ "mode": "any" })).is_ok());
    }
    #[test]
    fn off_missing_folder_and_size() {
        let t = tmp();
        let ok = t.0.join("ok");
        let cv = put(ok.join("cv.pdf"));
        for mode in [json!("off"), json!(null), json!("bogus"), json!(1)] {
            refused(&cv, &json!({ "mode": mode, "folders": [ok.to_str().unwrap()] }), "turned off");
        }
        refused(&cv, &json!({}), "turned off");
        refused(&json!(ok.join("nope.pdf").to_str().unwrap()), &folders(&ok), "no file at");
        assert!(read_upload(&json!(ok.join("sub").to_str().unwrap()), &folders(&ok)).is_err());
        fs::write(ok.join("big.bin"), vec![0u8; MAX_FILE as usize + 1]).unwrap();
        refused(&json!(ok.join("big.bin").to_str().unwrap()), &folders(&ok), "larger than 20 MB");
        fs::write(ok.join("empty.txt"), "").unwrap();
        assert_eq!(read_upload(&json!(ok.join("empty.txt").to_str().unwrap()), &folders(&ok)).unwrap().1.len(), 0);
    }
    #[test]
    fn below_compares_whole_names() {
        assert_eq!(below("C:\\a\\b.txt", "C:\\A"), Some("b.txt"));
        assert_eq!(below("C:\\a\\b.txt", "C:\\"), Some("a\\b.txt"));
        assert_eq!(below("C:\\ab\\b.txt", "C:\\a"), None);
        assert_eq!(below("D:\\a\\b.txt", "C:\\a"), None);
        assert_eq!(below("C:\\a", "C:\\a"), None);
    }
}
