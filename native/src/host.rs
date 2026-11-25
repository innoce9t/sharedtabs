//! Native messaging host. Chrome starts this, and only for the extension IDs in the host manifest.
//! It relays requests from local MCP servers (named pipe) to the extension (stdio).
use crate::files::read_upload;
use crate::pipe::{Listener, Pipe};
use crate::util::*;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, OnceLock};

struct Client {
    out: Sender<Vec<u8>>,
    pipe: Arc<Pipe>,
}
#[derive(Default)]
struct State {
    clients: HashMap<u64, Client>,
    pending: HashMap<u64, (u64, Value)>, // bridge id -> (client, the client's own id)
    next: u64,
}
static ENDPOINT: OnceLock<PathBuf> = OnceLock::new();

fn shutdown() -> ! {
    if let Some(f) = ENDPOINT.get() {
        let _ = fs::remove_file(f);
    }
    std::process::exit(0)
}

/// 4-byte length and JSON on stdout, one message at a time.
fn to_extension(v: &Value) {
    static LOCK: Mutex<()> = Mutex::new(());
    let body = v.to_string().into_bytes();
    let mut m = (body.len() as u32).to_le_bytes().to_vec();
    m.extend(body);
    let _g = LOCK.lock();
    let mut o = std::io::stdout().lock();
    if o.write_all(&m).and_then(|_| o.flush()).is_err() {
        shutdown();
    }
}

pub fn run(caller: &str) {
    let _ = fs::create_dir_all(endpoint_dir());
    if !extension_ids().iter().any(|id| caller == format!("chrome-extension://{id}/")) {
        log(&format!("refused caller {caller}"));
        std::process::exit(1);
    }
    let state = Arc::new(Mutex::new(State::default()));
    let name = format!("\\\\.\\pipe\\hermes-chrome-{}", random_hex(16));
    let listener = Listener::new(&name);
    match listener {
        Ok(l) => {
            let file = endpoint_dir().join(format!("{}.json", std::process::id()));
            let _ = ENDPOINT.set(file.clone());
            let st = state.clone();
            std::thread::spawn(move || serve(l, st));
            let entry = json!({ "pipe": name, "pid": std::process::id(), "createdAt": now_ms(), "bridge": VERSION });
            if fs::write(file, entry.to_string()).is_err() {
                to_extension(&json!({ "type": "fatal", "error": "The bridge could not write to its folder in your user profile." }));
                shutdown();
            }
            to_extension(&json!({ "type": "ready", "bridge": VERSION, "features": ["files", "gif", "updater"] }));
            log("ready");
        }
        Err(e) => {
            log(&format!("pipe error {e}"));
            to_extension(&json!({ "type": "fatal", "error": format!("Could not open the local pipe: {e}") }));
            std::thread::sleep(std::time::Duration::from_millis(200));
            shutdown();
        }
    }

    let mut i = std::io::stdin().lock();
    loop {
        let mut head = [0u8; 4];
        if i.read_exact(&mut head).is_err() {
            shutdown();
        }
        let len = u32::from_le_bytes(head) as usize;
        if len > 64 * 1024 * 1024 {
            log("message too large");
            shutdown();
        }
        let mut body = vec![0u8; len];
        if i.read_exact(&mut body).is_err() {
            shutdown();
        }
        match serde_json::from_slice::<Value>(&body) {
            Ok(v) => from_extension(v, &state),
            Err(e) => log(&format!("bad message {e}")),
        }
    }
}

fn from_extension(v: Value, state: &Arc<Mutex<State>>) {
    match v["type"].as_str() {
        Some("res") => {
            let Some(id) = v["id"].as_u64() else { return };
            let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
            let Some((client, own)) = s.pending.remove(&id) else { return };
            if let Some(c) = s.clients.get(&client) {
                let mut line = json!({ "id": own, "ok": v["ok"], "result": v["result"], "error": v["error"] }).to_string().into_bytes();
                line.push(b'\n');
                let _ = c.out.send(line);
            }
        }
        // Reading or saving a large file must not hold up everything else.
        Some("readFile") => { std::thread::spawn(move || send_file(v)); }
        Some("saveGif") => { std::thread::spawn(move || save_gif(v)); }
        Some("openUpdater") => crate::update::open_window(),
        _ => {}
    }
}

const CHUNK: usize = 510_000; // a multiple of 3, so the base64 pieces join up; under Chrome's 1 MB message limit
fn send_file(v: Value) {
    match read_upload(&v["path"], &v["policy"]) {
        Ok((name, data)) => {
            let mut at = 0;
            loop {
                let end = (at + CHUNK).min(data.len());
                to_extension(&json!({ "type": "file", "id": v["id"], "name": name, "size": data.len(), "chunk": to_base64(&data[at..end]), "last": end == data.len() }));
                at = end;
                if at >= data.len() {
                    return;
                }
            }
        }
        Err(e) => to_extension(&json!({ "type": "file", "id": v["id"], "error": e })),
    }
}

/// Recordings: the extension supplies only the image. The folder and name are chosen here, and nothing is overwritten.
fn save_gif(v: Value) {
    let saved = (|| -> Result<PathBuf, String> {
        let data = from_base64(v["data"].as_str().unwrap_or("")).ok_or("that is not a recording")?;
        if !data.starts_with(b"GIF89a") {
            return Err("that is not a recording".into());
        }
        let dir = std::env::var_os("HERMES_CHROME_DOWNLOADS").map(PathBuf::from).unwrap_or_else(|| home().join("Downloads"));
        let (y, mo, d, h, mi, s) = utc();
        let file = dir.join(format!("agent-recording-{y:04}{mo:02}{d:02}-{h:02}{mi:02}{s:02}-{}.gif", random_hex(2)));
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&file).map_err(|e| e.to_string())?;
        f.write_all(&data).map_err(|e| e.to_string())?;
        Ok(file)
    })();
    to_extension(&match saved {
        Ok(f) => json!({ "type": "file", "id": v["id"], "saved": f.to_string_lossy() }),
        Err(e) => json!({ "type": "file", "id": v["id"], "error": format!("The recording could not be saved: {e}") }),
    });
}

fn serve(mut l: Listener, state: Arc<Mutex<State>>) {
    let mut n = 0u64;
    loop {
        let pipe = match l.accept() {
            Ok(p) => p,
            Err(e) => {
                log(&format!("accept {e}"));
                std::thread::sleep(std::time::Duration::from_millis(200));
                continue;
            }
        };
        n += 1;
        let id = n;
        let (tx, rx) = channel::<Vec<u8>>();
        let w = pipe.clone();
        std::thread::spawn(move || {
            for m in rx {
                if w.write_all(&m).is_err() {
                    w.cancel();
                    return;
                }
            }
        });
        let count = {
            let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
            s.clients.insert(id, Client { out: tx, pipe: pipe.clone() });
            s.clients.len()
        };
        to_extension(&json!({ "type": "clients", "count": count }));
        let st = state.clone();
        std::thread::spawn(move || {
            pipe.lines(MAX_REQUEST, |line| from_client(id, line, &st));
            let (gone, count) = {
                let mut s = st.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(c) = s.clients.remove(&id) {
                    c.pipe.disconnect();
                }
                let gone: Vec<u64> = s.pending.iter().filter(|(_, p)| p.0 == id).map(|(k, _)| *k).collect();
                for k in &gone {
                    s.pending.remove(k);
                }
                (gone, s.clients.len())
            };
            for k in gone {
                to_extension(&json!({ "type": "cancel", "id": k }));
            }
            to_extension(&json!({ "type": "clients", "count": count }));
        });
    }
}

/// False ends the connection.
fn from_client(client: u64, line: &[u8], state: &Arc<Mutex<State>>) -> bool {
    let Ok(v) = serde_json::from_slice::<Value>(line) else { return false };
    if v["type"] == "cancel" {
        let hit = {
            let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
            let k = s.pending.iter().find(|(_, p)| p.0 == client && p.1 == v["id"]).map(|(k, _)| *k);
            if let Some(k) = k {
                s.pending.remove(&k);
            }
            k
        };
        if let Some(k) = hit {
            to_extension(&json!({ "type": "cancel", "id": k }));
        }
        return true;
    }
    let Some(method) = v["method"].as_str() else { return true };
    let id = {
        let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
        s.next += 1;
        let id = s.next;
        s.pending.insert(id, (client, v["id"].clone()));
        id
    };
    let name: String = v["client"].as_str().unwrap_or("").chars().take(60).collect();
    let params = if v["params"].is_null() { json!({}) } else { v["params"].clone() };
    to_extension(&json!({ "type": "req", "id": id, "method": method, "params": params, "client": name }));
    true
}
