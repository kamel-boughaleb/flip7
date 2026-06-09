/* Victory celebration: a full-screen overlay (auto-dismiss after 10s) with a
   randomized message + confetti, shown when a brand-new winner appears. */
import { el, esc } from "../util.js";
import { winner, winners } from "../scoring.js";
import { openSetupDialog } from "./setup.js";

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
  // Single team winner (Time's Up!): show its players under the team name.
  const sub =
    !tie && ws[0].members && ws[0].members.length
      ? `<div class="cel-name-sub">${ws[0].members.map((m) => esc(m.name)).join(", ")}</div>`
      : "";
  const variant = "cel-v" + (1 + Math.floor(Math.random() * 5)); // random animation
  const overlay = el(`
    <div class="celebrate ${variant}">
      ${celConfettiMarkup()}
      <div class="cel-inner">
        <div class="cel-emoji">${emoji}</div>
        <div class="cel-title">${esc(text)}</div>
        <div class="cel-name">${names}</div>
        ${sub}
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
        target: game.target,
        yamsChance: game.yamsChance,
        teams: game.players, // Time's Up!: carry over teams + their players
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

export { celebrate, celebrateIfNewWinner };
