//! The name a result export suggests (#347): the first free one of `results.csv`, `results (1).csv`, `results (2).csv`
//! and so on, the way Windows names copies. The UI has no permission to look at the disk, so it asks here.

use std::path::{Path, PathBuf};

/// Past this many taken names the last one is suggested anyway: the save dialog still asks before overwriting.
const MAX_SUFFIX: u32 = 9999;

pub fn free_path(dir: &Path, ext: &str) -> PathBuf {
    let mut path = dir.join(format!("results.{ext}"));
    for n in 1..=MAX_SUFFIX {
        if !path.exists() {
            break;
        }
        path = dir.join(format!("results ({n}).{ext}"));
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("panoptic-export-path-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn suggests_plain_name_when_free() {
        let dir = temp_dir("free");
        assert_eq!(free_path(&dir, "csv"), dir.join("results.csv"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn numbers_past_taken_names() {
        let dir = temp_dir("taken");
        std::fs::write(dir.join("results.csv"), "").unwrap();
        assert_eq!(free_path(&dir, "csv"), dir.join("results (1).csv"));
        std::fs::write(dir.join("results (1).csv"), "").unwrap();
        assert_eq!(free_path(&dir, "csv"), dir.join("results (2).csv"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn other_extension_does_not_count() {
        let dir = temp_dir("ext");
        std::fs::write(dir.join("results.csv"), "").unwrap();
        assert_eq!(free_path(&dir, "json"), dir.join("results.json"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn fills_a_gap() {
        let dir = temp_dir("gap");
        std::fs::write(dir.join("results.csv"), "").unwrap();
        std::fs::write(dir.join("results (2).csv"), "").unwrap();
        assert_eq!(free_path(&dir, "csv"), dir.join("results (1).csv"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
