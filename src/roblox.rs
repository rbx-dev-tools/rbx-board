//! Reading what Roblox already shows the public.
//!
//! Every endpoint here is one a logged-out visitor can call: player counts,
//! visits, votes and icons are on the experience's own page. Nothing in this
//! process holds a cookie or an API key, and that is a deliberate limit rather
//! than an unfinished feature.
//!
//! It is what makes a server on localhost safe to run. A local HTTP server is
//! reachable by every other program on the machine and by any page open in a
//! browser; one holding a `.ROBLOSECURITY` cookie would be worth attacking, and
//! would need a token, an origin check and a story about DNS rebinding. One that
//! only forwards public numbers is worth nothing to an attacker, so it needs
//! none of that.
//!
//! The cost is that this board shows and does not act. Publishing, renaming and
//! deactivating live in the CLIs, where the credential already is.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

const GAMES: &str = "https://games.roblox.com/v1/games";
const VOTES: &str = "https://games.roblox.com/v1/games/votes";
const ICONS: &str = "https://thumbnails.roblox.com/v1/games/icons";

/// Roblox takes a bounded list of ids per call. Larger boards are split rather
/// than truncated.
const CHUNK: usize = 50;

/// One experience, as the board shows it.
#[derive(Debug, Clone, Serialize)]
pub struct Game {
    pub universe_id: u64,
    pub place_id: u64,
    pub name: String,
    pub label: Option<String>,
    pub playing: u64,
    pub visits: u64,
    pub favorites: u64,
    pub up_votes: u64,
    pub down_votes: u64,
    pub max_players: u64,
    pub icon: Option<String>,
    /// Who owns it: a group or a user. Comes back with the experience itself,
    /// so grouping the board by group costs no extra call.
    pub creator: Option<Creator>,
    /// Anyone may take a copy of the place. Almost always a mistake, and the
    /// reason the old tool had a "problems" list.
    pub copying_allowed: bool,
    /// Roblox has restricted the content. Worth seeing the day it happens
    /// rather than the day somebody notices the visits stopped.
    pub content_restricted: bool,
    /// Roblox returned nothing for this id.
    ///
    /// It means private, deleted, or simply wrong, and the public API does not
    /// say which. The board says exactly that rather than guessing: a wrong
    /// guess here reads as "your game was taken down".
    pub visible: bool,
    /// When Roblox last saw an update, as it reports it.
    pub updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Creator {
    #[serde(default)]
    pub id: u64,
    #[serde(default)]
    pub name: String,
    /// `Group` or `User`.
    #[serde(default, rename = "type")]
    pub kind: String,
}

pub struct Client {
    http: reqwest::blocking::Client,
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Client")
    }
}

impl Client {
    pub fn new() -> Result<Self> {
        Ok(Self {
            http: reqwest::blocking::Client::builder()
                .gzip(true)
                .timeout(Duration::from_secs(20))
                .user_agent(concat!("rbx-board/", env!("CARGO_PKG_VERSION")))
                .build()
                .context("building the HTTP client")?,
        })
    }

    /// Everything the board needs, for every id, in three calls per chunk.
    ///
    /// Votes and icons are separate endpoints from the game itself, and either
    /// can fail on its own. Neither is worth failing the whole board for: a
    /// missing icon is a blank square, a missing vote count is a dash, and a
    /// board that renders is more useful than an error page.
    pub fn games(&self, ids: &[u64], labels: &HashMap<u64, String>) -> Result<Vec<Game>> {
        let mut out = Vec::with_capacity(ids.len());

        for chunk in ids.chunks(CHUNK) {
            let list = join(chunk);

            let details: Envelope<Detail> = self
                .get(&format!("{GAMES}?universeIds={list}"))
                .context("reading the experiences")?;

            let votes: HashMap<u64, Vote> = self
                .get::<Envelope<Vote>>(&format!("{VOTES}?universeIds={list}"))
                .map(|e| e.data.into_iter().map(|v| (v.id, v)).collect())
                .unwrap_or_default();

            let icons: HashMap<u64, Icon> = self
                .get::<Envelope<Icon>>(&format!(
                    "{ICONS}?universeIds={list}&size=150x150&format=Png&isCircular=false"
                ))
                .map(|e| e.data.into_iter().map(|i| (i.target_id, i)).collect())
                .unwrap_or_default();

            let mut seen = Vec::with_capacity(chunk.len());

            for detail in details.data {
                seen.push(detail.id);
                let vote = votes.get(&detail.id);
                let icon = icons
                    .get(&detail.id)
                    .filter(|i| i.state == "Completed")
                    .and_then(|i| i.image_url.clone());

                out.push(Game {
                    universe_id: detail.id,
                    place_id: detail.root_place_id,
                    name: detail.name,
                    label: labels.get(&detail.id).cloned(),
                    playing: detail.playing,
                    visits: detail.visits,
                    favorites: detail.favorited_count,
                    up_votes: vote.map(|v| v.up_votes).unwrap_or(0),
                    down_votes: vote.map(|v| v.down_votes).unwrap_or(0),
                    max_players: detail.max_players,
                    icon,
                    creator: detail.creator,
                    copying_allowed: detail.copying_allowed,
                    content_restricted: detail.is_content_restricted,
                    visible: true,
                    updated: detail.updated,
                });
            }

            // An id Roblox said nothing about still gets a card. Dropping it
            // silently is the failure mode worth avoiding: a game that has gone
            // private or been taken down would simply vanish from the board,
            // which looks exactly like never having added it.
            for id in chunk.iter().filter(|id| !seen.contains(id)) {
                out.push(Game {
                    universe_id: *id,
                    place_id: 0,
                    name: String::new(),
                    label: labels.get(id).cloned(),
                    playing: 0,
                    visits: 0,
                    favorites: 0,
                    up_votes: 0,
                    down_votes: 0,
                    max_players: 0,
                    icon: None,
                    creator: None,
                    copying_allowed: false,
                    content_restricted: false,
                    visible: false,
                    updated: None,
                });
            }
        }

        Ok(out)
    }

    fn get<T: serde::de::DeserializeOwned>(&self, url: &str) -> Result<T> {
        let response = self
            .http
            .get(url)
            .send()
            .with_context(|| format!("calling {url}"))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().unwrap_or_default();
            anyhow::bail!("Roblox returned HTTP {status}: {}", truncate(&body));
        }

        response
            .json()
            .with_context(|| format!("the response to {url} was not the JSON this tool expects"))
    }
}

fn join(ids: &[u64]) -> String {
    ids.iter().map(u64::to_string).collect::<Vec<_>>().join(",")
}

fn truncate(text: &str) -> String {
    const LIMIT: usize = 300;
    if text.len() <= LIMIT {
        return text.to_string();
    }
    let end = text
        .char_indices()
        .map(|(i, _)| i)
        .take_while(|i| *i <= LIMIT)
        .last()
        .unwrap_or(0);
    format!("{}...", &text[..end])
}

// Every field that is not shown is left out rather than typed, so a field
// Roblox renames costs nothing here.

#[derive(Deserialize)]
struct Envelope<T> {
    data: Vec<T>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Detail {
    id: u64,
    #[serde(default)]
    root_place_id: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    playing: u64,
    #[serde(default)]
    visits: u64,
    #[serde(default)]
    favorited_count: u64,
    #[serde(default)]
    max_players: u64,
    #[serde(default)]
    creator: Option<Creator>,
    #[serde(default)]
    copying_allowed: bool,
    #[serde(default)]
    is_content_restricted: bool,
    #[serde(default)]
    updated: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vote {
    id: u64,
    #[serde(default)]
    up_votes: u64,
    #[serde(default)]
    down_votes: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Icon {
    target_id: u64,
    #[serde(default)]
    state: String,
    #[serde(default)]
    image_url: Option<String>,
}
