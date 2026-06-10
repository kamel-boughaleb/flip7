/* ---------- router ----------
   Hash-based routing. The route lives in the URL fragment, so the real document
   path stays at the app root — refresh/share works on any host with zero server
   config (no SPA fallback, no .htaccess needed):

     #/                          → place      (place picker)
     #/[lieu]/                   → home       (games list, "today" filter)
     #/[lieu]/[filter]           → home       (filter ∈ week|month|all)
     #/[lieu]/stats              → stats
     #/[lieu]/stats/[jeu]        → stats       (game-mode filter)
     #/[lieu]/stats/[jeu]/[type] → stats       (game-mode + metric filter)
     #/[lieu]/[id]               → game
     #/[lieu]/[id]/details       → details
     #/[lieu]/[id]/entry         → entry       (legacy score-entry screen)

   Place names are slugged for the URL (spaces → "-"). Slugs need not be
   reversible: the app resolves a slug back to a real place name by matching the
   slugs of the places it knows. "" (the "Sans lieu" bucket) uses a sentinel. */

export const NO_PLACE_SLUG = "sans-lieu"; // URL segment for the empty/"" place

// Home date-filter keywords reserved as the second URL segment. "today" is the
// default and stays implicit ("/[lieu]/"), so it isn't listed here — only these
// produce a segment, and they can never collide with a game id (uid is base36).
export const HOME_FILTERS = ["week", "month", "all"];

// Slug a place name for the URL: trim, then collapse spaces to "-".
export function slugify(name) {
  return String(name == null ? "" : name)
    .trim()
    .replace(/\s+/g, "-");
}

function decodeSegments(routePath) {
  return String(routePath || "/")
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

// Pure: route-path ("/lieu/id/…", i.e. the hash without "#") → { name, … }.
export function parsePath(routePath) {
  const seg = decodeSegments(routePath);
  if (!seg.length) return { name: "place" };
  const [placeSlug, b, c] = seg;
  if (b === undefined) return { name: "home", placeSlug, filter: "today" };
  if (HOME_FILTERS.includes(b)) return { name: "home", placeSlug, filter: b };
  // stats: optional /[jeu] then /[type] (statMode / statMetric).
  if (b === "stats") return { name: "stats", placeSlug, mode: c, metric: seg[3] };
  if (c === "details") return { name: "details", placeSlug, id: b };
  if (c === "entry") return { name: "entry", placeSlug, id: b };
  return { name: "game", placeSlug, id: b };
}

// Pure: route → route-path (the part after "#"). Place screen / null place → "/".
export function buildPath({ name, place, id, filter, mode, metric } = {}) {
  if (name === "place" || place == null) return "/";
  const slug = place === "" ? NO_PLACE_SLUG : slugify(place);
  const p = encodeURIComponent(slug).replace(/%2D/gi, "-"); // keep "-" readable
  if (name === "stats") {
    let path = `/${p}/stats`;
    if (mode) path += `/${encodeURIComponent(mode)}`;
    if (mode && metric) path += `/${encodeURIComponent(metric)}`;
    return path;
  }
  if (name === "details" && id) return `/${p}/${encodeURIComponent(id)}/details`;
  if (name === "entry" && id) return `/${p}/${encodeURIComponent(id)}/entry`;
  if (name === "game" && id) return `/${p}/${encodeURIComponent(id)}`;
  // home: "today" is the default and stays implicit ("/[lieu]/").
  if (name === "home" && HOME_FILTERS.includes(filter))
    return `/${p}/${encodeURIComponent(filter)}`;
  return `/${p}/`; // home (and any name without the data it needs)
}

// Routes the legacy scheme exposed before the hash router. Anything else falls
// back to "home" (the place's games list).
const LEGACY_NAMES = new Set(["home", "stats", "game", "details", "entry"]);

// Pure: map a stale route-path from the pre-hash-routing scheme to the current
// one, or null when the path is already in the current form (so the caller can
// leave it alone).
//
// Old scheme: the route name leads and the place rides in a "?p=" query param —
//   "home?p=Chalucet" · "game/abc?p=Bureau" · "stats?p=Maison" · "place".
// Current scheme always leads with "/" (the place slug), so any path that does
// not is treated as legacy. The empty/missing place maps to "/" (place picker).
export function migrateLegacyPath(routePath) {
  const raw = String(routePath || "");
  if (raw === "" || raw.startsWith("/")) return null; // already current form
  const [pathPart, queryPart] = raw.split("?");
  const [name, id] = pathPart.split("/");

  let place = null;
  if (queryPart) {
    const params = new URLSearchParams(queryPart);
    if (params.has("p")) place = params.get("p"); // already URI-decoded
  }
  if (place == null) return "/"; // no "?p=" (e.g. "#place") → place picker

  // Reuse buildPath so slugging/encoding/the "Sans lieu" sentinel stay in sync.
  return buildPath({ name: LEGACY_NAMES.has(name) ? name : "home", place, id });
}
