//! What the user gets to see when the database engine (the sidecar) will not stay up (#191). Release builds have no
//! console, so the sidecar's stderr is kept in two places: the last few lines in memory, to explain a give-up in the
//! UI, and a small rolling log file. The sidecar never writes secrets to stderr (driver messages are checked for
//! them, #180; requests and their parameters are never logged).

use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Lines of the sidecar's stderr kept for the give-up message.
pub const TAIL_LINES: usize = 20;
/// The log is moved aside to `<name>.1.log` once it is this big, so it never grows past twice this.
pub const LOG_MAX_BYTES: u64 = 1024 * 1024;

/// The last [`TAIL_LINES`] non-empty stderr lines of one sidecar run.
#[derive(Default)]
pub struct Tail(VecDeque<String>);

impl Tail {
    pub fn push(&mut self, line: &str) {
        let line = line.trim_end();
        if line.trim().is_empty() {
            return;
        }
        if self.0.len() == TAIL_LINES {
            self.0.pop_front();
        }
        self.0.push_back(line.to_string());
    }

    pub fn last(&self) -> Option<&str> {
        self.0.back().map(String::as_str)
    }
}

/// The give-up message: how often and how it ended, what the engine last said, and where the full log is.
pub fn failure_text(failures: u32, code: Option<i32>, tail: &Tail, log: Option<&Path>) -> String {
    let mut text = format!("Database engine exited {failures} times in a row");
    match code {
        Some(code) => text.push_str(&format!(" (exit code {code})")),
        None => text.push_str(" (no exit code)"),
    }
    if let Some(last) = tail.last() {
        text.push_str(&format!(": {}", last.trim_end_matches('.')));
    }
    if let Some(log) = log {
        text.push_str(&format!(". Details in {}", log.display()));
    }
    text
}

/// Appends lines to the sidecar log, rolling it over at [`LOG_MAX_BYTES`]. Logging is best effort: a log that cannot
/// be written never stops the engine.
pub struct Log {
    path: PathBuf,
}

impl Log {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Moves a full log aside (replacing an older one). Called before each sidecar start.
    pub fn roll_if_full(&self) {
        if fs::metadata(&self.path).map(|m| m.len() >= LOG_MAX_BYTES).unwrap_or(false) {
            let _ = fs::rename(&self.path, self.path.with_extension("1.log"));
        }
    }

    pub fn write(&self, line: &str) {
        if let Some(dir) = self.path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&self.path) {
            let _ = writeln!(file, "{} {}", timestamp(), line.trim_end());
        }
    }
}

/// Seconds since the Unix epoch, UTC: enough to line entries up without a date crate.
fn timestamp() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    format!("[{}.{:03}]", now.as_secs(), now.subsec_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("panoptic-diag-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn tail_keeps_the_last_lines_and_skips_blank_ones() {
        let mut tail = Tail::default();
        for i in 0..30 {
            tail.push(&format!("line {i}\r\n"));
            tail.push("   ");
        }
        assert_eq!(tail.0.len(), TAIL_LINES);
        assert_eq!(tail.0.front().map(String::as_str), Some("line 10"));
        assert_eq!(tail.last(), Some("line 29"));
    }

    #[test]
    fn failure_text_says_what_the_engine_last_said_and_where_the_log_is() {
        let mut tail = Tail::default();
        tail.push("Unhandled exception. System.IO.IOException: The process cannot access the file");
        tail.push("Panoptic could not open its saved connections file: it is in use by another program.");
        let text = failure_text(5, Some(3), &tail, Some(Path::new(r"C:\logs\sidecar.log")));
        assert_eq!(
            text,
            r"Database engine exited 5 times in a row (exit code 3): Panoptic could not open its saved connections file: it is in use by another program. Details in C:\logs\sidecar.log"
        );
    }

    #[test]
    fn failure_text_without_output_or_code_is_still_readable() {
        assert_eq!(failure_text(5, None, &Tail::default(), None), "Database engine exited 5 times in a row (no exit code)");
        assert!(!failure_text(5, Some(1), &Tail::default(), None).contains("Some("));
    }

    #[test]
    fn log_appends_and_rolls_over_when_full() {
        let dir = temp_dir("roll");
        let log = Log::new(dir.join("sidecar.log"));
        log.write("first");
        log.write("second\n");
        let text = fs::read_to_string(log.path()).unwrap();
        assert_eq!(text.lines().count(), 2);
        assert!(text.lines().next().unwrap().ends_with(" first"));

        log.roll_if_full();
        assert!(log.path().exists(), "a small log is kept");

        fs::write(log.path(), vec![b'x'; LOG_MAX_BYTES as usize]).unwrap();
        log.roll_if_full();
        assert!(!log.path().exists());
        assert_eq!(fs::metadata(dir.join("sidecar.1.log")).unwrap().len(), LOG_MAX_BYTES);
        log.write("after roll");
        assert_eq!(fs::read_to_string(log.path()).unwrap().lines().count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }
}
