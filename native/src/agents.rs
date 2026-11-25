// SharedTabs. Copyright (C) 2026 Ahsan Nawazish. SPDX-License-Identifier: AGPL-3.0-only. Additional terms: ADDITIONAL-TERMS.md (LICENSE.txt in the download)
//! Connecting AI agents on this computer to the bridge. Only the ones the user ticks are touched.
use crate::util::home;
use serde_json::{json, Map, Value};
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

pub const SERVER: &str = "shared-tabs";
const CREATE_NEW_CONSOLE: u32 = 0x10;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone)]
pub struct Agent {
    pub id: &'static str,
    pub name: &'static str,
    how: How,
}
#[derive(Clone)]
enum How {
    Json(PathBuf),
    Cli(PathBuf, &'static str),
    Hermes(PathBuf),
}

fn env_dir(v: &str) -> PathBuf {
    std::env::var_os(v).map(PathBuf::from).unwrap_or_default()
}
fn on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for d in std::env::split_paths(&path).filter(|d| d.is_absolute()) {
        for ext in ["exe", "cmd"] {
            let f = d.join(format!("{name}.{ext}"));
            if f.is_file() {
                return Some(f);
            }
        }
    }
    None
}
fn claude_desktop() -> Option<PathBuf> {
    // The packaged app keeps its settings in its own folder.
    if let Ok(dir) = fs::read_dir(env_dir("LOCALAPPDATA").join("Packages")) {
        for e in dir.flatten() {
            if e.file_name().to_string_lossy().starts_with("Claude_") {
                let d = e.path().join("LocalCache\\Roaming\\Claude");
                if d.is_dir() {
                    return Some(d.join("claude_desktop_config.json"));
                }
            }
        }
    }
    let d = env_dir("APPDATA").join("Claude");
    d.is_dir().then(|| d.join("claude_desktop_config.json"))
}

/// Agents found on this computer.
pub fn found() -> Vec<Agent> {
    let mut out = Vec::new();
    let hermes = on_path("hermes").or_else(|| Some(env_dir("LOCALAPPDATA").join("hermes\\bin\\hermes.exe")).filter(|p| p.is_file()));
    if let Some(p) = hermes {
        out.push(Agent { id: "hermes", name: "Hermes Agent", how: How::Hermes(p) });
    }
    if let Some(p) = claude_desktop() {
        out.push(Agent { id: "claude-desktop", name: "Claude Desktop", how: How::Json(p) });
    }
    if let Some(p) = on_path("claude") {
        out.push(Agent { id: "claude-code", name: "Claude Code", how: How::Cli(p, "claude") });
    }
    if home().join(".cursor").is_dir() {
        out.push(Agent { id: "cursor", name: "Cursor", how: How::Json(home().join(".cursor\\mcp.json")) });
    }
    if let Some(p) = on_path("codex") {
        out.push(Agent { id: "codex", name: "Codex", how: How::Cli(p, "codex") });
    }
    out
}

pub fn settings_text(exe: &Path) -> String {
    serde_json::to_string_pretty(&json!({ "mcpServers": { SERVER: { "command": exe, "args": ["mcp"] } } })).unwrap_or_default()
}

fn read_settings(file: &Path) -> Result<Option<(String, Map<String, Value>)>, String> {
    let text = match fs::read_to_string(file) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("its settings could not be read ({e})")),
    };
    if text.trim().is_empty() {
        return Ok(Some((text, Map::new())));
    }
    match serde_json::from_str::<Value>(text.trim_start_matches('\u{feff}')) {
        Ok(Value::Object(m)) => Ok(Some((text, m))),
        _ => Err("its settings file has comments or errors, so it was left alone. Use Copy settings instead".into()),
    }
}
/// Writes beside the file and swaps it in, so a failure cannot leave half a settings file.
fn write_settings(file: &Path, old: Option<&str>, m: &Map<String, Value>) -> Result<(), String> {
    let err = |e: std::io::Error| format!("its settings could not be saved ({e})");
    let side = |ext: &str| PathBuf::from(format!("{}.{ext}", file.display()));
    fs::create_dir_all(file.parent().unwrap_or(file)).map_err(err)?;
    if let Some(o) = old {
        fs::write(side("sharedtabs-backup"), o).map_err(err)?;
    }
    let new = side("sharedtabs-new");
    fs::write(&new, serde_json::to_string_pretty(m).unwrap_or_default() + "\n").map_err(err)?;
    fs::rename(&new, file).map_err(err)
}

pub fn add_to_settings(file: &Path, exe: &Path) -> Result<(), String> {
    let before = read_settings(file)?;
    let mut m = before.as_ref().map(|b| b.1.clone()).unwrap_or_default();
    let servers = m.entry("mcpServers").or_insert_with(|| json!({}));
    let Some(s) = servers.as_object_mut() else { return Err("its settings have an unexpected shape, so they were left alone".into()) };
    s.insert(SERVER.into(), json!({ "command": exe, "args": ["mcp"] }));
    write_settings(file, before.as_ref().map(|b| b.0.as_str()), &m)
}
/// Removes the entry only if it is this program's.
pub fn remove_from_settings(file: &Path, exe: &Path) -> Result<bool, String> {
    let Some((text, mut m)) = read_settings(file)? else { return Ok(false) };
    let Some(s) = m.get_mut("mcpServers").and_then(|s| s.as_object_mut()) else { return Ok(false) };
    if !s.get(SERVER).is_some_and(|e| e["command"].as_str().is_some_and(|c| Path::new(c) == exe)) {
        return Ok(false);
    }
    s.shift_remove(SERVER);
    write_settings(file, Some(&text), &m)?;
    Ok(true)
}

fn quiet(program: &Path, args: &[&str]) -> Command {
    // .cmd files need cmd, and the arguments here are fixed words plus our own path.
    let mut c = if program.extension().is_some_and(|e| e.eq_ignore_ascii_case("cmd")) {
        let mut c = Command::new("cmd");
        c.arg("/d").arg("/c").arg(program);
        c
    } else {
        Command::new(program)
    };
    c.args(args).creation_flags(CREATE_NO_WINDOW);
    c
}

impl Agent {
    /// What the user should know afterwards, or why it did not work.
    pub fn connect(&self, exe: &Path) -> Result<String, String> {
        let e = exe.to_string_lossy();
        match &self.how {
            How::Json(f) => add_to_settings(f, exe).map(|_| format!("{}: connected. Restart it to use SharedTabs.", self.name)),
            How::Cli(p, kind) => {
                let args: Vec<&str> = if *kind == "claude" { vec!["mcp", "add", "--scope", "user", SERVER, "--", &e, "mcp"] } else { vec!["mcp", "add", SERVER, "--", &e, "mcp"] };
                let o = quiet(p, &args).output().map_err(|x| x.to_string())?;
                if o.status.success() {
                    Ok(format!("{}: connected. Start a new session to use SharedTabs.", self.name))
                } else {
                    let why = String::from_utf8_lossy(if o.stderr.is_empty() { &o.stdout } else { &o.stderr }).trim().chars().take(160).collect::<String>();
                    if why.contains("already exists") { Ok(format!("{}: already connected.", self.name)) } else { Err(why) }
                }
            }
            How::Hermes(p) => {
                // Hermes asks which tools to turn on, so it gets its own window.
                Command::new(p).args(["mcp", "add", SERVER, "--command", &e, "--args", "mcp"]).creation_flags(CREATE_NEW_CONSOLE).spawn().map_err(|x| x.to_string())?;
                Ok("Hermes Agent: answer its questions in the new window, then restart the gateway or use /reload-mcp.".into())
            }
        }
    }
    /// A note for the user when something is left for them to do.
    pub fn disconnect(&self, exe: &Path) -> Option<String> {
        match &self.how {
            How::Json(f) => remove_from_settings(f, exe).err().map(|e| format!("{}: {e}.", self.name)),
            How::Cli(p, kind) => {
                let args: &[&str] = if *kind == "claude" { &["mcp", "remove", "--scope", "user", SERVER] } else { &["mcp", "remove", SERVER] };
                let _ = quiet(p, args).output();
                None
            }
            How::Hermes(_) => Some(format!("Hermes Agent: if you connected it, run \"hermes mcp remove {SERVER}\".")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("sharedtabs agents {}", crate::util::random_hex(6)));
        fs::create_dir_all(&d).unwrap();
        d
    }
    #[test]
    fn settings_files() {
        let d = tmp();
        let exe = Path::new("C:\\Some Folder\\sharedtabs.exe");
        let f = d.join("new\\mcp.json");
        add_to_settings(&f, exe).unwrap(); // made when missing
        let v: Value = serde_json::from_str(&fs::read_to_string(&f).unwrap()).unwrap();
        assert_eq!(v, json!({ "mcpServers": { "shared-tabs": { "command": "C:\\Some Folder\\sharedtabs.exe", "args": ["mcp"] } } }));

        // everything else is kept, in order, and the original is backed up
        let g = d.join("g.json");
        let before = "\u{feff}{\n  \"z\": 1,\n  \"mcpServers\": { \"other\": { \"command\": \"x\" } },\n  \"a\": [1, {\"b\": null}]\n}";
        fs::write(&g, before).unwrap();
        add_to_settings(&g, exe).unwrap();
        add_to_settings(&g, exe).unwrap(); // twice changes nothing more
        let m: Map<String, Value> = serde_json::from_str(&fs::read_to_string(&g).unwrap()).unwrap();
        assert_eq!(m.keys().collect::<Vec<_>>(), ["z", "mcpServers", "a"]);
        assert_eq!(m["mcpServers"]["other"]["command"], "x");
        assert!(d.join("g.json.sharedtabs-backup").is_file());

        // removal takes only our own entry
        assert!(!remove_from_settings(&g, Path::new("C:\\else.exe")).unwrap());
        assert!(remove_from_settings(&g, exe).unwrap());
        assert!(!remove_from_settings(&g, exe).unwrap());
        let m: Value = serde_json::from_str(&fs::read_to_string(&g).unwrap()).unwrap();
        assert_eq!(m["mcpServers"], json!({ "other": { "command": "x" } }));

        // files we do not understand are left exactly as they were
        for bad in ["{ // comment\n }", "[]", "{\"mcpServers\": []}", "{\"a\":", "\"x\""] {
            let h = d.join("h.json");
            fs::write(&h, bad).unwrap();
            assert!(add_to_settings(&h, exe).is_err(), "{bad}");
            assert_eq!(fs::read_to_string(&h).unwrap(), bad);
        }
        fs::remove_dir_all(d).unwrap();
    }
}
