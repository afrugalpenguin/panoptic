//! The shell is a pipe: it owns the sidecar process and moves newline-delimited JSON-RPC
//! between it and the UI. It never parses or holds connection data.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_shell::ShellExt;
use tauri::async_runtime::Receiver;
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

/// The bundled changelog (ADR 0013), read here so the UI needs no filesystem permission. A missing
/// file is not an error: the app must never fail over its changelog, so it returns an empty string.
#[tauri::command]
fn changelog_markdown(app: AppHandle) -> Result<String, String> {
    let path = app.path().resource_dir().map_err(|e| e.to_string())?.join("CHANGELOG.md");
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Bench mode only: writes results to the path the launcher chose, then exits.
#[tauri::command]
fn bench_finish(app: AppHandle, results: String) -> Result<(), String> {
    let path = std::env::var("PANOPTIC_BENCH_OUT").map_err(|_| "not in bench mode")?;
    std::fs::write(path, results).map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

/// The sidecar process and its supervisor state. Status is kept here as well as emitted, so a UI
/// that subscribes late can still ask for it.
#[derive(Default)]
struct Sidecar {
    child: Mutex<Option<CommandChild>>,
    status: Mutex<Option<SidecarStatus>>,
    /// Set when we kill the sidecar on purpose (update or exit), so the supervisor doesn't restart it.
    stopping: AtomicBool,
    /// Bumped by sidecar_start, so a supervisor from before a stop exits instead of running alongside the new one.
    generation: AtomicU32,
}

#[derive(Clone, serde::Serialize)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum SidecarStatus {
    Starting { attempt: u32 },
    Running { pid: u32 },
    Exited { code: Option<i32> },
    Failed { error: String },
    /// Stopped on purpose (sidecar_stop): not restarted until sidecar_start.
    Stopped,
}

const MAX_CONSECUTIVE_FAILURES: u32 = 5;
/// A sidecar that ran at least this long counts as healthy, resetting the failure count.
const HEALTHY_AFTER: Duration = Duration::from_secs(30);

/// Writes one JSON-RPC message line to the sidecar's stdin.
#[tauri::command]
fn sidecar_send(line: String, sidecar: State<Sidecar>) -> Result<(), String> {
    let mut guard = sidecar.child.lock().map_err(|e| e.to_string())?;
    let child = guard.as_mut().ok_or("sidecar is not running")?;
    child.write(format!("{line}
").as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn sidecar_status(sidecar: State<Sidecar>) -> Option<SidecarStatus> {
    sidecar.status.lock().ok().and_then(|s| s.clone())
}

/// Stops the sidecar for good so the installer can replace its exe during an update. Reports a
/// terminal status, since the supervisor exits without one.
#[tauri::command]
fn sidecar_stop(app: AppHandle, sidecar: State<Sidecar>) -> Result<(), String> {
    stop_sidecar(&sidecar);
    set_status(&app, SidecarStatus::Stopped);
    Ok(())
}

/// Starts a supervisor again after sidecar_stop, e.g. when installing an update failed. Does nothing
/// if the sidecar was not stopped.
#[tauri::command]
fn sidecar_start(app: AppHandle, sidecar: State<Sidecar>) -> Result<(), String> {
    if sidecar.stopping.compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return Ok(());
    }
    let generation = sidecar.generation.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::Builder::new()
        .name("sidecar-supervisor".into())
        .spawn(move || supervise(app, generation))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn stop_sidecar(sidecar: &Sidecar) {
    sidecar.stopping.store(true, Ordering::SeqCst);
    if let Some(child) = sidecar.child.lock().ok().and_then(|mut c| c.take()) {
        let _ = child.kill();
    }
}

fn set_status(app: &AppHandle, status: SidecarStatus) {
    if let Ok(mut s) = app.state::<Sidecar>().status.lock() {
        *s = Some(status.clone());
    }
    let _ = app.emit("sidecar://status", status);
}

/// Runs on its own thread for the life of the app. Spawning can block for seconds on a first run
/// (Defender scanning the new exe, the .NET bundle extracting native libraries), so it must never
/// happen on the UI thread. Restarts the sidecar if it exits, with back-off, and gives up after
/// repeated quick failures rather than looping forever.
fn supervise(app: AppHandle, generation: u32) {
    let sidecar = app.state::<Sidecar>();
    let superseded = || sidecar.stopping.load(Ordering::SeqCst) || sidecar.generation.load(Ordering::SeqCst) != generation;
    let mut failures = 0u32;
    loop {
        if superseded() {
            return;
        }
        set_status(&app, SidecarStatus::Starting { attempt: failures + 1 });
        let started = Instant::now();

        match spawn_sidecar(&app) {
            Ok((rx, pid)) => {
                set_status(&app, SidecarStatus::Running { pid });
                let code = pump(&app, rx);
                if let Ok(mut c) = sidecar.child.lock() {
                    // A newer supervisor may already own the slot.
                    if sidecar.generation.load(Ordering::SeqCst) == generation {
                        c.take();
                    }
                }
                if superseded() {
                    return;
                }
                failures = if started.elapsed() >= HEALTHY_AFTER { 1 } else { failures + 1 };
                set_status(&app, SidecarStatus::Exited { code });
                if failures >= MAX_CONSECUTIVE_FAILURES {
                    set_status(&app, SidecarStatus::Failed { error: format!("database engine exited {failures} times in a row (last code {code:?})") });
                    return;
                }
            }
            Err(e) => {
                failures += 1;
                eprintln!("[shell] sidecar spawn failed (attempt {failures}): {e}");
                if failures >= MAX_CONSECUTIVE_FAILURES {
                    set_status(&app, SidecarStatus::Failed { error: e.to_string() });
                    return;
                }
            }
        }
        // 0.5 s, 1 s, 2 s, 4 s...
        std::thread::sleep(Duration::from_millis(500 * 2u64.pow(failures.saturating_sub(1).min(4))));
    }
}

fn spawn_sidecar(app: &AppHandle) -> Result<(Receiver<CommandEvent>, u32), Box<dyn std::error::Error>> {
    let mut command = app.shell().sidecar("panoptic-sidecar")?;
    // WAM (Entra sign-in) dialogs need a parent window, which only the shell can provide.
    #[cfg(windows)]
    if let Some(hwnd) = app.get_webview_window("main").and_then(|w| w.hwnd().ok()) {
        command = command.env("PANOPTIC_PARENT_HWND", (hwnd.0 as isize).to_string());
    }
    let (rx, child) = command.spawn()?;
    let pid = child.pid();
    *app.state::<Sidecar>().child.lock().map_err(|e| e.to_string())? = Some(child);
    Ok((rx, pid))
}

/// Forwards sidecar output to the UI until the process ends. Returns its exit code.
fn pump(app: &AppHandle, mut rx: Receiver<CommandEvent>) -> Option<i32> {
    while let Some(event) = tauri::async_runtime::block_on(rx.recv()) {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
                let _ = app.emit("sidecar://message", line);
            }
            CommandEvent::Stderr(bytes) => {
                eprintln!("[sidecar] {}", String::from_utf8_lossy(&bytes).trim_end());
            }
            CommandEvent::Terminated(payload) => return payload.code,
            _ => {}
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    MAIN_START_EPOCH_MS.get_or_init(epoch_ms);
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Export: a save dialog, then writing the one file the user picked (the dialog adds it to the fs scope).
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // What's new: https links in release notes open in the browser.
        .plugin(tauri_plugin_opener::init())
        .manage(Sidecar::default())
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::Builder::new().name("sidecar-supervisor".into()).spawn(move || supervise(handle, 0))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sidecar_send, sidecar_stop, sidecar_start, sidecar_status, startup_info, bench_finish, is_installed, changelog_markdown])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_sidecar(&app.state::<Sidecar>());
            }
        });
}
