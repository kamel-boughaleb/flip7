/* Flip 7 / Skyjo Scoreboard — vanilla JS (ES modules).
   Shared persistence via Supabase, with a localStorage fallback when unconfigured. */

import {
  el,
  wrapPanel,
  esc,
  fmtDate,
  fmtDuration,
  gameNameFromDate,
  toast,
  confettiMarkup,
} from "./js/util.js";
import "./js/components/logo.js"; // registers <app-logo>
import "./js/components/game-card.js"; // registers <app-game-card>
import "./js/components/stats-table.js"; // registers <app-stats-table>
import "./js/components/score-summary.js"; // registers <app-score-summary>
import "./js/components/turn-table.js"; // registers <app-turn-table>
import "./js/components/yams-table.js"; // registers <app-yams-table>
import "./js/components/score-table.js"; // registers <app-score-table>
import "./js/components/contree-table.js"; // registers <app-contree-table>
import {
  RULESETS,
  YAMS_CATEGORIES,
  YAMS_UPPER_KEYS,
  YAMS_BONUS_MIN,
  YAMS_BONUS,
  yamsCat,
  yamsFilled,
  yamsUpperSum,
  yamsUpperBonus,
  yamsComplete,
  CONTREE_SUITS,
  contreeSuit,
  UNITS,
  MODES,
  DEFAULT_MODE,
  rulesetOf,
  defFor,
  modeLabel,
  modeClass,
  rulesFor,
  unitKeyOf,
  unitOf,
  unitLabel,
  modeTabsHTML,
} from "./js/rules.js";
import {
  playerTotal,
  standings,
  teamsOf,
  teamName,
  teamTotal,
  currentDealer,
  isGameOver,
  winnersFromStandings,
  winners,
  winnersLabel,
  winner,
  turnOrder,
  currentPlayer,
  roundNoun,
  roundCountLabel,
  roundNumberLabel,
  roundNoteFor,
  rankLabels,
  gameDuration,
  turnDraftHasData,
  contreeBidHTML,
} from "./js/scoring.js";
import { parsePath } from "./js/router.js";
import { go, applyLocation, currentRoute, onRender } from "./js/nav.js";
import {
  db,
  LOADED_PLACE,
  fetchPlaces,
  fetchGames,
  getGame,
  upsertGame,
  deleteGame,
  uid,
  getSelectedPlace,
  setSelectedPlace,
  addLocalPlace,
  placeLabel,
  allPlaces,
  gamesForPlace,
  placePlayerNames,
} from "./js/store.js";
import {
  computeStats,
  STAT_FILTERS,
  STAT_METRICS,
  metricsForVersion,
  metricText,
} from "./js/stats.js";
import { confirmDialog, promptDialog } from "./js/ui.js";
import { openRulesDialog } from "./js/dialogs/rules.js";
import { renderPlayerRows } from "./js/dialogs/player-rows.js";

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


/* ---------- shell: render dispatch + polling ---------- */
const app = document.getElementById("app");
let homeFilter = "today"; // games list date filter: "today" | "week" | "month" | "all"
let pollTimer = null;
let durationTimer = null; // ticks the live game-duration chip every second
let statsRedraw = null; // redraws the stats table in place (filters preserved)

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
  if (place !== null && currentRoute().name !== "place") {
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
    place !== null && currentRoute().name !== "place"
      ? `${placeLabel(place)} | ${base}`
      : base;
}

const KNOWN_ROUTES = ["place", "home", "stats", "entry", "game", "details"];

// Render callback for the nav shell: mount the screen for the current route.
function render() {
  stopPolling();
  stopDurationTimer();
  const r = currentRoute();
  const name = KNOWN_ROUTES.includes(r.name) ? r.name : "home";
  updatePlaceBtn();
  if (name === "place") return renderPlace();
  if (name === "home") {
    renderHome();
    startHomePolling(); // live-refresh the games list every 2s
    return;
  }
  if (name === "stats") {
    renderStats();
    startStatsPolling(); // live-refresh the stats table every 2s
    return;
  }
  if (name === "entry") return renderEntry(r.id);
  if (name === "game") {
    renderGame(r.id);
    startPolling(r.id); // live-refresh the board every 2s
    return;
  }
  if (name === "details") {
    renderDetails(r.id);
    startPolling(r.id);
    return;
  }
  renderHome();
}
onRender(render); // the nav shell calls this on every route change

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
    if (currentRoute().name !== "home") return stopPolling();
    // don't disrupt an open dialog (e.g. delete confirmation)
    if (document.querySelector("#modal-root .overlay")) return;
    const place = getSelectedPlace();
    const before = JSON.stringify(gamesForPlace(place));
    await fetchGames();
    if (currentRoute().name !== "home") return;
    if (JSON.stringify(gamesForPlace(place)) !== before) renderHome();
  }, 2000);
}
// Auto-refresh the stats table (mirrors the home polling). Redraws in place so
// the selected version/metric filters are kept.
function startStatsPolling() {
  stopPolling();
  if (!db) return; // nothing to sync from in local mode
  pollTimer = setInterval(async () => {
    if (currentRoute().name !== "stats") return stopPolling();
    if (document.querySelector("#modal-root .overlay")) return;
    const place = getSelectedPlace();
    const before = JSON.stringify(gamesForPlace(place));
    await fetchGames();
    if (currentRoute().name !== "stats") return;
    if (JSON.stringify(gamesForPlace(place)) !== before && statsRedraw)
      statsRedraw();
  }, 2000);
}
function startPolling(id) {
  stopPolling();
  if (!db) return; // nothing to sync from in local mode
  const onScoreScreen = () => currentRoute().name === "game" || currentRoute().name === "details";
  pollTimer = setInterval(async () => {
    if (!onScoreScreen() || currentRoute().id !== id) return stopPolling();
    // don't disrupt an in-progress edit on the details screen
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("cell-input")) return;
    const before = JSON.stringify(getGame(id) || null);
    await fetchGames();
    if (!onScoreScreen() || currentRoute().id !== id) return;
    const after = JSON.stringify(getGame(id) || null);
    if (after !== before) {
      currentRoute().name === "details" ? renderDetails(id) : renderGame(id);
    }
  }, 2000);
}

/* ---------- helpers ---------- */
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

/* ---------- Place (entry screen) ---------- */
function renderPlace() {
  app.innerHTML = "";
  const current = getSelectedPlace();

  app.appendChild(el("<app-logo></app-logo>"));

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
        <app-logo></app-logo>
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
  // Each card emits a bubbling "open" event with the game id (see app-game-card).
  list.addEventListener("open", (e) => go("game", { id: e.detail }));
  filtered.forEach((g) => {
    const card = document.createElement("app-game-card");
    card.game = g;
    list.appendChild(card);
  });
  app.appendChild(list);
}

/* ---------- Shared player-list editor (used by Setup & Organiser) ---------- */
// Renders the reorderable player rows into `rowsEl`, mutating the `players`
// array ({id, name}) in place. Returns the redraw function (call it after
// pushing a new player). Identical preparation logic for both screens.
// Uses Pointer Events (mouse + touch) so reordering works on mobile too.

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
      if (currentRoute().name !== "game" || currentRoute().id !== id) return stopDurationTimer();
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
    const summary = document.createElement("app-score-summary");
    summary.game = game;
    app.appendChild(wrapPanel(summary));
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
/* ---------- Details (per-round breakdown) ---------- */
function renderDetails(id) {
  const game = getGame(id);
  if (!game) return go("home");
  app.innerHTML = "";

  const backRow = el(`
    <div class="row">
      <button class="back-btn" id="back"><i class="fa-regular fa-arrow-left"></i> Scores</button>
      <span class="badge ${modeClass(game.mode)} ml-auto">${esc(modeLabel(game.mode))}</span>
    </div>`);
  backRow
    .querySelector("#back")
    .addEventListener("click", () => go("game", { id: game.id }));
  app.appendChild(backRow);

  // Editable table components write to the store then emit "changed"; refresh
  // the screen, and celebrate a brand-new win when the event carries a prior id.
  const wireChanged = (node) => {
    node.addEventListener("changed", (e) => {
      const hasBefore = e.detail && "before" in e.detail;
      const g = getGame(id);
      renderDetails(id);
      if (hasBefore) celebrateIfNewWinner(e.detail.before, g);
    });
    return node;
  };
  const component = (tag) => {
    const n = document.createElement(tag);
    n.game = game;
    return wireChanged(n);
  };

  let tableNode;
  if (defFor(game).teams) tableNode = component("app-contree-table");
  else if (defFor(game).entry === "yams") tableNode = component("app-yams-table");
  else if (defFor(game).turnBased) tableNode = component("app-turn-table");
  else tableNode = component("app-score-table");
  app.appendChild(wrapPanel(tableNode));
}

// Details for Yams: a proper scorecard — one row per mission, one column per
// player — with the upper subtotal, the +35 bonus row, and the grand total.
// Filled cells stay editable: upper-section cells take a die count (score =
// count × face), lower-section cells toggle between the mission value and 0.
// Does a draft cell hold any entered data?
function draftHasData(d) {
  return d && ((d.points !== "" && d.points != null) || d.flip7 || d.bust);
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
    if (currentRoute().name === "game" && currentRoute().id === game.id) go("game", { id: game.id });
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
    if (currentRoute().name === "game" && currentRoute().id === game.id)
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
    if (currentRoute().name === "game" && currentRoute().id === game.id)
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

    const tableEl = document.createElement("app-stats-table");
    tableEl.data = { stats, metric, mode: statMode };
    content.appendChild(tableEl);
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
  const r = parsePath(location.pathname);
  if (r.name === "place" && getSelectedPlace() !== null) {
    // Landing on "/" with a remembered place: jump to its home (updates the URL).
    await fetchGames(getSelectedPlace());
    go("home");
  } else {
    await applyLocation();
  }
})();
