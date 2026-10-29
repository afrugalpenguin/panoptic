//! The shell is a pipe: it owns the sidecar process and moves newline-delimited JSON-RPC
//! between it and the UI. It never parses or holds connection data.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

#[derive(Default)]
struct Sidecar(Mutex<Option<CommandChild>>);

/// Writes one JSON-RPC message line to the sidecar's stdin.
#[tauri::command]
fn sidecar_send(line: String, sidecar: State<Sidecar>) -> Result<(), String> {
    let mut guard = sidecar.0.lock().map_err(|e| e.to_string())?;
    let child = guard.as_mut().ok_or("sidecar is not running")?;
    child.write(format!("{line}\n").as_bytes()).map_err(|e| e.to_string())
}

/// Stops the sidecar so the installer can replace its exe during an update.
#[tauri::command]
fn sidecar_stop(sidecar: State<Sidecar>) -> Result<(), String> {
    match sidecar.0.lock().map_err(|e| e.to_string())?.take() {
        Some(child) => child.kill().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

fn spawn_sidecar(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let (mut rx, child) = app.shell().sidecar("panoptic-sidecar")?.spawn()?;
    *app.state::<Sidecar>().0.lock().unwrap() = Some(child);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
                    let _ = app.emit("sidecar://message", line);
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!("[sidecar] {}", String::from_utf8_lossy(&bytes).trim_end());
                }
                CommandEvent::Terminated(payload) => {
                    app.state::<Sidecar>().0.lock().unwrap().take();
                    let _ = app.emit("sidecar://exit", payload.code);
                }
                _ => {}
            }
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Sidecar::default())
        .setup(|app| {
            spawn_sidecar(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sidecar_send, sidecar_stop])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(child) = app.state::<Sidecar>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
