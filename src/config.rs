//! Which experiences the board shows.
//!
//! Two sources, because a project usually already knows: an `rbxboard.toml` you
//! write, and any `rbxplace.toml` lying beside it, which the deploy tools
//! already keep up to date. Reading the second means a game you added to a
//! deploy shows up on the board without being typed a second time.

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

pub const DEFAULT_FILE: &str = "rbxboard.toml";
pub const PLACES_FILE: &str = "rbxplace.toml";

#[derive(Debug, Default, Deserialize)]
pub struct Config {
    #[serde(default, rename = "game")]
    pub games: Vec<Entry>,
}

#[derive(Debug, Deserialize)]
pub struct Entry {
    pub universe_id: u64,
    /// A name of your own. Roblox's name is shown anyway; this is for when the
    /// two differ, which is the whole reason to publish the same game twice.
    #[serde(default)]
    pub label: Option<String>,
}

/// The ids to show, and the labels to show beside them.
#[derive(Debug, Default)]
pub struct Board {
    pub ids: Vec<u64>,
    pub labels: HashMap<u64, String>,
}

impl Board {
    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    fn add(&mut self, id: u64, label: Option<String>) {
        if id == 0 || self.ids.contains(&id) {
            return;
        }
        self.ids.push(id);
        if let Some(label) = label.filter(|l| !l.is_empty()) {
            self.labels.insert(id, label);
        }
    }
}

/// Gather ids from the command line, `rbxboard.toml`, and `rbxplace.toml`.
///
/// Command line first, then the board file, then the deploy targets. Order is
/// only about which label wins when a universe appears twice, and the more
/// deliberate source should.
pub fn resolve(explicit: &[u64], board_file: &Path, places_file: &Path) -> Result<Board> {
    let mut board = Board::default();

    for id in explicit {
        board.add(*id, None);
    }

    if board_file.exists() {
        let text = std::fs::read_to_string(board_file)
            .with_context(|| format!("reading {}", board_file.display()))?;
        let config: Config =
            toml::from_str(&text).with_context(|| format!("parsing {}", board_file.display()))?;

        for entry in config.games {
            board.add(entry.universe_id, entry.label);
        }
    }

    if places_file.exists() {
        let text = std::fs::read_to_string(places_file)
            .with_context(|| format!("reading {}", places_file.display()))?;
        // Parsed loosely: rbx-cli owns this file's schema and adds to it, and a
        // key this tool has never heard of should not stop it finding an id.
        let doc: toml::Value =
            toml::from_str(&text).with_context(|| format!("parsing {}", places_file.display()))?;

        if let Some(table) = doc.as_table() {
            for (name, value) in table {
                if let Some(id) = value.get("universe_id").and_then(toml::Value::as_integer) {
                    if let Ok(id) = u64::try_from(id) {
                        board.add(id, Some(name.clone()));
                    }
                }
            }
        }
    }

    if board.is_empty() {
        bail!(
            "nothing to show. Pass --universe <id>, or write a {} like:\n\n\
             [[game]]\nuniverse_id = 1234567890\nlabel = \"my game\"\n\n\
             An {} from the deploy tools is read too, if there is one here.",
            board_file.display(),
            places_file.display()
        );
    }

    Ok(board)
}
