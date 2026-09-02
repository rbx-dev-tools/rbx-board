mod config;
mod roblox;

use anyhow::{Context, Result};
use clap::Parser;
use std::io::Cursor;
use std::net::{Ipv4Addr, SocketAddrV4};
use std::sync::Mutex;
use std::time::{Duration, Instant};

// Baked into the binary, so the executable is the whole program: nothing to
// install beside it and nothing to find at runtime.
const INDEX: &str = include_str!("../web/index.html");
const APP_JS: &str = include_str!("../web/app.js");
const STYLE: &str = include_str!("../web/style.css");

/// Roblox's numbers do not move fast enough to be worth asking twice in a
/// quarter of a minute, and the page polls.
const CACHE: Duration = Duration::from_secs(15);

#[derive(Parser, Debug)]
#[command(
    name = "rbx-board",
    version,
    about = "A local board of your Roblox experiences",
    long_about = "Serves a page on this machine showing players, visits, votes and \
                  icons for the experiences you name. Reads only what Roblox already \
                  shows the public, so it holds no cookie and no API key."
)]
struct Cli {
    /// An experience to show. Repeatable. Adds to whatever the config files say.
    #[arg(long = "universe", short = 'u', value_name = "ID")]
    universes: Vec<u64>,

    /// The board's own config.
    #[arg(long, value_name = "PATH", default_value = config::DEFAULT_FILE)]
    config: std::path::PathBuf,

    /// The deploy tools' env file, read for universe ids if it is there.
    #[arg(long, value_name = "PATH", default_value = config::PLACES_FILE)]
    places_file: std::path::PathBuf,

    /// Port to listen on. 0, the default, takes whatever is free.
    #[arg(long, short, default_value_t = 0)]
    port: u16,

    /// Print the address instead of opening a browser.
    #[arg(long)]
    no_open: bool,
}

struct Cache {
    games: Vec<roblox::Game>,
    at: Instant,
}

fn main() -> std::process::ExitCode {
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("Error: {e:#}");
            std::process::ExitCode::FAILURE
        }
    }
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    let board = config::resolve(&cli.universes, &cli.config, &cli.places_file)?;
    let client = roblox::Client::new()?;

    // 127.0.0.1, never 0.0.0.0. This is a page for the person at this machine,
    // and binding the loopback is what keeps it off the network the laptop is
    // on. It holds nothing secret, but "nothing secret" is not a reason to
    // publish a service to a coffee shop's wifi.
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, cli.port);
    let server = tiny_http::Server::http(address)
        .map_err(|e| anyhow::anyhow!("could not listen on {address}: {e}"))?;

    let url = format!(
        "http://{}",
        server
            .server_addr()
            .to_ip()
            .context("the server has no address")?
    );

    println!("{} experience(s) on {url}", board.ids.len());
    println!("Ctrl-C to stop.");

    if !cli.no_open {
        // A failure here is not a failure of the program: the address is
        // printed above and a browser can be pointed at it by hand.
        if let Err(e) = open::that_detached(&url) {
            eprintln!("Could not open a browser ({e}). Open {url} yourself.");
        }
    }

    let cache: Mutex<Option<Cache>> = Mutex::new(None);

    for request in server.incoming_requests() {
        let response = match request.url().split('?').next().unwrap_or("/") {
            "/" => html(INDEX),
            "/app.js" => asset(APP_JS, "text/javascript; charset=utf-8"),
            "/style.css" => asset(STYLE, "text/css; charset=utf-8"),
            "/api/games" => games(&client, &board, &cache),
            _ => tiny_http::Response::from_string("not found").with_status_code(404),
        };

        // A dropped connection is the browser navigating away, not a problem
        // worth stopping the server for.
        let _ = request.respond(response);
    }

    Ok(())
}

type Body = tiny_http::Response<Cursor<Vec<u8>>>;

fn html(body: &str) -> Body {
    asset(body, "text/html; charset=utf-8")
}

fn asset(body: &str, content_type: &str) -> Body {
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes())
        .expect("a static content type is always a valid header");
    tiny_http::Response::from_string(body).with_header(header)
}

fn games(client: &roblox::Client, board: &config::Board, cache: &Mutex<Option<Cache>>) -> Body {
    let mut guard = cache.lock().expect("cache mutex");

    if let Some(cached) = guard.as_ref() {
        if cached.at.elapsed() < CACHE {
            return json(&cached.games);
        }
    }

    match client.games(&board.ids, &board.labels) {
        Ok(games) => {
            let body = json(&games);
            *guard = Some(Cache {
                games,
                at: Instant::now(),
            });
            body
        }
        Err(e) => {
            // Serve the last good answer rather than an error page: Roblox
            // rate-limits, and a board that keeps showing slightly old numbers
            // through a blip is more useful than one that empties.
            if let Some(cached) = guard.as_ref() {
                eprintln!("Refresh failed, showing the last good numbers: {e:#}");
                return json(&cached.games);
            }
            let message = serde_json::json!({ "error": format!("{e:#}") });
            json(&message).with_status_code(502)
        }
    }
}

fn json<T: serde::Serialize>(value: &T) -> Body {
    let body = serde_json::to_string(value)
        .unwrap_or_else(|e| format!("{{\"error\":\"could not encode the response: {e}\"}}"));
    asset(&body, "application/json; charset=utf-8")
}
