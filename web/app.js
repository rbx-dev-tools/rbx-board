// The whole client. No build step and no framework: it renders one list and
// re-renders it every fifteen seconds, which is not a problem that needs either.

const gamesEl = document.getElementById("games");
const totalsEl = document.getElementById("totals");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const sortEl = document.getElementById("sort");
const ownerEl = document.getElementById("owner");

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

function displayName(game) {
  return game.label || game.name || String(game.universe_id);
}

function sorted(list) {
  const by = sortEl.value;
  const copy = [...list];

  copy.sort((a, b) => {
    if (by === "name") {
      return displayName(a).localeCompare(displayName(b));
    }
    if (by === "flagged") {
      // Most problems first, and among equals the busiest, so the list stays
      // useful once nothing is wrong.
      const d = problems(b).length - problems(a).length;
      return d !== 0 ? d : b.playing - a.playing;
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

// What is wrong with a game, in the order somebody would want to hear it.
function problems(game) {
  const found = [];
  if (!game.visible) {
    // Deliberately not "deleted". The public API returns nothing for a private
    // universe, a deleted one and a wrong id alike, and saying which would be
    // guessing at something alarming.
    found.push(["not public", "Roblox returns nothing for this id: private, removed, or the id is wrong"]);
  }
  if (game.content_restricted) {
    found.push(["restricted", "Roblox has restricted this experience's content"]);
  }
  if (game.copying_allowed) {
    found.push(["copying on", "anyone can take a copy of this place"]);
  }
  return found;
}

function card(game) {
  const el = document.createElement("a");
  el.className = "game" + (problems(game).length ? " flagged" : "");
  // A game Roblox says nothing about has no place to link to.
  el.href = game.visible
    ? `https://www.roblox.com/games/${game.place_id}`
    : `https://create.roblox.com/dashboard/creations`;
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
  title.textContent = game.label || game.name || String(game.universe_id);

  const sub = document.createElement("div");
  sub.className = "sub";
  // Roblox's own name when a label is set and the two differ, which is exactly
  // the case when the same game is published twice. Otherwise the owner, since
  // that is the next thing worth knowing.
  const owner = game.creator?.name ? `${game.creator.name}` : "";
  sub.textContent =
    game.label && game.name && game.label !== game.name ? game.name : owner;

  const flags = document.createElement("div");
  flags.className = "flags";
  for (const [text, why] of problems(game)) {
    const flag = document.createElement("span");
    flag.className = "flag";
    flag.textContent = text;
    flag.title = why;
    flags.append(flag);
  }

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

  body.append(title, sub, flags, stats);
  el.append(icon, body);
  return el;
}

function owners(list) {
  const names = new Set();
  for (const game of list) {
    if (game.creator?.name) names.add(game.creator.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function syncOwnerFilter() {
  const current = ownerEl.value;
  const names = owners(games);

  ownerEl.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = `all owners (${names.length})`;
  ownerEl.append(all);

  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    ownerEl.append(option);
  }

  // Keep the choice across a refresh, unless that owner is gone.
  ownerEl.value = names.includes(current) ? current : "";
  ownerEl.hidden = names.length < 2;
}

function visible(list) {
  const owner = ownerEl.value;
  return owner ? list.filter((g) => g.creator?.name === owner) : list;
}

function render() {
  syncOwnerFilter();
  const shown = visible(games);
  gamesEl.replaceChildren(...sorted(shown).map(card));

  const playing = shown.reduce((sum, g) => sum + g.playing, 0);
  const visits = shown.reduce((sum, g) => sum + g.visits, 0);
  const flagged = shown.filter((g) => problems(g).length).length;

  const parts = [
    `${shown.length} experiences`,
    `${number.format(playing)} playing`,
    `${number.format(visits)} visits`,
  ];
  if (flagged > 0) parts.push(`${flagged} flagged`);

  totalsEl.textContent = parts.join(" · ");
  totalsEl.hidden = shown.length === 0;
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

ownerEl.addEventListener("change", render);

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
