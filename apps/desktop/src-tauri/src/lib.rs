//! The shell is a pipe: it owns the sidecar process and moves newline-delimited JSON-RPC
//! between it and the UI. It never parses or holds connection data.

use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

static MAIN_START_EPOCH_MS: OnceLock<f64> = OnceLock::new();

fn epoch_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupInfo {
    main_start_epoch_ms: f64,
    /// Set by scripts/bench.ps1: "startup" or "ui".
    bench_mode: Option<String>,
}

#[tauri::command]
fn startup_info() -> StartupInfo {
    StartupInfo {
        main_start_epoch_ms: *MAIN_START_EPOCH_MS.get().unwrap_or(&0.0),
        bench_mode: std::env::var("PANOPTIC_BENCH").ok().filter(|m| m == "startup" || m == "ui"),
    }
}

/// True when running from the per-user installer (which drops uninstall.exe next to the app).
/// A portable copy unzipped anywhere else cannot be updated in place.
#[tauri::command]
fn is_installed() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("uninstall.exe").exists()))
        .unwrap_or(false)
}

/// Bench mode only: writes results to the path the launcher chose, then exits.
#[tauri::command]
fn bench_finish(app: AppHandle, results: String) -> Result<(), String> {
    let path = std::env::var("PANOPTIC_BENCH_OUT").map_err(|_| "not in bench mode")?;
    std::fs::write(path, results).map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

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
    let mut command = app.shell().sidecar("panoptic-sidecar")?;
    // WAM (Entra sign-in) dialogs need a parent window, which only the shell can provide.
    #[cfg(windows)]
    if let Some(hwnd) = app.get_webview_window("main").and_then(|w| w.hwnd().ok()) {
        command = command.env("PANOPTIC_PARENT_HWND", (hwnd.0 as isize).to_string());
    }
    let (mut rx, child) = command.spawn()?;
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
    MAIN_START_EPOCH_MS.get_or_init(epoch_ms);
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Sidecar::default())
        .setup(|app| {
            spawn_sidecar(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sidecar_send, sidecar_stop, startup_info, bench_finish, is_installed])
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
