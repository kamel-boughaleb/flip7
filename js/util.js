/* ---------- util ----------
   Pure DOM / formatting helpers, free of app state. Imported across the app. */

// Build a DOM node from an HTML string (first element of the parsed fragment).
export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
// Wrap a node in a gutter-bearing container (so full-width cards keep side margins).
export function wrapPanel(node) {
  const w = el(`<div class="panel-wrap"></div>`);
  w.appendChild(node);
  return w;
}
export function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
export function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
// Human-readable duration, e.g. "1 h 23 min", "12 min 05 s", "45 s".
export function fmtDuration(ms) {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m) return `${m} min ${String(s).padStart(2, "0")} s`;
  return `${s} s`;
}
// e.g. "Partie du lundi 25 mai à 13h30"
export function gameNameFromDate(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const m = String(d.getMinutes()).padStart(2, "0");
  return `Partie du ${date} à ${d.getHours()}h${m}`;
}
export function toast(msg) {
  const t = el(`<div class="toast">${esc(msg)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

// Big fan-card FLIP7 logo (home hero / setup header).
export function logoMarkup() {
  return `
    <div class="flip7-logo">
      <div class="fan">
        <span class="c1"></span><span class="c2"></span><span class="c3"></span><span class="c4"></span><span class="c5"></span>
      </div>
      <div class="logo-text"><span class="flip">FLIP</span><span class="seven">7</span></div>
      <div class="ribbon">TABLEAU DES SCORES</div>
    </div>`;
}

// Confetti burst inside a positioned container.
export function confettiMarkup(n = 14) {
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

// First name that appears twice (case-insensitive, trimmed), or null.
export function firstDuplicateName(names) {
  const seen = new Set();
  for (const n of names) {
    const key = (n || "").trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) return n.trim();
    seen.add(key);
  }
  return null;
}

