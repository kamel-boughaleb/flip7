/* ---------- store ----------
   Supabase client + in-memory game cache (write-through), plus the places
   layer. Shared mutable state (GAMES/PLACES/LOADED_PLACE/db) is owned here;
   the rest of the app only reads it through the exported accessors. */
import { toast } from "./util.js";
import { winner } from "./scoring.js";

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

export {
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
};
