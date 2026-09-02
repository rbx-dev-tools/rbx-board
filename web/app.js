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

// Roblox does not remove a taken-down experience from its public API. It keeps
// answering and replaces the name, so the only signal is the name itself.
// These are the strings it uses, seen on real experiences.
const TAKEN_DOWN = ["[ content deleted ]", "[title unavailable]", "[ title unavailable ]"];

function isTakenDown(text) {
  return TAKEN_DOWN.includes((text || "").trim().toLowerCase());
}

// What is wrong with a game, in the order somebody would want to hear it.
function problems(game) {
  const found = [];

  if (!game.visible) {
    // Deliberately not "deleted". The API returns nothing for a private
    // universe, a wrong id, and one that no longer exists alike, and saying
    // which would be guessing at something alarming.
    found.push([
      "no answer",
      "Roblox returns nothing for this id: private, gone, or the id is wrong",
    ]);
  }

  if (isTakenDown(game.name)) {
    found.push([
      "content deleted",
      "Roblox replaced this experience's name, which is how a takedown shows",
    ]);
  }

  if (game.content_restricted) {
    found.push(["restricted", "Roblox has restricted this experience's content"]);
  }

  // The experience can be fine while the group that owns it is gone.
  if (game.creator && isTakenDown(game.creator.name)) {
    found.push(["owner deleted", "the account or group that owns this no longer exists"]);
  } else if (game.creator?.name?.toLowerCase().startsWith("content deleted")) {
    found.push(["owner deleted", "the account or group that owns this no longer exists"]);
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

  // The owner is always shown, and Roblox's own name joins it when a label is
  // hiding it. An earlier version showed one *or* the other, which meant the
  // owner disappeared for every game that had a label: labels come from
  // rbxplace.toml env names, so they always differ from the Roblox name, and
  // the owner was never reachable.
  // Two lines rather than one joined by a separator: a Roblox name and a group
  // name are both long, and together they were being truncated to the point of
  // hiding the very thing this was added to show.
  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent =
    game.label && game.name && game.label !== game.name ? game.name : "";

  const owner = document.createElement("div");
  owner.className = "owner";
  if (game.creator?.name) {
    owner.textContent = game.creator.name;
    owner.title =
      game.creator.kind === "Group"
        ? `Group ${game.creator.id}`
        : `User ${game.creator.id}`;
    if (game.creator.kind === "Group") {
      const tag = document.createElement("span");
      tag.className = "kind";
      tag.textContent = "group";
      owner.append(" ", tag);
    }
  }

  // A badge either way. Showing one only when something is wrong makes a
  // healthy board indistinguishable from a board that never checked, which is
  // the thing worth being able to tell apart at a glance.
  const flags = document.createElement("div");
  flags.className = "flags";

  const found = problems(game);
  if (found.length === 0) {
    const ok = document.createElement("span");
    ok.className = "flag ok";
    // "listed" and not "public". Whether an experience is published is not in
    // any endpoint this reads, and a badge saying "public" about one that had
    // been taken private would be worse than no badge at all. Listed is what
    // is actually known: Roblox answers for it, under its own name.
    ok.textContent = "listed";
    ok.title =
      "Roblox answers for this experience under its own name. Whether it is " +
      "published is not in the public API, so this does not claim it.";
    flags.append(ok);
  }
  for (const [text, why] of found) {
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

  body.append(title, sub, owner, flags, stats);
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
  // Shown even with one owner: hiding it made a board of one group look like a
  // board that does not know about groups at all.
  ownerEl.hidden = names.length === 0;
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

  // The flagged count is always printed, zero included. "12 experiences, 0
  // flagged" is a statement; the absence of the word is not.
  const parts = [
    `${shown.length} experiences`,
    `${number.format(playing)} playing`,
    `${number.format(visits)} visits`,
    `${flagged} flagged`,
  ];

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
