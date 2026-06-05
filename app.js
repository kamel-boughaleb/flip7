/* Flip 7 / Skyjo Scoreboard — vanilla JS.
   Shared persistence via Supabase, with a localStorage fallback when unconfigured. */

// Single shared store for every game type (legacy key kept for back-compat).
const STORE_KEY = "flip7_games";

/* ---------- game rulesets ----------
   Each ruleset captures everything score-related for a family of games, so the
   rest of the app stays game-agnostic. Adding a game = adding a ruleset (+ a
   mode entry below). Functions (cellValue, scoreOrder, win condition) let
   wildly different games coexist — e.g. Flip 7 (highest wins, first to 200)
   and Skyjo (lowest wins, ends when someone reaches 100).

   A ruleset ends either at a score `target` (Flip 7, Skyjo) or after a fixed
   number of `rounds` (Time's Up!). Cell shapes differ per ruleset:
     flip7    → { points, flip7, bust }
     skyjo    → { points }  (may be negative)
     timesup  → { points }  (cards guessed by a team) */
const RULESETS = {
  flip7: {
    target: 200,
    bonus: 15,
    scoreOrder: "desc", // higher total ranks first
    entry: "flip7", // score-entry UI variant
    cellValue(cell) {
      if (!cell || cell.bust) return 0;
      return (Number(cell.points) || 0) + (cell.flip7 ? this.bonus : 0);
    },
  },
  skyjo: {
    target: 100,
    scoreOrder: "asc", // lower total ranks first
    entry: "number",
    negatives: true, // scores can be negative (adds a ± sign toggle)
    doubling: true, // the round score can be doubled (×2 button)
    cellValue(cell) {
      const pts = Number(cell && cell.points) || 0;
      return cell && cell.doubled ? pts * 2 : pts;
    },
  },
  timesup: {
    rounds: 3, // ends after a fixed number of rounds (no score target)
    scoreOrder: "desc", // highest team total wins
    entry: "number",
    unit: "equipe", // played by teams, not individual players
    cellValue(cell) {
      return Number(cell && cell.points) || 0;
    },
  },
  qwirkle: {
    manualEnd: true, // no score target / fixed rounds: ended by the user
    turnBased: true, // scores entered one player at a time, in turn order
    scoreOrder: "desc", // highest total wins
    entry: "number",
    cellValue(cell) {
      return Number(cell && cell.points) || 0;
    },
  },
  contree: {
    scoreOrder: "desc", // highest team total wins
    entry: "contree", // bespoke flow: dealer → bid → team scores
    teams: true, // 4 players in two fixed teams (A: seats 1&3, B: 2&4)
    configurableTarget: true, // score target is chosen at creation
    cellValue(cell) {
      return Number(cell && cell.points) || 0;
    },
  },
  yams: {
    turnBased: true, // one player fills one category per turn, in turn order
    autoEndFilled: true, // ends when every player has filled all categories
    scoreOrder: "desc", // highest total wins
    entry: "yams", // bespoke flow: pick a mission, enter/auto its value, or scratch
    cellValue(cell) {
      return Number(cell && cell.points) || 0;
    },
    // The upper-section bonus (+35 at ≥63) is aggregate, so it lives outside
    // cellValue and is added on top of the cell sum in playerTotal.
    extraTotal(game, playerId) {
      return yamsUpperBonus(game, playerId);
    },
  },
};

/* ---------- Yams scorecard ----------
   The 13 "missions" of the contract. Upper section (As→Six) scores the sum of
   the matching dice (variable, entered by hand); the bonus rewards filling it
   generously. Lower section mixes fixed-value combos (Full, suites, Yams) and
   variable ones (Brelan, Carré, Chance). Any mission can be "barrée" (0 pts).
   A stored cell is { category, points }; points 0 means a scratched mission. */
const YAMS_CATEGORIES = [
  { key: "ones", label: "As", section: "upper", fixed: null, face: 1 },
  { key: "twos", label: "Deux", section: "upper", fixed: null, face: 2 },
  { key: "threes", label: "Trois", section: "upper", fixed: null, face: 3 },
  { key: "fours", label: "Quatre", section: "upper", fixed: null, face: 4 },
  { key: "fives", label: "Cinq", section: "upper", fixed: null, face: 5 },
  { key: "sixes", label: "Six", section: "upper", fixed: null, face: 6 },
  { key: "brelan", label: "Brelan", section: "lower", fixed: 25 },
  { key: "carre", label: "Carré", section: "lower", fixed: 35 },
  { key: "full", label: "Full", section: "lower", fixed: 30 },
  { key: "petite", label: "Petite suite", section: "lower", fixed: 25 },
  { key: "grande", label: "Grande suite", section: "lower", fixed: 40 },
  { key: "yams", label: "Yam's", section: "lower", fixed: 50 },
];
const YAMS_UPPER_KEYS = ["ones", "twos", "threes", "fours", "fives", "sixes"];
const YAMS_BONUS_MIN = 63; // upper-section sum unlocking the bonus
const YAMS_BONUS = 35; // bonus points awarded once the threshold is reached
function yamsCat(key) {
  return YAMS_CATEGORIES.find((c) => c.key === key) || null;
}
// Categories a player has already filled (set of keys).
function yamsFilled(game, playerId) {
  const s = new Set();
  game.rounds.forEach((r) => {
    const c = r.scores[playerId];
    if (c && c.category) s.add(c.category);
  });
  return s;
}
// Sum of a player's upper-section cells (As→Six), used for the bonus check.
function yamsUpperSum(game, playerId) {
  return game.rounds.reduce((sum, r) => {
    const c = r.scores[playerId];
    return c && YAMS_UPPER_KEYS.includes(c.category)
      ? sum + (Number(c.points) || 0)
      : sum;
  }, 0);
}
function yamsUpperBonus(game, playerId) {
  return yamsUpperSum(game, playerId) >= YAMS_BONUS_MIN ? YAMS_BONUS : 0;
}
// Every player has filled all missions → the game is over.
function yamsComplete(game) {
  return (
    game.players.length > 0 &&
    game.players.every(
      (p) => yamsFilled(game, p.id).size >= YAMS_CATEGORIES.length,
    )
  );
}

// Trump suits for Contrée bids (4 colours, icons via Unicode pips).
const CONTREE_SUITS = [
  { key: "spades", label: "Pique", sym: "♠", red: false },
  { key: "hearts", label: "Cœur", sym: "♥", red: true },
  { key: "diamonds", label: "Carreau", sym: "♦", red: true },
  { key: "clubs", label: "Trèfle", sym: "♣", red: false },
];
function contreeSuit(key) {
  return CONTREE_SUITS.find((s) => s.key === key) || null;
}

// Wording for the competing entity, per ruleset (default: players).
const UNITS = {
  joueur: {
    one: "Joueur",
    many: "Joueurs",
    add: "Ajouter un joueur",
    placeholder: "Nom du joueur",
  },
  equipe: {
    one: "Équipe",
    many: "Équipes",
    add: "Ajouter une équipe",
    placeholder: "Nom de l'équipe",
  },
};

/* ---------- modes ----------
   A "mode" is a selectable entry in the new-game picker. Several modes can map
   to the same ruleset (Flip 7 variants share scoring, only their rules text
   differs). The mode key is stored on each game and used as a CSS modifier
   (mode-classic / mode-vengeance / mode-skyjo). Legacy games (no mode) are
   treated as "classic". */
const MODES = {
  classic: { label: "Flip 7", ruleset: "flip7", rules: () => rulesClassicHTML() },
  vengeance: {
    label: "Flip 7 Vengeance",
    ruleset: "flip7",
    rules: () => rulesVengeanceHTML(),
  },
  qwirkle: {
    label: "Qwirkle",
    ruleset: "qwirkle",
    rules: () => rulesQwirkleHTML(),
  },
  skyjo: { label: "Skyjo", ruleset: "skyjo", rules: () => rulesSkyjoHTML() },
  timesup: {
    label: "Time's Up!",
    ruleset: "timesup",
    rules: () => rulesTimesUpHTML(),
  },
  contree: {
    label: "Contrée",
    ruleset: "contree",
    rules: () => rulesContreeHTML(),
  },
  yams: {
    label: "Yam's",
    ruleset: "yams",
    rules: () => rulesYamsHTML(),
  },
};
const DEFAULT_MODE = "classic";

// The ruleset a game (or mode key) plays by.
function rulesetOf(mode) {
  return RULESETS[MODES[mode]?.ruleset] || RULESETS.flip7;
}
function defFor(game) {
  return rulesetOf(game && game.mode);
}
function modeLabel(mode) {
  return (MODES[mode] || MODES[DEFAULT_MODE]).label;
}
// CSS modifier class for a mode badge (falls back to the default mode).
function modeClass(mode) {
  return "mode-" + (MODES[mode] ? mode : DEFAULT_MODE);
}
function rulesFor(mode) {
  return (MODES[mode] || MODES[DEFAULT_MODE]).rules();
}
// Unit kind key ("joueur" | "equipe") for a mode/filter.
function unitKeyOf(mode) {
  return rulesetOf(mode).unit || "joueur";
}
// Wording for the competing entity (player vs team) for a mode/filter.
function unitOf(mode) {
  return UNITS[rulesetOf(mode).unit] || UNITS.joueur;
}
// Singular label for the score-table column (e.g. "Équipe" for Time's Up!).
function unitLabel(mode) {
  return unitOf(mode).one;
}
// New-game / edit "Type de partie" tab buttons, generated from the registry.
function modeTabsHTML() {
  return Object.entries(MODES)
    .map(
      ([key, m]) =>
        `<button type="button" class="mode-tab" data-mode="${key}">${esc(m.label)}</button>`,
    )
    .join("");
}

/* ---------- Supabase client ---------- */
function makeClient() {
  const cfg = window.FLIP7_CONFIG || {};
  const ready =
    window.supabase &&
    cfg.url &&
    cfg.anonKey &&
    /^https:\/\//.test(cfg.url) &&
    !/VOTRE-|YOUR-/i.test(cfg.url);
  if (!ready) {
    console.warn(
      "[Flip7] Supabase non configuré — stockage local (données non partagées). Renseignez config.js.",
    );
    return null;
  }
  return window.supabase.createClient(cfg.url, cfg.anonKey);
}
const db = makeClient();

/* ---------- storage: in-memory cache, write-through to Supabase ----------
   In Supabase mode the cache holds only the *current place*'s games (fetched
   server-side filtered); the distinct places are loaded separately so the place
   picker still knows them all. In local mode everything stays in the cache
   (no transfer cost) and gamesForPlace() filters for display. */
let GAMES = [];
let LOADED_PLACE; // place the cache currently holds (undefined = not loaded yet)
let PLACES = { names: [], hasNoPlace: false }; // distinct places known to the app

function localLoad() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || [];
  } catch {
    return [];
  }
}
function localSave() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(GAMES));
  } catch {}
}

const samePlace = (a, b) =>
  (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();

// Build the distinct-places set from a list of place names (may hold null/"").
function placesFromNames(list) {
  const map = new Map();
  let hasNoPlace = false;
  list.forEach((n) => {
    const t = (n || "").trim();
    if (t) map.set(t.toLowerCase(), t);
    else hasNoPlace = true;
  });
  return { names: [...map.values()], hasNoPlace };
}

// Load the distinct places. Lightweight: only the place field, not the games.
async function fetchPlaces() {
  if (!db) {
    PLACES = placesFromNames(localLoad().map((g) => g.place));
    return;
  }
  const { data, error } = await db.from("games").select("place:data->>place");
  if (error) {
    console.error(error);
    return;
  }
  PLACES = placesFromNames((data || []).map((r) => r.place));
}

// Load the current place's games into the cache (server-side filtered).
async function fetchGames(place) {
  if (place === undefined) place = getSelectedPlace();
  LOADED_PLACE = place;
  if (!db) {
    GAMES = localLoad(); // local: keep everything; gamesForPlace filters for display
    return;
  }
  if (place == null) {
    GAMES = []; // no place chosen yet — nothing to show
    return;
  }
  let q = db.from("games").select("id, data");
  // "Sans lieu" matches both a null and an empty place; else exact match.
  q =
    place === ""
      ? q.or("data->>place.is.null,data->>place.eq.")
      : q.eq("data->>place", place);
  const { data, error } = await q;
  if (error) {
    console.error(error);
    toast("Erreur de chargement des parties");
    return;
  }
  GAMES = (data || []).map((r) => r.data).filter(Boolean);
}

function loadGames() {
  return [...GAMES].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function getGame(id) {
  return GAMES.find((g) => g.id === id);
}
function upsertGame(game) {
  const i = GAMES.findIndex((g) => g.id === game.id);
  if (i >= 0) GAMES[i] = game;
  else GAMES.push(game);
  if (!db) return localSave();
  db.from("games")
    .upsert({ id: game.id, data: game })
    .then(({ error }) => {
      if (error) {
        console.error(error);
        toast("Erreur d'enregistrement");
      }
    });
}
function deleteGame(id) {
  GAMES = GAMES.filter((g) => g.id !== id);
  if (!db) return localSave();
  db.from("games")
    .delete()
    .eq("id", id)
    .then(({ error }) => {
      if (error) {
        console.error(error);
        toast("Erreur de suppression");
      }
    });
}

const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- places ----------
   The selected place is per-device (localStorage). The list of places is
   shared, derived from the games themselves (+ places added locally but not
   yet used). "" means "Sans lieu" (legacy games with no place). */
const PLACE_KEY = "flip7_place"; // currently selected place (name; "" = Sans lieu)
const PLACES_KEY = "flip7_places"; // places added on this device (may have no games yet)

function getSelectedPlace() {
  const v = localStorage.getItem(PLACE_KEY);
  return v === null ? null : v; // null = nothing chosen yet
}
function setSelectedPlace(name) {
  localStorage.setItem(PLACE_KEY, name == null ? "" : name);
}
function localPlaces() {
  try {
    return JSON.parse(localStorage.getItem(PLACES_KEY)) || [];
  } catch {
    return [];
  }
}
function addLocalPlace(name) {
  const list = localPlaces();
  if (!list.some((x) => x.toLowerCase() === name.toLowerCase())) {
    list.push(name);
    localStorage.setItem(PLACES_KEY, JSON.stringify(list));
  }
}
const placeLabel = (name) => (name ? name : "Sans lieu");

// All selectable places, sorted; includes "" if any game has no place.
function allPlaces() {
  const map = new Map(); // lowercased -> display
  (PLACES.names || []).forEach((n) => map.set(n.toLowerCase(), n));
  localPlaces().forEach((n) => {
    const t = n.trim();
    if (t) map.set(t.toLowerCase(), t);
  });
  const list = [...map.values()].sort((a, b) => a.localeCompare(b, "fr"));
  if (PLACES.hasNoPlace) list.unshift("");
  return list;
}
function gamesForPlace(place) {
  const key = (place || "").trim().toLowerCase();
  // loadGames() is already sorted by createdAt desc; a stable sort by
  // "ongoing first" keeps that recency order within each group.
  return loadGames()
    .filter((g) => (g.place || "").trim().toLowerCase() === key)
    .sort((a, b) => (winner(a) ? 1 : 0) - (winner(b) ? 1 : 0));
}

// Start of the current day / ISO week (Monday) as epoch ms.
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const monIdx = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - monIdx);
  return d.getTime();
}
function startOfMonth() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d.getTime();
}
// Keep games created within the selected window ("today" | "week" | "month" | "all").
function filterGamesByDate(games, filter) {
  if (filter === "all") return games;
  const from =
    filter === "month"
      ? startOfMonth()
      : filter === "week"
        ? startOfWeek()
        : startOfToday();
  return games.filter((g) => (g.createdAt || 0) >= from);
}

// Unique player names already used at a place (for name autocompletion).
// Names already used at a place, restricted to a unit kind ("joueur" |
// "equipe") so player games don't suggest team names and vice versa.
function placePlayerNames(place, unit = "joueur") {
  const seen = new Map(); // lowercased -> original casing
  gamesForPlace(place)
    .filter((g) => unitKeyOf(g.mode) === unit)
    .forEach((g) =>
      g.players.forEach((p) => {
        const n = (p.name || "").trim();
        if (n && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
      }),
    );
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "fr"));
}

// Returns the first name appearing more than once (case/space-insensitive), or null.
function firstDuplicateName(names) {
  const seen = new Set();
  for (const n of names) {
    const key = (n || "").trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) return n.trim();
    seen.add(key);
  }
  return null;
}

/* ---------- scoring ---------- */
function playerTotal(game, playerId) {
  const def = defFor(game);
  const base = game.rounds.reduce(
    (sum, r) => sum + def.cellValue(r.scores[playerId]),
    0,
  );
  // Some games (Yams) add an aggregate bonus on top of the per-cell sum.
  return base + (def.extraTotal ? def.extraTotal(game, playerId) : 0);
}
// Standings sorted by the game's order (Flip 7: highest first; Skyjo: lowest
// first). The leader — best by the game's rules — is always s[0]. Team games
// (Contrée) rank the two teams instead of individual players, so isGameOver /
// winners (which only read {id, total}) keep working unchanged.
function standings(game) {
  const def = defFor(game);
  if (def.teams) {
    return teamsOf(game)
      .map((t) => ({ ...t, total: teamTotal(game, t.id) }))
      .sort((a, b) => b.total - a.total);
  }
  const asc = def.scoreOrder === "asc";
  return game.players
    .map((p) => ({ ...p, total: playerTotal(game, p.id) }))
    .sort((a, b) => (asc ? a.total - b.total : b.total - a.total));
}

/* ---------- teams (Contrée) ---------- */
// The two fixed teams: A = seats 1 & 3, B = seats 2 & 4 (in roster order).
function teamsOf(game) {
  const ps = game.players;
  return [
    { id: "A", name: teamName(game, "A"), members: [ps[0], ps[2]].filter(Boolean) },
    { id: "B", name: teamName(game, "B"), members: [ps[1], ps[3]].filter(Boolean) },
  ];
}
// A team's display name: its members joined by "&", or "Équipe A/B" as fallback.
function teamName(game, id) {
  const ps = game.players;
  const members = (id === "A" ? [ps[0], ps[2]] : [ps[1], ps[3]])
    .filter(Boolean)
    .map((p) => p.name)
    .filter((n) => n && n.trim());
  return members.length ? members.join(" & ") : id === "A" ? "Équipe A" : "Équipe B";
}
// A team's cumulative score across all played deals.
function teamTotal(game, id) {
  return game.rounds.reduce(
    (sum, r) => sum + (Number(r.scores && r.scores[id]) || 0),
    0,
  );
}
// The player dealing the current deal: the chosen first dealer rotated by the
// number of deals already played (deal passes clockwise, in roster order).
function currentDealer(game) {
  if (!game.dealer) return null;
  const order = turnOrder({ players: game.players, starter: game.dealer });
  return order.length ? order[game.rounds.length % order.length] : null;
}
// Is the game finished? Target-based games (Flip 7, Skyjo) end once any player
// reaches the target; round-limited games (Time's Up!) end after N rounds;
// manual-end games (Qwirkle) end when the user closes them (game.ended).
function isGameOver(game, s) {
  const def = defFor(game);
  if (def.manualEnd) return !!game.ended; // user closes the game by hand
  if (def.autoEndFilled) return yamsComplete(game); // Yams: every card filled
  if (def.rounds) return game.rounds.length >= def.rounds;
  return s.some((p) => p.total >= game.target);
}
// Winning players from a standings array already sorted by the game's order.
// A cancelled game is won by the current leader(s); otherwise, once the game is
// over, the leader(s) win (highest for Flip 7 / Time's Up!, lowest for Skyjo).
// Ties at the leading total are all returned.
function winnersFromStandings(game, s) {
  if (!s.length) return [];
  const best = s[0].total;
  if (game.cancelled) return s.filter((p) => p.total === best);
  if (isGameOver(game, s)) return s.filter((p) => p.total === best);
  return [];
}
function winners(game) {
  return winnersFromStandings(game, standings(game));
}
// Label for a list of winners: names joined by commas, the last one with "&"
// (e.g. "Lucas, Léna & Cindy").
function winnersLabel(ws) {
  const names = ws.map((p) => esc(p.name));
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}
// Single representative winner (or null). Truthy means the game is over.
function winner(game) {
  return winners(game)[0] || null;
}

/* ---------- turn-based games (Qwirkle) ---------- */
// The roster rotated so the chosen starter plays first; falls back to the
// roster order when no starter has been picked yet.
function turnOrder(game) {
  const ps = game.players;
  const i = ps.findIndex((p) => p.id === game.starter);
  return i <= 0 ? ps.slice() : ps.slice(i).concat(ps.slice(0, i));
}
// The player whose turn it is now, or null if the game hasn't started. The next
// player is the one following the last player who scored (robust to deleting a
// turn from the details screen); before any turn, it's the starter.
function currentPlayer(game) {
  if (!game.starter) return null;
  const order = turnOrder(game);
  if (!order.length) return null;
  // Where the next turn lands: just after the last player who scored, or the
  // starter before any turn (robust to deleting a turn from the details screen).
  let start;
  if (!game.rounds.length) start = 0;
  else {
    const lastPid = Object.keys(game.rounds[game.rounds.length - 1].scores)[0];
    const idx = order.findIndex((p) => p.id === lastPid);
    start = idx < 0 ? game.rounds.length % order.length : (idx + 1) % order.length;
  }
  // Yams: skip players whose card is already full (can happen after correcting
  // a finished game by clearing a cell). Other turn-based games never skip.
  const done =
    defFor(game).entry === "yams"
      ? (p) => yamsFilled(game, p.id).size >= YAMS_CATEGORIES.length
      : () => false;
  for (let n = 0; n < order.length; n++) {
    const cand = order[(start + n) % order.length];
    if (!done(cand)) return cand;
  }
  return null; // everyone is done
}
// Noun for the scoring unit: "donne" (Contrée), "tour" (turn-based), else
// "manche".
function roundNoun(game) {
  const def = defFor(game);
  if (def.teams) return "donne";
  return def.turnBased ? "tour" : "manche";
}
// Count label with a variable plural, e.g. "1 manche" / "5 tours".
function roundCountLabel(game, n) {
  const noun = roundNoun(game);
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
// Numbered label for the round/turn in progress, e.g. "Manche 5" / "Tour 5".
function roundNumberLabel(game, n) {
  const noun = roundNoun(game);
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${n}`;
}
// Short status note shown on a game card / header for an ongoing game.
function roundNoteFor(game) {
  const def = defFor(game);
  if (def.teams) return game.dealer ? `Donne ${game.rounds.length + 1}` : "À démarrer";
  if (!def.turnBased) return `Manche ${game.rounds.length + 1}`;
  if (!game.starter) return "À démarrer";
  const cur = currentPlayer(game);
  return cur ? `Tour de ${esc(cur.name)}` : "En cours";
}
// Close a manual-end game by hand and crown the current leader(s).
async function endGamePrompt(game) {
  const lead = standings(game)[0];
  const ok = await confirmDialog({
    title: "Terminer la partie ?",
    body: `La partie sera close et la victoire attribuée au joueur en tête${lead ? ` (actuellement ${lead.name}, ${lead.total} pts)` : ""}.`,
    confirmLabel: "Terminer",
    cancelLabel: "Retour",
  });
  if (!ok) return;
  const g = getGame(game.id);
  const beforeWinnerId = (winner(g) || {}).id || null;
  g.ended = true;
  upsertGame(g);
  go("game", { id: game.id });
  celebrateIfNewWinner(beforeWinnerId, g);
}

// Competition-style rank labels for an ALREADY-SORTED list. `tied(prev, cur)`
// reports whether two adjacent entries share the same rank. Each result is
// { place, label }: `place` is the rank of the tie group's leader (1-based,
// gaps after ties — "1, 1, 3, 3, 5"…). Tied entries share that same number,
// so `label` equals `place` for every entry.
function rankLabels(sorted, tied) {
  let place = 0;
  return sorted.map((item, i) => {
    const isTie = i > 0 && tied(sorted[i - 1], item);
    if (!isTie) place = i + 1;
    return { place, label: String(place) };
  });
}

/* ---------- router ---------- */
const app = document.getElementById("app");
let route = { name: "place" };
let homeFilter = "today"; // games list date filter: "today" | "week" | "month" | "all"
let pollTimer = null;
let durationTimer = null; // ticks the live game-duration chip every second
let statsRedraw = null; // redraws the stats table in place (filters preserved)

function routeToHash(name, params = {}) {
  const base = params.id ? `${name}/${params.id}` : name;
  const place = getSelectedPlace();
  const q = place !== null ? `?p=${encodeURIComponent(place)}` : "";
  return `#${base}${q}`;
}

// Pure: hash → route. No side effects (place restoration is done separately).
function hashToRoute(hash) {
  const h = (hash || "").replace(/^#/, "");
  if (!h) return { name: "place" };
  const [name, id] = h.split("?")[0].split("/");
  return id ? { name, id } : { name };
}
// Restaure le lieu depuis l'URL (lien direct, retour navigateur, partage).
function selectPlaceFromHash(hash) {
  const queryPart = (hash || "").split("?")[1];
  if (!queryPart) return;
  const params = new URLSearchParams(queryPart);
  if (params.has("p")) setSelectedPlace(params.get("p"));
}

function go(name, params = {}) {
  route = { name, ...params };
  // Setting the hash fires `hashchange`, but our equality guard below makes it
  // a no-op since `route` already matches — so we render here directly.
  location.hash = routeToHash(name, params);
  render();
  window.scrollTo(0, 0); // always start a new screen at the top
}

window.addEventListener("hashchange", async () => {
  selectPlaceFromHash(location.hash);
  // The URL may point to another place (deep link / back button): reload its
  // games before rendering.
  if (getSelectedPlace() !== LOADED_PLACE)
    await fetchGames(getSelectedPlace());
  const newRoute = hashToRoute(location.hash);
  // Ne pas re-render si seul le nom/id correspond déjà (évite d'écraser prefill
  // après un go(), et le double-render qu'il provoquerait).
  if (newRoute.name === route.name && newRoute.id === route.id) return;
  route = newRoute;
  render();
  window.scrollTo(0, 0);
});

document.getElementById("homeBtn").addEventListener("click", () => go("home"));
document
  .getElementById("placeBtn")
  .addEventListener("click", () => go("place"));
document
  .getElementById("rulesBtn")
  .addEventListener("click", () => openRulesDialog());

// Top-left button showing the current place (hidden on the place screen / before a place is set).
function updatePlaceBtn() {
  const btn = document.getElementById("placeBtn");
  if (!btn) return;
  const place = getSelectedPlace();
  if (place !== null && route.name !== "place") {
    btn.innerHTML = `<i class="fa-regular fa-location-dot"></i> ${esc(placeLabel(place))}`;
    btn.hidden = false;
  } else {
    btn.hidden = true;
  }
  updateTitle(place);
}

// Document title reflects the current place: "[Lieu] | Compteur de score".
function updateTitle(place) {
  const base = "Compteur de score";
  document.title =
    place !== null && route.name !== "place"
      ? `${placeLabel(place)} | ${base}`
      : base;
}

const KNOWN_ROUTES = ["place", "home", "stats", "entry", "game", "details"];

function render() {
  stopPolling();
  stopDurationTimer();
  // Unknown / stale route names fall back to home (keeps route.name coherent).
  if (!KNOWN_ROUTES.includes(route.name)) route = { name: "home" };
  updatePlaceBtn();
  if (route.name === "place") return renderPlace();
  if (route.name === "home") {
    renderHome();
    startHomePolling(); // live-refresh the games list every 2s
    return;
  }
  if (route.name === "stats") {
    renderStats();
    startStatsPolling(); // live-refresh the stats table every 2s
    return;
  }
  if (route.name === "entry") return renderEntry(route.id);
  if (route.name === "game") {
    renderGame(route.id);
    startPolling(route.id); // live-refresh the board every 2s
    return;
  }
  if (route.name === "details") {
    renderDetails(route.id);
    startPolling(route.id);
    return;
  }
  renderHome();
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
function stopDurationTimer() {
  if (durationTimer) {
    clearInterval(durationTimer);
    durationTimer = null;
  }
}
// Auto-refresh the home games list (mirrors the score-screen polling), so a
// game created on another device appears without a manual refresh.
function startHomePolling() {
  stopPolling();
  if (!db) return; // nothing to sync from in local mode
  pollTimer = setInterval(async () => {
    if (route.name !== "home") return stopPolling();
    // don't disrupt an open dialog (e.g. delete confirmation)
    if (document.querySelector("#modal-root .overlay")) return;
    const place = getSelectedPlace();
    const before = JSON.stringify(gamesForPlace(place));
    await fetchGames();
    if (route.name !== "home") return;
    if (JSON.stringify(gamesForPlace(place)) !== before) renderHome();
  }, 2000);
}
// Auto-refresh the stats table (mirrors the home polling). Redraws in place so
// the selected version/metric filters are kept.
function startStatsPolling() {
  stopPolling();
  if (!db) return; // nothing to sync from in local mode
  pollTimer = setInterval(async () => {
    if (route.name !== "stats") return stopPolling();
    if (document.querySelector("#modal-root .overlay")) return;
    const place = getSelectedPlace();
    const before = JSON.stringify(gamesForPlace(place));
    await fetchGames();
    if (route.name !== "stats") return;
    if (JSON.stringify(gamesForPlace(place)) !== before && statsRedraw)
      statsRedraw();
  }, 2000);
}
function startPolling(id) {
  stopPolling();
  if (!db) return; // nothing to sync from in local mode
  const onScoreScreen = () => route.name === "game" || route.name === "details";
  pollTimer = setInterval(async () => {
    if (!onScoreScreen() || route.id !== id) return stopPolling();
    // don't disrupt an in-progress edit on the details screen
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("cell-input")) return;
    const before = JSON.stringify(getGame(id) || null);
    await fetchGames();
    if (!onScoreScreen() || route.id !== id) return;
    const after = JSON.stringify(getGame(id) || null);
    if (after !== before) {
      route.name === "details" ? renderDetails(id) : renderGame(id);
    }
  }, 2000);
}

/* ---------- helpers ---------- */
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
// Wrap a node in a gutter-bearing container (so full-width cards keep side margins).
function wrapPanel(node) {
  const w = el(`<div class="panel-wrap"></div>`);
  w.appendChild(node);
  return w;
}
function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
// Human-readable duration, e.g. "1 h 23 min", "12 min 05 s", "45 s".
function fmtDuration(ms) {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m) return `${m} min ${String(s).padStart(2, "0")} s`;
  return `${s} s`;
}
// Elapsed time since the game was created: counts up live while the game is
// ongoing, then freezes at the last (winning) round once it's over.
// Returns null if the creation time is unknown.
function gameDuration(game) {
  const start = game.createdAt;
  if (!start) return null;
  const r = game.rounds;
  const over = !!winner(game);
  const end = over ? (r.length ? r[r.length - 1].at : start) : Date.now();
  if (!end || end < start) return null;
  return end - start;
}
// e.g. "Partie du lundi 25 mai à 13h30"
function gameNameFromDate(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const m = String(d.getMinutes()).padStart(2, "0");
  return `Partie du ${date} à ${d.getHours()}h${m}`;
}
function toast(msg) {
  const t = el(`<div class="toast">${esc(msg)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

// Big fan-card FLIP7 logo (home hero / setup header)
// Top navigation tabs shared by Home and Stats. `active` is "home" | "stats".
function navTabs(active) {
  const nav = el(`
    <div class="nav-tabs">
      <button type="button" class="nav-tab ${active === "home" ? "active" : ""}" data-go="home"><i class="fa-regular fa-list-ul"></i> Parties</button>
      <button type="button" class="nav-tab ${active === "stats" ? "active" : ""}" data-go="stats"><i class="fa-regular fa-chart-simple"></i> Statistiques</button>
    </div>`);
  nav.querySelectorAll(".nav-tab").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.go !== active) go(b.dataset.go);
    }),
  );
  return nav;
}

function logoMarkup() {
  return `
    <div class="flip7-logo">
      <div class="fan">
        <span class="c1"></span><span class="c2"></span><span class="c3"></span><span class="c4"></span><span class="c5"></span>
      </div>
      <div class="logo-text"><span class="flip">FLIP</span><span class="seven">7</span></div>
      <div class="ribbon">TABLEAU DES SCORES</div>
    </div>`;
}

// Confetti burst inside a positioned container
function confettiMarkup(n = 14) {
  const colors = [
    "var(--gold)",
    "var(--coral)",
    "var(--teal)",
    "var(--sky)",
    "var(--gold-dark)",
  ];
  let pieces = "";
  for (let i = 0; i < n; i++) {
    const left = Math.round((i / n) * 100);
    const delay = ((i % 7) * 0.35).toFixed(2);
    const dur = (3.2 + (i % 5) * 0.3).toFixed(2);
    const color = colors[i % colors.length];
    const radius = i % 3 === 0 ? "50%" : "2px";
    pieces += `<i style="left:${left}%;background:${color};border-radius:${radius};animation-duration:${dur}s;animation-delay:${delay}s"></i>`;
  }
  return `<div class="confetti">${pieces}</div>`;
}

/* ---------- victory celebration (full screen, 10s, randomized) ---------- */
const CONGRATS = [
  "Champion incontesté !",
  "Personne ne pouvait t'arrêter !",
  "Une victoire légendaire !",
  "Tu as pulvérisé la concurrence !",
  "Génie absolu du Flip 7 !",
  "Les autres peuvent aller se rhabiller !",
  "Maître des cartes !",
  "Victoire écrasante !",
  "On s'incline devant toi !",
  "Royauté du Flip 7 !",
  "Imbattable ce soir !",
  "Tu as flippé jusqu'au bout !",
  "Un sans-faute de boss !",
  "La chance ? Non, du talent !",
  "Trop fort pour ce monde !",
];
const CEL_EMOJIS = [
  "party-horn",
  "trophy",
  "face-party",
  "burst",
  "crown",
  "sparkles",
  "fire",
  "hand-fist",
  "rocket",
  "face-grin-stars",
].map((name) => `<i class="fa-regular fa-${name}"></i>`);
// Shown when several players/teams tie for the win.
const TIE_CONGRATS = [
  "Égalité parfaite !",
  "Ex æquo !",
  "Impossible de les départager !",
  "À égalité au sommet !",
  "Tout le monde sur la plus haute marche !",
];
const TIE_EMOJIS = ["handshake", "scale-balanced", "people-group", "medal"].map(
  (name) => `<i class="fa-regular fa-${name}"></i>`,
);

function celConfettiMarkup(n = 70) {
  const colors = [
    "var(--gold)",
    "var(--coral)",
    "var(--teal)",
    "var(--sky)",
    "var(--gold-dark)",
    "var(--coral-light)",
    "var(--teal-light)",
  ];
  let pieces = "";
  for (let i = 0; i < n; i++) {
    const left = (Math.random() * 100).toFixed(2);
    const delay = (Math.random() * 4).toFixed(2);
    const dur = (3 + Math.random() * 3).toFixed(2);
    const color = colors[Math.floor(Math.random() * colors.length)];
    const radius = Math.random() < 0.4 ? "50%" : "2px";
    const w = Math.round(6 + Math.random() * 8);
    const h = Math.round(10 + Math.random() * 10);
    pieces += `<i style="left:${left}%;width:${w}px;height:${h}px;background:${color};border-radius:${radius};animation-duration:${dur}s;animation-delay:${delay}s"></i>`;
  }
  return `<div class="cel-confetti">${pieces}</div>`;
}

function celebrate(game) {
  const ws = winners(game);
  if (!ws.length) return;
  const tie = ws.length > 1;
  const pool = tie ? TIE_CONGRATS : CONGRATS;
  const emojiPool = tie ? TIE_EMOJIS : CEL_EMOJIS;
  const text = pool[Math.floor(Math.random() * pool.length)];
  const emoji = emojiPool[Math.floor(Math.random() * emojiPool.length)];
  const names = ws.map((p) => esc(p.name)).join(" & ");
  const variant = "cel-v" + (1 + Math.floor(Math.random() * 5)); // random animation
  const overlay = el(`
    <div class="celebrate ${variant}">
      ${celConfettiMarkup()}
      <div class="cel-inner">
        <div class="cel-emoji">${emoji}</div>
        <div class="cel-title">${esc(text)}</div>
        <div class="cel-name">${names}</div>
        <div class="cel-score">${ws[0].total} points <i class="fa-regular fa-trophy"></i></div>
        <div class="cel-actions">
          <button class="btn btn-primary cel-close">Continuer</button>
          <button class="btn btn-restart cel-restart"><i class="fa-regular fa-arrows-rotate"></i> Rejouer</button>
        </div>
      </div>
    </div>`);
  let done = false;
  const remove = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    overlay.remove();
  };
  const timer = setTimeout(remove, 10000); // auto-dismiss after 10s
  overlay.addEventListener("click", (e) => {
    if (e.target.classList.contains("cel-restart")) {
      done = true;
      clearTimeout(timer);
      overlay.remove();
      openSetupDialog({
        prefill: game.players.map((p) => p.name),
        mode: game.mode,
      });
      return;
    }
    remove();
  });
  document.body.appendChild(overlay);
}

// Compare winner before/after a score change; celebrate a brand-new win
// (including ties — the celebration lists every tied player/team).
function celebrateIfNewWinner(beforeWinnerId, game) {
  const w = winner(game);
  if (w && w.id !== beforeWinnerId) celebrate(game);
}

/* ---------- restart ---------- */
function restartGame(game) {
  const now = Date.now();
  const newGame = {
    id: uid(),
    name: gameNameFromDate(now),
    createdAt: now,
    target: game.target,
    place: game.place,
    players: game.players.map((p) => ({ id: uid(), name: p.name })),
    rounds: [],
  };
  upsertGame(newGame);
  go("game", { id: newGame.id });
}

function confirmDialog({
  title,
  body,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  danger = false,
}) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    const overlay = el(`
      <div class="overlay">
        <div class="modal">
          <h3>${esc(title)}</h3>
          <p>${esc(body)}</p>
          <div class="row">
            <button class="btn btn-ghost" data-act="cancel">${esc(cancelLabel)}</button>
            <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="ok">${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>`);
    const close = (val) => {
      overlay.remove();
      resolve(val);
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
      const act = e.target.getAttribute("data-act");
      if (act === "cancel") close(false);
      if (act === "ok") close(true);
    });
    root.appendChild(overlay);
  });
}

function promptDialog({
  title,
  label,
  placeholder = "",
  confirmLabel = "Ajouter",
}) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    const overlay = el(`
      <div class="overlay">
        <div class="modal">
          <h3>${esc(title)}</h3>
          <div class="field">
            <label>${esc(label)}</label>
            <input type="text" id="promptInput" placeholder="${esc(placeholder)}" />
          </div>
          <div class="row">
            <button class="btn btn-ghost" data-act="cancel">Annuler</button>
            <button class="btn btn-primary" data-act="ok">${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>`);
    const input = overlay.querySelector("#promptInput");
    const close = (val) => {
      overlay.remove();
      resolve(val);
    };
    const submit = () => close(input.value.trim() || null);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
      const act = e.target.getAttribute("data-act");
      if (act === "cancel") close(null);
      if (act === "ok") submit();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    root.appendChild(overlay);
    setTimeout(() => input.focus(), 30);
  });
}

async function promptNewPlace() {
  const name = await promptDialog({
    title: "Ajouter un lieu",
    label: "Nom du lieu",
    placeholder: "ex. Maison, Bureau, Chalet…",
  });
  if (!name) return false;
  addLocalPlace(name);
  setSelectedPlace(name);
  return true;
}

/* ---------- Rules ---------- */
let rulesTab = "classic";

function rulesClassicHTML() {
  return `
    <p class="rules-intro"><b>Flip 7</b> est un jeu de cartes de <b>« stop ou encore »</b> (push-your-luck) rapide et nerveux. À chaque manche, on pioche des cartes pour accumuler le plus de points possible… mais piocher un <b>doublon</b> vous élimine et vous fait tout perdre. Faut-il tenter une carte de plus ou s'arrêter à temps ? Premier à <b>200 points</b> gagne.</p>

    <h3><i class="fa-regular fa-bullseye"></i> But du jeu</h3>
    <p>Être le premier joueur à atteindre <b>200 points</b>, cumulés sur plusieurs manches. Chaque manche, on essaie de banquer le plus de points sans se faire éliminer.</p>

    <h3><i class="fa-regular fa-cards"></i> Les cartes</h3>
    <ul>
      <li><b>Cartes numéro (0 à 12)</b> : il y a autant d'exemplaires d'un chiffre que sa valeur (douze « 12 », onze « 11 »… un seul « 1 »), plus une unique carte « 0 ».</li>
      <li><b>Cartes modificateur</b> : +2, +4, +6, +8, +10 et ×2 — elles font grimper le score de la manche.</li>
      <li><b>Cartes action</b> : Gel, Pioche Trois et Seconde Chance.</li>
    </ul>

    <h3><i class="fa-regular fa-arrows-rotate"></i> Déroulement d'une manche</h3>
    <p>À tour de rôle, chaque joueur choisit de <b>piocher</b> une carte de plus (« encore ») ou de <b>s'arrêter</b> (« stop ») pour banquer ses points. Une fois arrêté ou éliminé, on ne rejoue plus jusqu'à la manche suivante.</p>

    <h3><i class="fa-regular fa-burst"></i> Cartes numéro &amp; élimination</h3>
    <ul>
      <li>Chaque carte numéro vaut sa <b>valeur faciale</b> et s'ajoute à votre total de manche.</li>
      <li>Piocher un chiffre que vous <b>possédez déjà</b> (un doublon) vous <b>élimine</b> : 0 point pour la manche… sauf si vous détenez une Seconde Chance.</li>
    </ul>

    <h3><i class="fa-regular fa-star"></i> Le Flip 7</h3>
    <p>Réunir <b>7 cartes numéro différentes</b> déclenche un « Flip 7 » : la manche se termine <b>immédiatement</b> pour tout le monde et vous empochez un bonus de <b>+15 points</b>. C'est le gros coup de la partie.</p>

    <h3><i class="fa-regular fa-plus"></i> Cartes modificateur</h3>
    <ul>
      <li><b>+2 / +4 / +6 / +8 / +10</b> : ajoutent leur valeur à votre total de la manche.</li>
      <li><b>×2</b> : double la somme de vos cartes numéro (les cartes « + » s'ajoutent ensuite).</li>
    </ul>

    <h3><i class="fa-regular fa-clapperboard"></i> Cartes action</h3>
    <ul>
      <li><b>Gel</b> : un joueur que vous désignez doit s'arrêter immédiatement et banquer ses points.</li>
      <li><b>Pioche Trois</b> : un joueur doit piocher trois cartes d'affilée (en s'exposant aux doublons).</li>
      <li><b>Seconde Chance</b> : vous protège d'un doublon (vous le défaussez au lieu d'être éliminé). Si vous en recevez une deuxième, donnez-la à un joueur qui n'en a pas.</li>
    </ul>

    <h3><i class="fa-regular fa-flag-checkered"></i> Fin de la manche</h3>
    <p>La manche s'arrête quand tous les joueurs se sont arrêtés ou éliminés, ou dès qu'un joueur réalise un Flip 7. Score de chacun : somme des cartes numéro (doublée si ×2) + modificateurs + 15 si Flip 7. Un joueur éliminé marque <b>0</b>.</p>

    <h3><i class="fa-regular fa-trophy"></i> Fin de la partie</h3>
    <p>Dès qu'un joueur atteint <b>200 points</b> au total, il gagne. Si plusieurs franchissent 200 dans la même manche, le <b>plus haut total</b> l'emporte.</p>

    <h3><i class="fa-regular fa-mobile-screen-button"></i> Dans cette application</h3>
    <ul>
      <li>Saisissez le <b>total de chaque joueur</b> pour chaque manche.</li>
      <li>Cochez <b>« Flip 7 (+15) »</b> pour ajouter le bonus, ou <b>« Éliminé »</b> pour marquer 0.</li>
      <li>Dans le <b>détail des scores</b>, tapez <b>« +15 »</b> dans une case (ex. « 10+15 ») pour activer ou retirer le bonus Flip 7.</li>
    </ul>`;
}

function rulesVengeanceHTML() {
  return `
    <p class="rules-intro"><b>Flip 7 : With a Vengeance</b> est la suite de Flip 7. Le principe ne change pas (premier à <b>200 points</b>), mais le jeu ajoute des cartes plus chaotiques. Les bases (tours, élimination sur doublon, Flip 7 = +15) restent celles de l'onglet <b>Flip 7</b> — voici ce qui est <b>nouveau</b>.</p>

    <h3><i class="fa-regular fa-list-ol"></i> Nouvelles cartes numéro</h3>
    <ul>
      <li><b>Le 13</b> : les chiffres montent désormais jusqu'à 13 (treize cartes « 13 »).</li>
      <li><b>13 chanceux</b> : vous pouvez posséder <b>deux « 13 »</b> sans être éliminé ; un troisième vous élimine.</li>
      <li><b>Zéro (spécial)</b> : votre total de la manche devient <b>0</b>, et vous êtes obligé de continuer à piocher jusqu'à réaliser un Flip 7.</li>
      <li><b>7 malchanceux</b> : vous défaussez toutes vos cartes numéro et modificateur ; il ne vous reste que ce 7.</li>
    </ul>

    <h3><i class="fa-regular fa-plus"></i> Nouveaux modificateurs</h3>
    <ul>
      <li><b>÷2 (divisé par deux)</b> : divise par deux la somme de vos cartes numéro, <b>avant</b> les autres modificateurs (arrondi à l'inférieur).</li>
      <li><b>Modificateurs négatifs</b> : soustraient leur valeur de votre score.</li>
    </ul>

    <h3><i class="fa-regular fa-clapperboard"></i> Nouvelles cartes action</h3>
    <ul>
      <li><b>Encore une</b> : un joueur pioche une carte, puis s'arrête immédiatement.</li>
      <li><b>Échanger</b> : deux joueurs échangent une de leurs cartes face visible.</li>
      <li><b>Voler</b> : prenez une carte face visible d'un autre joueur.</li>
      <li><b>Défausser</b> : un joueur défausse une de ses cartes.</li>
      <li><b>Pioche Quatre</b> : un joueur pioche quatre cartes d'affilée (s'arrête s'il est éliminé ou réalise un Flip 7).</li>
    </ul>

    <h3><i class="fa-regular fa-calculator"></i> Calcul des points (dans l'ordre)</h3>
    <ul>
      <li>1. Additionnez la valeur de vos cartes numéro.</li>
      <li>2. Appliquez le <b>÷2</b> s'il est présent (arrondi à l'inférieur).</li>
      <li>3. Soustrayez les <b>modificateurs négatifs</b> (minimum 0 en jeu normal).</li>
      <li>4. Ajoutez <b>+15</b> si vous avez réalisé un Flip 7.</li>
    </ul>

    <h3><i class="fa-regular fa-face-angry-horns"></i> Mode Brutal (variante)</h3>
    <ul>
      <li>Les scores d'une manche peuvent être <b>négatifs</b>.</li>
      <li>Les modificateurs peuvent être donnés à un joueur même <b>éliminé</b>.</li>
      <li>En réalisant un Flip 7, au choix : <b>+15 pour vous</b> ou <b>−15 pour un adversaire</b>.</li>
    </ul>

    <h3><i class="fa-regular fa-mobile-screen-button"></i> Dans cette application</h3>
    <ul>
      <li>Saisissez le total final de chaque joueur pour chaque manche — toutes les variantes (÷2, négatifs, mode Brutal) sont donc gérées par votre saisie.</li>
      <li>Cochez <b>« Flip 7 (+15) »</b> pour le bonus, ou <b>« Éliminé »</b> pour marquer 0.</li>
      <li>Dans le <b>détail des scores</b>, tapez <b>« +15 »</b> dans une case (ex. « 10+15 ») pour activer ou retirer le bonus Flip 7.</li>
    </ul>`;
}

function rulesSkyjoHTML() {
  return `
    <p class="rules-intro"><b>Skyjo</b> est un jeu de cartes où l'on cherche à avoir <b>le moins de points possible</b>. La partie se joue en plusieurs manches ; elle s'arrête dès qu'un joueur atteint <b>100 points</b>, et c'est le joueur avec le <b>total le plus bas</b> qui gagne.</p>

    <h3><i class="fa-regular fa-bullseye"></i> But du jeu</h3>
    <p>Avoir le <b>plus petit total</b> de points à la fin de la partie. Contrairement à Flip 7, les points sont une malus : on veut les éviter.</p>

    <h3><i class="fa-regular fa-cards"></i> Les cartes</h3>
    <ul>
      <li>150 cartes de valeurs <b>−2 à 12</b> (les cartes négatives et les zéros font baisser votre score).</li>
      <li>Chaque joueur dispose d'une grille de <b>3 × 4 cartes</b> (12 cartes), d'abord face cachée.</li>
    </ul>

    <h3><i class="fa-regular fa-arrows-rotate"></i> Déroulement d'une manche</h3>
    <ul>
      <li>À son tour, on pioche une carte (de la pioche ou de la défausse) et on l'échange avec une carte de sa grille, ou on retourne une carte cachée.</li>
      <li><b>Colonne identique</b> : si une colonne de 3 cartes affiche la même valeur, elle est retirée et vaut <b>0</b>.</li>
      <li>La manche se termine quand un joueur a <b>retourné toutes ses cartes</b> ; les autres jouent un dernier tour.</li>
    </ul>

    <h3><i class="fa-regular fa-calculator"></i> Décompte d'une manche</h3>
    <ul>
      <li>Chaque joueur additionne la valeur des cartes restantes dans sa grille.</li>
      <li><b>Pénalité du premier sorti</b> : le joueur qui a terminé la manche <b>double son score de la manche</b> s'il n'a pas (seul) le plus petit total de la manche.</li>
    </ul>

    <h3><i class="fa-regular fa-trophy"></i> Fin de la partie</h3>
    <p>Dès qu'un joueur atteint ou dépasse <b>100 points</b> au cumul, la partie s'arrête. Le joueur avec le <b>total le plus bas</b> l'emporte.</p>

    <h3><i class="fa-regular fa-mobile-screen-button"></i> Dans cette application</h3>
    <ul>
      <li>Saisissez le <b>score de chaque joueur pour chaque manche</b> ; le bouton <b>±</b> permet d'entrer un score <b>négatif</b>.</li>
      <li>Le classement met le <b>plus petit total en tête</b> ; le vainqueur prévisionnel est signalé d'une couronne dès qu'un joueur atteindrait 100.</li>
    </ul>`;
}

function rulesTimesUpHTML() {
  return `
    <p class="rules-intro"><b>Time's Up!</b> est un jeu d'ambiance par <b>équipes</b> où l'on fait deviner des personnalités. La partie se joue en <b>3 manches</b> avec le <b>même paquet de cartes</b> à chaque fois ; à la fin, l'équipe au <b>plus haut total</b> gagne.</p>

    <h3><i class="fa-regular fa-bullseye"></i> But du jeu</h3>
    <p>En équipes, faire deviner un maximum de personnalités en un temps limité (≈ 30 s par tour). On cumule les cartes devinées sur les 3 manches ; l'équipe avec le <b>plus de points</b> l'emporte.</p>

    <h3><i class="fa-regular fa-users"></i> Mise en place</h3>
    <ul>
      <li>Formez <b>2 équipes ou plus</b>.</li>
      <li>Chaque joueur écrit quelques personnalités (réelles ou fictives, connues de tous) ; toutes les cartes forment le paquet commun.</li>
    </ul>

    <h3><i class="fa-regular fa-arrows-rotate"></i> Les 3 manches</h3>
    <ul>
      <li><b>Manche 1 — Description libre</b> : faire deviner en parlant librement (sans dire le nom).</li>
      <li><b>Manche 2 — Un seul mot</b> : un seul mot d'indice par carte.</li>
      <li><b>Manche 3 — Mime</b> : uniquement des gestes, sans parler.</li>
    </ul>
    <p>À chaque manche on rejoue avec <b>tout le paquet</b> : les cartes mémorisées aux manches précédentes deviennent plus faciles.</p>

    <h3><i class="fa-regular fa-stopwatch"></i> Déroulement d'un tour</h3>
    <p>À tour de rôle, une équipe désigne un « parleur » qui fait deviner le plus de cartes possible avant la fin du sablier. Chaque carte devinée = <b>1 point</b> pour l'équipe. La manche s'arrête quand le paquet est épuisé, puis on rebat les cartes pour la manche suivante.</p>

    <h3><i class="fa-regular fa-trophy"></i> Fin de la partie</h3>
    <p>Après la <b>3ᵉ manche</b>, on additionne les points des 3 manches. L'équipe au <b>plus haut total</b> gagne (égalité possible).</p>

    <h3><i class="fa-regular fa-mobile-screen-button"></i> Dans cette application</h3>
    <ul>
      <li>Saisissez les <b>noms d'équipes</b> dans les joueurs.</li>
      <li>À chaque manche, entrez le <b>nombre de cartes devinées</b> par chaque équipe.</li>
      <li>La partie se termine automatiquement après <b>3 manches</b> ; le plus haut total gagne.</li>
    </ul>`;
}

function rulesQwirkleHTML() {
  return `
    <p class="rules-intro"><b>Qwirkle</b> est un jeu de tuiles où l'on forme des lignes partageant une même <b>couleur</b> ou une même <b>forme</b>. On marque des points à chaque pose ; à la fin, le joueur au <b>plus haut total</b> l'emporte.</p>

    <h3><i class="fa-regular fa-bullseye"></i> But du jeu</h3>
    <p>Marquer un <b>maximum de points</b> en posant des tuiles pour créer ou prolonger des lignes de même couleur (formes différentes) ou de même forme (couleurs différentes).</p>

    <h3><i class="fa-regular fa-shapes"></i> Le matériel</h3>
    <ul>
      <li><b>108 tuiles</b> : 6 formes × 6 couleurs, chacune en 3 exemplaires.</li>
      <li>Chaque joueur garde <b>6 tuiles</b> en main, piochées dans le sac.</li>
    </ul>

    <h3><i class="fa-regular fa-arrows-rotate"></i> Déroulement d'un tour</h3>
    <ul>
      <li>À son tour, on pose une ou plusieurs tuiles <b>alignées</b> qui partagent la couleur <b>ou</b> la forme (jamais de doublon dans une même ligne), puis on complète sa main à 6.</li>
      <li>On peut aussi <b>échanger</b> tout ou partie de sa main (on passe alors son tour).</li>
    </ul>

    <h3><i class="fa-regular fa-calculator"></i> Décompte</h3>
    <ul>
      <li>On marque <b>1 point par tuile</b> de chaque ligne créée ou prolongée par sa pose (une tuile au croisement de deux lignes compte dans les deux).</li>
      <li><b>Qwirkle</b> : compléter une ligne de <b>6 tuiles</b> rapporte <b>6 points bonus</b> (soit 12 pour cette ligne).</li>
    </ul>

    <h3><i class="fa-regular fa-trophy"></i> Fin de la partie</h3>
    <p>La partie s'arrête quand un joueur <b>pose sa dernière tuile</b> alors que le sac est vide : il gagne <b>6 points bonus</b>. Le <b>plus haut total</b> gagne.</p>

    <h3><i class="fa-regular fa-mobile-screen-button"></i> Dans cette application</h3>
    <ul>
      <li>Au démarrage, choisissez <b>« Qui commence ? »</b> ; les tours s'enchaînent ensuite <b>dans l'ordre des joueurs</b>.</li>
      <li>À chaque tour, saisissez le <b>score du joueur courant</b> (« Score de … »), puis on passe automatiquement au suivant. Utilisez <b>« A pioché »</b> s'il a pioché sans marquer (0 point).</li>
      <li>Il n'y a pas de fin automatique : appuyez sur <b>« Terminer »</b> quand la partie est finie ; le joueur en tête est alors couronné.</li>
    </ul>`;
}

function rulesContreeHTML() {
  return `
    <p class="rules-intro">La <b>Contrée</b> (ou coinche) est un jeu de plis par <b>équipes de 2</b>. Une équipe annonce un <b>contrat</b> (un nombre de points dans une couleur d'atout) ; si elle le réalise, elle marque, sinon l'adversaire empoche. Première équipe au <b>score cible</b> gagne.</p>

    <h3><i class="fa-regular fa-users"></i> Mise en place</h3>
    <ul>
      <li><b>4 joueurs</b>, 2 équipes : les joueurs <b>1 & 3</b> contre les joueurs <b>2 & 4</b> (assis en alternance).</li>
      <li>On définit un <b>score cible</b> à atteindre (souvent 1000 ou 2000).</li>
    </ul>

    <h3><i class="fa-regular fa-gavel"></i> Les enchères</h3>
    <ul>
      <li>À tour de rôle, on annonce un <b>contrat</b> : une valeur (80, 90… 160, capot) et une <b>couleur d'atout</b> (♠ ♥ ♦ ♣).</li>
      <li>Les adversaires peuvent <b>contrer</b> (×2) ; l'équipe qui prend peut <b>surcontrer</b> (×4).</li>
    </ul>

    <h3><i class="fa-regular fa-share-from-square"></i> La distribution</h3>
    <p>On choisit qui <b>distribue en premier</b> ; la distribution tourne ensuite dans l'ordre des joueurs à chaque donne.</p>

    <h3><i class="fa-regular fa-mobile-screen-button"></i> Dans cette application</h3>
    <ul>
      <li>À la création : définissez le <b>score cible</b> et les <b>4 joueurs</b> (l'ordre fixe les équipes : 1 & 3 / 2 & 4).</li>
      <li>Sur la partie : choisissez <b>qui distribue</b>, puis saisissez la <b>mise</b> (contrat 80→160 ou <b>Capot</b>, atout, équipe qui prend, contré/surcontré). Elle est rappelée en haut du tableau.</li>
      <li>Pour le score, entrez les <b>points de plis</b> d'une équipe (l'autre se complète à <b>160</b>, arrondi à la dizaine) et signalez une éventuelle <b>Belote (+20)</b>.</li>
      <li>L'app <b>calcule automatiquement</b> le score de la donne (contrat réussi/chuté, contré ×2, surcontré ×4, capot) et indique si le contrat est tenu. La distribution passe ensuite au joueur suivant.</li>
    </ul>`;
}

function rulesYamsHTML() {
  return `
    <p class="rules-intro">Le <b>Yam's</b> (Yahtzee) est un jeu de <b>dés</b> : à chaque tour, on lance cinq dés (jusqu'à 3 lancers) pour réaliser une <b>combinaison</b>, puis on l'inscrit dans une <b>case du contrat</b>. Chaque case ne sert qu'<b>une seule fois</b>. Le plus haut total l'emporte.</p>

    <h3><i class="fa-regular fa-dice"></i> Le matériel</h3>
    <ul>
      <li><b>5 dés</b> et une <b>feuille de marque</b> par joueur (les 12 cases du contrat).</li>
      <li>À son tour : jusqu'à <b>3 lancers</b>, en gardant les dés voulus entre chaque relance.</li>
    </ul>

    <h3><i class="fa-regular fa-list-check"></i> Les 12 missions</h3>
    <ul>
      <li><b>Section haute</b> — As, Deux, Trois, Quatre, Cinq, Six : on marque la <b>somme des dés</b> de la valeur choisie.</li>
      <li><b>Brelan</b> (3 identiques) = <b>25</b> · <b>Carré</b> (4 identiques) = <b>35</b> · <b>Full</b> (brelan + paire) = <b>30</b>.</li>
      <li><b>Petite suite</b> (4 à la suite) = <b>25</b> · <b>Grande suite</b> (5 à la suite) = <b>40</b> · <b>Yam's</b> (5 identiques) = <b>50</b>.</li>
    </ul>

    <h3><i class="fa-regular fa-star"></i> Le bonus</h3>
    <p>Si le total de la <b>section haute</b> atteint <b>63 points</b>, on gagne un <b>bonus de +35</b>.</p>

    <h3><i class="fa-regular fa-trophy"></i> Fin de la partie</h3>
    <p>La partie s'arrête quand <b>tous les joueurs ont rempli leurs 12 cases</b>. Le joueur au <b>plus haut total</b> (cases + bonus) gagne.</p>

    <h3><i class="fa-regular fa-mobile-screen-button"></i> Dans cette application</h3>
    <ul>
      <li>Au démarrage, choisissez <b>« Qui commence ? »</b> ; les tours s'enchaînent ensuite <b>dans l'ordre des joueurs</b>.</li>
      <li>À chaque tour, choisissez la <b>mission</b> à inscrire. Pour la <b>section haute</b>, indiquez le <b>nombre de dés</b> de la face (l'app multiplie par la valeur) ; les figures fixes sont remplies automatiquement. Vous pouvez aussi <b>barrer</b> la case (0 point).</li>
      <li>Le <b>bonus de +35</b> est <b>calculé automatiquement</b> dès que la section haute atteint 63.</li>
      <li>La partie se <b>termine d'elle-même</b> une fois toutes les cases remplies ; le joueur en tête est couronné.</li>
    </ul>`;
}

// Rules shown in a dialog (opened from the top-bar book button).
function openRulesDialog() {
  // When viewing a game, default the rules to that game's mode.
  if (["game", "details", "entry"].includes(route.name) && route.id) {
    const g = getGame(route.id);
    if (g && MODES[g.mode]) rulesTab = g.mode;
  }
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-rules"></div>`);
  overlay.appendChild(modal);

  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3><i class="fa-regular fa-book-open"></i> Règles</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="rules-dialog-body"></div>`;
  modal
    .querySelector("[data-act=close]")
    .addEventListener("click", () => overlay.remove());
  const body = modal.querySelector(".rules-dialog-body");

  function draw() {
    body.innerHTML = `
      <div class="rules-tabs">
        ${Object.entries(MODES)
          .map(
            ([key, m]) =>
              `<button class="rules-tab ${rulesTab === key ? "active" : ""}" data-tab="${key}">${esc(m.label)}</button>`,
          )
          .join("")}
      </div>
      <div class="rules">${rulesFor(rulesTab)}</div>`;
    body.querySelectorAll(".rules-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        rulesTab = btn.getAttribute("data-tab");
        draw();
      });
    });
  }
  draw();

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  root.appendChild(overlay);
}

/* ---------- Place (entry screen) ---------- */
function renderPlace() {
  app.innerHTML = "";
  const current = getSelectedPlace();

  app.appendChild(el(logoMarkup()));

  const wrap = el(`
    <div class="panel" style="max-width:480px;margin:0 auto">
      <h2>Où jouez-vous&nbsp;?</h2>
      <p class="muted" style="margin:-6px 0 18px">Indiquez le lieu. S'il existe déjà, vous le rejoignez ; sinon il est créé.</p>
      <div class="field">
        <label>Lieu</label>
        <input type="text" id="placeInput" placeholder="ex. Maison, Bureau, Chalet…" />
      </div>
      <div class="row">
        <div class="spacer"></div>
        <button class="btn btn-primary btn-big" id="continue">Continuer <i class="fa-regular fa-arrow-right"></i></button>
      </div>
    </div>`);
  app.appendChild(wrapPanel(wrap));

  const input = wrap.querySelector("#placeInput");
  if (current) input.value = current;

  const submit = async () => {
    const name = input.value.trim();
    if (!name) return toast("Indiquez un lieu");
    const existing = allPlaces()
      .filter(Boolean)
      .find((p) => p.toLowerCase() === name.toLowerCase());
    if (existing) {
      setSelectedPlace(existing); // already exists → join it
    } else {
      addLocalPlace(name); // new → create it
      setSelectedPlace(name);
    }
    await fetchGames(getSelectedPlace()); // load the chosen place's games
    go("home");
  };
  wrap.querySelector("#continue").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  setTimeout(() => input.focus(), 30);
}

/* ---------- Home ---------- */
function renderHome() {
  app.innerHTML = "";

  const place = getSelectedPlace();
  if (place === null) return go("place"); // must pick a place first

  const games = gamesForPlace(place);

  // The intro/hero (logo + description + actions) is only useful before any
  // game exists for this place. Once games are listed, drop it and surface the
  // new-game action in the toolbar.
  if (!games.length) {
    app.appendChild(navTabs("home"));
    const hero = el(`
      <section class="hero">
        ${logoMarkup()}
        <h2>Suivez vos parties de Flip 7 &amp; Skyjo</h2>
        <p>Choisissez un lieu, créez une partie et enregistrez les points de chaque manche.</p>
        <button class="btn btn-primary" id="newGame">+ Nouvelle partie</button>
      </section>`);
    hero.querySelector("#newGame").addEventListener("click", () => openSetupDialog());
    app.appendChild(wrapPanel(hero));
    app.appendChild(
      wrapPanel(
        el(
          `<div class="empty">Aucune partie à « ${esc(placeLabel(place))} » pour l'instant. Créez-en une ci-dessus.</div>`,
        ),
      ),
    );
    return;
  }

  // ----- games for this place -----
  // Tabs, date filter and "new game" sit directly in main (no wrapper).
  const FILTERS = [
    { key: "today", label: "Aujourd'hui" },
    { key: "week", label: "Cette semaine" },
    { key: "month", label: "Ce mois" },
    { key: "all", label: "Toutes" },
  ];
  if (!FILTERS.some((f) => f.key === homeFilter)) homeFilter = "today";
  const nav = navTabs("home");
  const newBtn = el(
    `<button class="btn btn-primary btn-sm ml-auto" id="newGame"><i class="fa-regular fa-plus"></i> <span class="btn-label">Nouvelle partie</span></button>`,
  );
  newBtn.addEventListener("click", () => openSetupDialog());
  nav.appendChild(newBtn);
  app.appendChild(nav);

  const filterEl = el(`
    <div class="date-filter" id="dateFilter">
      ${FILTERS.map((f) => {
        const n = filterGamesByDate(games, f.key).length;
        return `<button type="button" data-f="${f.key}" class="${f.key === homeFilter ? "active" : ""}">${f.label} <span class="filter-count">${n}</span></button>`;
      }).join("")}
    </div>`);
  filterEl.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      homeFilter = b.dataset.f;
      renderHome();
    }),
  );
  app.appendChild(filterEl);

  const filtered = filterGamesByDate(games, homeFilter);
  if (!filtered.length) {
    const label =
      homeFilter === "today"
        ? "aujourd'hui"
        : homeFilter === "week"
          ? "cette semaine"
          : homeFilter === "month"
            ? "ce mois"
            : "pour ce filtre";
    app.appendChild(
      wrapPanel(el(`<div class="empty">Aucune partie ${label}.</div>`)),
    );
    return;
  }

  const list = el(`<div class="game-list"></div>`);
  filtered.forEach((g) => {
    const ws = winners(g);
    const w = ws[0] || null;
    const ongoing = !g.cancelled && !w;
    const playerCount = g.players.length;
    const u = unitOf(g.mode);
    const playersNote = playerCount
      ? `${playerCount} ${(playerCount === 1 ? u.one : u.many).toLowerCase()}`
      : "Aucun joueur";
    let roundsNote = "";
    if (!ongoing) {
      roundsNote = ` · ${roundCountLabel(g, g.rounds.length)}`;
      const dur = gameDuration(g);
      if (dur != null) roundsNote += ` · ${fmtDuration(dur)}`;
    }
    const statusBadge = g.cancelled
      ? `<span class="badge cancelled"><i class="fa-regular fa-ban"></i> Annulée</span>`
      : w
        ? `<span class="badge rank1"><i class="fa-regular fa-trophy"></i> ${winnersLabel(ws)}</span>`
        : `<div class="status-cell">
             <span class="badge ongoing">En cours <i class="fa-regular fa-spinner-third fa-spin"></i></span>
             <span class="round-note">${roundNoteFor(g)}</span>
           </div>`;
    const card = el(`
      <div class="game-card ${g.cancelled ? "cancelled" : w ? "done" : "ongoing"}">
        <div class="meta">
          <div class="name"><span class="name-text">${esc(g.name)}</span> <span class="badge badge-sm ${modeClass(g.mode)}">${esc(modeLabel(g.mode))}</span></div>
          <div class="sub">${esc(playersNote)}${roundsNote}</div>
        </div>
        ${statusBadge}
      </div>`);
    card.addEventListener("click", () => go("game", { id: g.id }));
    list.appendChild(card);
  });
  app.appendChild(list);
}

/* ---------- Shared player-list editor (used by Setup & Organiser) ---------- */
// Renders the reorderable player rows into `rowsEl`, mutating the `players`
// array ({id, name}) in place. Returns the redraw function (call it after
// pushing a new player). Identical preparation logic for both screens.
// Uses Pointer Events (mouse + touch) so reordering works on mobile too.
function renderPlayerRows(
  rowsEl,
  players,
  { allowRemove = true, placeholder = "Nom du joueur", suggestions } = {},
) {
  // placeholder may be a function so it tracks the dialog's selected game.
  const phText = () =>
    typeof placeholder === "function" ? placeholder() : placeholder;
  // allowRemove may be a function so it can react to the selected game (Contrée
  // has a fixed 4-player roster: no remove, but rows stay reorderable).
  const canRemove = () =>
    typeof allowRemove === "function" ? allowRemove() : allowRemove;
  // Autocompletion source; may be a function so it tracks the selected game
  // (player names vs team names). A custom dropdown is used instead of
  // <datalist>, whose mobile support is unreliable.
  const getSuggestions = () =>
    typeof suggestions === "function"
      ? suggestions()
      : suggestions || placePlayerNames(getSelectedPlace());
  let dragSrc = null;

  // Wire a custom suggestions dropdown to a row's name input. The dropdown is
  // an in-flow block right under the input (inside the scrollable dialog body)
  // so it follows the input — unlike a position:fixed overlay, it doesn't drift
  // when the mobile keyboard resizes the viewport, and it's never clipped.
  function wireSuggestions(input, i) {
    const box = input.parentElement.querySelector(".name-suggest");
    const renderList = () => {
      const q = (input.value || "").trim().toLowerCase();
      // Hide names already chosen in other rows + the current exact value.
      const taken = new Set(
        players
          .filter((_, k) => k !== i)
          .map((p) => (p.name || "").trim().toLowerCase())
          .filter(Boolean),
      );
      const matches = getSuggestions()
        .filter((n) => {
          const nl = n.toLowerCase();
          return !taken.has(nl) && nl !== q && (!q || nl.includes(q));
        })
        .slice(0, 6);
      if (!matches.length) {
        box.hidden = true;
        box.innerHTML = "";
        return;
      }
      box.innerHTML = matches
        .map(
          (n) =>
            `<button type="button" class="name-suggest-item">${esc(n)}</button>`,
        )
        .join("");
      box.hidden = false;
      // Keep the list in view (e.g. when the keyboard just opened).
      box.scrollIntoView({ block: "nearest" });
    };
    input.addEventListener("focus", renderList);
    input.addEventListener("input", renderList);
    // Delay so a tap on an item registers before the list hides.
    input.addEventListener("blur", () =>
      setTimeout(() => {
        box.hidden = true;
      }, 150),
    );
    // pointerdown (not click) fires before blur — works for touch and mouse.
    box.addEventListener("pointerdown", (e) => {
      const btn = e.target.closest(".name-suggest-item");
      if (!btn) return;
      e.preventDefault();
      input.value = btn.textContent;
      players[i].name = btn.textContent;
      box.hidden = true;
      revalidate(i);
    });
  }

  // Index of the row whose upper half currently contains pointer Y, i.e. the
  // insertion target. Falls back to the last row when below every center.
  function rowIndexAtY(y) {
    const rows = [...rowsEl.querySelectorAll(".player-row")];
    for (let j = 0; j < rows.length; j++) {
      const r = rows[j].getBoundingClientRect();
      if (y < r.top + r.height / 2) return j;
    }
    return rows.length - 1;
  }

  function clearHints() {
    rowsEl
      .querySelectorAll(".player-row")
      .forEach((r) => r.classList.remove("drag-over", "dragging"));
  }

  function draw() {
    rowsEl.innerHTML = "";
    players.forEach((p, i) => {
      const row = el(`
        <div class="player-row" data-i="${i}">
          <span class="drag-handle" title="Déplacer"><i class="fa-regular fa-grip-dots-vertical"></i></span>
          <div class="player-input-wrap">
            <div class="name-field">
              <input type="text" placeholder="${esc(phText())}" value="${esc(p.name)}" autocomplete="off" />
              <div class="name-suggest" hidden></div>
            </div>
            <div class="player-error" hidden></div>
          </div>
          ${canRemove() ? `<button class="btn btn-danger btn-icon" title="Retirer"><i class="fa-regular fa-xmark"></i></button>` : ""}
        </div>`);
      const input = row.querySelector("input");
      input.addEventListener("input", (e) => {
        players[i].name = e.target.value;
        revalidate(i);
      });
      wireSuggestions(input, i);
      if (canRemove()) {
        row.querySelector("button").addEventListener("click", () => {
          players.splice(i, 1);
          if (!players.length) players.push({ id: uid(), name: "" });
          draw();
        });
      }

      const handle = row.querySelector(".drag-handle");
      handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        dragSrc = i;
        row.classList.add("dragging");
        handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener("pointermove", (e) => {
        if (dragSrc === null) return;
        e.preventDefault();
        const j = rowIndexAtY(e.clientY);
        rowsEl
          .querySelectorAll(".player-row")
          .forEach((r, k) =>
            r.classList.toggle("drag-over", k === j && j !== dragSrc),
          );
      });
      const finish = (e) => {
        if (dragSrc === null) return;
        const j = rowIndexAtY(e.clientY);
        const src = dragSrc;
        dragSrc = null;
        if (j !== src) {
          const moved = players.splice(src, 1)[0];
          players.splice(j, 0, moved);
        }
        draw();
      };
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", () => {
        dragSrc = null;
        clearHints();
      });

      rowsEl.appendChild(row);
    });
    revalidate(null);
  }

  // Outline duplicate-name inputs in red; show a message under the row that was
  // just edited (focusIndex), if its name collides with another.
  function revalidate(focusIndex) {
    const counts = {};
    players.forEach((p) => {
      const k = (p.name || "").trim().toLowerCase();
      if (k) counts[k] = (counts[k] || 0) + 1;
    });
    [...rowsEl.querySelectorAll(".player-row")].forEach((row, idx) => {
      const input = row.querySelector("input");
      const errEl = row.querySelector(".player-error");
      const k = (players[idx].name || "").trim().toLowerCase();
      const isDup = !!k && counts[k] > 1;
      input.classList.toggle("dup", isDup);
      if (isDup && idx === focusIndex) {
        errEl.textContent = "Ce joueur est déjà dans la partie";
        errEl.hidden = false;
      } else {
        errEl.textContent = "";
        errEl.hidden = true;
      }
    });
  }

  draw();
  return draw;
}

/* ---------- Setup ---------- */
// New-game setup in a dialog. `opts` may carry { prefill: [names], mode }.
function openSetupDialog(opts = {}) {
  const place = getSelectedPlace();
  if (place === null) return toast("Ajoutez ou choisissez un lieu d'abord");
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);

  let players =
    opts.prefill && opts.prefill.length
      ? opts.prefill.map((n) => ({ id: uid(), name: n }))
      : [
          { id: uid(), name: "" },
          { id: uid(), name: "" },
        ];
  let mode = opts.mode && MODES[opts.mode] ? opts.mode : DEFAULT_MODE;

  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Nouvelle partie</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <div class="field">
        <label>Type de partie</label>
        <div class="mode-tabs" id="modeTabs">${modeTabsHTML()}</div>
      </div>
      <div class="field" id="targetField" hidden>
        <label for="targetInput">Score cible</label>
        <input type="number" inputmode="numeric" class="cell-input target-input" id="targetInput" placeholder="2000" value="2000" />
      </div>
      <div class="field">
        <label id="playersLabel">Joueurs</label>
        <div class="player-rows" id="rows"></div>
        <button class="btn btn-ghost btn-sm" id="addPlayer">+ Ajouter un joueur</button>
        <p class="teams-hint" id="teamsHint" hidden></p>
      </div>
    </div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
      <button class="btn btn-primary" id="start">Commencer la partie</button>
    </div>`;

  const rowsEl = modal.querySelector("#rows");
  const addBtn = modal.querySelector("#addPlayer");
  const playersLabel = modal.querySelector("#playersLabel");
  const targetField = modal.querySelector("#targetField");
  const targetInput = modal.querySelector("#targetInput");
  const teamsHint = modal.querySelector("#teamsHint");
  const isTeams = () => rulesetOf(mode).teams;
  // Reflect the selected game's wording (players vs teams).
  const applyUnit = () => {
    const u = unitOf(mode);
    playersLabel.textContent = u.many;
    addBtn.textContent = `+ ${u.add}`;
    rowsEl
      .querySelectorAll('input[type="text"]')
      .forEach((i) => (i.placeholder = u.placeholder));
  };
  // Contrée: A = seats 1 & 3, B = seats 2 & 4. Refresh the live preview.
  const updateTeamsHint = () => {
    if (!isTeams()) return (teamsHint.hidden = true);
    teamsHint.hidden = false;
    const nm = (i) => (players[i] && players[i].name.trim()) || `Joueur ${i + 1}`;
    teamsHint.innerHTML = `<b>Équipe A</b> : ${esc(nm(0))} & ${esc(nm(2))} · <b>Équipe B</b> : ${esc(nm(1))} & ${esc(nm(3))}`;
  };
  // Show/hide the score-target field and enforce a fixed 4-player roster for
  // team games (reorderable, but no add/remove).
  const applyModeLayout = () => {
    targetField.hidden = !rulesetOf(mode).configurableTarget;
    if (isTeams()) {
      while (players.length < 4) players.push({ id: uid(), name: "" });
      if (players.length > 4) players.length = 4;
      addBtn.style.display = "none";
    } else {
      addBtn.style.display = "";
    }
    drawRows();
    updateTeamsHint();
  };

  const modeTabs = modal.querySelector("#modeTabs");
  const syncModeTabs = () =>
    modeTabs
      .querySelectorAll(".mode-tab")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  modeTabs.querySelectorAll(".mode-tab").forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.mode;
      syncModeTabs();
      applyUnit();
      applyModeLayout();
    }),
  );
  syncModeTabs();

  const drawRows = renderPlayerRows(rowsEl, players, {
    allowRemove: () => !isTeams(),
    placeholder: () => unitOf(mode).placeholder,
    suggestions: () => placePlayerNames(place, unitKeyOf(mode)),
  });
  applyUnit();
  applyModeLayout();
  // Keep the teams preview in sync with name edits and reordering.
  rowsEl.addEventListener("input", updateTeamsHint);
  rowsEl.addEventListener("pointerup", () => setTimeout(updateTeamsHint, 0));
  modal.querySelector("#addPlayer").addEventListener("click", () => {
    players.push({ id: uid(), name: "" });
    drawRows();
    rowsEl.querySelector(".player-row:last-child input").focus();
  });

  const close = () => overlay.remove();
  modal
    .querySelectorAll("[data-act=close]")
    .forEach((b) => b.addEventListener("click", close));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  modal.querySelector("#start").addEventListener("click", () => {
    const def = rulesetOf(mode);
    const valid = players.filter((p) => p.name.trim());
    if (def.teams) {
      if (valid.length !== 4)
        return toast("La Contrée se joue à exactement 4 joueurs");
    } else if (valid.length < 2) {
      return toast("Ajoutez au moins 2 joueurs");
    }
    const dup = firstDuplicateName(valid.map((p) => p.name));
    if (dup) return toast(`« ${dup} » est présent en double`);
    let target = def.target;
    if (def.configurableTarget) {
      target = Number(targetInput.value) || 0;
      if (target <= 0) return toast("Indiquez un score cible valide");
    }
    const now = Date.now();
    const game = {
      id: uid(),
      name: gameNameFromDate(now),
      createdAt: now,
      target,
      mode,
      place,
      players: valid.map((p) => ({ id: p.id, name: p.name.trim() })),
      rounds: [],
    };
    upsertGame(game);
    overlay.remove();
    go("game", { id: game.id });
  });

  root.appendChild(overlay);
}

/* ---------- Game ---------- */
function renderGame(id) {
  const game = getGame(id);
  if (!game) return go("home");
  app.innerHTML = "";

  const st = standings(game);
  const w = winner(game);

  // Elapsed time since creation: live while ongoing, frozen once the game is
  // over (at the winning round).
  const dur = gameDuration(game);
  const durationChip =
    dur != null
      ? `<span class="target-note" id="durationChip"><i class="fa-regular fa-clock"></i> <span class="dur-val">${fmtDuration(dur)}</span></span>`
      : "";
  // Score target chip (games with a chosen target, e.g. Contrée).
  const targetChip =
    defFor(game).configurableTarget && game.target
      ? `<span class="target-note"><i class="fa-regular fa-bullseye"></i> ${game.target} pts</span>`
      : "";
  // Round/turn label shown on the meta row below the title. Ongoing: the
  // numbered round/turn in progress ("Manche 5" / "Tour 5"); finished or
  // cancelled: the total played with a variable plural ("5 manches" / "5 tours").
  const roundNum = `<span class="game-round-num">${
    w
      ? roundCountLabel(game, game.rounds.length)
      : roundNumberLabel(game, game.rounds.length + 1)
  }</span>`;

  const backRow = el(`
    <div class="row">
      <button class="back-btn" id="back"><i class="fa-regular fa-arrow-left"></i> Retour</button>
      <span class="badge ${modeClass(game.mode)} ml-auto">${esc(modeLabel(game.mode))}</span>
    </div>`);
  backRow.querySelector("#back").addEventListener("click", () => go("home"));

  const head = el(`
    <div class="game-head game-head-stacked">
      <div class="game-meta-row">
        ${roundNum}
        ${durationChip}
        ${targetChip}
        <button class="btn btn-ghost btn-sm ml-auto" id="editPlayers">Modifier</button>
        <div class="kebab">
          <button class="btn btn-ghost btn-sm btn-icon" id="moreBtn" aria-label="Plus d'options" aria-haspopup="true" aria-expanded="false"><i class="fa-regular fa-ellipsis"></i></button>
          <div class="kebab-menu" id="moreMenu" hidden>
            <button class="kebab-item kebab-edit" id="editKebab"><i class="fa-regular fa-pen-to-square"></i> Modifier</button>
            <button class="kebab-item" id="shareBtn"><i class="fa-regular fa-share-nodes"></i> Partager</button>
            ${defFor(game).manualEnd && !defFor(game).turnBased && !w && !game.cancelled && game.rounds.length ? `<button class="kebab-item" id="endGame"><i class="fa-regular fa-flag-checkered"></i> Terminer la partie</button>` : ""}
            ${game.cancelled ? "" : `<button class="kebab-item" id="cancel"><i class="fa-regular fa-ban"></i> Annuler</button>`}
            <button class="kebab-item" id="del"${w ? "" : ' disabled title="Une partie en cours ne peut pas être supprimée — annulez-la d\'abord."'}><i class="fa-regular fa-trash-can"></i> Supprimer</button>
          </div>
        </div>
      </div>
    </div>`);
  head
    .querySelector("#editPlayers")
    .addEventListener("click", () => openEditPlayersDialog(game));

  // "..." options menu (Annuler / Supprimer)
  const moreBtn = head.querySelector("#moreBtn");
  const moreMenu = head.querySelector("#moreMenu");
  const closeMenu = () => {
    moreMenu.hidden = true;
    moreBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onOutside);
  };
  const onOutside = (e) => {
    if (!head.querySelector(".kebab").contains(e.target)) closeMenu();
  };
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = moreMenu.hidden;
    moreMenu.hidden = !open;
    moreBtn.setAttribute("aria-expanded", String(open));
    if (open) document.addEventListener("click", onOutside);
  });

  // Edit entry inside the menu (shown instead of the standalone button on
  // narrow screens).
  head.querySelector("#editKebab").addEventListener("click", () => {
    closeMenu();
    openEditPlayersDialog(game);
  });

  // Share the game via the native share sheet (clipboard fallback).
  head.querySelector("#shareBtn").addEventListener("click", async () => {
    closeMenu();
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: game.name, url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        toast("Lien copié");
      } else {
        toast("Partage non disponible");
      }
    } catch (e) {
      if (e && e.name !== "AbortError") toast("Partage impossible");
    }
  });

  // Manual-end games: close the game and crown the current leader(s).
  const endBtn = head.querySelector("#endGame");
  if (endBtn) {
    endBtn.addEventListener("click", () => {
      closeMenu();
      endGamePrompt(game);
    });
  }

  const cancelBtn = head.querySelector("#cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", async () => {
      closeMenu();
      const ok = await confirmDialog({
        title: "Annuler la partie ?",
        body: "La partie sera marquée comme annulée et attribuée au joueur ayant le plus gros score.",
        confirmLabel: "Annuler la partie",
        cancelLabel: "Retour",
        danger: true,
      });
      if (ok) {
        const g = getGame(game.id);
        g.cancelled = true;
        upsertGame(g);
        go("game", { id: game.id });
      }
    });
  }
  head.querySelector("#del").addEventListener("click", async () => {
    if (!w) return; // ongoing games can't be deleted (button is disabled)
    closeMenu();
    const ok = await confirmDialog({
      title: "Supprimer la partie ?",
      body: `« ${game.name} » et ses scores seront définitivement supprimés.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (ok) {
      deleteGame(game.id);
      go("home");
    }
  });

  // Group the back row and the game info/actions in a single column.
  const headerCol = el(`<div class="game-header-col"></div>`);
  headerCol.appendChild(backRow);
  headerCol.appendChild(head);
  app.appendChild(headerCol);

  // Tick the duration chip every second while the game is ongoing; it freezes
  // automatically once a winner exists (re-render swaps in the frozen value).
  if (!w && dur != null) {
    const valEl = head.querySelector("#durationChip .dur-val");
    stopDurationTimer();
    durationTimer = setInterval(() => {
      if (route.name !== "game" || route.id !== id) return stopDurationTimer();
      const g = getGame(id);
      if (!g || winner(g)) return stopDurationTimer();
      if (valEl && valEl.isConnected) valEl.textContent = fmtDuration(gameDuration(g));
    }, 1000);
  }

  const ws = winners(game);
  if (ws.length) {
    const names = winnersLabel(ws);
    // A team winner (Contrée) is plural even though there's a single team.
    const plural = ws.length > 1 || defFor(game).teams;
    const banner = game.cancelled
      ? el(
          `<div class="banner banner-cancelled"><i class="fa-regular fa-ban"></i> Partie annulée — ${plural ? "Vainqueurs" : "Vainqueur"} : <b>${names}</b> (${ws[0].total} pts)</div>`,
        )
      : el(
          `<div class="banner">${confettiMarkup()}<span class="crown"><i class="fa-regular fa-trophy"></i></span> <b>${names}</b> ${plural ? "gagnent" : "gagne"} avec ${ws[0].total} points !</div>`,
        );
    app.appendChild(wrapPanel(banner));
  }

  if (defFor(game).teams) {
    // Dealer (and the current bid, if any) sit above the scoreboard in a card.
    if (!w && game.dealer)
      app.appendChild(wrapPanel(buildBidInfo(game)));
    app.appendChild(wrapPanel(buildContreeSummary(game)));
    if (!w) app.appendChild(buildContreeBar(game));
  } else {
    app.appendChild(wrapPanel(buildSummary(game, st, w)));
    // Hide score entry once the game is won.
    if (!w) {
      if (defFor(game).turnBased) {
        app.appendChild(buildTurnBar(game));
      } else {
        const hasDraft = !!game.draftRound;
        const actions = el(`
          <div class="new-scores-bar">
            <button class="btn btn-primary btn-big" id="newScores"><i class="fa-regular fa-${hasDraft ? "pen-to-square" : "plus"}"></i> ${hasDraft ? "Reprendre la saisie" : "Nouveaux scores"}</button>
          </div>`);
        actions
          .querySelector("#newScores")
          .addEventListener("click", () => openScoresDialog(game));
        app.appendChild(actions);
      }
    }
  }

  const linksWrap = el(`<div class="rules-link-wrap game-links-row">
    <button class="link-btn" id="showDetails"${game.rounds.length ? "" : ' disabled title="Aucune manche enregistrée pour l\'instant"'}><i class="fa-regular fa-clipboard-list"></i> Détails</button>
    <button class="link-btn" id="newGameSamePlayers"><i class="fa-regular fa-arrows-rotate"></i> Rejouer</button>
  </div>`);
  linksWrap
    .querySelector("#showDetails")
    .addEventListener("click", () => go("details", { id: game.id }));
  linksWrap
    .querySelector("#newGameSamePlayers")
    .addEventListener("click", () =>
      openSetupDialog({
        prefill: game.players.map((p) => p.name),
        mode: game.mode,
      }),
    );
  app.appendChild(linksWrap);
}

// Compact scoreboard: just player + final total (ranked, winner crowned).
function buildSummary(game, st, w) {
  const hasRounds = game.rounds.length > 0;
  const winIds = new Set(winners(game).map((p) => p.id));
  const wrap = el(`<div class="table-wrap"></div>`);
  const table = el(
    `<table class="score summary-table"><thead><tr><th class="rank-col">#</th><th class="player-name">${unitLabel(game.mode)}</th><th>Total</th></tr></thead></table>`,
  );
  const tbody = el(`<tbody></tbody>`);
  const labels = rankLabels(st, (a, b) => a.total === b.total);
  // In-progress (pre-saved) entry: show each player's projected total in muted.
  const def = defFor(game);
  const draft = game.draftRound || {};
  // Turn-based games pre-save a single player's turn (the current player).
  const turnCur = def.turnBased ? currentPlayer(game) : null;
  const turnDraft =
    turnCur && turnDraftHasData(game.draftTurn) ? game.draftTurn : null;
  // The pending draft cell for a player, or null if they have nothing entered.
  const draftCellFor = (p) => {
    if (def.turnBased)
      return turnDraft && p.id === turnCur.id
        ? {
            points: turnDraft.drawn ? 0 : Number(turnDraft.points) || 0,
            drawn: !!turnDraft.drawn,
          }
        : null;
    const dc = draft[p.id];
    return dc && ((dc.points !== "" && dc.points != null) || dc.flip7 || dc.bust)
      ? dc
      : null;
  };
  const hasDraftFor = (p) => !!draftCellFor(p);
  const projected = {};
  st.forEach((p) => {
    const dc = draftCellFor(p);
    projected[p.id] = p.total + (dc ? def.cellValue(dc) : 0);
  });
  // Projected winner(s): only when the game isn't already won and a round is in
  // progress — the leader(s) under the game's rules once the target is reached
  // (highest for Flip 7, lowest for Skyjo).
  const projWinnerIds = new Set();
  if (!w && st.some(hasDraftFor)) {
    const projStandings = st
      .map((p) => ({ id: p.id, total: projected[p.id] }))
      .sort((a, b) =>
        def.scoreOrder === "asc" ? a.total - b.total : b.total - a.total,
      );
    winnersFromStandings(game, projStandings).forEach((p) =>
      projWinnerIds.add(p.id),
    );
  }
  st.forEach((p, i) => {
    const { place, label } = labels[i];
    const won = winIds.has(p.id);
    const crown = won
      ? '<span class="crown"><i class="fa-regular fa-crown"></i></span>'
      : "";
    const rankClass = `rank${place}`;
    const rankBadge = hasRounds
      ? `<span class="badge ${rankClass}">${label}</span>`
      : "";
    const previewCrown = projWinnerIds.has(p.id)
      ? ' <span class="crown"><i class="fa-regular fa-crown"></i></span>'
      : "";
    // A player marked "Éliminé" (bust) in the in-progress round: flag the row in
    // red with a tag and hide the projected total (it would just repeat p.total).
    const eliminated = !!(draft[p.id] && draft[p.id].bust);
    // A Qwirkle draw (0 points) reuses Flip 7's "éliminé" row styling.
    const drew = !!(turnDraft && turnCur && p.id === turnCur.id && turnDraft.drawn);
    let preview = "";
    if (eliminated) {
      preview = ""; // no badge for a player eliminated in the in-progress round
    } else if (drew) {
      preview = '<span class="elim-tag">Pioche</span>';
    } else if (hasDraftFor(p)) {
      preview = `<span class="score-preview"><i class="fa-regular fa-arrow-right-long"></i> ${projected[p.id]}${previewCrown}</span>`;
    }
    const tr = el(`
      <tr class="${won ? "winner-row" : ""}${eliminated || drew ? " eliminated-row" : ""}">
        <td class="rank-col">${rankBadge}</td>
        <td class="player-name">${esc(p.name)}</td>
        <td class="total-cell"><span class="score-badge ${rankClass}">${p.total}${crown}</span>${preview}</td>
      </tr>`);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/* ---------- Details (per-round breakdown) ---------- */
function renderDetails(id) {
  const game = getGame(id);
  if (!game) return go("home");
  app.innerHTML = "";

  const st = standings(game);
  const w = winner(game);
  const labels = rankLabels(st, (a, b) => a.total === b.total);
  const rankMap = {};
  st.forEach((p, i) => {
    rankMap[p.id] = { order: i, place: labels[i].place, label: labels[i].label };
  });

  const backRow = el(`
    <div class="row">
      <button class="back-btn" id="back"><i class="fa-regular fa-arrow-left"></i> Scores</button>
      <span class="badge ${modeClass(game.mode)} ml-auto">${esc(modeLabel(game.mode))}</span>
    </div>`);
  backRow
    .querySelector("#back")
    .addEventListener("click", () => go("game", { id: game.id }));
  app.appendChild(backRow);

  app.appendChild(
    wrapPanel(
      defFor(game).teams
        ? buildContreeTable(game)
        : defFor(game).entry === "yams"
          ? buildYamsTable(game)
          : defFor(game).turnBased
            ? buildTurnTable(game)
            : buildTable(game, rankMap, w),
    ),
  );
}

// Details for a turn-based game (Qwirkle): one row per turn, in chronological
// order, with the running total for the player who scored. Points stay editable
// and each turn can be removed.
function buildTurnTable(game) {
  const def = defFor(game);
  const wrap = el(`<div class="table-wrap"></div>`);
  const table = el(`<table class="score turn-table"></table>`);
  table.innerHTML = `<thead><tr><th class="rank-col">Tour</th><th class="player-name">${unitLabel(game.mode)}</th><th>Points</th><th>Total</th><th class="rank-col"></th></tr></thead>`;
  const tbody = el(`<tbody></tbody>`);
  const running = {}; // running total per player as turns accumulate

  if (!game.rounds.length) {
    tbody.appendChild(
      el(
        `<tr><td colspan="5" class="turn-empty muted">Aucun tour joué pour l'instant.</td></tr>`,
      ),
    );
  }

  game.rounds.forEach((r, i) => {
    const pid = Object.keys(r.scores)[0];
    const cell = r.scores[pid] || { points: 0 };
    const p = game.players.find((x) => x.id === pid);
    const name = p ? esc(p.name) : "—";
    const val = def.cellValue(cell);
    running[pid] = (running[pid] || 0) + val;
    // A 0 means the player drew tiles instead of scoring — flag it like Flip 7's
    // "+15" badge, but reading "Pioche".
    const drawnTag = val === 0 ? '<span class="draw-tag">Pioche</span>' : "";
    const tr = el(`
      <tr>
        <td class="rank-col"><span class="turn-num">${i + 1}</span></td>
        <td class="player-name">${name}</td>
        <td><span class="cell-box"><input type="number" class="cell-input${val === 0 ? " cell-zero" : ""}" value="${val}" />${drawnTag}</span></td>
        <td class="total-cell"><span class="score-badge">${running[pid]}</span></td>
        <td class="rank-col"><button class="btn btn-danger btn-icon" data-delturn="${i}" title="Supprimer le tour"><i class="fa-regular fa-xmark"></i></button></td>
      </tr>`);

    const input = tr.querySelector("input");
    input.addEventListener("input", () => {
      input.classList.toggle("cell-zero", (Number(input.value) || 0) === 0);
    });
    input.addEventListener("change", (e) => {
      const g = getGame(game.id);
      const c = g.rounds[i].scores[pid] || { points: 0 };
      const v = Number(e.target.value) || 0;
      c.points = v;
      if (v !== 0) delete c.drawn; // a real score overrides "a pioché"
      g.rounds[i].scores[pid] = c;
      upsertGame(g);
      renderDetails(game.id);
    });

    tr.querySelector("[data-delturn]").addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: `Supprimer le tour ${i + 1} ?`,
        body: `Le score de ${p ? p.name : "ce joueur"} pour ce tour sera supprimé.`,
        confirmLabel: "Supprimer",
        danger: true,
      });
      if (!ok) return;
      const g = getGame(game.id);
      g.rounds.splice(i, 1);
      upsertGame(g);
      renderDetails(game.id);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// Details for Yams: a proper scorecard — one row per mission, one column per
// player — with the upper subtotal, the +35 bonus row, and the grand total.
// Filled cells stay editable: upper-section cells take a die count (score =
// count × face), lower-section cells toggle between the mission value and 0.
function buildYamsTable(game) {
  const players = game.players;
  const winIds = new Set(winners(game).map((p) => p.id));
  // category key -> { [playerId]: { points, idx } }
  const byCat = {};
  game.rounds.forEach((r, idx) => {
    const pid = Object.keys(r.scores)[0];
    const cell = r.scores[pid];
    if (!cell || !cell.category) return;
    if (!byCat[cell.category]) byCat[cell.category] = {};
    byCat[cell.category][pid] = { points: Number(cell.points) || 0, idx };
  });

  const wrap = el(`<div class="table-wrap"></div>`);
  const table = el(`<table class="score yams-table"></table>`);
  let thead = `<thead><tr><th class="player-name">Mission</th>`;
  players.forEach((p) => {
    const crown = winIds.has(p.id)
      ? ' <span class="crown"><i class="fa-regular fa-crown"></i></span>'
      : "";
    thead += `<th>${esc(p.name)}${crown}</th>`;
  });
  thead += `</tr></thead>`;
  table.innerHTML = thead;
  const tbody = el(`<tbody></tbody>`);

  const cellHtml = (catKey, pid) => {
    const e = byCat[catKey] && byCat[catKey][pid];
    if (!e) return `<td class="yams-cell yams-empty">·</td>`;
    const cat = yamsCat(catKey);
    const struck = e.points === 0 ? " struck" : "";
    if (cat.section === "upper") {
      // Editable die count: at rest the input shows the computed score; focusing
      // reveals the die count; blur saves count × face.
      return `<td class="yams-cell"><input type="number" inputmode="numeric" class="cell-input yams-up-input${struck}" data-cat="${catKey}" data-pid="${pid}" data-face="${cat.face}" value="${e.points}" /></td>`;
    }
    // Lower section: an active/inactive toggle showing the mission's score;
    // active = it counts, inactive = barré (0). Clicking flips the state.
    const on = e.points !== 0;
    return `<td class="yams-cell"><button type="button" class="yams-toggle${on ? " active" : ""}" data-cat="${catKey}" data-pid="${pid}" data-fixed="${cat.fixed}">${cat.fixed}</button></td>`;
  };
  const rowFor = (cat) =>
    el(
      `<tr><td class="player-name">${esc(cat.label)}${cat.fixed != null ? ` <span class="yams-fixed-tag">${cat.fixed}</span>` : ""}</td>${players.map((p) => cellHtml(cat.key, p.id)).join("")}</tr>`,
    );

  tbody.appendChild(
    el(
      `<tr class="yams-section"><td colspan="${players.length + 1}">Section haute</td></tr>`,
    ),
  );
  YAMS_CATEGORIES.filter((c) => c.section === "upper").forEach((c) =>
    tbody.appendChild(rowFor(c)),
  );
  tbody.appendChild(
    el(
      `<tr class="yams-subtotal"><td class="player-name">Sous-total</td>${players
        .map(
          (p) =>
            `<td class="yams-cell"><span class="yams-pts">${yamsUpperSum(game, p.id)}</span></td>`,
        )
        .join("")}</tr>`,
    ),
  );
  tbody.appendChild(
    el(
      `<tr class="yams-bonus"><td class="player-name">Bonus (≥${YAMS_BONUS_MIN})<span class="yams-fixed-tag">+${YAMS_BONUS}</span></td>${players
        .map((p) => {
          const b = yamsUpperBonus(game, p.id);
          return `<td class="yams-cell"><span class="yams-pts${b ? " yams-bonus-on" : ""}">${b ? "+" + b : "—"}</span></td>`;
        })
        .join("")}</tr>`,
    ),
  );
  tbody.appendChild(
    el(
      `<tr class="yams-section"><td colspan="${players.length + 1}">Section basse</td></tr>`,
    ),
  );
  YAMS_CATEGORIES.filter((c) => c.section === "lower").forEach((c) =>
    tbody.appendChild(rowFor(c)),
  );
  tbody.appendChild(
    el(
      `<tr class="yams-total"><td class="player-name">Total</td>${players
        .map(
          (p) =>
            `<td class="yams-cell"><span class="score-badge">${playerTotal(game, p.id)}</span></td>`,
        )
        .join("")}</tr>`,
    ),
  );

  // Helper: find a player's round for a given category and rewrite its points.
  const setCellPoints = (pid, catKey, pts) => {
    const g = getGame(game.id);
    const beforeWinnerId = (winner(g) || {}).id || null;
    const i = g.rounds.findIndex((r) => {
      const c = r.scores[pid];
      return c && c.category === catKey;
    });
    if (i < 0) return;
    g.rounds[i].scores[pid].points = pts;
    upsertGame(g);
    renderDetails(game.id);
    celebrateIfNewWinner(beforeWinnerId, g);
  };

  // Upper-section cells: editable die count (score = count × face).
  tbody.querySelectorAll(".yams-up-input").forEach((input) => {
    const face = Number(input.dataset.face) || 1;
    const { cat: catKey, pid } = input.dataset;
    const points = Number(input.value) || 0; // computed score shown at rest
    input.addEventListener("focus", () => {
      input.value = String(Math.round(points / face)); // reveal the die count
      input.select();
    });
    const commit = () => {
      const count = Math.max(0, Math.min(5, Math.round(Number(input.value) || 0)));
      const pts = count * face;
      if (pts === points) {
        input.value = String(points); // unchanged: restore the at-rest display
        return;
      }
      setCellPoints(pid, catKey, pts);
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
    });
  });

  // Lower-section cells: toggle between the mission value and 0 (barré).
  tbody.querySelectorAll(".yams-toggle").forEach((btn) => {
    const { cat: catKey, pid } = btn.dataset;
    const fixed = Number(btn.dataset.fixed) || 0;
    btn.addEventListener("click", () => {
      const on = btn.classList.contains("active"); // currently counts
      setCellPoints(pid, catKey, on ? 0 : fixed);
    });
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function buildTable(game, rankMap, w) {
  const def = defFor(game);
  const isFlip7Game = def.entry === "flip7";
  const hasRounds = game.rounds.length > 0;
  const winIds = new Set(winners(game).map((p) => p.id));
  const wrap = el(`<div class="table-wrap"></div>`);
  const table = el(`<table class="score"></table>`);

  // head
  let thead = `<thead><tr><th class="rank-col">#</th><th class="player-name">${unitLabel(game.mode)}</th>`;
  game.rounds.forEach((_, i) => {
    thead += `<th>M${i + 1}</th>`;
  });
  thead += `<th>Total</th></tr></thead>`;
  table.innerHTML = thead;

  // body — rows ordered by rank (same as the other screens)
  const tbody = el(`<tbody></tbody>`);
  const orderedPlayers = [...game.players].sort(
    (a, b) => rankMap[a.id].order - rankMap[b.id].order,
  );
  orderedPlayers.forEach((p) => {
    const total = playerTotal(game, p.id);
    const { place, label } = rankMap[p.id];
    const won = winIds.has(p.id);
    const rankBadge = hasRounds
      ? `<span class="badge rank${place}">${label}</span>`
      : "";
    const tr = el(
      `<tr class="${won ? "winner-row" : ""}"><td class="rank-col">${rankBadge}</td><td class="player-name">${esc(p.name)}</td></tr>`,
    );

    game.rounds.forEach((r, ri) => {
      const cell = r.scores[p.id] || { points: 0, flip7: false, bust: false };
      const td = el(`<td></td>`);
      const pts = cell.bust ? 0 : Number(cell.points) || 0;
      if (isFlip7Game) {
        // At rest the input shows only the entered points (with a "+15" badge
        // when Flip 7); focusing reveals the "10+15" expression so the bonus can
        // be added or removed by typing — which toggles the badge live. type
        // "text" with no inputmode keeps the full keyboard (so "+" stays
        // reachable on mobile, without falling back to the "tel" keypad).
        const flip7 = !cell.bust && !!cell.flip7;
        td.innerHTML = `<span class="cell-box"><input type="text" class="cell-input${pts === 0 && !flip7 ? " cell-zero" : ""}" value="${esc(String(pts))}" />${flip7 ? '<span class="flip7-tag">+15</span>' : ""}</span>`;
        const input = td.querySelector("input");
        const box = td.querySelector(".cell-box");
        const setBadge = (on) => {
          const tag = box.querySelector(".flip7-tag");
          if (on && !tag)
            box.insertAdjacentHTML("beforeend", '<span class="flip7-tag">+15</span>');
          else if (!on && tag) tag.remove();
        };
        input.addEventListener("focus", () => {
          if (box.querySelector(".flip7-tag"))
            input.value = `${Number(input.value) || 0}+15`;
        });
        input.addEventListener("input", () => {
          const { points, flip7: f } = parseFlip7Input(input.value);
          setBadge(f);
          input.classList.toggle("cell-zero", points === 0 && !f);
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") input.blur();
        });
        const restoreDisplay = () => {
          input.value = String(pts);
          setBadge(flip7);
          input.classList.toggle("cell-zero", pts === 0 && !flip7);
        };
        input.addEventListener("blur", () => {
          const { points, flip7: f } = parseFlip7Input(input.value);
          const bustCleared = cell.bust && (points !== 0 || f);
          // Nothing actually changed: just collapse back to the at-rest display
          // (points only) without a full re-render.
          if (points === pts && f === flip7 && !bustCleared) {
            restoreDisplay();
            return;
          }
          const g = getGame(game.id);
          const beforeWinnerId = (winner(g) || {}).id || null;
          const c = g.rounds[ri].scores[p.id] || {
            points: 0,
            flip7: false,
            bust: false,
          };
          c.points = points;
          c.flip7 = f;
          if (bustCleared) c.bust = false; // a real score/bonus revives the cell
          g.rounds[ri].scores[p.id] = c;
          upsertGame(g);
          renderDetails(game.id); // reset the cell to its at-rest display
          celebrateIfNewWinner(beforeWinnerId, g);
        });
        tr.appendChild(td);
        return;
      }
      // Doubling games (Skyjo): mirror the Flip 7 cell. At rest the input shows
      // the entered points with a "Doublé" badge when doubled; focusing reveals
      // the "15x2" expression so the ×2 can be added or removed by typing.
      if (def.doubling) {
        const doubled = !cell.bust && !!cell.doubled;
        td.innerHTML = `<span class="cell-box"><input type="text" class="cell-input${pts === 0 && !doubled ? " cell-zero" : ""}" value="${esc(String(pts))}" />${doubled ? '<span class="flip7-tag dbl-tag">Doublé</span>' : ""}</span>`;
        const input = td.querySelector("input");
        const box = td.querySelector(".cell-box");
        const setBadge = (on) => {
          const tag = box.querySelector(".dbl-tag");
          if (on && !tag)
            box.insertAdjacentHTML(
              "beforeend",
              '<span class="flip7-tag dbl-tag">Doublé</span>',
            );
          else if (!on && tag) tag.remove();
        };
        input.addEventListener("focus", () => {
          if (box.querySelector(".dbl-tag"))
            input.value = `${Number(input.value) || 0}x2`;
        });
        input.addEventListener("input", () => {
          const { points, doubled: d2 } = parseSkyjoInput(input.value);
          setBadge(d2);
          input.classList.toggle("cell-zero", points === 0 && !d2);
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") input.blur();
        });
        const restoreDisplay = () => {
          input.value = String(pts);
          setBadge(doubled);
          input.classList.toggle("cell-zero", pts === 0 && !doubled);
        };
        input.addEventListener("blur", () => {
          const { points, doubled: d2 } = parseSkyjoInput(input.value);
          if (points === pts && d2 === doubled) {
            restoreDisplay(); // nothing changed: collapse to the at-rest display
            return;
          }
          const g = getGame(game.id);
          const beforeWinnerId = (winner(g) || {}).id || null;
          const c = g.rounds[ri].scores[p.id] || { points: 0 };
          c.points = points;
          if (d2) c.doubled = true;
          else delete c.doubled;
          g.rounds[ri].scores[p.id] = c;
          upsertGame(g);
          renderDetails(game.id);
          celebrateIfNewWinner(beforeWinnerId, g);
        });
        tr.appendChild(td);
        return;
      }
      // Other number games (Time's Up!): a plain editable number. No inputmode
      // so the classic number keyboard is used (keeps the "−" key reachable for
      // negatives).
      td.innerHTML = `
        <span class="cell-box"><input type="number" class="cell-input${pts === 0 ? " cell-zero" : ""}" value="${pts}" /></span>`;
      const input = td.querySelector("input");
      input.addEventListener("input", () => {
        input.classList.toggle("cell-zero", (Number(input.value) || 0) === 0);
      });
      input.addEventListener("change", (e) => {
        const g = getGame(game.id);
        const beforeWinnerId = (winner(g) || {}).id || null;
        const c = g.rounds[ri].scores[p.id] || { points: 0 };
        c.points = Number(e.target.value) || 0;
        g.rounds[ri].scores[p.id] = c;
        upsertGame(g);
        renderDetails(game.id);
        celebrateIfNewWinner(beforeWinnerId, g);
      });
      tr.appendChild(td);
    });

    const crown = won
      ? '<span class="crown"><i class="fa-regular fa-crown"></i></span>'
      : "";
    const rankClass = `rank${place}`;
    const totalTd = el(
      `<td class="total-cell"><span class="score-badge ${rankClass}">${total}${crown}</span></td>`,
    );
    tr.appendChild(totalTd);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  // footer: round delete buttons
  if (game.rounds.length) {
    let cells = `<td class="rank-col"></td><td class="player-name muted">Retirer</td>`;
    game.rounds.forEach((_, i) => {
      cells += `<td><button class="btn btn-danger btn-icon" data-delround="${i}" title="Supprimer la manche"><i class="fa-regular fa-xmark"></i></button></td>`;
    });
    cells += `<td></td>`;
    const tf = el(`<tfoot><tr>${cells}</tr></tfoot>`);
    table.appendChild(tf);
    tf.querySelectorAll("[data-delround]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ri = Number(btn.getAttribute("data-delround"));
        const ok = await confirmDialog({
          title: `Supprimer la manche ${ri + 1} ?`,
          body: "Les scores de cette manche seront supprimés pour tous les joueurs.",
          confirmLabel: "Supprimer",
          danger: true,
        });
        if (!ok) return;
        const g = getGame(game.id);
        g.rounds.splice(ri, 1);
        upsertGame(g);
        renderDetails(game.id);
      });
    });
  }

  wrap.appendChild(table);
  return wrap;
}

// Parse a Flip 7 details-cell input: a trailing "+15" marks a Flip 7 bonus, so
// "10+15" → { points: 10, flip7: true } and "10" → { points: 10, flip7: false }.
function parseFlip7Input(value) {
  const v = String(value).trim().replace(/\s+/g, "");
  const m = v.match(/^(-?\d*)\+15$/);
  if (m) return { points: Number(m[1]) || 0, flip7: true };
  return { points: Number(v) || 0, flip7: false };
}
// Parse a Skyjo cell expression: a (possibly negative) number with an optional
// "×2" suffix marking a doubled round, e.g. "15x2", "-3×2". Mirrors
// parseFlip7Input — the "x2" is the editable counterpart of Flip 7's "+15".
function parseSkyjoInput(value) {
  const v = String(value).trim().replace(/\s+/g, "");
  const m = v.match(/^(-?\d*)[x×*]2$/i);
  if (m) return { points: Number(m[1]) || 0, doubled: true };
  return { points: Number(v) || 0, doubled: false };
}
// Does a draft cell hold any entered data?
function draftHasData(d) {
  return d && ((d.points !== "" && d.points != null) || d.flip7 || d.bust);
}
// Does a turn-based draft (Qwirkle: points/drawn; Yams: a picked mission) hold
// any entered data?
function turnDraftHasData(d) {
  return !!(
    d &&
    ((d.points !== "" && d.points != null) || d.drawn || d.category)
  );
}
// Convert a draft cell to a stored round cell, per the game's entry style.
function draftToCell(def, d) {
  if (def.entry === "number") {
    const cell = { points: Number(d.points) || 0 };
    if (def.doubling && d.doubled) cell.doubled = true; // ×2 round penalty
    return cell;
  }
  return {
    points: d.bust ? 0 : Number(d.points) || 0,
    flip7: d.bust ? false : !!d.flip7,
    bust: !!d.bust,
  };
}
// Build and wire one player's score-entry row. `draft[p.id]` must be set.
// Renders the Flip 7 controls (number + bonus + Éliminé) or, for "number"
// games like Skyjo, a single number input (negatives allowed). `onChange` (if
// given) fires after every draft mutation, e.g. to pre-save the round live.
function buildEntryRow(game, draft, p, onChange) {
  const def = defFor(game);
  const d = draft[p.id];
  const notify = () => onChange && onChange();
  if (def.entry === "number") {
    const row = el(`
      <div class="entry-player${d.doubled ? " doubled" : ""}">
        <span class="pname">${esc(p.name)}</span>
        <div class="entry-controls">
          ${def.negatives ? '<button type="button" class="btn btn-ghost btn-sm sign-btn" title="Score négatif" aria-label="Inverser le signe">±</button>' : ""}
          <input type="number" inputmode="numeric" class="cell-input" placeholder="0" value="${esc(d.points)}" />
          ${def.doubling ? `<button type="button" class="btn btn-ghost btn-sm x2-btn${d.doubled ? " active" : ""}" title="Doubler le score de la manche" aria-label="Doubler le score">×2</button>` : ""}
        </div>
      </div>`);
    const input = row.querySelector("input");
    input.addEventListener("input", (e) => {
      draft[p.id].points = e.target.value;
      notify();
    });
    const signBtn = row.querySelector(".sign-btn");
    if (signBtn)
      signBtn.addEventListener("click", () => {
        const v = String(input.value).trim();
        input.value = v.startsWith("-") ? v.slice(1) : "-" + v;
        draft[p.id].points = input.value;
        input.focus();
        notify();
      });
    const x2Btn = row.querySelector(".x2-btn");
    if (x2Btn)
      x2Btn.addEventListener("click", () => {
        draft[p.id].doubled = !draft[p.id].doubled;
        x2Btn.classList.toggle("active", draft[p.id].doubled);
        row.classList.toggle("doubled", draft[p.id].doubled);
        notify();
      });
    return row;
  }
  const row = el(`
    <div class="entry-player ${d.bust ? "busted" : d.flip7 ? "flipped" : ""}">
      <span class="pname">${esc(p.name)}</span>
      <div class="entry-controls">
        <input type="number" inputmode="numeric" class="cell-input" placeholder="0" min="0" value="${d.bust ? "" : esc(d.points)}" ${d.bust ? "disabled" : ""} />
        <button type="button" class="btn btn-ghost btn-sm flip7-btn ${d.flip7 ? "active" : ""}" ${d.bust ? "disabled" : ""}>Flip 7</button>
        <button type="button" class="btn btn-ghost btn-sm bust-btn ${d.bust ? "active" : ""}">Éliminé</button>
      </div>
    </div>`);
  const numInput = row.querySelector('input[type="number"]');
  const flipBtn = row.querySelector(".flip7-btn");
  const bustBtn = row.querySelector(".bust-btn");
  numInput.addEventListener("input", (e) => {
    draft[p.id].points = e.target.value;
    notify();
  });
  flipBtn.addEventListener("click", () => {
    if (draft[p.id].bust) return;
    draft[p.id].flip7 = !draft[p.id].flip7;
    flipBtn.classList.toggle("active", draft[p.id].flip7);
    row.classList.toggle("flipped", draft[p.id].flip7);
    notify();
  });
  bustBtn.addEventListener("click", () => {
    draft[p.id].bust = !draft[p.id].bust;
    bustBtn.classList.toggle("active", draft[p.id].bust);
    row.classList.toggle("busted", draft[p.id].bust);
    numInput.disabled = draft[p.id].bust;
    flipBtn.disabled = draft[p.id].bust;
    if (draft[p.id].bust) {
      numInput.value = "";
      draft[p.id].flip7 = false;
      flipBtn.classList.remove("active");
      row.classList.remove("flipped");
    }
    notify();
  });
  return row;
}

function buildRoundEntry(game) {
  const section = el(`
    <div class="panel round-entry">
      <h3>Manche ${game.rounds.length + 1}</h3>
      <div class="entry-grid" id="entryGrid"></div>
      <div class="row">
        <button class="btn btn-ghost" id="cancelRound">Annuler</button>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="saveRound">Enregistrer la manche</button>
      </div>
    </div>`);
  section
    .querySelector("#cancelRound")
    .addEventListener("click", () => go("game", { id: game.id }));

  const grid = section.querySelector("#entryGrid");
  // draft holds entry state per player
  const draft = {};
  game.players.forEach((p) => {
    draft[p.id] = { points: "", flip7: false, bust: false };
    grid.appendChild(buildEntryRow(game, draft, p));
  });

  section.querySelector("#saveRound").addEventListener("click", () => {
    const def = defFor(game);
    const scores = {};
    game.players.forEach((p) => {
      scores[p.id] = draftToCell(def, draft[p.id]);
    });
    const g = getGame(game.id);
    const beforeWinnerId = (winner(g) || {}).id || null;
    g.rounds.push({ scores, at: Date.now() });
    upsertGame(g);
    toast(`Manche ${g.rounds.length} enregistrée`);
    go("game", { id: game.id });
    celebrateIfNewWinner(beforeWinnerId, g);
  });

  return section;
}

// Score entry in a dialog. The in-progress round can be "pre-saved" to
// game.draftRound so closing/reopening keeps the state untouched.
function openScoresDialog(game) {
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);

  const saved = game.draftRound || {};
  const draft = {};

  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Manche ${game.rounds.length + 1}</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body"><div class="entry-grid" id="entryGrid"></div></div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" id="cancelRound">Annuler</button>
      <button class="btn btn-primary" id="saveRound">Enregistrer la manche</button>
    </div>`;

  // Pre-save the draft live as scores are entered (debounced to avoid writing
  // on every keystroke). Empty drafts clear any saved one.
  const hasData = () => Object.values(draft).some(draftHasData);
  const writeDraft = () => {
    const g = getGame(game.id);
    g.draftRound = hasData() ? JSON.parse(JSON.stringify(draft)) : null;
    upsertGame(g);
  };
  let saveTimer = null;
  const saveDraftSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeDraft, 400);
  };

  const grid = modal.querySelector("#entryGrid");
  game.players.forEach((p) => {
    const s = saved[p.id] || {};
    draft[p.id] = {
      points: s.points != null && s.points !== "" ? String(s.points) : "",
      flip7: !!s.flip7,
      bust: !!s.bust,
    };
    grid.appendChild(buildEntryRow(game, draft, p, saveDraftSoon));
  });

  // Leaving the dialog (×, Annuler, click outside) flushes the pending pre-save
  // so the in-progress round can be resumed later.
  const closeKeepingDraft = () => {
    clearTimeout(saveTimer);
    writeDraft();
    overlay.remove();
    if (route.name === "game" && route.id === game.id) go("game", { id: game.id });
  };
  modal
    .querySelector("[data-act=close]")
    .addEventListener("click", closeKeepingDraft);
  modal.querySelector("#cancelRound").addEventListener("click", closeKeepingDraft);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeKeepingDraft();
  });

  modal.querySelector("#saveRound").addEventListener("click", () => {
    clearTimeout(saveTimer); // cancel any pending draft write
    const def = defFor(game);
    const scores = {};
    game.players.forEach((p) => {
      scores[p.id] = draftToCell(def, draft[p.id]);
    });
    const g = getGame(game.id);
    const beforeWinnerId = (winner(g) || {}).id || null;
    g.rounds.push({ scores, at: Date.now() });
    g.draftRound = null; // round committed — clear the draft
    upsertGame(g);
    overlay.remove();
    toast(`Manche ${g.rounds.length} enregistrée`);
    go("game", { id: game.id });
    celebrateIfNewWinner(beforeWinnerId, g);
  });

  root.appendChild(overlay);
}

/* ---------- Turn-based entry (Qwirkle) ---------- */
// Action bar for a turn-based game: "Qui commence ?" until a starter is set,
// then "Score de <current player>", plus a "Terminer" button once scoring has
// begun.
function buildTurnBar(game) {
  const started = !!game.starter;
  const cur = currentPlayer(game);
  const canEnd = game.rounds.length > 0;
  const hasDraft = turnDraftHasData(game.draftTurn);
  const scoreBtnHtml =
    started && cur
      ? `<button class="btn btn-primary btn-big" id="turnScore"><i class="fa-regular fa-${hasDraft ? "pen-to-square" : "plus"}"></i> ${hasDraft ? `Reprendre — ${esc(cur.name)}` : `Score de ${esc(cur.name)}`}</button>`
      : `<button class="btn btn-primary btn-big" id="startGame"><i class="fa-regular fa-flag"></i> Qui commence ?</button>`;
  const bar = el(`
    <div class="new-scores-bar turn-bar">
      ${scoreBtnHtml}
      ${canEnd ? `<button class="btn btn-ghost btn-big btn-end" id="endGameBar"><i class="fa-regular fa-flag-checkered"></i> Terminer</button>` : ""}
    </div>`);
  const startBtn = bar.querySelector("#startGame");
  if (startBtn)
    startBtn.addEventListener("click", () => openStarterDialog(game));
  const scoreBtn = bar.querySelector("#turnScore");
  if (scoreBtn)
    scoreBtn.addEventListener("click", () =>
      defFor(game).entry === "yams"
        ? openYamsDialog(game)
        : openTurnDialog(game),
    );
  const endBtn = bar.querySelector("#endGameBar");
  if (endBtn) endBtn.addEventListener("click", () => endGamePrompt(game));
  return bar;
}

// Pick which player starts; the turn order then follows the roster from there.
function openStarterDialog(game) {
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);
  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Qui commence ?</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <p class="rules-intro">Choisissez le joueur qui débute. Les tours s'enchaîneront ensuite dans l'ordre des joueurs.</p>
      <div class="starter-list" id="starterList"></div>
    </div>`;
  const list = modal.querySelector("#starterList");
  game.players.forEach((p) => {
    const btn = el(
      `<button class="btn btn-ghost starter-item">${esc(p.name)}</button>`,
    );
    btn.addEventListener("click", () => {
      const g = getGame(game.id);
      g.starter = p.id;
      upsertGame(g);
      overlay.remove();
      go("game", { id: game.id });
    });
    list.appendChild(btn);
  });
  modal
    .querySelector("[data-act=close]")
    .addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  root.appendChild(overlay);
}

// Enter the current player's score for this turn. "A pioché" records 0 points
// (the player drew/exchanged tiles instead of scoring) — same idea as Flip 7's
// "Éliminé" toggle. Saving commits a one-player round and advances the turn.
function openTurnDialog(game) {
  const cur = currentPlayer(game);
  if (!cur) return;
  const turnNo = game.rounds.length + 1;
  const saved = game.draftTurn || {};
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);
  let drawn = !!saved.drawn;
  const savedPoints = drawn || saved.points == null ? "" : String(saved.points);
  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Score de ${esc(cur.name)}</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <div class="turn-meta">Tour ${turnNo}</div>
      <div class="entry-player turn-entry${drawn ? " busted" : ""}" id="turnEntry">
        <div class="entry-controls">
          <input type="number" class="cell-input" id="turnPoints" placeholder="0" inputmode="numeric" value="${esc(savedPoints)}" ${drawn ? "disabled" : ""} />
          <button type="button" class="btn btn-ghost btn-sm bust-btn${drawn ? " active" : ""}" id="drawnBtn">A pioché (0)</button>
        </div>
      </div>
    </div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
      <button class="btn btn-primary" id="saveTurn">Enregistrer</button>
    </div>`;
  const input = modal.querySelector("#turnPoints");
  const drawnBtn = modal.querySelector("#drawnBtn");
  const entry = modal.querySelector("#turnEntry");

  // Pre-save the in-progress turn to game.draftTurn (debounced), so closing and
  // reopening keeps the entry — mirrors the multi-player scores dialog.
  const hasData = () => drawn || (input.value !== "" && input.value != null);
  const writeDraft = () => {
    const g = getGame(game.id);
    g.draftTurn = hasData() ? { points: drawn ? "" : input.value, drawn } : null;
    upsertGame(g);
  };
  let saveTimer = null;
  const saveDraftSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeDraft, 400);
  };

  drawnBtn.addEventListener("click", () => {
    drawn = !drawn;
    drawnBtn.classList.toggle("active", drawn);
    entry.classList.toggle("busted", drawn);
    input.disabled = drawn;
    if (drawn) input.value = "";
    else input.focus();
    saveDraftSoon();
  });
  input.addEventListener("input", saveDraftSoon);

  // Leaving the dialog flushes the pending pre-save so the turn can be resumed.
  const closeKeepingDraft = () => {
    clearTimeout(saveTimer);
    writeDraft();
    overlay.remove();
    if (route.name === "game" && route.id === game.id)
      go("game", { id: game.id });
  };
  modal
    .querySelectorAll("[data-act=close]")
    .forEach((b) => b.addEventListener("click", closeKeepingDraft));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeKeepingDraft();
  });

  const save = () => {
    clearTimeout(saveTimer); // cancel any pending draft write
    const points = drawn ? 0 : Number(input.value) || 0;
    const cell = drawn ? { points: 0, drawn: true } : { points };
    const g = getGame(game.id);
    g.rounds.push({ scores: { [cur.id]: cell }, at: Date.now() });
    g.draftTurn = null; // turn committed — clear the draft
    upsertGame(g);
    overlay.remove();
    toast(`${cur.name} : ${drawn ? "a pioché (0)" : points + " pts"}`);
    go("game", { id: game.id });
  };
  modal.querySelector("#saveTurn").addEventListener("click", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") save();
  });
  root.appendChild(overlay);
  if (!drawn) input.focus();
}

/* ---------- Yams (dice scorecard) ---------- */
// Enter the current player's turn: pick a mission among those left on their
// card, set its value (auto for fixed combos like Full/suites/Yams, typed for
// the rest) or scratch it (0 pts). Saving commits a one-player round and
// advances the turn. The in-progress pick is pre-saved to game.draftTurn so the
// dialog can be closed and resumed.
function openYamsDialog(game) {
  const cur = currentPlayer(game);
  if (!cur) return;
  const turnNo = game.rounds.length + 1;
  const filled = yamsFilled(game, cur.id);
  // Points already marked by this player per mission (to show on filled cases).
  const marked = {};
  game.rounds.forEach((r) => {
    const c = r.scores[cur.id];
    if (c && c.category) marked[c.category] = Number(c.points) || 0;
  });
  const upperSum = yamsUpperSum(game, cur.id);
  const saved =
    game.draftTurn && game.draftTurn.category ? game.draftTurn : null;
  let selKey =
    saved && !filled.has(saved.category) ? saved.category : null;
  let scratched = saved ? !!saved.scratched : false;
  let rawValue = saved && saved.value != null ? String(saved.value) : "";

  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);

  const bonusNote =
    upperSum >= YAMS_BONUS_MIN
      ? ` ✓ +${YAMS_BONUS}`
      : ` (encore ${YAMS_BONUS_MIN - upperSum})`;
  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Score de ${esc(cur.name)}</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <div class="turn-meta">Tour ${turnNo} · Section haute ${upperSum} / ${YAMS_BONUS_MIN}${bonusNote}</div>
      <div class="yams-missions" id="yamsMissions"></div>
      <div class="yams-value" id="yamsValue" hidden></div>
    </div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
      <button class="btn btn-primary" id="saveYams">Enregistrer</button>
    </div>`;

  const missionsEl = modal.querySelector("#yamsMissions");
  const valueEl = modal.querySelector("#yamsValue");

  // All missions stay visible; already-played ones are disabled and show the
  // score that was marked (fixed value, computed upper score, or 0 if scratched).
  YAMS_CATEGORIES.forEach((c) => {
    const done = filled.has(c.key);
    const tag = done
      ? `<span class="yams-fixed">${marked[c.key]}</span>`
      : c.fixed != null
        ? `<span class="yams-fixed">${c.fixed}</span>`
        : "";
    const btn = el(
      `<button type="button" class="yams-mission yams-${c.section}${done ? " filled" : ""}" data-key="${c.key}"${done ? " disabled" : ""}><span class="yams-mission-name">${esc(c.label)}</span>${tag}</button>`,
    );
    if (!done)
      btn.addEventListener("click", () => {
        selKey = c.key;
        scratched = false;
        rawValue = "";
        syncSel();
        drawValue();
        writeDraft();
      });
    missionsEl.appendChild(btn);
  });

  const syncSel = () =>
    missionsEl
      .querySelectorAll(".yams-mission")
      .forEach((b) => b.classList.toggle("active", b.dataset.key === selKey));

  function drawValue() {
    if (!selKey) {
      valueEl.hidden = true;
      valueEl.innerHTML = "";
      return;
    }
    const c = yamsCat(selKey);
    valueEl.hidden = false;
    const scratchBtnHtml = `<button type="button" class="btn btn-ghost btn-sm yams-scratch${scratched ? " active" : ""}" id="scratchBtn"><i class="fa-regular fa-ban"></i> Barrer (0)</button>`;
    if (c.fixed != null) {
      valueEl.innerHTML = `
        <div class="yams-value-row">
          <span class="yams-value-label">${esc(c.label)}</span>
          <span class="yams-value-fixed${scratched ? " struck" : ""}">${scratched ? "0" : c.fixed} pts</span>
          ${scratchBtnHtml}
        </div>`;
    } else {
      const face = c.face || 1;
      const computed = (Number(rawValue) || 0) * face;
      const hint = `Nombre de ${esc(c.label.toLowerCase())} (× ${face})`;
      valueEl.innerHTML = `
        <div class="yams-value-row">
          <span class="yams-value-label">${esc(c.label)}</span>
          <input type="number" class="cell-input" id="yamsInput" placeholder="0" inputmode="numeric" min="0" max="5" aria-label="${hint}" value="${esc(scratched ? "" : rawValue)}" ${scratched ? "disabled" : ""} />
          <span class="yams-value-fixed" id="yamsComputed">= ${computed} pts</span>
          ${scratchBtnHtml}
        </div>
        <div class="yams-hint muted">${hint}</div>`;
    }
    valueEl.querySelector("#scratchBtn").addEventListener("click", () => {
      scratched = !scratched;
      drawValue();
      writeDraft();
    });
    const input = valueEl.querySelector("#yamsInput");
    if (input) {
      input.addEventListener("input", () => {
        rawValue = input.value;
        const comp = valueEl.querySelector("#yamsComputed");
        if (comp) {
          const cc = yamsCat(selKey);
          comp.textContent = `= ${(Number(rawValue) || 0) * (cc.face || 1)} pts`;
        }
        writeDraft();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") save();
      });
      if (!scratched) input.focus();
    }
  }

  // Effective numeric points for the current selection. Upper-section missions
  // take a die count and score count × face; lower missions are fixed values.
  const effPoints = () => {
    if (!selKey || scratched) return 0;
    const c = yamsCat(selKey);
    if (c.fixed != null) return c.fixed;
    return (Number(rawValue) || 0) * (c.face || 1);
  };

  const writeDraft = () => {
    const g = getGame(game.id);
    g.draftTurn = selKey
      ? { category: selKey, scratched, value: rawValue, points: effPoints() }
      : null;
    upsertGame(g);
  };

  const closeKeepingDraft = () => {
    writeDraft();
    overlay.remove();
    if (route.name === "game" && route.id === game.id)
      go("game", { id: game.id });
  };
  modal
    .querySelectorAll("[data-act=close]")
    .forEach((b) => b.addEventListener("click", closeKeepingDraft));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeKeepingDraft();
  });

  const save = () => {
    if (!selKey) return toast("Choisissez une mission");
    const points = effPoints();
    const g = getGame(game.id);
    g.rounds.push({
      scores: { [cur.id]: { category: selKey, points } },
      at: Date.now(),
    });
    g.draftTurn = null; // turn committed — clear the draft
    upsertGame(g);
    overlay.remove();
    const cat = yamsCat(selKey);
    toast(`${cur.name} — ${cat.label} : ${points} pts`);
    go("game", { id: game.id });
  };
  modal.querySelector("#saveYams").addEventListener("click", save);

  syncSel();
  drawValue();
  root.appendChild(overlay);
}

/* ---------- Contrée (teams + bids) ---------- */
// Compact team scoreboard: the two teams ranked by total, leader crowned.
function buildContreeSummary(game) {
  const st = standings(game); // the two teams, sorted by total (desc)
  const winIds = new Set(winners(game).map((t) => t.id));
  const hasRounds = game.rounds.length > 0;
  const labels = rankLabels(st, (a, b) => a.total === b.total);
  const wrap = el(`<div class="table-wrap"></div>`);
  const table = el(
    `<table class="score summary-table"><thead><tr><th class="rank-col">#</th><th class="player-name">Équipe</th><th>Total</th></tr></thead></table>`,
  );
  const tbody = el(`<tbody></tbody>`);
  st.forEach((t, i) => {
    const { place, label } = labels[i];
    const won = winIds.has(t.id);
    const crown = won
      ? '<span class="crown"><i class="fa-regular fa-crown"></i></span>'
      : "";
    const rankBadge = hasRounds ? `<span class="badge rank${place}">${label}</span>` : "";
    tbody.appendChild(
      el(`
      <tr class="${won ? "winner-row" : ""}">
        <td class="rank-col">${rankBadge}</td>
        <td class="player-name">${esc(t.name)}</td>
        <td class="total-cell"><span class="score-badge rank${place}">${t.total}${crown}</span></td>
      </tr>`),
    );
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// Inline HTML describing a bid: contract value, trump suit icon, taking team,
// and a Contré/Surcontré tag when applicable.
function contreeBidHTML(bid, game) {
  const suit = contreeSuit(bid.suit);
  const team = teamsOf(game).find((t) => t.id === bid.team);
  const suitHTML = suit
    ? `<span class="suit${suit.red ? " red" : ""}">${suit.sym}</span>`
    : "";
  const coinche =
    bid.coinche === "surcoinche"
      ? '<span class="bid-coinche">Surcontré</span>'
      : bid.coinche === "coinche"
        ? '<span class="bid-coinche">Contré</span>'
        : "";
  const contractTxt = bid.contract === "capot" ? "Capot" : esc(String(bid.contract));
  return `<span class="bid-contract">${contractTxt}</span> ${suitHTML} · <b>${esc(team ? team.name : "")}</b> ${coinche}`;
}

// White card above the scoreboard: the dealer on the left and, once a bid has
// been entered, the bid info opposed on the right.
function buildBidInfo(game) {
  const dealer = currentDealer(game);
  const bid = game.pendingBid
    ? `<span class="bid-current">${contreeBidHTML(game.pendingBid, game)}</span>`
    : "";
  return el(`
    <div class="bid-info">
      <span class="bid-dealer"><i class="fa-regular fa-share-from-square"></i> Distribue : <b>${esc(dealer ? dealer.name : "")}</b></span>
      ${bid}
    </div>`);
}

// Action area for a Contrée game: pick the first dealer, then the
// dealer→bid→scores cycle. Shows the current deal's dealer.
function buildContreeBar(game) {
  const wrap = el(`<div class="contree-actions"></div>`);
  if (!game.dealer) {
    const bar = el(
      `<div class="new-scores-bar turn-bar"><button class="btn btn-primary btn-big" id="setDealer"><i class="fa-regular fa-flag"></i> Qui distribue ?</button></div>`,
    );
    bar.querySelector("#setDealer").addEventListener("click", () => openDealerDialog(game));
    wrap.appendChild(bar);
    return wrap;
  }
  if (game.pendingBid) {
    // dealer is shown in the bid card above — just the action buttons here
    const bar = el(`
      <div class="new-scores-bar turn-bar">
        <button class="btn btn-primary btn-big" id="enterScores"><i class="fa-regular fa-plus"></i> Saisir les scores</button>
        <button class="btn btn-ghost btn-big btn-end" id="editBid"><i class="fa-regular fa-pen"></i> Mise</button>
      </div>`);
    bar.querySelector("#enterScores").addEventListener("click", () => openContreeScoreDialog(game));
    bar.querySelector("#editBid").addEventListener("click", () => openBidDialog(game));
    wrap.appendChild(bar);
  } else {
    // dealer is shown in the card above — just the "saisir la mise" button here
    const bar = el(
      `<div class="new-scores-bar turn-bar"><button class="btn btn-primary btn-big" id="setBid"><i class="fa-regular fa-gavel"></i> Saisir la mise</button></div>`,
    );
    bar.querySelector("#setBid").addEventListener("click", () => openBidDialog(game));
    wrap.appendChild(bar);
  }
  return wrap;
}

// Pick who deals first; the deal then rotates in roster order.
function openDealerDialog(game) {
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);
  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Qui distribue ?</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <p class="rules-intro">Choisissez le premier distributeur. La distribution tournera ensuite dans l'ordre des joueurs.</p>
      <div class="starter-list" id="dealerList"></div>
    </div>`;
  const list = modal.querySelector("#dealerList");
  game.players.forEach((p) => {
    const btn = el(`<button class="btn btn-ghost starter-item">${esc(p.name)}</button>`);
    btn.addEventListener("click", () => {
      const g = getGame(game.id);
      g.dealer = p.id;
      upsertGame(g);
      overlay.remove();
      go("game", { id: game.id });
    });
    list.appendChild(btn);
  });
  modal.querySelector("[data-act=close]").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  root.appendChild(overlay);
}

// Enter (or edit) the current deal's bid: contract value, trump suit, taking
// team, and Contré/Surcontré. Stored on game.pendingBid until scores are saved.
function openBidDialog(game) {
  const saved = game.pendingBid || {};
  let contract = saved.contract || null;
  let suit = saved.suit || null;
  let team = saved.team || null;
  let coinche = saved.coinche || "none";
  const CONTRACTS = [80, 90, 100, 110, 120, 130, 140, 150, 160, "capot"];
  const contractLabel = (v) => (v === "capot" ? "Capot" : v);
  const teams = teamsOf(game);
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);
  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>${saved.contract ? "Modifier la mise" : "Saisir la mise"}</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <div class="field">
        <label>Contrat</label>
        <div class="pick-row contract-picker" id="contractPicker">
          ${CONTRACTS.map((v) => `<button type="button" class="pick-btn${contract === v ? " active" : ""}${v === "capot" ? " capot" : ""}" data-contract="${v}">${contractLabel(v)}</button>`).join("")}
        </div>
      </div>
      <div class="field">
        <label>Atout</label>
        <div class="suit-picker" id="suitPicker">
          ${CONTREE_SUITS.map(
            (s) =>
              `<button type="button" class="suit-btn${s.red ? " red" : ""}${suit === s.key ? " active" : ""}" data-suit="${s.key}"><span class="suit-sym">${s.sym}</span> ${s.label}</button>`,
          ).join("")}
        </div>
      </div>
      <div class="field">
        <label>Équipe qui prend</label>
        <div class="pick-row" id="teamPicker">
          ${teams.map((t) => `<button type="button" class="pick-btn${team === t.id ? " active" : ""}" data-team="${t.id}">${esc(t.name)}</button>`).join("")}
        </div>
      </div>
      <div class="field">
        <label>Contre</label>
        <div class="pick-row" id="coinchePicker">
          <button type="button" class="pick-btn${coinche === "none" ? " active" : ""}" data-coinche="none">Aucune</button>
          <button type="button" class="pick-btn${coinche === "coinche" ? " active" : ""}" data-coinche="coinche">Contré</button>
          <button type="button" class="pick-btn${coinche === "surcoinche" ? " active" : ""}" data-coinche="surcoinche">Surcontré</button>
        </div>
      </div>
    </div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
      <button class="btn btn-primary" id="saveBid">Valider la mise</button>
    </div>`;
  const sync = (sel, attr, val) =>
    modal
      .querySelectorAll(sel + " button")
      .forEach((b) => b.classList.toggle("active", b.dataset[attr] === val));
  modal.querySelectorAll("#contractPicker button").forEach((b) =>
    b.addEventListener("click", () => {
      const v = b.dataset.contract;
      contract = v === "capot" ? "capot" : Number(v);
      sync("#contractPicker", "contract", String(contract));
    }),
  );
  modal.querySelectorAll("#suitPicker button").forEach((b) =>
    b.addEventListener("click", () => {
      suit = b.dataset.suit;
      sync("#suitPicker", "suit", suit);
    }),
  );
  modal.querySelectorAll("#teamPicker button").forEach((b) =>
    b.addEventListener("click", () => {
      team = b.dataset.team;
      sync("#teamPicker", "team", team);
    }),
  );
  modal.querySelectorAll("#coinchePicker button").forEach((b) =>
    b.addEventListener("click", () => {
      coinche = b.dataset.coinche;
      sync("#coinchePicker", "coinche", coinche);
    }),
  );
  const close = () => overlay.remove();
  modal.querySelectorAll("[data-act=close]").forEach((b) => b.addEventListener("click", close));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  modal.querySelector("#saveBid").addEventListener("click", () => {
    if (!contract) return toast("Choisissez la valeur du contrat");
    if (!suit) return toast("Choisissez l'atout");
    if (!team) return toast("Choisissez l'équipe qui prend");
    const g = getGame(game.id);
    g.pendingBid = { contract, suit, team, coinche };
    upsertGame(g);
    close();
    go("game", { id: game.id });
  });
  root.appendChild(overlay);
}

// Enter the two teams' scores for the current deal. The two trick scores are
// linked (they sum to 162); each team has a "Belote (+20)" toggle, and a live
// message flags whether the taking team made its contract. Commits a deal (bid
// + final scores), clears the pending bid, and advances the dealer.
function openContreeScoreDialog(game) {
  const teams = teamsOf(game);
  const bid = game.pendingBid;
  const TOTAL = 160; // trick points shared per deal (rounded base)
  const state = {};
  teams.forEach((t) => (state[t.id] = { belote: false }));
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);
  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Score de la donne</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      ${bid ? `<div class="deal-bid">${contreeBidHTML(bid, game)}</div>` : ""}
      <div class="entry-grid">
        ${teams
          .map(
            (t) => `
          <div class="entry-player">
            <span class="pname">${esc(t.name)}</span>
            <div class="entry-controls">
              <input type="number" inputmode="numeric" class="cell-input" data-score="${t.id}" placeholder="0" />
              <button type="button" class="btn btn-ghost btn-sm belote-btn" data-belote="${t.id}">Belote (+20)</button>
            </div>
          </div>`,
          )
          .join("")}
      </div>
      <div class="contract-msg" id="contractMsg" hidden></div>
    </div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
      <button class="btn btn-primary" id="saveDeal">Enregistrer la donne</button>
    </div>`;
  const inputs = {};
  teams.forEach((t) => (inputs[t.id] = modal.querySelector(`[data-score="${t.id}"]`)));
  const otherId = (id) => teams.find((t) => t.id !== id).id;
  const round10 = (n) =>
    Math.min(TOTAL, Math.max(0, Math.round((Number(n) || 0) / 10) * 10));
  const beloteOf = (id) => (state[id].belote ? 20 : 0);
  // Compute each team's deal score from the bid, the taker's (rounded) trick
  // points, the coinche and each team's belote.
  const compute = () => {
    if (!bid) return null;
    const takerId = bid.team;
    const defId = otherId(takerId);
    const tricks = round10(inputs[takerId].value); // taker's trick points
    const m =
      bid.coinche === "surcoinche" ? 4 : bid.coinche === "coinche" ? 2 : 1;
    let baseTaker = 0;
    let baseDef = 0;
    let success;
    if (bid.contract === "capot") {
      success = tricks >= TOTAL; // all tricks taken
      baseTaker = success ? 500 : 0;
      baseDef = success ? 0 : 500;
    } else {
      const c = Number(bid.contract) || 0;
      success = tricks + beloteOf(takerId) >= c; // belote counts toward contract
      if (bid.coinche !== "none") {
        const pot = (TOTAL + c) * m;
        baseTaker = success ? pot : 0;
        baseDef = success ? 0 : pot;
      } else if (tricks >= TOTAL) {
        baseTaker = 250 + c; // capot non annoncé
        success = true;
      } else if (success) {
        baseTaker = tricks + c;
        baseDef = TOTAL - tricks;
      } else {
        baseDef = TOTAL + c;
      }
    }
    // Belote always adds 20 to its team (kept even on a chute).
    return {
      success,
      scores: {
        [takerId]: baseTaker + beloteOf(takerId),
        [defId]: baseDef + beloteOf(defId),
      },
    };
  };
  const msg = modal.querySelector("#contractMsg");
  const refreshMsg = () => {
    const anyFilled = teams.some((t) => inputs[t.id].value !== "");
    const res = compute();
    if (!res || !anyFilled) return (msg.hidden = true);
    const taker = teams.find((t) => t.id === bid.team);
    const detail = teams
      .map((t) => `${esc(t.name)} <b>${res.scores[t.id]}</b>`)
      .join(" · ");
    msg.hidden = false;
    msg.classList.toggle("fail", !res.success);
    msg.innerHTML = `${esc(taker.name)} ${res.success ? "réalise son contrat" : "chute"} — ${detail}`;
  };
  // The two trick scores are complementary (sum to 160).
  teams.forEach((t) => {
    inputs[t.id].addEventListener("input", () => {
      const raw = inputs[t.id].value;
      inputs[otherId(t.id)].value = raw === "" ? "" : TOTAL - (Number(raw) || 0);
      refreshMsg();
    });
    // Snap to a multiple of 10 on blur.
    inputs[t.id].addEventListener("blur", () => {
      if (inputs[t.id].value === "") return;
      const r = round10(inputs[t.id].value);
      inputs[t.id].value = r;
      inputs[otherId(t.id)].value = TOTAL - r;
      refreshMsg();
    });
  });
  modal.querySelectorAll("[data-belote]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.belote;
      state[id].belote = !state[id].belote;
      b.classList.toggle("active", state[id].belote);
      refreshMsg();
    }),
  );
  const close = () => overlay.remove();
  modal.querySelectorAll("[data-act=close]").forEach((b) => b.addEventListener("click", close));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  modal.querySelector("#saveDeal").addEventListener("click", () => {
    const res = compute();
    const scores = res ? res.scores : {};
    teams.forEach((t) => {
      if (scores[t.id] == null) scores[t.id] = round10(inputs[t.id].value);
    });
    const g = getGame(game.id);
    const beforeWinnerId = (winner(g) || {}).id || null;
    g.rounds.push({ bid: g.pendingBid || null, scores, at: Date.now() });
    g.pendingBid = null; // deal committed — dealer advances automatically
    upsertGame(g);
    close();
    toast(`Donne ${g.rounds.length} enregistrée`);
    go("game", { id: game.id });
    celebrateIfNewWinner(beforeWinnerId, g);
  });
  root.appendChild(overlay);
  inputs[bid ? bid.team : teams[0].id].focus();
}

// Details for a Contrée game: one row per deal (bid + each team's points).
function buildContreeTable(game) {
  const teams = teamsOf(game);
  const running = { A: 0, B: 0 };
  const wrap = el(`<div class="table-wrap"></div>`);
  const table = el(`<table class="score turn-table"></table>`);
  table.innerHTML = `<thead><tr><th class="rank-col">Donne</th><th class="player-name">Mise</th><th>${esc(teams[0].name)}</th><th>${esc(teams[1].name)}</th><th class="rank-col"></th></tr></thead>`;
  const tbody = el(`<tbody></tbody>`);
  if (!game.rounds.length) {
    tbody.appendChild(
      el(`<tr><td colspan="5" class="turn-empty muted">Aucune donne jouée pour l'instant.</td></tr>`),
    );
  }
  game.rounds.forEach((r, i) => {
    running.A += Number(r.scores && r.scores.A) || 0;
    running.B += Number(r.scores && r.scores.B) || 0;
    const bidCell = r.bid ? contreeBidHTML(r.bid, game) : '<span class="muted">—</span>';
    const tr = el(`
      <tr>
        <td class="rank-col"><span class="turn-num">${i + 1}</span></td>
        <td class="player-name">${bidCell}</td>
        <td class="total-cell">${Number(r.scores && r.scores.A) || 0}<span class="run-total">${running.A}</span></td>
        <td class="total-cell">${Number(r.scores && r.scores.B) || 0}<span class="run-total">${running.B}</span></td>
        <td class="rank-col"><button class="btn btn-danger btn-icon" data-deldeal="${i}" title="Supprimer la donne"><i class="fa-regular fa-xmark"></i></button></td>
      </tr>`);
    tr.querySelector("[data-deldeal]").addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: `Supprimer la donne ${i + 1} ?`,
        body: "Les scores de cette donne seront supprimés.",
        confirmLabel: "Supprimer",
        danger: true,
      });
      if (!ok) return;
      const g = getGame(game.id);
      g.rounds.splice(i, 1);
      upsertGame(g);
      renderDetails(game.id);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/* ---------- Edit Players ---------- */
// Edit a game's roster and type in a dialog.
function openEditPlayersDialog(game) {
  const id = game.id;
  const root = document.getElementById("modal-root");
  const overlay = el(`<div class="overlay"></div>`);
  const modal = el(`<div class="modal modal-scores"></div>`);
  overlay.appendChild(modal);

  let players = game.players.map((p) => ({ ...p }));
  // A finished or cancelled game keeps its roster fixed — no add/remove.
  const locked = !!winner(game);
  let mode = MODES[game.mode] ? game.mode : DEFAULT_MODE;

  modal.innerHTML = `
    <div class="rules-dialog-head">
      <h3>Modifier la partie</h3>
      <button class="modal-close" data-act="close" aria-label="Fermer"><i class="fa-regular fa-xmark"></i></button>
    </div>
    <div class="scores-dialog-body">
      <div class="field">
        <label>Type de partie</label>
        <div class="mode-tabs" id="modeTabs">${modeTabsHTML()}</div>
      </div>
      <div class="field" id="targetField" hidden>
        <label for="targetInput">Score cible</label>
        <input type="number" inputmode="numeric" class="cell-input target-input" id="targetInput" value="${esc(game.target != null ? String(game.target) : "")}" />
      </div>
      <div class="field">
        <label id="playersLabel">Joueurs</label>
        <div class="player-rows" id="rows"></div>
        ${locked ? "" : `<button class="btn btn-ghost btn-sm" id="addPlayer">+ Ajouter un joueur</button>`}
        <p class="teams-hint" id="teamsHint" hidden></p>
      </div>
    </div>
    <div class="scores-dialog-foot">
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-act="close">Annuler</button>
      <button class="btn btn-primary" id="save">Enregistrer</button>
    </div>`;

  const rowsEl = modal.querySelector("#rows");
  const addBtn = modal.querySelector("#addPlayer");
  const playersLabel = modal.querySelector("#playersLabel");
  // Reflect the selected game's wording (players vs teams).
  const applyUnit = () => {
    const u = unitOf(mode);
    playersLabel.textContent = u.many;
    if (addBtn) addBtn.textContent = `+ ${u.add}`;
    rowsEl
      .querySelectorAll('input[type="text"]')
      .forEach((i) => (i.placeholder = u.placeholder));
  };

  // Conversions that would change the round structure are locked once scores
  // exist: turn-based (Qwirkle) and team (Contrée) games store rounds
  // differently, so a started game can't switch to/from them.
  const hasRounds = game.rounds.length > 0;
  const curTurn = !!defFor(game).turnBased;
  const curTeams = !!defFor(game).teams;
  const isTeams = () => rulesetOf(mode).teams;
  const modeTabs = modal.querySelector("#modeTabs");
  const tabBtns = modeTabs.querySelectorAll(".mode-tab");
  tabBtns.forEach((b) => {
    const r = rulesetOf(b.dataset.mode);
    if (hasRounds && (!!r.turnBased !== curTurn || !!r.teams !== curTeams)) {
      b.disabled = true;
      b.classList.add("disabled");
      b.title = "Partie déjà commencée — type de jeu non modifiable";
    }
  });
  const targetField = modal.querySelector("#targetField");
  const targetInput = modal.querySelector("#targetInput");
  const teamsHint = modal.querySelector("#teamsHint");
  // Contrée: A = seats 1 & 3, B = seats 2 & 4. Live preview under the roster.
  const updateTeamsHint = () => {
    if (!isTeams()) return (teamsHint.hidden = true);
    teamsHint.hidden = false;
    const nm = (i) => (players[i] && players[i].name.trim()) || `Joueur ${i + 1}`;
    teamsHint.innerHTML = `<b>Équipe A</b> : ${esc(nm(0))} & ${esc(nm(2))} · <b>Équipe B</b> : ${esc(nm(1))} & ${esc(nm(3))}`;
  };
  // Team games keep a fixed roster (no add/remove); games with a configurable
  // target (Contrée) expose the score-target field.
  const applyRoster = () => {
    if (addBtn) addBtn.style.display = isTeams() ? "none" : "";
    targetField.hidden = !rulesetOf(mode).configurableTarget;
    updateTeamsHint();
  };
  const syncModeTabs = () =>
    tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  tabBtns.forEach((b) =>
    b.addEventListener("click", () => {
      if (b.disabled) return;
      mode = b.dataset.mode;
      syncModeTabs();
      applyUnit();
      applyRoster();
      drawRows();
    }),
  );
  syncModeTabs();

  const drawRows = renderPlayerRows(rowsEl, players, {
    allowRemove: () => !locked && !isTeams(),
    placeholder: () => unitOf(mode).placeholder,
    suggestions: () => placePlayerNames(getSelectedPlace(), unitKeyOf(mode)),
  });
  applyUnit();
  applyRoster();
  // Keep the teams preview in sync with name edits and reordering.
  rowsEl.addEventListener("input", updateTeamsHint);
  rowsEl.addEventListener("pointerup", () => setTimeout(updateTeamsHint, 0));
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      players.push({ id: uid(), name: "" });
      drawRows();
      rowsEl.querySelector(".player-row:last-child input").focus();
    });
  }

  const close = () => overlay.remove();
  modal
    .querySelectorAll("[data-act=close]")
    .forEach((b) => b.addEventListener("click", close));
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  modal.querySelector("#save").addEventListener("click", () => {
    const valid = players.filter((p) => p.name.trim());
    const def = rulesetOf(mode);
    if (def.teams) {
      if (valid.length !== 4)
        return toast("La Contrée se joue à exactement 4 joueurs");
    } else if (valid.length < 2) {
      return toast("Au moins 2 joueurs requis");
    }
    const dup = firstDuplicateName(valid.map((p) => p.name));
    if (dup) return toast(`« ${dup} » est présent en double`);
    const g = getGame(id);
    g.players = valid.map((p) => ({ id: p.id, name: p.name.trim() }));
    // Never switch a started game to/from a turn-based or team type.
    const cur = defFor(g);
    const incompatible =
      g.rounds.length > 0 &&
      (!!def.turnBased !== !!cur.turnBased || !!def.teams !== !!cur.teams);
    const safeMode = incompatible ? g.mode : mode;
    g.mode = safeMode;
    const sdef = rulesetOf(safeMode);
    // Configurable target (Contrée): read the field; else follow the ruleset.
    if (sdef.configurableTarget) {
      const t = Number(targetInput.value) || 0;
      if (t <= 0) return toast("Indiquez un score cible valide");
      g.target = t;
    } else {
      g.target = sdef.target;
    }
    upsertGame(g);
    overlay.remove();
    go("game", { id });
  });

  root.appendChild(overlay);
}

/* ---------- Entry (screen 2) ---------- */
function renderEntry(id) {
  const game = getGame(id);
  if (!game) return go("home");
  if (winner(game)) return go("game", { id }); // game is over — no new scores
  if (defFor(game).turnBased || defFor(game).teams) return go("game", { id }); // scored via dialog
  app.innerHTML = "";

  const backRow = el(`
    <div class="row">
      <button class="back-btn" id="back"><i class="fa-regular fa-arrow-left"></i> Retour</button>
    </div>`);
  backRow
    .querySelector("#back")
    .addEventListener("click", () => go("game", { id: game.id }));
  app.appendChild(backRow);

  app.appendChild(
    el(`
      <div class="game-head">
        <div class="game-title">
          <div class="game-title-main">
            <h2>${esc(game.name)}</h2>
            <span class="badge ${modeClass(game.mode)}">${esc(modeLabel(game.mode))}</span>
          </div>
        </div>
      </div>`),
  );

  app.appendChild(wrapPanel(buildRoundEntry(game)));
}

/* ---------- Stats (per place, keyed by player name) ---------- */
// Stats filters. "flip7" (Général) pools both Flip 7 variants; the others are
// a single mode/game. `order` is how points rank (Skyjo: fewer is better).
// Legacy games (no stored mode) count as Flip 7 classic.
const STAT_FILTERS = {
  flip7: { match: (g) => rulesetOf(g.mode) === RULESETS.flip7, order: "desc" },
  classic: { match: (g) => (g.mode || "classic") === "classic", order: "desc" },
  vengeance: { match: (g) => g.mode === "vengeance", order: "desc" },
  skyjo: { match: (g) => g.mode === "skyjo", order: "asc" },
  timesup: { match: (g) => g.mode === "timesup", order: "desc" },
  qwirkle: { match: (g) => g.mode === "qwirkle", order: "desc" },
  contree: { match: (g) => g.mode === "contree", order: "desc" },
  yams: { match: (g) => g.mode === "yams", order: "desc" },
};
function computeStats(place, filter = "flip7") {
  const f = STAT_FILTERS[filter] || STAT_FILTERS.flip7;
  // "Best" depends on the ruleset's score order: lowest is best for Skyjo
  // (asc), highest for everyone else (desc). null means "no value yet".
  const isBetter = (v, cur) =>
    cur == null || (f.order === "asc" ? v < cur : v > cur);
  const games = gamesForPlace(place).filter(f.match);
  const map = {}; // key: lowercased trimmed name -> aggregate
  games.forEach((g) => {
    const def = defFor(g);
    // Team games (Contrée): a player's figures are those of their team
    // (seats 1 & 3 → team A, 2 & 4 → team B).
    const teamOfSeat = (idx) => (idx % 2 === 0 ? "A" : "B");
    g.players.forEach((p, idx) => {
      const name = p.name.trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (!map[key])
        map[key] = {
          name,
          games: 0,
          points: 0,
          wins: 0,
          elims: 0, // number of busted (eliminated) rounds across games
          flip7s: 0, // number of Flip 7 bonuses scored across games
          bestGame: null, // best single-game total (min for asc, max for desc)
          bestRound: null, // best single-round score (min for asc, max for desc)
        };
      const agg = map[key];
      agg.games += 1;
      if (def.teams) {
        const teamId = teamOfSeat(idx);
        const total = teamTotal(g, teamId);
        agg.points += total;
        if (g.rounds.length && isBetter(total, agg.bestGame))
          agg.bestGame = total;
        g.rounds.forEach((r) => {
          const rv = Number(r.scores && r.scores[teamId]) || 0;
          if (isBetter(rv, agg.bestRound)) agg.bestRound = rv;
        });
      } else {
        const total = playerTotal(g, p.id);
        agg.points += total;
        if (g.rounds.length && isBetter(total, agg.bestGame))
          agg.bestGame = total;
        g.rounds.forEach((r) => {
          const cell = r.scores[p.id];
          if (cell && cell.bust) agg.elims += 1;
          if (cell && cell.flip7 && !cell.bust) agg.flip7s += 1;
          const rv = def.cellValue(cell);
          if (isBetter(rv, agg.bestRound)) agg.bestRound = rv;
        });
      }
    });
    // Ties count as a win for every co-winner, not just one representative.
    if (def.teams) {
      const winTeams = new Set(winners(g).map((t) => t.id));
      g.players.forEach((p, idx) => {
        if (!winTeams.has(teamOfSeat(idx))) return;
        const key = p.name.trim().toLowerCase();
        if (map[key]) map[key].wins += 1;
      });
    } else {
      winners(g).forEach((w) => {
        const key = w.name.trim().toLowerCase();
        if (map[key]) map[key].wins += 1;
      });
    }
  });
  const ptsCmp =
    f.order === "asc"
      ? (a, b) => a.points - b.points
      : (a, b) => b.points - a.points;
  return Object.values(map).sort(
    (a, b) => b.wins - a.wins || ptsCmp(a, b) || b.games - a.games,
  );
}

// Stat "metrics" selectable for Flip 7: which table to show. Each defines its
// value column, sort order, and the tie test used for shared ranks.
// Label for the "best round" metric, named after each game's round unit.
function bestRoundLabel(mode) {
  return mode === "qwirkle"
    ? "Meilleur tour"
    : mode === "yams"
      ? "Meilleure case"
      : mode === "contree"
        ? "Meilleure donne"
        : "Meilleure manche";
}
// Average score per game, rounded to a whole number (0 if no game).
function avgScore(s) {
  if (!s.games) return 0;
  return Math.round(s.points / s.games);
}
// Win ratio as a whole-number percentage of games played (0 if no game).
function winRate(s) {
  if (!s.games) return 0;
  return Math.round((s.wins / s.games) * 100);
}

const STAT_METRICS = {
  wins: {
    label: "Nombre de victoires",
    valueHead: "Victoires",
    value: (s) => s.wins,
    sort: () => (a, b) => b.wins - a.wins || b.games - a.games,
    tie: (a, b) => a.wins === b.wins && a.games === b.games,
  },
  winrate: {
    label: "Taux de victoire",
    valueHead: "Taux",
    value: (s) => `${winRate(s)} %`,
    sort: () => (a, b) => winRate(b) - winRate(a) || b.games - a.games,
    tie: (a, b) => winRate(a) === winRate(b) && a.games === b.games,
  },
  games: {
    label: "Nombre de parties",
    valueHead: "Parties",
    value: (s) => s.games,
    sort: () => (a, b) => b.games - a.games || b.wins - a.wins,
    tie: (a, b) => a.games === b.games && a.wins === b.wins,
  },
  points: {
    label: "Score total",
    valueHead: "Points",
    value: (s) => s.points,
    // Higher is better, except Skyjo (asc) where fewer points is better.
    sort: (order) => (a, b) =>
      (order === "asc" ? a.points - b.points : b.points - a.points) ||
      b.games - a.games,
    tie: (a, b) => a.points === b.points && a.games === b.games,
  },
  average: {
    label: "Moyenne par partie",
    valueHead: "Moyenne",
    value: (s) => avgScore(s),
    sort: (order) => (a, b) =>
      (order === "asc"
        ? avgScore(a) - avgScore(b)
        : avgScore(b) - avgScore(a)) || b.games - a.games,
    tie: (a, b) => avgScore(a) === avgScore(b),
  },
  elims: {
    label: "Le plus éliminé",
    valueHead: "Éliminations",
    value: (s) => s.elims,
    sort: () => (a, b) => b.elims - a.elims || b.games - a.games,
    tie: (a, b) => a.elims === b.elims && a.games === b.games,
  },
  flip7s: {
    label: "Nombre de Flip 7",
    valueHead: "Flip 7",
    value: (s) => s.flip7s,
    sort: () => (a, b) => b.flip7s - a.flip7s || b.games - a.games,
    tie: (a, b) => a.flip7s === b.flip7s && a.games === b.games,
  },
  bestGame: {
    label: "Meilleure partie",
    valueHead: "Meilleur total",
    value: (s) => s.bestGame ?? 0,
    // Best = lowest for asc (Skyjo), highest otherwise. null sorts last.
    sort: (order) => (a, b) =>
      (order === "asc"
        ? (a.bestGame ?? Infinity) - (b.bestGame ?? Infinity)
        : (b.bestGame ?? -Infinity) - (a.bestGame ?? -Infinity)) ||
      b.games - a.games,
    tie: (a, b) => a.bestGame === b.bestGame,
  },
  bestRound: {
    // A "round" is a "tour" in Qwirkle, a "donne" in Contrée, a "case" in
    // Yam's, a "manche" elsewhere.
    label: (mode) => bestRoundLabel(mode),
    valueHead: (mode) => bestRoundLabel(mode),
    value: (s) => s.bestRound ?? 0,
    sort: (order) => (a, b) =>
      (order === "asc"
        ? (a.bestRound ?? Infinity) - (b.bestRound ?? Infinity)
        : (b.bestRound ?? -Infinity) - (a.bestRound ?? -Infinity)) ||
      b.games - a.games,
    tie: (a, b) => a.bestRound === b.bestRound,
  },
};
// Which metrics each version offers in the selector (wins is the default/first).
const FLIP7_VERSIONS = new Set(["flip7", "classic", "vengeance"]);
function metricsForVersion(mode) {
  const base = ["wins", "winrate", "games", "points", "average"];
  if (FLIP7_VERSIONS.has(mode))
    return [...base, "elims", "flip7s", "bestGame", "bestRound"];
  // Games with a meaningful single-game / single-round high score.
  if (["skyjo", "qwirkle", "yams", "timesup", "contree"].includes(mode))
    return [...base, "bestGame", "bestRound"];
  return base;
}
// Resolve a metric label/valueHead that may be a string or a mode-aware fn.
function metricText(x, mode) {
  return typeof x === "function" ? x(mode) : x;
}

function renderStats() {
  app.innerHTML = "";

  const place = getSelectedPlace();

  app.appendChild(navTabs("stats"));

  // Version filter, styled like the games-list date filter (segmented).
  // "Général" pools both Flip 7 variants; Skyjo is tracked separately.
  const VERSIONS = [
    { key: "flip7", label: "Flip 7 + Vengeance" },
    { key: "classic", label: "Flip 7" },
    { key: "vengeance", label: "Flip 7 Vengeance" },
    { key: "qwirkle", label: "Qwirkle" },
    { key: "skyjo", label: "Skyjo" },
    { key: "timesup", label: "Time's Up!" },
    { key: "contree", label: "Contrée" },
    { key: "yams", label: "Yam's" },
  ];
  let statMode = "flip7";
  let statMetric = "wins";
  const controls = el(`
    <div class="date-filter" id="versionFilter">
      ${VERSIONS.map((v) => `<button type="button" data-v="${v.key}" class="${v.key === statMode ? "active" : ""}">${v.label}</button>`).join("")}
    </div>`);
  const versionBtns = controls.querySelectorAll("button");
  versionBtns.forEach((b) =>
    b.addEventListener("click", () => {
      statMode = b.dataset.v;
      versionBtns.forEach((x) =>
        x.classList.toggle("active", x.dataset.v === statMode),
      );
      syncMetricControls();
      draw();
    }),
  );
  app.appendChild(controls);

  // Metric selector: options depend on the selected version (filled by
  // syncMetricControls). Hidden when the version offers a single metric.
  const metricControls = el(`
    <div class="stat-metric-filter" id="metricFilter">
      <select class="stat-metric-select"></select>
    </div>`);
  const metricSelect = metricControls.querySelector("select");
  metricSelect.addEventListener("change", () => {
    statMetric = metricSelect.value;
    draw();
  });
  app.appendChild(metricControls);

  function syncMetricControls() {
    const keys = metricsForVersion(statMode);
    if (!keys.includes(statMetric)) statMetric = "wins";
    metricSelect.innerHTML = keys
      .map(
        (key) =>
          `<option value="${key}" ${key === statMetric ? "selected" : ""}>${metricText(STAT_METRICS[key].label, statMode)}</option>`,
      )
      .join("");
    metricControls.style.display = keys.length > 1 ? "" : "none";
    metricSelect.value = statMetric;
  }

  const content = el(`<div id="statsContent"></div>`);
  app.appendChild(content);

  function draw() {
    content.innerHTML = "";
    const f = STAT_FILTERS[statMode] || STAT_FILTERS.flip7;
    const metric = STAT_METRICS[statMetric] || STAT_METRICS.wins;
    const stats = computeStats(place, statMode)
      .slice()
      .sort(metric.sort(f.order));
    if (!stats.length) {
      const ver = VERSIONS.find((v) => v.key === statMode);
      const modeTxt = statMode === "flip7" ? "" : ` en ${ver.label}`;
      content.appendChild(
        wrapPanel(
          el(
            `<div class="empty">Aucune donnée pour « ${esc(placeLabel(place))} »${modeTxt}. Jouez une partie pour voir les statistiques.</div>`,
          ),
        ),
      );
      return;
    }

    const wrap = el(`<div class="table-wrap"></div>`);
    const table = el(`
      <table class="score stats-table">
        <thead><tr>
          <th class="rank-col">#</th>
          <th class="player-name">${unitLabel(statMode)}</th>
          <th>${metricText(metric.valueHead, statMode)}</th>
        </tr></thead>
      </table>`);
    const tbody = el(`<tbody></tbody>`);
    const labels = rankLabels(stats, metric.tie);
    stats.forEach((s, i) => {
      const { place, label } = labels[i];
      const rankClass = `rank${place}`;
      const tr = el(`
        <tr class="${place === 1 ? "winner-row" : ""}">
          <td class="rank-col"><span class="badge ${rankClass}">${label}</span></td>
          <td class="player-name">${esc(s.name)}</td>
          <td class="total-cell"><span class="score-badge ${rankClass}">${metric.value(s)}</span></td>
        </tr>`);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    content.appendChild(wrap);
  }

  // Expose the in-place redraw so polling can refresh the table while keeping
  // the selected version/metric filters (closures over statMode/statMetric).
  statsRedraw = draw;
  syncMetricControls();
  draw();
}

/* ---------- disable zoom (pinch / ctrl+wheel / ctrl +/-) ---------- */
(function preventZoom() {
  // trackpad pinch + ctrl+wheel zoom
  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );
  // keyboard zoom: ctrl/cmd + (+, -, =, 0)
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0"].includes(e.key))
      e.preventDefault();
  });
  // iOS Safari pinch gestures
  ["gesturestart", "gesturechange", "gestureend"].forEach((evt) =>
    document.addEventListener(evt, (e) => e.preventDefault()),
  );
})();

/* ---------- boot ---------- */
(async function boot() {
  app.innerHTML = `<div class="panel-wrap"><div class="empty">Chargement…</div></div>`;
  await fetchPlaces();
  if (location.hash) {
    selectPlaceFromHash(location.hash);
    await fetchGames(getSelectedPlace());
    route = hashToRoute(location.hash);
    render();
  } else if (getSelectedPlace() !== null) {
    // No deep-link but a place is known: go home and reflect it in the URL.
    await fetchGames(getSelectedPlace());
    go("home");
  } else {
    route = { name: "place" };
    render();
  }
})();
