/* ---------- router ----------
   Hash-based routing. The route lives in the URL fragment, so the real document
   path stays at the app root — refresh/share works on any host with zero server
   config (no SPA fallback, no .htaccess needed):

     #/                       → place        (place picker)
     #/[lieu]/                → home         (games list)
     #/[lieu]/stats           → stats
     #/[lieu]/[id]            → game
     #/[lieu]/[id]/details    → details
     #/[lieu]/[id]/entry      → entry         (legacy score-entry screen)

   Place names are slugged for the URL (spaces → "-"). Slugs need not be
   reversible: the app resolves a slug back to a real place name by matching the
   slugs of the places it knows. "" (the "Sans lieu" bucket) uses a sentinel. */

export const NO_PLACE_SLUG = "sans-lieu"; // URL segment for the empty/"" place

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
  if (b === undefined) return { name: "home", placeSlug };
  if (b === "stats") return { name: "stats", placeSlug };
  if (c === "details") return { name: "details", placeSlug, id: b };
  if (c === "entry") return { name: "entry", placeSlug, id: b };
  return { name: "game", placeSlug, id: b };
}

// Pure: route → route-path (the part after "#"). Place screen / null place → "/".
export function buildPath({ name, place, id } = {}) {
  if (name === "place" || place == null) return "/";
  const slug = place === "" ? NO_PLACE_SLUG : slugify(place);
  const p = encodeURIComponent(slug).replace(/%2D/gi, "-"); // keep "-" readable
  if (name === "stats") return `/${p}/stats`;
  if (name === "details" && id) return `/${p}/${encodeURIComponent(id)}/details`;
  if (name === "entry" && id) return `/${p}/${encodeURIComponent(id)}/entry`;
  if (name === "game" && id) return `/${p}/${encodeURIComponent(id)}`;
  return `/${p}/`; // home (and any name without the data it needs)
}
