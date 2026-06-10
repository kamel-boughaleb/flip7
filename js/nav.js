/* ---------- nav ----------
   Navigation shell: owns the current route + hash plumbing, decoupled from
   rendering. The app registers a render callback via onRender(); screens and
   components navigate with go() without importing back into app.js. */
import {
  parsePath,
  buildPath,
  slugify,
  migrateLegacyPath,
  NO_PLACE_SLUG,
} from "./router.js";
import {
  getSelectedPlace,
  setSelectedPlace,
  fetchGames,
  LOADED_PLACE,
  allPlaces,
} from "./store.js";

let route = { name: "place" };
let renderCb = () => {};
let lastHash = null; // the hash we set ourselves (to ignore our own hashchange)

// "List" screens a game's "Retour" button returns to. We track the last one we
// visited (with its filter / mode-metric) so leaving a game lands back where the
// user came from — e.g. the "all"-filtered list, not the default "today" one.
const LIST_SCREENS = new Set(["home", "stats"]);
let lastListRoute = null;
function rememberList(r) {
  if (r && LIST_SCREENS.has(r.name)) lastListRoute = { ...r };
}

export function currentRoute() {
  return route;
}
export function onRender(cb) {
  renderCb = cb;
}

// The route-path encoded in the current URL (the hash, minus the leading "#").
export function currentHashPath() {
  return location.hash.replace(/^#/, "") || "/";
}

// Resolve a URL place-slug back to a real place name known to the app. Matches
// known places by slug; falls back to a best-effort de-slug for direct links.
export function placeFromSlug(slug) {
  if (slug == null) return null;
  if (slug === NO_PLACE_SLUG) return ""; // the "Sans lieu" bucket
  const hit = allPlaces().find((pl) => slugify(pl) === slug);
  return hit !== undefined ? hit : slug.replace(/-/g, " ");
}

export function go(name, params = {}) {
  route = { name, ...params };
  rememberList(route);
  const place = name === "place" ? null : getSelectedPlace();
  // params may carry id / filter / mode / metric — forward them all to buildPath.
  const hash = "#" + buildPath({ name, place, ...params });
  lastHash = hash;
  if (location.hash !== hash) location.hash = hash; // fires hashchange (ignored)
  renderCb();
  window.scrollTo(0, 0);
}

// Leave a game/details screen back to the last list screen we came from,
// preserving its filter (home) or game-mode/metric (stats). Falls back to the
// games list when there's no remembered list (e.g. a direct deep link).
export function goBack() {
  const { name, ...params } = lastListRoute || { name: "home" };
  go(name, params);
}

// Rewrite the URL to the canonical form of the current route WITHOUT navigating
// (no new history entry, no re-render). Used to surface a screen's implicit
// defaults in the URL — e.g. "/[lieu]/stats" becomes "/[lieu]/stats/flip7/wins"
// once renderStats has resolved the default game-mode/metric. replaceState does
// not fire hashchange, so this never loops back through applyLocation().
export function replaceRoute(name, params = {}) {
  route = { name, ...params };
  const place = name === "place" ? null : getSelectedPlace();
  const hash = "#" + buildPath({ name, place, ...params });
  lastHash = hash;
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

// Rewrite a stale link from the pre-hash-routing scheme ("#home?p=Chalucet",
// "#game/abc?p=Bureau", …) into the current "#/lieu/…" form, in place — no
// history entry, no hashchange. Idempotent: a no-op once the URL is canonical.
export function migrateLegacyHash() {
  const migrated = migrateLegacyPath(currentHashPath());
  if (migrated == null) return;
  const hash = "#" + migrated;
  lastHash = hash;
  history.replaceState(null, "", hash);
}

// Apply the route described by the current URL (back/forward, deep link).
export async function applyLocation() {
  migrateLegacyHash(); // upgrade old "#name?p=" links before parsing
  const r = parsePath(currentHashPath());
  lastHash = location.hash;
  if (r.name !== "place") {
    const place = placeFromSlug(r.placeSlug);
    setSelectedPlace(place);
    // The URL may point to another place: reload its games before rendering.
    if (place !== LOADED_PLACE) await fetchGames(place);
  }
  // route carries everything the parser found except the place slug (resolved
  // above): id for game screens, filter for home, mode/metric for stats.
  const { placeSlug, ...rest } = r;
  route = rest;
  rememberList(route);
  renderCb();
  window.scrollTo(0, 0);
}

// Back/forward or a manual hash edit: re-apply (skip our own go() changes).
window.addEventListener("hashchange", () => {
  if (location.hash === lastHash) return;
  applyLocation();
});
