#![windows_subsystem = "windows"]
mod agents;
mod files;
mod host;
mod install;
mod mcp;
mod pipe;
mod ui;
mod update;
mod util;

use std::io::Write;

fn say(r: Result<(), String>) -> i32 {
    match r {
        Ok(()) => 0,
        Err(e) => {
            let _ = writeln!(std::io::stdout(), "{e}");
            1
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(caller) = args.iter().find(|a| a.starts_with("chrome-extension://")) {
        return host::run(caller); // started by Chrome
    }
    let silent = args.iter().any(|a| a == "/S");
    let code = match (args.first().map(String::as_str), silent) {
        (Some("mcp"), _) => { mcp::run(); 0 }
        (Some("selftest"), _) => install::self_test(),
        (Some("install"), true) => say(install::install()),
        (Some("uninstall"), true) => {
            for n in install::uninstall() {
                let _ = writeln!(std::io::stdout(), "{n}");
            }
            0
        }
        // The same steps as the window's buttons, without the window. Still only newer, signed releases.
        (Some("update"), true) => say(update::check().and_then(|r| match r {
            Some(r) => update::apply(&r).map(|_| { let _ = writeln!(std::io::stdout(), "Updated to {}", r.version); }),
            None => { let _ = writeln!(std::io::stdout(), "You have the newest version."); Ok(()) }
        })),
        (Some("uninstall"), false) => { ui::run(ui::Start::Remove); 0 }
        (Some("update"), false) => { ui::run(ui::Start::Update); 0 }
        _ => { ui::run(ui::Start::Auto); 0 }
    };
    std::process::exit(code)
}
