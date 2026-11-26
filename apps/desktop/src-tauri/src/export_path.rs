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

/// Export all (#376): `count` free names `<base>1.<ext>`, `<base>2.<ext>`, ... in `dir`, numbering past any that are
/// taken, so no existing file is ever written over.
pub fn numbered_free_paths(dir: &Path, base: &str, ext: &str, count: usize) -> Vec<PathBuf> {
    let mut paths = Vec::with_capacity(count);
    let mut n: u32 = 1;
    while paths.len() < count {
        let path = dir.join(format!("{base}{n}.{ext}"));
        if !path.exists() {
            paths.push(path);
        }
        n += 1;
    }
    paths
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
    #[test]
    fn numbers_from_one() {
        let dir = temp_dir("numbered");
        assert_eq!(numbered_free_paths(&dir, "results", "csv", 3), vec![dir.join("results1.csv"), dir.join("results2.csv"), dir.join("results3.csv")]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn numbered_skips_every_taken_name() {
        let dir = temp_dir("numbered-taken");
        std::fs::write(dir.join("orders1.json"), "").unwrap();
        std::fs::write(dir.join("orders3.json"), "").unwrap();
        assert_eq!(numbered_free_paths(&dir, "orders", "json", 3), vec![dir.join("orders2.json"), dir.join("orders4.json"), dir.join("orders5.json")]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
