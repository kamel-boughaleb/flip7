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
    cellValue(cell) {
      return Number(cell && cell.points) || 0;
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
};

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
  skyjo: { label: "Skyjo", ruleset: "skyjo", rules: () => rulesSkyjoHTML() },
  timesup: {
    label: "Time's Up!",
    ruleset: "timesup",
    rules: () => rulesTimesUpHTML(),
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

/* ---------- storage: in-memory cache, write-through to Supabase ---------- */
let GAMES = [];

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

// Load all games from the server (or localStorage) into the cache.
async function fetchGames() {
  if (!db) {
    GAMES = localLoad();
    return;
  }
  const { data, error } = await db.from("games").select("id, data");
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
  let hasNoPlace = false;
  GAMES.forEach((g) => {
    const n = (g.place || "").trim();
    if (n) map.set(n.toLowerCase(), n);
    else hasNoPlace = true;
  });
  localPlaces().forEach((n) => {
    const t = n.trim();
    if (t) map.set(t.toLowerCase(), t);
  });
  const list = [...map.values()].sort((a, b) => a.localeCompare(b, "fr"));
  if (hasNoPlace) list.unshift("");
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
  return game.rounds.reduce(
    (sum, r) => sum + def.cellValue(r.scores[playerId]),
    0,
  );
}
// Standings sorted by the game's order (Flip 7: highest first; Skyjo: lowest
// first). The leader — best by the game's rules — is always s[0].
function standings(game) {
  const asc = defFor(game).scoreOrder === "asc";
  return game.players
    .map((p) => ({ ...p, total: playerTotal(game, p.id) }))
    .sort((a, b) => (asc ? a.total - b.total : b.total - a.total));
}
// Is the game finished? Target-based games (Flip 7, Skyjo) end once any player
// reaches the target; round-limited games (Time's Up!) end after N rounds.
function isGameOver(game, s) {
  const def = defFor(game);
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

window.addEventListener("hashchange", () => {
  selectPlaceFromHash(location.hash);
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
  if (route.name === "stats") return renderStats();
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
      <li>Saisissez le <b>score de chaque joueur pour chaque manche</b> (la valeur peut être <b>négative</b>).</li>
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

  const submit = () => {
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
      ${FILTERS.map((f) => `<button type="button" data-f="${f.key}" class="${f.key === homeFilter ? "active" : ""}">${f.label}</button>`).join("")}
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
    const names = g.players.map((p) => p.name).join(", ");
    let roundsNote = "";
    if (!ongoing) {
      roundsNote = ` · ${g.rounds.length} manche${g.rounds.length === 1 ? "" : "s"}`;
      const dur = gameDuration(g);
      if (dur != null) roundsNote += ` · ${fmtDuration(dur)}`;
    }
    const statusBadge = g.cancelled
      ? `<span class="badge cancelled"><i class="fa-regular fa-ban"></i> Annulée</span>`
      : w
        ? `<span class="badge rank1"><i class="fa-regular fa-trophy"></i> ${winnersLabel(ws)}</span>`
        : `<div class="status-cell">
             <span class="badge ongoing">En cours <i class="fa-regular fa-spinner-third fa-spin"></i></span>
             <span class="round-note">Manche ${g.rounds.length + 1}</span>
           </div>`;
    const card = el(`
      <div class="game-card ${g.cancelled ? "cancelled" : w ? "done" : "ongoing"}">
        <div class="meta">
          <div class="name"><span class="name-text">${esc(g.name)}</span> <span class="badge badge-sm ${modeClass(g.mode)}">${esc(modeLabel(g.mode))}</span></div>
          <div class="sub">${esc(names || "Aucun joueur")}${roundsNote}</div>
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
          ${allowRemove ? `<button class="btn btn-danger btn-icon" title="Retirer"><i class="fa-regular fa-xmark"></i></button>` : ""}
        </div>`);
      const input = row.querySelector("input");
      input.addEventListener("input", (e) => {
        players[i].name = e.target.value;
        revalidate(i);
      });
      wireSuggestions(input, i);
      if (allowRemove) {
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
      <div class="field">
        <label id="playersLabel">Joueurs</label>
        <div class="player-rows" id="rows"></div>
        <button class="btn btn-ghost btn-sm" id="addPlayer">+ Ajouter un joueur</button>
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
  // Reflect the selected game's wording (players vs teams).
  const applyUnit = () => {
    const u = unitOf(mode);
    playersLabel.textContent = u.many;
    addBtn.textContent = `+ ${u.add}`;
    rowsEl
      .querySelectorAll('input[type="text"]')
      .forEach((i) => (i.placeholder = u.placeholder));
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
    }),
  );
  syncModeTabs();

  const drawRows = renderPlayerRows(rowsEl, players, {
    placeholder: () => unitOf(mode).placeholder,
    suggestions: () => placePlayerNames(place, unitKeyOf(mode)),
  });
  applyUnit();
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
    const valid = players.filter((p) => p.name.trim());
    if (valid.length < 2) return toast("Ajoutez au moins 2 joueurs");
    const dup = firstDuplicateName(valid.map((p) => p.name));
    if (dup) return toast(`« ${dup} » est présent en double`);
    const now = Date.now();
    const game = {
      id: uid(),
      name: gameNameFromDate(now),
      createdAt: now,
      target: rulesetOf(mode).target,
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
  // Round count shown on the meta row below the title.
  // Ongoing: the round being played; finished/cancelled: total rounds played.
  const roundCount = w ? game.rounds.length : game.rounds.length + 1;
  const roundNum = `<span class="game-round-num">${roundCount} manche${roundCount === 1 ? "" : "s"}</span>`;

  const backRow = el(`
    <div class="row">
      <button class="back-btn" id="back"><i class="fa-regular fa-arrow-left"></i> Retour</button>
    </div>`);
  backRow.querySelector("#back").addEventListener("click", () => go("home"));
  app.appendChild(backRow);

  const head = el(`
    <div class="game-head game-head-stacked">
      <div class="game-title-main">
        <h2>${esc(game.name)}</h2>
        <span class="badge ${modeClass(game.mode)}">${esc(modeLabel(game.mode))}</span>
      </div>
      <div class="game-meta-row">
        ${roundNum}
        ${durationChip}
        <button class="btn btn-ghost btn-sm ml-auto" id="editPlayers">Modifier</button>
        <div class="kebab">
          <button class="btn btn-ghost btn-sm btn-icon" id="moreBtn" aria-label="Plus d'options" aria-haspopup="true" aria-expanded="false"><i class="fa-regular fa-ellipsis"></i></button>
          <div class="kebab-menu" id="moreMenu" hidden>
            <button class="kebab-item kebab-edit" id="editKebab"><i class="fa-regular fa-pen-to-square"></i> Modifier</button>
            <button class="kebab-item" id="shareBtn"><i class="fa-regular fa-share-nodes"></i> Partager</button>
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

  app.appendChild(head);

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
    const banner = game.cancelled
      ? el(
          `<div class="banner banner-cancelled"><i class="fa-regular fa-ban"></i> Partie annulée — ${ws.length > 1 ? "Vainqueurs" : "Vainqueur"} : <b>${names}</b> (${ws[0].total} pts)</div>`,
        )
      : el(
          `<div class="banner">${confettiMarkup()}<span class="crown"><i class="fa-regular fa-trophy"></i></span> <b>${names}</b> ${ws.length > 1 ? "gagnent" : "gagne"} avec ${ws[0].total} points !</div>`,
        );
    app.appendChild(wrapPanel(banner));
  }

  app.appendChild(wrapPanel(buildSummary(game, st, w)));

  // Hide score entry once the game is won.
  if (!w) {
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

  const linksWrap = el(`<div class="rules-link-wrap game-links-row">
    <button class="link-btn" id="showDetails"><i class="fa-regular fa-clipboard-list"></i> Voir les détails</button>
    <button class="link-btn" id="newGameSamePlayers"><i class="fa-regular fa-arrows-rotate"></i> Nouvelle partie avec ces joueurs</button>
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
  // In-progress (pre-saved) round: show each player's projected total in muted.
  const draft = game.draftRound || {};
  const def = defFor(game);
  const hasDraftFor = (p) => {
    const dc = draft[p.id];
    return dc && ((dc.points !== "" && dc.points != null) || dc.flip7 || dc.bust);
  };
  const projected = {};
  st.forEach((p) => {
    projected[p.id] =
      p.total + (hasDraftFor(p) ? def.cellValue(draft[p.id]) : 0);
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
    let preview = "";
    if (eliminated) {
      preview = '<span class="elim-tag">éliminé.e</span>';
    } else if (hasDraftFor(p)) {
      preview = `<span class="score-preview"><i class="fa-regular fa-arrow-right-long"></i> ${projected[p.id]}${previewCrown}</span>`;
    }
    const tr = el(`
      <tr class="${won ? "winner-row" : ""}${eliminated ? " eliminated-row" : ""}">
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
      <button class="back-btn" id="back"><i class="fa-regular fa-arrow-left"></i> Retour</button>
    </div>`);
  backRow
    .querySelector("#back")
    .addEventListener("click", () => go("game", { id: game.id }));
  app.appendChild(backRow);

  app.appendChild(
    el(`
      <div class="game-head">
        <h2>Détails des scores</h2>
        <span class="badge ${modeClass(game.mode)}">${esc(modeLabel(game.mode))}</span>
        <span class="target-note">${esc(game.name)}</span>
      </div>`),
  );

  app.appendChild(wrapPanel(buildTable(game, rankMap, w)));
}

function buildTable(game, rankMap, w) {
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
      const tags = `${cell.flip7 ? '<span class="flip7-tag">+15</span>' : ""}`;
      // Eliminated cells stay editable but keep a "disabled" look while at 0.
      const val = cell.bust ? 0 : Number(cell.points) || 0;
      td.innerHTML = `
        <span class="cell-box"><input type="number" class="cell-input${val === 0 ? " cell-zero" : ""}" value="${val}" />${tags}</span>`;
      const input = td.querySelector("input");
      input.addEventListener("input", () => {
        input.classList.toggle("cell-zero", (Number(input.value) || 0) === 0);
      });
      input.addEventListener("change", (e) => {
        const g = getGame(game.id);
        const beforeWinnerId = (winner(g) || {}).id || null;
        const c = g.rounds[ri].scores[p.id] || {
          points: 0,
          flip7: false,
          bust: false,
        };
        const v = Number(e.target.value) || 0;
        c.points = v;
        // A non-zero edit overrides the elimination so the score actually counts.
        if (v !== 0) c.bust = false;
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

// Does a draft cell hold any entered data?
function draftHasData(d) {
  return d && ((d.points !== "" && d.points != null) || d.flip7 || d.bust);
}
// Convert a draft cell to a stored round cell, per the game's entry style.
function draftToCell(def, d) {
  if (def.entry === "number") return { points: Number(d.points) || 0 };
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
      <div class="entry-player">
        <span class="pname">${esc(p.name)}</span>
        <div class="entry-controls">
          <input type="number" class="cell-input" placeholder="0" value="${esc(d.points)}" />
        </div>
      </div>`);
    row.querySelector("input").addEventListener("input", (e) => {
      draft[p.id].points = e.target.value;
      notify();
    });
    return row;
  }
  const row = el(`
    <div class="entry-player ${d.bust ? "busted" : d.flip7 ? "flipped" : ""}">
      <span class="pname">${esc(p.name)}</span>
      <div class="entry-controls">
        <input type="number" class="cell-input" placeholder="0" min="0" value="${d.bust ? "" : esc(d.points)}" ${d.bust ? "disabled" : ""} />
        <button type="button" class="btn btn-ghost btn-sm flip7-btn ${d.flip7 ? "active" : ""}" ${d.bust ? "disabled" : ""}><i class="fa-regular fa-star"></i> Flip 7 (+${def.bonus})</button>
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
      <div class="field">
        <label id="playersLabel">Joueurs</label>
        <div class="player-rows" id="rows"></div>
        ${locked ? "" : `<button class="btn btn-ghost btn-sm" id="addPlayer">+ Ajouter un joueur</button>`}
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
    }),
  );
  syncModeTabs();

  const drawRows = renderPlayerRows(rowsEl, players, {
    allowRemove: !locked,
    placeholder: () => unitOf(mode).placeholder,
    suggestions: () => placePlayerNames(getSelectedPlace(), unitKeyOf(mode)),
  });
  applyUnit();
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
    if (valid.length < 2) return toast("Au moins 2 joueurs requis");
    const dup = firstDuplicateName(valid.map((p) => p.name));
    if (dup) return toast(`« ${dup} » est présent en double`);
    const g = getGame(id);
    g.players = valid.map((p) => ({ id: p.id, name: p.name.trim() }));
    g.mode = mode;
    g.target = rulesetOf(mode).target; // follow the (possibly new) ruleset
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
};
function computeStats(place, filter = "flip7") {
  const f = STAT_FILTERS[filter] || STAT_FILTERS.flip7;
  const games = gamesForPlace(place).filter(f.match);
  const map = {}; // key: lowercased trimmed name -> aggregate
  games.forEach((g) => {
    const def = defFor(g);
    g.players.forEach((p) => {
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
          bestGame: 0, // highest single-game total
          bestRound: 0, // highest single-round score
        };
      const agg = map[key];
      agg.games += 1;
      const total = playerTotal(g, p.id);
      agg.points += total;
      if (total > agg.bestGame) agg.bestGame = total;
      g.rounds.forEach((r) => {
        const cell = r.scores[p.id];
        if (cell && cell.bust) agg.elims += 1;
        const rv = def.cellValue(cell);
        if (rv > agg.bestRound) agg.bestRound = rv;
      });
    });
    // Ties count as a win for every co-winner, not just one representative.
    winners(g).forEach((w) => {
      const key = w.name.trim().toLowerCase();
      if (map[key]) map[key].wins += 1;
    });
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
const STAT_METRICS = {
  ranking: {
    label: "Classement",
    cols: (mode) => [
      { head: "Parties", get: (s) => s.games },
      { head: "Points", get: (s) => s.points },
    ],
    valueHead: "Victoires",
    value: (s) => s.wins,
    sort: (order) => (a, b) =>
      b.wins - a.wins ||
      (order === "asc" ? a.points - b.points : b.points - a.points) ||
      b.games - a.games,
    tie: (a, b) =>
      a.wins === b.wins && a.points === b.points && a.games === b.games,
  },
  elims: {
    label: "Le plus éliminé",
    cols: () => [{ head: "Parties", get: (s) => s.games }],
    valueHead: "Éliminations",
    value: (s) => s.elims,
    sort: () => (a, b) => b.elims - a.elims || b.games - a.games,
    tie: (a, b) => a.elims === b.elims && a.games === b.games,
  },
  bestGame: {
    label: "Le plus gros score",
    cols: () => [{ head: "Parties", get: (s) => s.games }],
    valueHead: "Meilleur total",
    value: (s) => s.bestGame,
    sort: () => (a, b) => b.bestGame - a.bestGame || b.games - a.games,
    tie: (a, b) => a.bestGame === b.bestGame,
  },
  bestRound: {
    label: "La plus grosse manche",
    cols: () => [{ head: "Parties", get: (s) => s.games }],
    valueHead: "Meilleure manche",
    value: (s) => s.bestRound,
    sort: () => (a, b) => b.bestRound - a.bestRound || b.games - a.games,
    tie: (a, b) => a.bestRound === b.bestRound,
  },
};
// Metric selector only applies to the Flip 7 family (busts/Flip 7 bonuses).
const FLIP7_VERSIONS = new Set(["flip7", "classic", "vengeance"]);

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
    { key: "skyjo", label: "Skyjo" },
    { key: "timesup", label: "Time's Up!" },
  ];
  let statMode = "flip7";
  let statMetric = "ranking";
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
      if (!FLIP7_VERSIONS.has(statMode)) statMetric = "ranking";
      syncMetricControls();
      draw();
    }),
  );
  app.appendChild(controls);

  // Metric selector (Flip 7 only): Classement / Le plus éliminé / etc.
  const metricControls = el(`
    <div class="stat-metric-filter" id="metricFilter">
      <select class="stat-metric-select">
        ${Object.entries(STAT_METRICS)
          .map(
            ([key, m]) =>
              `<option value="${key}" ${key === statMetric ? "selected" : ""}>${m.label}</option>`,
          )
          .join("")}
      </select>
    </div>`);
  const metricSelect = metricControls.querySelector("select");
  metricSelect.addEventListener("change", () => {
    statMetric = metricSelect.value;
    draw();
  });
  app.appendChild(metricControls);

  function syncMetricControls() {
    metricControls.style.display = FLIP7_VERSIONS.has(statMode) ? "" : "none";
    metricSelect.value = statMetric;
  }

  const content = el(`<div id="statsContent"></div>`);
  app.appendChild(content);

  function draw() {
    content.innerHTML = "";
    const f = STAT_FILTERS[statMode] || STAT_FILTERS.flip7;
    const metric = STAT_METRICS[statMetric] || STAT_METRICS.ranking;
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

    const cols = metric.cols(statMode);
    const wrap = el(`<div class="table-wrap"></div>`);
    const table = el(`
      <table class="score stats-table">
        <thead><tr>
          <th class="rank-col">#</th>
          <th class="player-name">${unitLabel(statMode)}</th>
          ${cols.map((c) => `<th>${c.head}</th>`).join("")}
          <th>${metric.valueHead}</th>
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
          ${cols.map((c) => `<td>${c.get(s)}</td>`).join("")}
          <td class="total-cell"><span class="score-badge ${rankClass}">${metric.value(s)}</span></td>
        </tr>`);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    content.appendChild(wrap);
  }

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
  await fetchGames();
  if (location.hash) {
    selectPlaceFromHash(location.hash);
    route = hashToRoute(location.hash);
    render();
  } else if (getSelectedPlace() !== null) {
    // No deep-link but a place is known: go home and reflect it in the URL.
    go("home");
  } else {
    route = { name: "place" };
    render();
  }
})();
