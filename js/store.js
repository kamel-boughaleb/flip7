/* ---------- store ----------
   Supabase client + in-memory game cache (write-through), plus the places
   layer. Shared mutable state (GAMES/PLACES/LOADED_PLACE/db) is owned here;
   the rest of the app only reads it through the exported accessors. */
import { toast } from "./util.js";
import { winner } from "./scoring.js";
import { unitKeyOf, rulesetOf } from "./rules.js";

// Single shared store for every game type (legacy key kept for back-compat).
const STORE_KEY = "flip7_games";


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
  const fresh = (data || []).map((r) => r.data).filter(Boolean);
  // Keep the local (not-yet-confirmed) version of any game still being written,
  // so this fetch can't revert it to a stale server state mid-save.
  const dirty = pendingWriteIds();
  if (dirty.size) {
    const keep = GAMES.filter((g) => dirty.has(g.id));
    GAMES = fresh.filter((g) => !dirty.has(g.id)).concat(keep);
  } else {
    GAMES = fresh;
  }
  // Prune authored-bust markers down to what's still busted in the synced state:
  // a deal committed or a player restored elsewhere should no longer be treated
  // as a local bust (else a later remote re-elimination would be suppressed).
  localBusts.forEach((set, id) => {
    const live = bustSetOf(getGame(id));
    set.forEach((pid) => live.has(pid) || set.delete(pid));
    if (!set.size) localBusts.delete(id);
  });
}

/* ---------- locally-authored eliminations ----------
   The set of players THIS device has marked eliminated in each game's
   in-progress draft. The polling loop uses it to suppress the elimination flash
   for the emitting device — the flash is meant for the OTHER players' screens.
   Updated synchronously on every local write (upsertGame), so it is correct
   even when a swipe lands during a poll's await; pruned on fetchGames so a
   remote commit/restore that clears a bust drops it (no stale suppression). */
const localBusts = new Map(); // game id -> Set<pid>
function bustSetOf(game) {
  const s = new Set();
  const d = game && game.draftRound;
  if (d) for (const pid in d) if (d[pid] && d[pid].bust) s.add(pid);
  return s;
}
function localBustSet(id) {
  return localBusts.get(id) || new Set();
}

// Fingerprint of the "advance" state — round count, pending contract/bid,
// starter, dealer — so the polling loop can tell a progression THIS device
// triggered (committed a round/turn, announced a contract) from one another
// device did. The advance toast is for the other players, not the emitter.
function advanceFingerprint(game) {
  if (!game) return "";
  return JSON.stringify({
    r: (game.rounds || []).length,
    c: game.pendingContract || null,
    b: game.pendingBid || null,
    s: game.starter || null,
    d: game.dealer || null,
  });
}
const localAdvance = new Map(); // game id -> fingerprint last written here
function localAdvanceSig(id) {
  return localAdvance.get(id) || "";
}

function loadGames() {
  return [...GAMES].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function getGame(id) {
  return GAMES.find((g) => g.id === id);
}
// The most recent game created as a replay of `id` (via the celebration's
// "Rejouer" button, which stamps restartOf), or undefined. Lets a device still
// on the finished game offer to join the new one.
function replayOf(id) {
  return loadGames().find((g) => g.restartOf === id);
}

/* ---------- write serialization ----------
   Supabase upserts are fire-and-forget, so two concurrent writes to the same
   row can land out of order — e.g. a debounced draft save overtaking the commit
   that cleared it, resurrecting stale state (the "scores didn't really send"
   bug). We keep at most one request in flight per game and always (re)send the
   latest snapshot, so the server converges to the most recent local state. */
const writers = new Map(); // game id -> { inFlight: bool, pending: data|null }

// Games with an unconfirmed local write (queued or in flight). fetchGames keeps
// the local version of these so a poll can't revert the UI to stale server data.
function pendingWriteIds() {
  const ids = new Set();
  writers.forEach((w, id) => {
    if (w.inFlight || w.pending != null) ids.add(id);
  });
  return ids;
}
function flushWrite(id) {
  const w = writers.get(id);
  if (!w || w.inFlight || w.pending == null) return;
  const data = w.pending;
  w.pending = null;
  w.inFlight = true;
  db.from("games")
    .upsert({ id, data })
    .then(({ error }) => {
      w.inFlight = false;
      if (error) {
        console.error(error);
        toast("Erreur d'enregistrement");
      }
      // A newer state may have queued while this was in flight — send it next.
      if (w.pending != null) flushWrite(id);
      else writers.delete(id);
    });
}
function upsertGame(game) {
  const i = GAMES.findIndex((g) => g.id === game.id);
  if (i >= 0) GAMES[i] = game;
  else GAMES.push(game);
  // This device authored the current state, so its busts and advance state are
  // "local" — recorded so the polling loop won't flash/toast them back at the
  // emitter.
  localBusts.set(game.id, bustSetOf(game));
  localAdvance.set(game.id, advanceFingerprint(game));
  if (!db) return localSave();
  // Snapshot the state at call time so each queued write carries its own data.
  const data = JSON.parse(JSON.stringify(game));
  let w = writers.get(game.id);
  if (!w) writers.set(game.id, (w = { inFlight: false, pending: null }));
  w.pending = data; // coalesce: only the latest state needs to reach the server
  flushWrite(game.id);
}
// Cancel a queued (not-yet-sent) write for a game. Used when a score dialog is
// closed because the round was committed elsewhere: we must not push the now
// stale draft back over the freshly committed state.
function dropPendingWrite(id) {
  const w = writers.get(id);
  if (!w) return;
  w.pending = null;
  if (!w.inFlight) writers.delete(id);
}
async function deleteGame(id) {
  GAMES = GAMES.filter((g) => g.id !== id);
  const w = writers.get(id);
  if (w) w.pending = null; // drop any queued write for this game
  if (!db) return localSave();
  // Wait out an in-flight write so it can't recreate the row after the delete.
  while (writers.get(id) && writers.get(id).inFlight)
    await new Promise((r) => setTimeout(r, 50));
  writers.delete(id);
  const { error } = await db.from("games").delete().eq("id", id);
  if (error) {
    console.error(error);
    toast("Erreur de suppression");
  }
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

// Distinct player (or team) names seen at a place, for entry autocompletion.
// Team-builder games (Time's Up!) store teams whose members are players, so a
// "joueur" pool gathers those members and an "equipe" pool the team names.
function placePlayerNames(place, unit = "joueur") {
  const seen = new Map(); // lowercased -> original casing
  const add = (n) => {
    const t = (n || "").trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  };
  gamesForPlace(place).forEach((g) => {
    if (rulesetOf(g.mode).teamBuilder) {
      g.players.forEach((t) => {
        if (unit === "joueur") (t.members || []).forEach((m) => add(m.name));
        else add(t.name);
      });
    } else if (unitKeyOf(g.mode) === unit) {
      g.players.forEach((p) => add(p.name));
    }
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "fr"));
}

export {
  db,
  placePlayerNames,
  LOADED_PLACE,
  fetchPlaces,
  fetchGames,
  getGame,
  replayOf,
  upsertGame,
  localBustSet,
  advanceFingerprint,
  localAdvanceSig,
  dropPendingWrite,
  deleteGame,
  uid,
  getSelectedPlace,
  setSelectedPlace,
  addLocalPlace,
  placeLabel,
  allPlaces,
  gamesForPlace,
};
