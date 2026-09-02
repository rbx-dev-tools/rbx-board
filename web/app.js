// The whole client. No build step and no framework: it renders one list and
// re-renders it every fifteen seconds, which is not a problem that needs either.

const gamesEl = document.getElementById("games");
const totalsEl = document.getElementById("totals");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const sortEl = document.getElementById("sort");

// The sort survives a reload, because the one you want is the one you wanted
// last time.
const SORT_KEY = "rbx-board.sort";
try {
  const saved = localStorage.getItem(SORT_KEY);
  if (saved) sortEl.value = saved;
} catch {
  // A browser with site data blocked is not a reason to fail to render.
}

let games = [];

const number = new Intl.NumberFormat();

function ratio(game) {
  const total = game.up_votes + game.down_votes;
  return total === 0 ? null : game.up_votes / total;
}

function sorted(list) {
  const by = sortEl.value;
  const copy = [...list];

  copy.sort((a, b) => {
    if (by === "name") {
      return (a.label || a.name).localeCompare(b.label || b.name);
    }
    if (by === "ratio") {
      // A game with no votes has no rating, and sorting it as 0% would put a
      // brand new game below a genuinely disliked one.
      const ra = ratio(a);
      const rb = ratio(b);
      if (ra === null && rb === null) return 0;
      if (ra === null) return 1;
      if (rb === null) return -1;
      return rb - ra;
    }
    return b[by] - a[by];
  });

  return copy;
}

function card(game) {
  const el = document.createElement("a");
  el.className = "game";
  el.href = `https://www.roblox.com/games/${game.place_id}`;
  el.target = "_blank";
  el.rel = "noreferrer";

  const icon = document.createElement("div");
  icon.className = "icon";
  if (game.icon) {
    const img = document.createElement("img");
    img.src = game.icon;
    img.alt = "";
    img.loading = "lazy";
    icon.append(img);
  }

  const body = document.createElement("div");
  body.className = "body";

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = game.label || game.name;

  const sub = document.createElement("div");
  sub.className = "sub";
  // When a label is set, Roblox's own name is the interesting second line:
  // publishing the same game twice is exactly when the two differ.
  sub.textContent = game.label && game.label !== game.name ? game.name : "";

  const stats = document.createElement("div");
  stats.className = "stats";

  const r = ratio(game);
  const rows = [
    ["playing", number.format(game.playing), game.playing > 0 ? "live" : ""],
    ["visits", number.format(game.visits), ""],
    ["favourites", number.format(game.favorites), ""],
    ["rating", r === null ? "–" : `${Math.round(r * 100)}%`, ""],
  ];

  for (const [label, value, extra] of rows) {
    const stat = document.createElement("div");
    stat.className = `stat ${extra}`.trim();
    const v = document.createElement("span");
    v.className = "value";
    v.textContent = value;
    const l = document.createElement("span");
    l.className = "label";
    l.textContent = label;
    stat.append(v, l);
    stats.append(stat);
  }

  body.append(title, sub, stats);
  el.append(icon, body);
  return el;
}

function render() {
  gamesEl.replaceChildren(...sorted(games).map(card));

  const playing = games.reduce((sum, g) => sum + g.playing, 0);
  const visits = games.reduce((sum, g) => sum + g.visits, 0);
  totalsEl.textContent = `${games.length} experiences · ${number.format(
    playing,
  )} playing · ${number.format(visits)} visits`;
  totalsEl.hidden = games.length === 0;
}

async function refresh() {
  statusEl.textContent = "refreshing…";
  try {
    const response = await fetch("/api/games");
    const body = await response.json();

    if (!response.ok) {
      throw new Error(body.error || `HTTP ${response.status}`);
    }

    games = body;
    errorEl.hidden = true;
    render();
    statusEl.textContent = `updated ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    // Keep whatever is on screen. Stale numbers beat an empty page.
    errorEl.textContent = String(e.message || e);
    errorEl.hidden = false;
    statusEl.textContent = "";
  }
}

sortEl.addEventListener("change", () => {
  try {
    localStorage.setItem(SORT_KEY, sortEl.value);
  } catch {
    // Same as above: not being able to remember the sort is not a failure.
  }
  render();
});

refresh();
setInterval(refresh, 15000);
