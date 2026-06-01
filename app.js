/* Flip 7 Scoreboard — vanilla JS.
   Shared persistence via Supabase, with a localStorage fallback when unconfigured. */

const STORE_KEY = "flip7_games";
const FLIP7_BONUS = 15;
const DEFAULT_TARGET = 200;

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
      "[Flip7] Supabase non configuré — stockage local (données non partagées). Renseignez config.js."
    );
    return null;
  }
  return window.supabase.createClient(cfg.url, cfg.anonKey);
}
const db = makeClient();

/* ---------- storage: in-memory cache, write-through to Supabase ---------- */
let GAMES = [];

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

// Load all games from the server (or localStorage) into the cache.
async function fetchGames() {
  if (!db) {
    GAMES = localLoad();
    return;
  }
  const { data, error } = await db.from("games").select("id, data");
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
const PLACE_KEY = "flip7_place";    // currently selected place (name; "" = Sans lieu)
const PLACES_KEY = "flip7_places";  // places added on this device (may have no games yet)

function getSelectedPlace() {
  const v = localStorage.getItem(PLACE_KEY);
  return v === null ? null : v; // null = nothing chosen yet
}
function setSelectedPlace(name) {
  localStorage.setItem(PLACE_KEY, name == null ? "" : name);
}
function localPlaces() {
  try { return JSON.parse(localStorage.getItem(PLACES_KEY)) || []; } catch { return []; }
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
  let hasNoPlace = false;
  GAMES.forEach((g) => {
    const n = (g.place || "").trim();
    if (n) map.set(n.toLowerCase(), n);
    else hasNoPlace = true;
  });
  localPlaces().forEach((n) => {
    const t = n.trim();
    if (t) map.set(t.toLowerCase(), t);
  });
  const list = [...map.values()].sort((a, b) => a.localeCompare(b, "fr"));
  if (hasNoPlace) list.unshift("");
  return list;
}
function gamesForPlace(place) {
  const key = (place || "").trim().toLowerCase();
  return loadGames().filter((g) => (g.place || "").trim().toLowerCase() === key);
}

/* ---------- scoring ---------- */
// A cell is { points: number, flip7: boolean, bust: boolean }
function cellValue(cell) {
  if (!cell || cell.bust) return 0;
  const pts = Number(cell.points) || 0;
  return pts + (cell.flip7 ? FLIP7_BONUS : 0);
}
function playerTotal(game, playerId) {
  return game.rounds.reduce((sum, r) => sum + cellValue(r.scores[playerId]), 0);
}
function standings(game) {
  return game.players
    .map((p) => ({ ...p, total: playerTotal(game, p.id) }))
    .sort((a, b) => b.total - a.total);
}
function winner(game) {
  const s = standings(game);
  if (s.length && s[0].total >= game.target) return s[0];
  return null;
}

/* ---------- router ---------- */
const app = document.getElementById("app");
let route = { name: "place" };
let pollTimer = null;

function go(name, params = {}) {
  route = { name, ...params };
  render();
  window.scrollTo(0, 0); // always start a new screen at the top
}

document.getElementById("homeBtn").addEventListener("click", () => go("home"));
document.getElementById("placeBtn").addEventListener("click", () => go("place"));

// Top-left button showing the current place (hidden on the place screen / before a place is set).
function updatePlaceBtn() {
  const btn = document.getElementById("placeBtn");
  if (!btn) return;
  const place = getSelectedPlace();
  if (place !== null && route.name !== "place") {
    btn.textContent = "📍 " + placeLabel(place);
    btn.hidden = false;
  } else {
    btn.hidden = true;
  }
}

function render() {
  stopPolling();
  updatePlaceBtn();
  if (route.name === "place") return renderPlace();
  if (route.name === "rules") return renderRules();
  if (route.name === "home") return renderHome();
  if (route.name === "setup") return renderSetup();
  if (route.name === "stats") return renderStats();
  if (route.name === "entry") return renderEntry(route.id);
  if (route.name === "game") {
    renderGame(route.id);
    startPolling(route.id); // live-refresh the board every 2s
    return;
  }
  if (route.name === "details") {
    renderDetails(route.id);
    startPolling(route.id);
    return;
  }
  renderHome();
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
function startPolling(id) {
  stopPolling();
  if (!db) return; // nothing to sync from in local mode
  const onScoreScreen = () => route.name === "game" || route.name === "details";
  pollTimer = setInterval(async () => {
    if (!onScoreScreen() || route.id !== id) return stopPolling();
    // don't disrupt an in-progress edit on the details screen
    const ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("cell-input")) return;
    const before = JSON.stringify(getGame(id) || null);
    await fetchGames();
    if (!onScoreScreen() || route.id !== id) return;
    const after = JSON.stringify(getGame(id) || null);
    if (after !== before) {
      route.name === "details" ? renderDetails(id) : renderGame(id);
    }
  }, 2000);
}

/* ---------- helpers ---------- */
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}
// e.g. "Partie du lundi 25 mai à 13h30"
function gameNameFromDate(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const m = String(d.getMinutes()).padStart(2, "0");
  return `Partie du ${date} à ${d.getHours()}h${m}`;
}
function toast(msg) {
  const t = el(`<div class="toast">${esc(msg)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

// Big fan-card FLIP7 logo (home hero / setup header)
function logoMarkup() {
  return `
    <div class="flip7-logo">
      <div class="fan">
        <span class="c1"></span><span class="c2"></span><span class="c3"></span><span class="c4"></span><span class="c5"></span>
      </div>
      <div class="logo-text"><span class="flip">FLIP</span><span class="seven">7</span></div>
      <div class="ribbon">TABLEAU DES SCORES</div>
    </div>`;
}

// Confetti burst inside a positioned container
function confettiMarkup(n = 14) {
  const colors = ["var(--gold)", "var(--coral)", "var(--teal)", "var(--sky)", "var(--gold-dark)"];
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
const CEL_EMOJIS = ["🎉", "🏆", "🥳", "🎊", "👑", "🌟", "🔥", "💪", "🚀", "🤩"];

function celConfettiMarkup(n = 70) {
  const colors = [
    "var(--gold)", "var(--coral)", "var(--teal)", "var(--sky)",
    "var(--gold-dark)", "var(--coral-light)", "var(--teal-light)",
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

function celebrate(w) {
  const text = CONGRATS[Math.floor(Math.random() * CONGRATS.length)];
  const emoji = CEL_EMOJIS[Math.floor(Math.random() * CEL_EMOJIS.length)];
  const variant = "cel-v" + (1 + Math.floor(Math.random() * 5)); // random animation
  const overlay = el(`
    <div class="celebrate ${variant}">
      ${celConfettiMarkup()}
      <div class="cel-inner">
        <div class="cel-emoji">${emoji}</div>
        <div class="cel-title">${esc(text)}</div>
        <div class="cel-name">${esc(w.name)}</div>
        <div class="cel-score">${w.total} points 🏆</div>
        <button class="btn btn-primary cel-close">Continuer</button>
      </div>
    </div>`);
  let done = false;
  const remove = () => { if (done) return; done = true; clearTimeout(timer); overlay.remove(); };
  const timer = setTimeout(remove, 10000); // auto-dismiss after 10s
  overlay.addEventListener("click", remove); // tap anywhere to skip
  document.body.appendChild(overlay);
}

// Compare winner before/after a score change; celebrate a brand-new win.
function celebrateIfNewWinner(beforeWinnerId, game) {
  const w = winner(game);
  if (w && w.id !== beforeWinnerId) celebrate(w);
}

function confirmDialog({ title, body, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    const overlay = el(`
      <div class="overlay">
        <div class="modal">
          <h3>${esc(title)}</h3>
          <p>${esc(body)}</p>
          <div class="row">
            <button class="btn btn-ghost" data-act="cancel">Cancel</button>
            <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="ok">${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>`);
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
      const act = e.target.getAttribute("data-act");
      if (act === "cancel") close(false);
      if (act === "ok") close(true);
    });
    root.appendChild(overlay);
  });
}

function promptDialog({ title, label, placeholder = "", confirmLabel = "Ajouter" }) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    const overlay = el(`
      <div class="overlay">
        <div class="modal">
          <h3>${esc(title)}</h3>
          <div class="field">
            <label>${esc(label)}</label>
            <input type="text" id="promptInput" placeholder="${esc(placeholder)}" />
          </div>
          <div class="row">
            <button class="btn btn-ghost" data-act="cancel">Annuler</button>
            <button class="btn btn-primary" data-act="ok">${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>`);
    const input = overlay.querySelector("#promptInput");
    const close = (val) => { overlay.remove(); resolve(val); };
    const submit = () => close(input.value.trim() || null);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
      const act = e.target.getAttribute("data-act");
      if (act === "cancel") close(null);
      if (act === "ok") submit();
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    root.appendChild(overlay);
    setTimeout(() => input.focus(), 30);
  });
}

async function promptNewPlace() {
  const name = await promptDialog({
    title: "Ajouter un lieu",
    label: "Nom du lieu",
    placeholder: "ex. Maison, Bureau, Chalet…",
  });
  if (!name) return false;
  addLocalPlace(name);
  setSelectedPlace(name);
  return true;
}

/* ---------- Rules ---------- */
let rulesTab = "classic";

function rulesClassicHTML() {
  return `
    <h3>🎯 But du jeu</h3>
    <p>Être le premier joueur à atteindre <b>200 points</b>, cumulés sur plusieurs manches.</p>

    <h3>🃏 Les cartes</h3>
    <ul>
      <li><b>Cartes numéro (0 à 12)</b> : il y a autant d'exemplaires d'un chiffre que sa valeur (douze « 12 », onze « 11 »… un seul « 1 »), plus une unique carte « 0 ».</li>
      <li><b>Cartes modificateur</b> : +2, +4, +6, +8, +10 et ×2.</li>
      <li><b>Cartes action</b> : Gel, Pioche Trois et Seconde Chance.</li>
    </ul>

    <h3>🔄 Déroulement d'une manche</h3>
    <p>À tour de rôle, chaque joueur choisit de <b>piocher</b> une carte de plus ou de <b>s'arrêter</b> pour banquer ses points. Une fois arrêté ou éliminé, il ne joue plus jusqu'à la manche suivante.</p>

    <h3>💥 Cartes numéro &amp; élimination</h3>
    <ul>
      <li>Chaque carte numéro vaut sa valeur faciale.</li>
      <li>Si vous piochez un chiffre que vous <b>possédez déjà</b> (doublon), vous êtes <b>éliminé</b> : 0 point pour la manche… sauf si vous avez une Seconde Chance.</li>
    </ul>

    <h3>⭐ Le Flip 7</h3>
    <p>Réunir <b>7 cartes numéro différentes</b> déclenche un « Flip 7 » : la manche se termine aussitôt et vous gagnez <b>+15 points</b> de bonus.</p>

    <h3>➕ Cartes modificateur</h3>
    <ul>
      <li><b>+2 / +4 / +6 / +8 / +10</b> : ajoutent leur valeur à votre total de la manche.</li>
      <li><b>×2</b> : double la somme de vos cartes numéro (les cartes « + » s'ajoutent ensuite).</li>
    </ul>

    <h3>🎬 Cartes action</h3>
    <ul>
      <li><b>Gel</b> : un joueur que vous désignez doit s'arrêter immédiatement et banquer ses points.</li>
      <li><b>Pioche Trois</b> : un joueur doit piocher trois cartes d'affilée.</li>
      <li><b>Seconde Chance</b> : vous protège d'un doublon (vous le défaussez au lieu d'être éliminé). Si vous en recevez une deuxième, donnez-la à un joueur qui n'en a pas.</li>
    </ul>

    <h3>🏁 Fin de la manche</h3>
    <p>La manche s'arrête quand tous les joueurs se sont arrêtés ou éliminés, ou dès qu'un joueur réalise un Flip 7. Score de chacun : somme des cartes numéro (doublée si ×2) + modificateurs + 15 si Flip 7. Un joueur éliminé marque 0.</p>

    <h3>🏆 Fin de la partie</h3>
    <p>Dès qu'un joueur atteint <b>200 points</b> au total, il gagne. Si plusieurs franchissent 200 dans la même manche, le <b>plus haut total</b> l'emporte.</p>

    <h3>📱 Dans cette application</h3>
    <ul>
      <li>Saisissez le total de chaque joueur pour chaque manche.</li>
      <li>Cochez <b>« Flip 7 (+15) »</b> pour ajouter le bonus, ou <b>« Éliminé »</b> pour marquer 0.</li>
    </ul>`;
}

function rulesVengeanceHTML() {
  return `
    <p class="rules-intro"><b>Flip 7 : With a Vengeance</b> est la suite de Flip 7. Le principe ne change pas (premier à <b>200 points</b>), mais le jeu ajoute des cartes plus chaotiques. Les bases (tours, élimination sur doublon, Flip 7 = +15) restent celles de l'onglet <b>Flip 7 Classic</b> — voici ce qui est <b>nouveau</b>.</p>

    <h3>🔢 Nouvelles cartes numéro</h3>
    <ul>
      <li><b>Le 13</b> : les chiffres montent désormais jusqu'à 13 (treize cartes « 13 »).</li>
      <li><b>13 chanceux</b> : vous pouvez posséder <b>deux « 13 »</b> sans être éliminé ; un troisième vous élimine.</li>
      <li><b>Zéro (spécial)</b> : votre total de la manche devient <b>0</b>, et vous êtes obligé de continuer à piocher jusqu'à réaliser un Flip 7.</li>
      <li><b>7 malchanceux</b> : vous défaussez toutes vos cartes numéro et modificateur ; il ne vous reste que ce 7.</li>
    </ul>

    <h3>➕ Nouveaux modificateurs</h3>
    <ul>
      <li><b>÷2 (divisé par deux)</b> : divise par deux la somme de vos cartes numéro, <b>avant</b> les autres modificateurs (arrondi à l'inférieur).</li>
      <li><b>Modificateurs négatifs</b> : soustraient leur valeur de votre score.</li>
    </ul>

    <h3>🎬 Nouvelles cartes action</h3>
    <ul>
      <li><b>Encore une</b> : un joueur pioche une carte, puis s'arrête immédiatement.</li>
      <li><b>Échanger</b> : deux joueurs échangent une de leurs cartes face visible.</li>
      <li><b>Voler</b> : prenez une carte face visible d'un autre joueur.</li>
      <li><b>Défausser</b> : un joueur défausse une de ses cartes.</li>
      <li><b>Pioche Quatre</b> : un joueur pioche quatre cartes d'affilée (s'arrête s'il est éliminé ou réalise un Flip 7).</li>
    </ul>

    <h3>🧮 Calcul des points (dans l'ordre)</h3>
    <ul>
      <li>1. Additionnez la valeur de vos cartes numéro.</li>
      <li>2. Appliquez le <b>÷2</b> s'il est présent (arrondi à l'inférieur).</li>
      <li>3. Soustrayez les <b>modificateurs négatifs</b> (minimum 0 en jeu normal).</li>
      <li>4. Ajoutez <b>+15</b> si vous avez réalisé un Flip 7.</li>
    </ul>

    <h3>😈 Mode Brutal (variante)</h3>
    <ul>
      <li>Les scores d'une manche peuvent être <b>négatifs</b>.</li>
      <li>Les modificateurs peuvent être donnés à un joueur même <b>éliminé</b>.</li>
      <li>En réalisant un Flip 7, au choix : <b>+15 pour vous</b> ou <b>−15 pour un adversaire</b>.</li>
    </ul>

    <h3>📱 Dans cette application</h3>
    <ul>
      <li>Saisissez le total final de chaque joueur pour chaque manche — toutes les variantes (÷2, négatifs, mode Brutal) sont donc gérées par votre saisie.</li>
      <li>Cochez <b>« Flip 7 (+15) »</b> pour le bonus, ou <b>« Éliminé »</b> pour marquer 0.</li>
    </ul>`;
}

function renderRules() {
  app.innerHTML = "";
  const wrap = el(`
    <div>
      <div class="row" style="margin-bottom:18px">
        <button class="btn btn-ghost btn-sm" id="back">← Retour</button>
      </div>
      <div class="game-head"><h2>📖 Règles</h2></div>
      <div class="rules-tabs">
        <button class="rules-tab ${rulesTab === "classic" ? "active" : ""}" data-tab="classic">Flip 7 Classic</button>
        <button class="rules-tab ${rulesTab === "vengeance" ? "active" : ""}" data-tab="vengeance">Flip 7 Vengeance</button>
      </div>
      <div class="panel rules" id="rulesBody">${rulesTab === "vengeance" ? rulesVengeanceHTML() : rulesClassicHTML()}</div>
    </div>`);
  wrap.querySelector("#back").addEventListener("click", () => go("place"));
  wrap.querySelectorAll(".rules-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      rulesTab = btn.getAttribute("data-tab");
      renderRules();
    });
  });
  app.appendChild(wrap);
}

/* ---------- Place (entry screen) ---------- */
function renderPlace() {
  app.innerHTML = "";
  const current = getSelectedPlace();

  const wrap = el(`
    <div>
      ${logoMarkup()}
      <div class="panel" style="max-width:480px;margin:0 auto">
        <h2>Où jouez-vous&nbsp;?</h2>
        <p class="muted" style="margin:-6px 0 18px">Indiquez le lieu. S'il existe déjà, vous le rejoignez ; sinon il est créé.</p>
        <div class="field">
          <label>Lieu</label>
          <input type="text" id="placeInput" placeholder="ex. Maison, Bureau, Chalet…" />
        </div>
        <div class="row" style="margin-top:8px">
          <div class="spacer"></div>
          <button class="btn btn-primary btn-big" id="continue">Continuer →</button>
        </div>
      </div>
      <div class="rules-link-wrap">
        <button class="link-btn" id="rulesLink">📖 Voir les règles du jeu</button>
      </div>
    </div>`);

  wrap.querySelector("#rulesLink").addEventListener("click", () => go("rules"));

  const input = wrap.querySelector("#placeInput");
  if (current) input.value = current;

  const submit = () => {
    const name = input.value.trim();
    if (!name) return toast("Indiquez un lieu");
    const existing = allPlaces()
      .filter(Boolean)
      .find((p) => p.toLowerCase() === name.toLowerCase());
    if (existing) {
      setSelectedPlace(existing); // already exists → join it
    } else {
      addLocalPlace(name); // new → create it
      setSelectedPlace(name);
    }
    go("home");
  };
  wrap.querySelector("#continue").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  app.appendChild(wrap);
  setTimeout(() => input.focus(), 30);
}

/* ---------- Home ---------- */
function renderHome() {
  app.innerHTML = "";

  const place = getSelectedPlace();
  if (place === null) return go("place"); // must pick a place first

  const hero = el(`
    <section class="hero">
      ${logoMarkup()}
      <h2>Suivez vos parties de Flip 7</h2>
      <p>Choisissez un lieu, créez une partie et enregistrez les points de chaque manche. Le premier à ${DEFAULT_TARGET} gagne. Un Flip 7 ajoute un bonus de +${FLIP7_BONUS}.</p>
      <div class="row" style="justify-content:center;flex-wrap:wrap">
        <button class="btn btn-primary" id="newGame">+ Nouvelle partie</button>
        <button class="btn btn-ghost" id="statsBtn">📊 Statistiques</button>
      </div>
    </section>`);
  hero.querySelector("#newGame").addEventListener("click", () => go("setup"));
  hero.querySelector("#statsBtn").addEventListener("click", () => go("stats"));
  app.appendChild(hero);

  // ----- games for this place -----
  const listHead = el(`<div class="row" style="margin-bottom:14px"><h3 style="margin:0">Parties</h3><div class="spacer"></div></div>`);
  if (db) {
    const rb = el(`<button class="btn btn-ghost btn-sm" id="refresh">↻ Rafraîchir</button>`);
    rb.addEventListener("click", async () => {
      rb.disabled = true;
      rb.textContent = "…";
      await fetchGames();
      if (route.name === "home") renderHome();
    });
    listHead.appendChild(rb);
  }
  app.appendChild(listHead);

  const games = gamesForPlace(place);
  if (!games.length) {
    app.appendChild(el(`<div class="empty">Aucune partie à « ${esc(placeLabel(place))} » pour l'instant. Créez-en une ci-dessus.</div>`));
    return;
  }

  const list = el(`<div class="game-list"></div>`);
  games.forEach((g) => {
    const w = winner(g);
    const names = g.players.map((p) => p.name).join(", ");
    const card = el(`
      <div class="game-card">
        <div class="meta">
          <div class="name">${esc(g.name)}</div>
          <div class="sub">${esc(names || "Aucun joueur")} · ${g.rounds.length} manche${g.rounds.length === 1 ? "" : "s"} · ${fmtDate(g.createdAt)}</div>
        </div>
        ${w ? `<span class="pill win">🏆 ${esc(w.name)}</span>` : `<span class="pill">en cours</span>`}
        <button class="btn btn-danger btn-sm" data-del="${g.id}">Supprimer</button>
      </div>`);
    card.addEventListener("click", (e) => {
      if (e.target.getAttribute("data-del")) return;
      go("game", { id: g.id });
    });
    card.querySelector("[data-del]").addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog({
        title: "Supprimer la partie ?",
        body: `« ${g.name} » et ses scores seront définitivement supprimés.`,
        confirmLabel: "Supprimer",
        danger: true,
      });
      if (ok) { deleteGame(g.id); renderHome(); }
    });
    list.appendChild(card);
  });
  app.appendChild(list);
}

/* ---------- Setup ---------- */
function renderSetup() {
  app.innerHTML = "";
  let players = ["", ""];

  const wrap = el(`
    <div>
      <div class="row" style="margin-bottom:18px">
        <button class="btn btn-ghost btn-sm" id="back">← Retour</button>
      </div>
      ${logoMarkup()}
      <div class="panel">
        <h2>Nouvelle partie</h2>
        <div class="field">
          <label>Joueurs</label>
          <div class="player-rows" id="rows"></div>
          <button class="btn btn-ghost btn-sm" id="addPlayer">+ Ajouter un joueur</button>
        </div>
        <div class="row" style="margin-top:8px">
          <div class="spacer"></div>
          <button class="btn btn-primary" id="start">Commencer la partie</button>
        </div>
      </div>
    </div>`);

  wrap.querySelector("#back").addEventListener("click", () => go("home"));
  app.appendChild(wrap);

  const rowsEl = wrap.querySelector("#rows");
  function drawRows() {
    rowsEl.innerHTML = "";
    players.forEach((name, i) => {
      const row = el(`
        <div class="player-row">
          <div class="idx">${i + 1}</div>
          <input type="text" placeholder="Nom du joueur" value="${esc(name)}" />
          <button class="btn btn-danger btn-icon" title="Retirer">✕</button>
        </div>`);
      const input = row.querySelector("input");
      input.addEventListener("input", (e) => { players[i] = e.target.value; });
      row.querySelector("button").addEventListener("click", () => {
        players.splice(i, 1);
        if (!players.length) players.push("");
        drawRows();
      });
      rowsEl.appendChild(row);
    });
  }
  drawRows();

  wrap.querySelector("#addPlayer").addEventListener("click", () => {
    players.push("");
    drawRows();
    rowsEl.querySelector(".player-row:last-child input").focus();
  });

  wrap.querySelector("#start").addEventListener("click", () => {
    const names = players.map((n) => n.trim()).filter(Boolean);
    if (names.length < 2) return toast("Ajoutez au moins 2 joueurs");
    const place = getSelectedPlace();
    if (place === null) return toast("Ajoutez ou choisissez un lieu d'abord");
    const now = Date.now();
    const game = {
      id: uid(),
      name: gameNameFromDate(now),
      createdAt: now,
      target: DEFAULT_TARGET,
      place,
      players: names.map((n) => ({ id: uid(), name: n })),
      rounds: [],
    };
    upsertGame(game);
    go("game", { id: game.id });
  });
}

/* ---------- Game ---------- */
function renderGame(id) {
  const game = getGame(id);
  if (!game) return go("home");
  app.innerHTML = "";

  const st = standings(game);
  const w = winner(game);

  const head = el(`
    <div>
      <div class="row" style="margin-bottom:18px">
        <button class="btn btn-ghost btn-sm" id="back">← Toutes les parties</button>
        <div class="spacer"></div>
        <button class="btn btn-danger btn-sm" id="del">Supprimer la partie</button>
      </div>
      <div class="game-head">
        <h2>${esc(game.name)}</h2>
        <span class="target-note">Premier à ${game.target} pts</span>
      </div>
    </div>`);
  head.querySelector("#back").addEventListener("click", () => go("home"));
  head.querySelector("#del").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Supprimer la partie ?",
      body: `« ${game.name} » et ses scores seront définitivement supprimés.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (ok) { deleteGame(game.id); go("home"); }
  });
  app.appendChild(head);

  if (w) {
    app.appendChild(el(`<div class="banner">${confettiMarkup()}<span class="crown">🏆</span> <b>${esc(w.name)}</b> gagne avec ${w.total} points !</div>`));
  }

  app.appendChild(buildSummary(game, st, w));

  // Hide score entry once the game is won.
  if (!w) {
    const actions = el(`
      <div class="new-scores-bar">
        <button class="btn btn-primary btn-big" id="newScores">➕ Nouveaux scores</button>
      </div>`);
    actions.querySelector("#newScores").addEventListener("click", () => go("entry", { id: game.id }));
    app.appendChild(actions);
  }

  const detailsWrap = el(`<div class="rules-link-wrap"><button class="link-btn" id="showDetails">📋 Voir les détails</button></div>`);
  detailsWrap.querySelector("#showDetails").addEventListener("click", () => go("details", { id: game.id }));
  app.appendChild(detailsWrap);
}

// Compact scoreboard: just player + final total (ranked, with medals).
function buildSummary(game, st, w) {
  const hasRounds = game.rounds.length > 0;
  const wrap = el(`<div class="table-wrap"></div>`);
  const table = el(`<table class="score summary-table"><thead><tr><th class="player-name">Joueur</th><th>Total</th></tr></thead></table>`);
  const tbody = el(`<tbody></tbody>`);
  st.forEach((p, i) => {
    const rank = i + 1;
    const ranked = hasRounds && p.total > 0;
    const won = w && w.id === p.id;
    const medal = ranked && MEDALS[rank] ? `<span class="medal">${MEDALS[rank]}</span>` : "";
    const crown = won ? '<span class="crown">👑</span>' : "";
    const rankClass = ranked ? `rank${rank}` : "";
    const tr = el(`
      <tr class="${won ? "winner-row" : ""}">
        <td class="player-name">${esc(p.name)}</td>
        <td class="total-cell ${rankClass}">${p.total}${won ? crown : medal}</td>
      </tr>`);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/* ---------- Details (per-round breakdown) ---------- */
function renderDetails(id) {
  const game = getGame(id);
  if (!game) return go("home");
  app.innerHTML = "";

  const st = standings(game);
  const w = winner(game);
  const rankMap = {};
  st.forEach((p, i) => { rankMap[p.id] = i + 1; });

  const head = el(`
    <div>
      <div class="row" style="margin-bottom:18px">
        <button class="btn btn-ghost btn-sm" id="back">← Retour au tableau</button>
      </div>
      <div class="game-head">
        <h2>Détails des scores</h2>
        <span class="target-note">${esc(game.name)}</span>
      </div>
    </div>`);
  head.querySelector("#back").addEventListener("click", () => go("game", { id: game.id }));
  app.appendChild(head);

  app.appendChild(buildTable(game, rankMap, w));
}

const MEDALS = { 1: "🥇", 2: "🥈", 3: "🥉" };

function buildTable(game, rankMap, w) {
  const hasRounds = game.rounds.length > 0;
  const wrap = el(`<div class="table-wrap"></div>`);
  const table = el(`<table class="score"></table>`);

  // head
  let thead = `<thead><tr><th class="player-name">Joueur</th>`;
  game.rounds.forEach((_, i) => { thead += `<th>M${i + 1}</th>`; });
  thead += `<th>Total</th></tr></thead>`;
  table.innerHTML = thead;

  // body
  const tbody = el(`<tbody></tbody>`);
  game.players.forEach((p) => {
    const total = playerTotal(game, p.id);
    const rank = rankMap[p.id];
    const ranked = hasRounds && total > 0;
    const won = w && w.id === p.id;
    const tr = el(`<tr class="${won ? "winner-row" : ""}"><td class="player-name">${esc(p.name)}</td></tr>`);

    game.rounds.forEach((r) => {
      const cell = r.scores[p.id] || { points: 0, flip7: false, bust: false };
      const pts = cell.bust ? 0 : (Number(cell.points) || 0);
      const tags = cell.flip7 ? '<span class="flip7-tag">+15</span>' : "";
      const td = el(`<td><span class="cell-value${cell.bust ? " bust" : ""}">${pts}</span>${tags}</td>`);
      tr.appendChild(td);
    });

    const medal = ranked && MEDALS[rank] ? `<span class="medal">${MEDALS[rank]}</span>` : "";
    const crown = won ? '<span class="crown">👑</span>' : "";
    const rankClass = ranked ? `rank${rank}` : "";
    const totalTd = el(`<td class="total-cell ${rankClass}">${total}${won ? crown : medal}</td>`);
    tr.appendChild(totalTd);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  // footer: round delete buttons
  if (game.rounds.length) {
    let cells = `<td class="player-name muted">Retirer</td>`;
    game.rounds.forEach((_, i) => { cells += `<td><button class="btn btn-danger btn-icon" data-delround="${i}" title="Supprimer la manche">✕</button></td>`; });
    cells += `<td></td>`;
    const tf = el(`<tfoot><tr>${cells}</tr></tfoot>`);
    table.appendChild(tf);
    tf.querySelectorAll("[data-delround]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ri = Number(btn.getAttribute("data-delround"));
        const ok = await confirmDialog({
          title: `Supprimer la manche ${ri + 1} ?`,
          body: "Les scores de cette manche seront supprimés pour tous les joueurs.",
          confirmLabel: "Supprimer",
          danger: true,
        });
        if (!ok) return;
        const g = getGame(game.id);
        g.rounds.splice(ri, 1);
        upsertGame(g);
        renderDetails(game.id);
      });
    });
  }

  wrap.appendChild(table);
  return wrap;
}

function buildRoundEntry(game) {
  const section = el(`
    <div class="panel round-entry">
      <h3>Manche ${game.rounds.length + 1}</h3>
      <div class="entry-grid" id="entryGrid"></div>
      <div class="row">
        <button class="btn btn-ghost" id="cancelRound">Annuler</button>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="saveRound">Enregistrer la manche</button>
      </div>
    </div>`);
  section.querySelector("#cancelRound").addEventListener("click", () => go("game", { id: game.id }));

  const grid = section.querySelector("#entryGrid");
  // draft holds entry state per player
  const draft = {};
  game.players.forEach((p) => {
    draft[p.id] = { points: "", flip7: false, bust: false };
    const row = el(`
      <div class="entry-player">
        <span class="pname">${esc(p.name)}</span>
        <input type="number" placeholder="0" min="0" />
        <label class="chk"><input type="checkbox" /> Flip 7 (+${FLIP7_BONUS})</label>
        <button class="btn btn-ghost btn-sm bust-btn">Éliminé</button>
      </div>`);
    const numInput = row.querySelector('input[type="number"]');
    const chk = row.querySelector('input[type="checkbox"]');
    const bustBtn = row.querySelector(".bust-btn");

    numInput.addEventListener("input", (e) => { draft[p.id].points = e.target.value; });
    chk.addEventListener("change", (e) => {
      draft[p.id].flip7 = e.target.checked;
      row.classList.toggle("flipped", e.target.checked);
    });
    bustBtn.addEventListener("click", () => {
      draft[p.id].bust = !draft[p.id].bust;
      bustBtn.classList.toggle("active", draft[p.id].bust);
      row.classList.toggle("busted", draft[p.id].bust);
      numInput.disabled = draft[p.id].bust;
      chk.disabled = draft[p.id].bust;
      if (draft[p.id].bust) {
        numInput.value = ""; chk.checked = false; draft[p.id].flip7 = false;
        row.classList.remove("flipped");
      }
    });
    grid.appendChild(row);
  });

  section.querySelector("#saveRound").addEventListener("click", () => {
    const scores = {};
    game.players.forEach((p) => {
      const d = draft[p.id];
      scores[p.id] = {
        points: d.bust ? 0 : (Number(d.points) || 0),
        flip7: d.bust ? false : !!d.flip7,
        bust: !!d.bust,
      };
    });
    const g = getGame(game.id);
    const beforeWinnerId = (winner(g) || {}).id || null;
    g.rounds.push({ scores });
    upsertGame(g);
    toast(`Manche ${g.rounds.length} enregistrée`);
    go("game", { id: game.id });
    celebrateIfNewWinner(beforeWinnerId, g);
  });

  return section;
}

/* ---------- Entry (screen 2) ---------- */
function renderEntry(id) {
  const game = getGame(id);
  if (!game) return go("home");
  if (winner(game)) return go("game", { id }); // game is over — no new scores
  app.innerHTML = "";

  const head = el(`
    <div>
      <div class="row" style="margin-bottom:18px">
        <button class="btn btn-ghost btn-sm" id="back">← Retour aux scores</button>
      </div>
      <div class="game-head">
        <h2>Nouveaux scores</h2>
        <span class="target-note">${esc(game.name)}</span>
      </div>
    </div>`);
  head.querySelector("#back").addEventListener("click", () => go("game", { id: game.id }));
  app.appendChild(head);

  app.appendChild(buildRoundEntry(game));
}

/* ---------- Stats (per place, keyed by player name) ---------- */
function computeStats(place) {
  const games = gamesForPlace(place);
  const map = {}; // key: lowercased trimmed name -> aggregate
  games.forEach((g) => {
    const w = winner(g);
    g.players.forEach((p) => {
      const name = p.name.trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (!map[key]) map[key] = { name, games: 0, points: 0, wins: 0 };
      map[key].games += 1;
      map[key].points += playerTotal(g, p.id);
    });
    if (w) {
      const key = w.name.trim().toLowerCase();
      if (map[key]) map[key].wins += 1;
    }
  });
  return Object.values(map).sort(
    (a, b) => b.wins - a.wins || b.points - a.points || b.games - a.games
  );
}

function renderStats() {
  app.innerHTML = "";

  const place = getSelectedPlace();
  const stats = computeStats(place);

  const head = el(`
    <div>
      <div class="row" style="margin-bottom:18px">
        <button class="btn btn-ghost btn-sm" id="back">← Accueil</button>
      </div>
      <div class="game-head">
        <h2>📊 Statistiques</h2>
        <span class="target-note">📍 ${esc(placeLabel(place))} · ${stats.length} joueur${stats.length === 1 ? "" : "s"}</span>
      </div>
    </div>`);
  head.querySelector("#back").addEventListener("click", () => go("home"));
  app.appendChild(head);

  if (!stats.length) {
    app.appendChild(el(`<div class="empty">Aucune donnée pour « ${esc(placeLabel(place))} ». Jouez une partie pour voir les statistiques.</div>`));
    return;
  }

  const wrap = el(`<div class="table-wrap"></div>`);
  const table = el(`
    <table class="score stats-table">
      <thead><tr>
        <th class="player-name">Joueur</th>
        <th>Parties jouées</th>
        <th>Points totaux</th>
        <th>Victoires</th>
      </tr></thead>
    </table>`);
  const tbody = el(`<tbody></tbody>`);
  stats.forEach((s, i) => {
    const medal = s.wins > 0 && MEDALS[i + 1] ? `<span class="medal">${MEDALS[i + 1]}</span>` : "";
    const tr = el(`
      <tr>
        <td class="player-name">${esc(s.name)}</td>
        <td>${s.games}</td>
        <td>${s.points}</td>
        <td class="total-cell ${s.wins > 0 ? "rank1" : ""}">${s.wins}${medal}</td>
      </tr>`);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  app.appendChild(wrap);
}

/* ---------- disable zoom (pinch / ctrl+wheel / ctrl +/-) ---------- */
(function preventZoom() {
  // trackpad pinch + ctrl+wheel zoom
  window.addEventListener("wheel", (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  // keyboard zoom: ctrl/cmd + (+, -, =, 0)
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0"].includes(e.key)) e.preventDefault();
  });
  // iOS Safari pinch gestures
  ["gesturestart", "gesturechange", "gestureend"].forEach((evt) =>
    document.addEventListener(evt, (e) => e.preventDefault())
  );
})();

/* ---------- boot ---------- */
(async function boot() {
  app.innerHTML = `<div class="empty">Chargement…</div>`;
  await fetchGames();
  render();
})();
