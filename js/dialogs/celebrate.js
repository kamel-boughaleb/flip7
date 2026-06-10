/* Victory celebration: a full-screen overlay (auto-dismiss after 10s) with a
   randomized message + confetti, shown when a brand-new winner appears. */
import { el, esc, logoMarkup } from "../util.js";
import { winner, winners } from "../scoring.js";
import { MODES } from "../rules.js";
import { openSetupDialog } from "./setup.js";

/* ---------- victory celebration (full screen, 10s, randomized) ---------- */
// Generic victory lines, valid for any game.
const GENERAL_CONGRATS = [
  "Champion incontesté !",
  "Personne ne pouvait t'arrêter !",
  "Une victoire légendaire !",
  "Tu as pulvérisé la concurrence !",
  "Les autres peuvent aller se rhabiller !",
  "Victoire écrasante !",
  "On s'incline devant toi !",
  "Imbattable ce soir !",
  "Un sans-faute de boss !",
  "La chance ? Non, du talent !",
  "Trop fort pour ce monde !",
  "Maître du jeu !",
];

// Game-specific victory lines, keyed by RULESET (so the two Flip 7 variants —
// "classic" and "vengeance" — share the "flip7" lines). Merged with
// GENERAL_CONGRATS at celebration time before the deterministic pick.
const MODE_CONGRATS = {
  flip7: [
    "Génie absolu du Flip 7 !",
    "Royauté du Flip 7 !",
    "Tu as flippé jusqu'au bout !",
    "Stop au moment parfait !",
    "Le 7e flip était pour toi !",
  ],
  skyjo: [
    "Roi du Skyjo !",
    "Le moins de points, le plus de classe !",
    "Tu as vidé ton jeu en beauté !",
    "Colonnes nettoyées, victoire assurée !",
  ],
  qwirkle: [
    "Maître des formes et des couleurs !",
    "Qwirkle parfait !",
    "Tu as aligné la victoire !",
  ],
  timesup: [
    "La pendule était de ton côté !",
    "Time's Up… mais pas pour toi !",
    "Champion du chrono !",
  ],
  contree: [
    "Maître de la Contrée !",
    "Contrat rempli, partie pliée !",
    "Capot pour les autres !",
    "Annonce tenue, victoire méritée !",
  ],
  yams: [
    "Yam's ! Et la victoire avec !",
    "Les dés t'ont tout donné !",
    "Cinq dés, zéro pitié !",
    "Maître des combinaisons !",
  ],
  bombu: [
    "Tu as déjoué tous les contrats !",
    "Le Roi ♥ ne t'a jamais eu !",
    "Maître du Bombu !",
    "Aucun pli de trop pour toi !",
  ],
};
// Shown when several players/teams tie for the win.
const TIE_CONGRATS = [
  "Égalité parfaite !",
  "Ex æquo !",
  "Impossible de les départager !",
  "À égalité au sommet !",
  "Tout le monde sur la plus haute marche !",
];

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

// Deterministic 32-bit hash of a string (FNV-1a). Lets every device seed the
// message and animation from the shared game.id, so the celebration screen
// is identical across the party instead of each device picking at random.
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function celebrate(game) {
  const ws = winners(game);
  if (!ws.length) return;
  const tie = ws.length > 1;
  // Pool = generic lines + the current game's ruleset-specific lines, so a
  // Skyjo win can't surface a Flip 7 message. Ties keep their own generic pool.
  const family = (MODES[game.mode] || {}).ruleset || "flip7";
  const pool = tie
    ? TIE_CONGRATS
    : [...GENERAL_CONGRATS, ...(MODE_CONGRATS[family] || [])];
  // Seed from the shared game id; different bit-shifts decorrelate the message
  // and animation picks while keeping them identical on every device.
  const seed = hashStr(game.id || "");
  const text = pool[seed % pool.length];
  const names = ws.map((p) => esc(p.name)).join(" & ");
  // Single team winner (Time's Up!): show its players under the team name.
  const sub =
    !tie && ws[0].members && ws[0].members.length
      ? `<div class="cel-name-sub">${ws[0].members.map((m) => esc(m.name)).join(", ")}</div>`
      : "";
  const variant = "cel-v" + (1 + ((seed >>> 16) % 5)); // animation, same seed
  const overlay = el(`
    <div class="celebrate ${variant}">
      ${celConfettiMarkup()}
      <div class="cel-inner">
        <div class="cel-logo">${logoMarkup()}</div>
        <div class="cel-title">${esc(text)}</div>
        <div class="cel-name">${names}</div>
        ${sub}
        <div class="cel-score">${ws[0].total} points <i class="fa-regular fa-trophy"></i></div>
        <div class="cel-actions">
          <button class="btn btn-primary cel-close">Continuer</button>
          <button class="btn btn-ghost cel-restart"><i class="fa-regular fa-arrows-rotate"></i> Rejouer</button>
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
        brutalMode: game.brutalMode,
        teams: game.players, // Time's Up!: carry over teams + their players
        restartOf: game.id, // link the replay so other devices can offer to join
      });
      return;
    }
    remove();
  });
  document.body.appendChild(overlay);
}

// Compare winner before/after a score change; celebrate a brand-new win
// (including ties — the celebration lists every tied player/team). A cancelled
// game has a "winner" (the leader it's awarded to) but must never celebrate.
function celebrateIfNewWinner(beforeWinnerId, game) {
  if (game.cancelled) return;
  const w = winner(game);
  if (w && w.id !== beforeWinnerId) celebrate(game);
}

export { celebrate, celebrateIfNewWinner };
