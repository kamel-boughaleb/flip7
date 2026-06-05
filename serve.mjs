/* Dev server with SPA fallback for path-based routing.
   Serves static files from this folder; any route that isn't a real file falls
   back to index.html (so /[lieu]/stats, /[lieu]/[id]/details… load on refresh).
   Usage: node serve.mjs [port]   (default 4173) */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = process.cwd();
const PORT = Number(process.argv[2]) || 4173;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
};

async function tryFile(p) {
  try {
    const s = await stat(p);
    return s.isFile() ? p : null;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  // Resolve within ROOT (no path traversal).
  const safe = normalize(url).replace(/^(\.\.[/\\])+/, "");
  let file = await tryFile(join(ROOT, safe));
  // Not a real file → SPA fallback to index.html (the client router takes over).
  if (!file) file = join(ROOT, "index.html");
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.listen(PORT, () =>
  console.log(`Dev server (SPA fallback) → http://localhost:${PORT}/`),
);
