/* Flip 7 / Skyjo Scoreboard — vanilla JS (ES modules).
   Shared persistence via Supabase, with a localStorage fallback when unconfigured. */

import {
  el,
  wrapPanel,
  esc,
  fmtDate,
  dayKey,
  dayHeading,
  fmtDuration,
  toast,
  confettiMarkup,
  firstDuplicateName,
} from "./js/util.js";
import "./js/components/logo.js"; // registers <app-logo>
import "./js/components/game-card.js"; // registers <app-game-card>
import "./js/components/stats-table.js"; // registers <app-stats-table>
import "./js/components/score-summary.js"; // registers <app-score-summary>
import { flashEliminated } from "./js/components/score-summary.js";
import "./js/components/turn-table.js"; // registers <app-turn-table>
import "./js/components/yams-table.js"; // registers <app-yams-table>
import "./js/components/score-table.js"; // registers <app-score-table>
import "./js/components/bombu-table.js"; // registers <app-bombu-table>
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
  bombuContract,
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
import {
  go,
  goBack,
  applyLocation,
  migrateLegacyHash,
  currentRoute,
  onRender,
  currentHashPath,
  replaceRoute,
} from "./js/nav.js";
import {
  db,
  LOADED_PLACE,
  fetchPlaces,
  fetchGames,
  getGame,
  replayOf,
  upsertGame,
  localBustSet,
  advanceFingerprint,
  localAdvanceSig,
  deleteGame,
  getSelectedPlace,
  setSelectedPlace,
  addLocalPlace,
  placeLabel,
  allPlaces,
  gamesForPlace,
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
import { openSetupDialog } from "./js/dialogs/setup.js";
import { openEditPlayersDialog } from "./js/dialogs/edit-players.js";
import { buildRoundEntry, openScoresDialog } from "./js/dialogs/scores.js";
import { buildTurnBar } from "./js/dialogs/turn.js";
import { buildBombuBar, buildBombuContractInfo } from "./js/dialogs/bombu.js";
import { openYamsEditDialog } from "./js/dialogs/yams.js";
import { celebrateIfNewWinner } from "./js/dialogs/celebrate.js";
import { endGamePrompt } from "./js/actions.js";
import {
  buildContreeSummary,
  buildBidInfo,
  buildContreeBar,
} from "./js/dialogs/contree.js";

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

/* ---------- shell: render dispatch + polling ---------- */
const app = document.getElementById("app");
let homeFilter = "today"; // games list date filter: "today" | "week" | "month" | "all"
let pollTimer = null;
// Finished-game ids for which we've already shown the "a replay was created"
// banner, so polling doesn't re-show it every 2s.
const replayNotified = new Set();
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

// Document title reflects the current place: "[Lieu] | Kigagne ?".
function updateTitle(place) {
  const base = "Kigagne ?";
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
  document.getElementById("replay-banner")?.remove(); // drop it on navigation
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
// `immediate` runs one tick right away (used when resuming from the background,
// so the screen catches up instead of waiting up to 2s for the first interval).
function startHomePolling(immediate) {
  stopPolling();
  if (!db) return; // nothing to sync from in local mode
  const tick = async () => {
    if (currentRoute().name !== "home") return stopPolling();
    // don't disrupt an open dialog (e.g. delete confirmation)
    if (document.querySelector("#modal-root .overlay")) return;
    const place = getSelectedPlace();
    const before = JSON.stringify(gamesForPlace(place));
    await fetchGames();
    if (currentRoute().name !== "home") return;
    if (JSON.stringify(gamesForPlace(place)) !== before) renderHome();
  };
  if (immediate) tick();
  pollTimer = setInterval(tick, 2000);
}
// Auto-refresh the stats table (mirrors the home polling). Redraws in place so
// the selected version/metric filters are kept.
function startStatsPolling(immediate) {
  stopPolling();
  if (!db) return; // nothing to sync from in local mode
  const tick = async () => {
    if (currentRoute().name !== "stats") return stopPolling();
    if (document.querySelector("#modal-root .overlay")) return;
    const place = getSelectedPlace();
    const before = JSON.stringify(gamesForPlace(place));
    await fetchGames();
    if (currentRoute().name !== "stats") return;
    if (JSON.stringify(gamesForPlace(place)) !== before && statsRedraw)
      statsRedraw();
  };
  if (immediate) tick();
  pollTimer = setInterval(tick, 2000);
}
function startPolling(id, immediate) {
  stopPolling();
  if (!db) return; // nothing to sync from in local mode
  // A replay that ALREADY exists when we land on this game isn't news: mark it
  // known so the banner only fires for a replay created live while we watch —
  // not every time we revisit an old, already-replayed game.
  if (replayOf(id)) replayNotified.add(id);
  const onScoreScreen = () => currentRoute().name === "game" || currentRoute().name === "details";
  const tick = async () => {
    if (!onScoreScreen() || currentRoute().id !== id) return stopPolling();
    // don't disrupt an in-progress edit on the details screen
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("cell-input")) return;
    const before = JSON.stringify(getGame(id) || null);
    // Capture the winner before syncing so we can fire the celebration overlay
    // on every device once the win arrives via polling (not just on the device
    // that entered the score — see renderDetails' "changed" handler).
    const beforeWinnerId = (winner(getGame(id)) || {}).id;
    await fetchGames();
    if (!onScoreScreen() || currentRoute().id !== id) return;
    maybeNotifyReplay(id); // a "Rejouer" on another device created a new game
    const after = JSON.stringify(getGame(id) || null);
    if (after !== before) {
      const g = getGame(id);
      // Mirror the elimination flash on the OTHER players' screens: a player now
      // busted that this device didn't bust itself was eliminated remotely.
      flashRemoteEliminations(g);
      toastRemoteAdvance(g); // round/turn change → toast, on the other devices only
      // Let an open score dialog react to the sync (e.g. close itself if the
      // round was just committed on another device).
      document.dispatchEvent(new CustomEvent("flip7:gamechanged", { detail: id }));
      currentRoute().name === "details" ? renderDetails(id) : renderGame(id);
      // Only fires when the winner id actually changed, so it shows once.
      celebrateIfNewWinner(beforeWinnerId, g);
    }
  };
  if (immediate) tick();
  pollTimer = setInterval(tick, 2000);
}

// Players currently busted in a game's in-progress draft.
function draftBustSet(game) {
  const s = new Set();
  const d = game && game.draftRound;
  if (d) for (const pid in d) if (d[pid] && d[pid].bust) s.add(pid);
  return s;
}
// Busts this device has already accounted for per game (baseline on entry +
// everything flashed so far), so a steady remote bust isn't re-flashed.
const seenBusts = new Map();

// Flash the elimination animation for any player who became busted remotely —
// i.e. busted now, not yet seen here, and NOT authored by this device (the
// emitter must never see its own elimination). Skipped on the details screen.
function flashRemoteEliminations(game) {
  if (!game || currentRoute().name !== "game") return;
  const fetched = draftBustSet(game);
  // First sighting of this game: just baseline, never flash pre-existing busts.
  if (!seenBusts.has(game.id)) {
    seenBusts.set(game.id, fetched);
    return;
  }
  const seen = seenBusts.get(game.id);
  const local = localBustSet(game.id);
  const names = (game.players || [])
    .filter((p) => fetched.has(p.id) && !seen.has(p.id) && !local.has(p.id))
    .map((p) => p.name);
  seenBusts.set(game.id, fetched);
  names.forEach(flashEliminated);
}

// --- Advance toast (new manche / tour / case / main-contrat) -----------------
// Every game progression is announced with a discreet toast on the OTHER
// players' screens only (never the device that triggered it): a manche/donne
// committed, a turn taken, a Yam's cell filled, a contract/bid announced.
// Driven from the poll loop (a local commit's renderGame never reaches it) and
// guarded by the authored fingerprint, so a change landing during a poll's
// await still isn't toasted on the emitter.

// The text to announce for a game's current advance state (null = nothing).
function advanceText(game) {
  const def = defFor(game);
  if (def.entry === "bombu") {
    const c = game.pendingContract ? bombuContract(game.pendingContract) : null;
    return c ? `Contrat : ${c.label}` : null;
  }
  if (def.entry === "contree") {
    const b = game.pendingBid;
    if (!b) return null;
    const s = contreeSuit(b.suit);
    const val = b.contract === "capot" ? "Capot" : b.contract;
    return `Contrat : ${val}${s ? " " + s.sym : ""}`;
  }
  if (def.turnBased) {
    const cp = currentPlayer(game);
    return cp ? `Au tour de ${cp.name}` : null;
  }
  const n = (game.rounds || []).length;
  return roundNumberLabel(game, n + 1);
}

const seenAdvance = new Map();
function toastRemoteAdvance(game) {
  if (!game || currentRoute().name !== "game") return;
  const fp = advanceFingerprint(game);
  if (!seenAdvance.has(game.id)) {
    seenAdvance.set(game.id, fp); // baseline on first sight, never toast it
    return;
  }
  const prev = seenAdvance.get(game.id);
  seenAdvance.set(game.id, fp);
  if (prev === fp || winner(game)) return; // unchanged, or game over (celebration)
  if (fp === localAdvanceSig(game.id)) return; // authored here → emitter, skip
  const text = advanceText(game);
  if (text) toast(text);
}

// (Re)start the polling appropriate to the current screen, without re-rendering.
// Used to resume live sync when the app returns to the foreground; `immediate`
// forces a catch-up fetch right away.
function startPollingForCurrentRoute(immediate) {
  const r = currentRoute();
  if (r.name === "home") startHomePolling(immediate);
  else if (r.name === "stats") startStatsPolling(immediate);
  else if (r.name === "game" || r.name === "details") startPolling(r.id, immediate);
}

// Don't poll while the tab/app is in the background (hidden) — it wastes
// requests and battery and nothing is on screen to update. Resume on return.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPolling();
  else startPollingForCurrentRoute(true); // immediate catch-up on return
});

// Show a one-time banner when a replay of game `id` has been created elsewhere
// (so devices still on the finished game can jump to the new one).
function maybeNotifyReplay(id) {
  if (replayNotified.has(id)) return;
  const rep = replayOf(id);
  if (!rep) return;
  replayNotified.add(id);
  notifyReplay(rep);
}

// Dismissible top banner offering to join the freshly-created replay game.
function notifyReplay(game) {
  document.getElementById("replay-banner")?.remove();
  const banner = el(`
    <div class="replay-banner" id="replay-banner">
      <span class="replay-banner-text">Une nouvelle partie a été créée</span>
      <button class="btn btn-primary btn-sm replay-join">Rejoindre</button>
      <button class="replay-dismiss" aria-label="Ignorer"><i class="fa-regular fa-xmark"></i></button>
    </div>`);
  banner
    .querySelector(".replay-join")
    .addEventListener("click", () => go("game", { id: game.id }));
  banner
    .querySelector(".replay-dismiss")
    .addEventListener("click", () => banner.remove());
  document.body.appendChild(banner);
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

  // The active date filter lives in the URL ("/[lieu]/week" etc.); "today" is
  // the implicit default. Normalised against FILTERS just below.
  homeFilter = currentRoute().filter || "today";

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
    b.addEventListener("click", () => go("home", { filter: b.dataset.f })),
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
  // `filtered` is sorted by createdAt desc, so days are contiguous: emit a
  // separator each time the calendar day changes while walking the list.
  let lastDay = null;
  filtered.forEach((g) => {
    const day = dayKey(g.createdAt);
    if (day !== lastDay) {
      list.appendChild(
        el(
          `<div class="day-separator">${esc(dayHeading(g.createdAt))}</div>`,
        ),
      );
      lastDay = day;
    }
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

/* ---------- Game ---------- */
function renderGame(id) {
  const game = getGame(id);
  if (!game) return go("home");
  // Baseline the elimination + advance trackers on entry so pre-existing state
  // doesn't fire and the first remote change is still caught by the poll diff.
  if (!seenBusts.has(id)) seenBusts.set(id, draftBustSet(game));
  if (!seenAdvance.has(id)) seenAdvance.set(id, advanceFingerprint(game));
  app.innerHTML = "";

  const st = standings(game);
  const w = winner(game);
  // A game with no committed round and no in-progress (pre-saved) draft can be
  // deleted outright — nothing to lose. Otherwise only finished games are
  // deletable (an ongoing game with scores must be cancelled first).
  const isEmpty =
    game.rounds.length === 0 &&
    !game.draftRound &&
    !turnDraftHasData(game.draftTurn);
  const canDelete = !!w || isEmpty;

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
  backRow.querySelector("#back").addEventListener("click", () => goBack());

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
            <button class="kebab-item" id="del"${canDelete ? "" : ' disabled title="Une partie en cours ne peut pas être supprimée — annulez-la d\'abord."'}><i class="fa-regular fa-trash-can"></i> Supprimer</button>
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
    if (!canDelete) return; // disabled for ongoing games with scores
    closeMenu();
    const ok = await confirmDialog({
      title: "Supprimer la partie ?",
      body: w
        ? `« ${game.name} » et ses scores seront définitivement supprimés.`
        : `« ${game.name} » sera définitivement supprimée.`,
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
    // Single team winner (Time's Up!): list its players under the banner.
    const sub =
      ws.length === 1 && ws[0].members && ws[0].members.length
        ? `<div class="banner-sub">${ws[0].members.map((m) => esc(m.name)).join(", ")}</div>`
        : "";
    const banner = game.cancelled
      ? el(
          `<div class="banner banner-cancelled"><i class="fa-regular fa-ban"></i> Partie annulée — ${plural ? "Vainqueurs" : "Vainqueur"} : <b>${names}</b> (${ws[0].total} pts)${sub}</div>`,
        )
      : el(
          `<div class="banner">${confettiMarkup()}<span class="crown"><i class="fa-regular fa-trophy"></i></span> <b>${names}</b> ${plural ? "gagnent" : "gagne"} avec ${ws[0].total} points !${sub}</div>`,
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
    // Bombu: show the active contract card above the scoreboard (like Contrée).
    if (defFor(game).entry === "bombu" && !w && game.pendingContract)
      app.appendChild(wrapPanel(buildBombuContractInfo(game)));
    const summary = document.createElement("app-score-summary");
    summary.game = game;
    // Swipe-to-eliminate writes the round draft → re-render the game screen
    // (refreshes the scoreboard preview and the "Reprendre la saisie" button).
    summary.addEventListener("draftchanged", () => renderGame(id));
    app.appendChild(wrapPanel(summary));
    // Hide score entry once the game is won.
    if (!w) {
      if (defFor(game).entry === "bombu") {
        app.appendChild(buildBombuBar(game));
      } else if (defFor(game).turnBased) {
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
        target: game.target,
        yamsChance: game.yamsChance,
        brutalMode: game.brutalMode,
        teams: game.players, // Time's Up!: carry over teams + their players
        restartOf: game.id, // link the replay so other devices can offer to join
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
  else if (defFor(game).entry === "yams") {
    tableNode = component("app-yams-table");
    // Tapping a filled cell opens the turn editor (change mission and/or value).
    tableNode.addEventListener("editturn", (e) =>
      openYamsEditDialog(getGame(id), e.detail.pid, e.detail.category, () =>
        renderDetails(id),
      ),
    );
  } else if (defFor(game).entry === "bombu")
    tableNode = component("app-bombu-table");
  else if (defFor(game).turnBased) tableNode = component("app-turn-table");
  else tableNode = component("app-score-table");
  app.appendChild(wrapPanel(tableNode));
}

// Details for Yams: a proper scorecard — one row per mission, one column per
// player — with the upper subtotal, the +35 bonus row, and the grand total.
// Filled cells stay editable: upper-section cells take a die count (score =
// count × face), lower-section cells toggle between the mission value and 0.
// Does a draft cell hold any entered data?
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
    { key: "bombu", label: "Bombu" },
  ];
  // Selected version/metric come from the URL ("/[lieu]/stats/[jeu]/[type]");
  // statMode falls back to "flip7", statMetric is validated per-mode in
  // syncMetricControls (reset to "wins" when unavailable for the version).
  const r = currentRoute();
  let statMode = VERSIONS.some((v) => v.key === r.mode) ? r.mode : "flip7";
  let statMetric = r.metric || "wins";
  const controls = el(`
    <div class="date-filter" id="versionFilter">
      ${VERSIONS.map((v) => `<button type="button" data-v="${v.key}" class="${v.key === statMode ? "active" : ""}">${v.label}</button>`).join("")}
    </div>`);
  const versionBtns = controls.querySelectorAll("button");
  versionBtns.forEach((b) =>
    // Navigate so the URL reflects the version; keep the metric if it still
    // exists for the new version, otherwise let it default to "wins".
    b.addEventListener("click", () => {
      const keys = metricsForVersion(b.dataset.v);
      const metric = keys.includes(statMetric) ? statMetric : "wins";
      go("stats", { mode: b.dataset.v, metric });
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
  metricSelect.addEventListener("change", () =>
    go("stats", { mode: statMode, metric: metricSelect.value }),
  );
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
    // "games" already shows the count as its main column — skip the duplicate.
    tableEl.data = { stats, metric, mode: statMode, showGames: statMetric !== "games" };
    content.appendChild(tableEl);
  }

  // Expose the in-place redraw so polling can refresh the table while keeping
  // the selected version/metric filters (closures over statMode/statMetric).
  statsRedraw = draw;
  syncMetricControls(); // finalises statMetric (resets to "wins" if unavailable)
  // Surface the resolved defaults in the URL: a bare "/[lieu]/stats" becomes
  // "/[lieu]/stats/[jeu]/[type]". replaceRoute swaps the URL in place (no extra
  // history entry, no re-render) so it can't loop back into renderStats.
  replaceRoute("stats", { mode: statMode, metric: statMetric });
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

/* ---------- launch screen + boot ---------- */
// The splash (index.html) stays up until BOTH a minimum display time has
// elapsed AND the app has finished booting — whichever is later — then fades
// out. A safety timeout hides it regardless, so a hung boot never traps the
// user behind the splash.
(function startup() {
  const MIN_SPLASH_MS = 2000; // minimum time the splash stays visible
  const SAFETY_MS = 8000; // hard cap: hide even if the boot hangs
  let hidden = false;
  function hideLaunch() {
    if (hidden) return;
    hidden = true;
    clearTimeout(safety);
    const launch = document.getElementById("launch-screen");
    if (!launch) return;
    launch.classList.add("is-hiding"); // CSS fades opacity to 0
    // Drop the node after the fade — transitionend, with a timed fallback in
    // case it doesn't fire.
    launch.addEventListener("transitionend", () => launch.remove(), {
      once: true,
    });
    setTimeout(() => launch.remove(), 700);
  }
  const safety = setTimeout(hideLaunch, SAFETY_MS);
  const minDelay = new Promise((r) => setTimeout(r, MIN_SPLASH_MS));

  (async function boot() {
    app.innerHTML = `<div class="panel-wrap"><div class="empty">Chargement…</div></div>`;
    await fetchPlaces();
    migrateLegacyHash(); // upgrade old "#name?p=" links so the parse below sees the current form
    const r = parsePath(currentHashPath());
    if (r.name === "place" && getSelectedPlace() !== null) {
      // Landing on "/" with a remembered place: jump to its home (updates URL).
      await fetchGames(getSelectedPlace());
      go("home");
    } else {
      await applyLocation();
    }
  })()
    .catch((e) => console.error(e))
    // Hide once the boot settled (success or error) AND the minimum elapsed.
    .finally(async () => {
      await minDelay;
      hideLaunch();
    });
})();
