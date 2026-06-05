/* ---------- router ----------
   Path-based routing via the History API. URL structure (after the deploy base):

     <base>                       → place        (place picker)
     <base>[lieu]/                → home         (games list)
     <base>[lieu]/stats           → stats
     <base>[lieu]/[id]            → game
     <base>[lieu]/[id]/details    → details
     <base>[lieu]/[id]/entry      → entry         (legacy score-entry screen)

   The deploy base is whatever <base href> resolves to (e.g. "/" at the domain
   root, "/flip7/" under a MAMP subfolder). It is read once from document.baseURI
   so the single source of truth is the <base> tag in index.html.

   Place names are slugged for the URL (spaces → "-"). Slugs need not be
   reversible: the app resolves a slug back to a real place name by matching the
   slugs of the places it knows. "" (the "Sans lieu" bucket) uses a sentinel. */

export const NO_PLACE_SLUG = "sans-lieu"; // URL segment for the empty/"" place

// Deploy base path, always with a trailing slash (e.g. "/" or "/flip7/").
function detectBase() {
  if (typeof document === "undefined" || !document.baseURI) return "/";
  try {
    let b = new URL(document.baseURI).pathname;
    return b.endsWith("/") ? b : b + "/";
  } catch {
    return "/";
  }
}
const BASE = detectBase();

// Strip the deploy base, returning an app-relative pathname starting with "/".
function stripBase(pathname) {
  const p = pathname || "/";
  if (BASE === "/") return p;
  if (p === BASE || p === BASE.slice(0, -1)) return "/";
  return p.startsWith(BASE) ? "/" + p.slice(BASE.length) : p;
}
// Prepend the deploy base to an app-relative pathname (starting with "/").
function withBase(path) {
  if (BASE === "/") return path;
  return path === "/" ? BASE : BASE.slice(0, -1) + path;
}

// Slug a place name for the URL: trim, then collapse spaces to "-".
export function slugify(name) {
  return String(name == null ? "" : name)
    .trim()
    .replace(/\s+/g, "-");
}

function decodeSegments(pathname) {
  return String(pathname || "/")
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

// Pure: pathname → { name, placeSlug?, id? }. `placeSlug` is the raw URL segment
// (the app resolves it to a real place name — it owns the place list).
export function parsePath(pathname) {
  const seg = decodeSegments(stripBase(pathname));
  if (!seg.length) return { name: "place" };
  const [placeSlug, b, c] = seg;
  if (b === undefined) return { name: "home", placeSlug };
  if (b === "stats") return { name: "stats", placeSlug };
  if (c === "details") return { name: "details", placeSlug, id: b };
  if (c === "entry") return { name: "entry", placeSlug, id: b };
  return { name: "game", placeSlug, id: b };
}

// Pure: route → pathname (deploy base included). The place screen (or a null
// place) maps to the base itself.
export function buildPath({ name, place, id } = {}) {
  if (name === "place" || place == null) return withBase("/");
  const slug = place === "" ? NO_PLACE_SLUG : slugify(place);
  const p = encodeURIComponent(slug).replace(/%2D/gi, "-"); // keep "-" readable
  if (name === "stats") return withBase(`/${p}/stats`);
  if (name === "details" && id) return withBase(`/${p}/${encodeURIComponent(id)}/details`);
  if (name === "entry" && id) return withBase(`/${p}/${encodeURIComponent(id)}/entry`);
  if (name === "game" && id) return withBase(`/${p}/${encodeURIComponent(id)}`);
  return withBase(`/${p}/`); // home (and any name without the data it needs)
}
