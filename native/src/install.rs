// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
//! Installing and removing, for the current user only. No administrator rights are used.
use crate::util::*;
use serde_json::json;
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Com::*;
use windows::Win32::System::Registry::*;
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

pub const NAME: &str = "SharedTabs Bridge";
pub const HELP: &str = "https://ahsan.live/sharedtabs";

/// The extension's store page, or the SharedTabs page until the store has given it an ID.
pub fn store_page() -> String {
    let v: serde_json::Value = serde_json::from_str(include_str!("../update.json")).unwrap_or_default();
    match v["storeId"].as_str() {
        Some(id) if id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b)) => format!("https://chromewebstore.google.com/detail/{id}"),
        _ => HELP.into(),
    }
}

// Overridable so tests never touch the real installation.
fn reg(path: &str) -> String {
    std::env::var("SHAREDTABS_TEST_REGISTRY").map(|r| format!("{r}\\{path}")).unwrap_or_else(|_| path.to_string())
}
fn chrome_key() -> String {
    reg(&format!("Software\\Google\\Chrome\\NativeMessagingHosts\\{HOST_NAME}"))
}
fn uninstall_key() -> String {
    reg("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SharedTabs")
}
pub fn dir() -> PathBuf {
    if let Some(d) = std::env::var_os("SHAREDTABS_TEST_DIR") {
        return d.into();
    }
    PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default()).join("Programs\\SharedTabs")
}
pub fn exe() -> PathBuf {
    dir().join("sharedtabs.exe")
}
fn shortcut() -> PathBuf {
    if let Some(d) = std::env::var_os("SHAREDTABS_TEST_DIR") {
        return PathBuf::from(d).join("SharedTabs Bridge.lnk");
    }
    PathBuf::from(std::env::var_os("APPDATA").unwrap_or_default()).join("Microsoft\\Windows\\Start Menu\\Programs\\SharedTabs Bridge.lnk")
}

/// Packaged (MSIX) apps, and programs started from them, can get a private registry and AppData, so an install
/// from there would do nothing. Windows does not say so and even hides the real path, but the file itself
/// turns up in the app's private folder.
fn redirected() -> bool {
    let local = PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default());
    let d = dir();
    let Ok(rel) = d.strip_prefix(&local).map(Path::to_path_buf) else { return false };
    let existed = d.is_dir();
    if fs::create_dir_all(&d).is_err() {
        return false; // reported when copying
    }
    let name = format!("probe-{}", random_hex(6));
    let probe = d.join(&name);
    let made = fs::write(&probe, "").is_ok();
    let hidden = made
        && fs::read_dir(local.join("Packages")).is_ok_and(|mut l| l.any(|e| e.is_ok_and(|e| e.path().join("LocalCache\\Local").join(&rel).join(&name).is_file())));
    let _ = fs::remove_file(&probe);
    if hidden && !existed {
        let _ = fs::remove_dir(&d);
    }
    hidden
}

fn set(key: &str, name: &str, value: &str) -> Result<(), String> {
    let (k, n, v) = (wide(key), wide(name), wide(value));
    let mut h = HKEY::default();
    unsafe {
        let r = RegCreateKeyExW(HKEY_CURRENT_USER, pcw(&k), 0, PCWSTR::null(), REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, None, &mut h, None);
        if r != ERROR_SUCCESS {
            return Err(format!("The registry could not be changed ({}).", r.0));
        }
        let bytes = std::slice::from_raw_parts(v.as_ptr() as *const u8, v.len() * 2);
        let r = RegSetValueExW(h, pcw(&n), 0, REG_SZ, Some(bytes));
        let _ = RegCloseKey(h);
        if r != ERROR_SUCCESS {
            return Err(format!("The registry could not be changed ({}).", r.0));
        }
    }
    Ok(())
}
fn set_number(key: &str, name: &str, value: u32) {
    let (k, n) = (wide(key), wide(name));
    unsafe { let _ = RegSetKeyValueW(HKEY_CURRENT_USER, pcw(&k), pcw(&n), REG_DWORD.0, Some(&value as *const u32 as *const _), 4); }
}
pub fn get(key: &str, name: &str) -> Option<String> {
    let (k, n) = (wide(key), wide(name));
    let mut buf = vec![0u16; 2048];
    let mut len = (buf.len() * 2) as u32;
    let r = unsafe { RegGetValueW(HKEY_CURRENT_USER, pcw(&k), pcw(&n), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr() as *mut _), Some(&mut len)) };
    (r == ERROR_SUCCESS).then(|| String::from_utf16_lossy(&buf[..(len as usize / 2).saturating_sub(1)]))
}
fn delete(key: &str) {
    let k = wide(key);
    unsafe { let _ = RegDeleteTreeW(HKEY_CURRENT_USER, pcw(&k)); }
}

pub fn installed_version() -> Option<String> {
    get(&uninstall_key(), "DisplayVersion").filter(|_| exe().is_file())
}

fn make_shortcut(target: &Path) -> windows::core::Result<()> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        let (t, d) = (wide(&target.to_string_lossy()), wide("Connects SharedTabs for Chrome to AI agents on this computer"));
        link.SetPath(pcw(&t))?;
        link.SetDescription(pcw(&d))?;
        let f = wide(&shortcut().to_string_lossy());
        link.cast::<IPersistFile>()?.Save(pcw(&f), true)
    }
}

/// Files left from replaced versions that are no longer running.
pub fn clean_old() {
    if let Ok(d) = fs::read_dir(dir()) {
        for e in d.flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            if n.starts_with("sharedtabs.old-") && n.ends_with(".exe") {
                let _ = fs::remove_file(e.path());
            }
        }
    }
}

fn retry<T>(mut f: impl FnMut() -> std::io::Result<T>) -> std::io::Result<T> {
    let mut n = 0;
    loop {
        match f() {
            Err(_) if n < 20 => { // virus scanners hold new files briefly
                n += 1;
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            r => return r,
        }
    }
}

/// Puts this program in place. A copy that is running keeps working until Chrome and the agents restart.
pub fn install() -> Result<(), String> {
    if redirected() {
        return Err("Windows gives apps such as Claude a private copy of some settings, so setup can't work when started from inside one. Open SharedTabs Setup from File Explorer instead.".into());
    }
    let broken = option_env!("SHAREDTABS_TEST_BREAK").is_some(); // test builds only
    let (here, to) = (std::env::current_exe().map_err(|e| e.to_string())?, exe());
    let fail = |e: std::io::Error| format!("SharedTabs could not be copied into place ({e}).");
    fs::create_dir_all(dir()).map_err(fail)?;
    clean_old();
    if here != to {
        let new = dir().join(format!("sharedtabs.new-{}.exe", random_hex(4)));
        fs::copy(&here, &new).map_err(fail)?;
        let old = dir().join(format!("sharedtabs.old-{}.exe", random_hex(4)));
        let had = to.is_file();
        if had {
            retry(|| fs::rename(&to, &old)).map_err(fail)?; // a running program can be renamed, not overwritten
        }
        if let Err(e) = retry(|| fs::rename(&new, &to)) {
            if had {
                let _ = fs::rename(&old, &to);
            }
            let _ = fs::remove_file(&new);
            return Err(fail(e));
        }
    }
    let manifest = dir().join(format!("{HOST_NAME}.json"));
    let origins: Vec<String> = extension_ids().iter().map(|id| format!("chrome-extension://{id}/")).collect();
    let body = json!({ "name": HOST_NAME, "description": NAME, "path": to, "type": "stdio", "allowed_origins": origins });
    fs::write(&manifest, serde_json::to_string_pretty(&body).unwrap_or_default()).map_err(fail)?;
    fs::create_dir_all(endpoint_dir()).map_err(fail)?;
    if broken {
        return Err("broken on purpose".into());
    }
    set(&chrome_key(), "", &manifest.to_string_lossy())?;

    let k = uninstall_key();
    let q = format!("\"{}\"", to.display());
    for (n, v) in [("DisplayName", NAME.to_string()), ("DisplayVersion", VERSION.into()), ("Publisher", "SharedTabs".into()), ("DisplayIcon", to.display().to_string()), ("InstallLocation", dir().display().to_string()), ("UninstallString", format!("{q} uninstall")), ("QuietUninstallString", format!("{q} uninstall /S")), ("URLInfoAbout", HELP.into())] {
        set(&k, n, &v)?;
    }
    set_number(&k, "NoModify", 1);
    set_number(&k, "NoRepair", 1);
    set_number(&k, "EstimatedSize", fs::metadata(&to).map(|m| (m.len() / 1024) as u32).unwrap_or(0));
    let _ = make_shortcut(&to); // a missing shortcut should not fail the installation
    Ok(())
}

/// Removes everything setup made. Returns notes for anything left for the user.
pub fn uninstall() -> Vec<String> {
    let notes: Vec<String> = crate::agents::found().iter().filter_map(|a| a.disconnect(&exe())).collect();
    let ours = dir().join(format!("{HOST_NAME}.json"));
    // Leave the registration alone if something else has replaced it, such as a development copy.
    if get(&chrome_key(), "").is_some_and(|v| Path::new(&v) == ours) {
        delete(&chrome_key());
    }
    delete(&uninstall_key());
    let _ = fs::remove_file(shortcut());
    let _ = fs::remove_file(&ours);
    let _ = fs::remove_file(state_dir().join("host.log"));
    clean_old();
    // A running program cannot delete itself, so a hidden helper does it a moment later. The folder goes only if it is empty.
    let (f, d) = (exe(), dir());
    if f.is_file() && std::env::current_exe().is_ok_and(|me| me == f) {
        let line = format!("/d /c ping -n 3 127.0.0.1 >nul & del /f /q \"{}\" & rd \"{}\"", f.display(), d.display());
        let _ = std::process::Command::new("cmd").raw_arg(line).current_dir(std::env::temp_dir()).creation_flags(0x0800_0000).spawn();
    } else {
        let _ = fs::remove_file(&f);
        let _ = fs::remove_dir(&d);
    }
    notes
}

/// Run on a new version before it replaces this one.
pub fn self_test() -> i32 {
    use std::io::Write;
    let ok = !extension_ids().is_empty() && crate::pipe::Listener::new(&format!("\\\\.\\pipe\\sharedtabs-check-{}", random_hex(8))).is_ok();
    let _ = write!(std::io::stdout(), "sharedtabs {VERSION} {}", if ok { "ok" } else { "bad" });
    if ok { 0 } else { 1 }
}
