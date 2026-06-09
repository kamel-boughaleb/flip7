/* ---------- rules ----------
   Game rulesets, modes, the Yam's scorecard, the Contrée suits, unit
   wording, and the rules text. Pure domain config — no app state. */
import { esc } from "./util.js";

/* ---------- game rulesets ----------
   Each ruleset captures everything score-related for a family of games, so the
   rest of the app stays game-agnostic. Adding a game = adding a ruleset (+ a
   mode entry below). Functions (cellValue, scoreOrder, win condition) let
   wildly different games coexist — e.g. Flip 7 (highest wins, first to 200)
   and Skyjo (lowest wins, ends when someone reaches 100).

   A ruleset ends either at a score `target` (Flip 7, Skyjo) or after a fixed
   number of `rounds` (Time's Up!). Cell shapes differ per ruleset:
     flip7    → { points, flip7, bust }
     skyjo    → { points }  (may be negative)
     timesup  → { points }  (cards guessed by a team) */
const RULESETS = {
  flip7: {
    target: 200,
    bonus: 15,
    scoreOrder: "desc", // higher total ranks first
    entry: "flip7", // score-entry UI variant
    cellValue(cell) {
      if (!cell || cell.bust) return 0;
      return (Number(cell.points) || 0) + (cell.flip7 ? this.bonus : 0);
    },
  },
  skyjo: {
    target: 100,
    scoreOrder: "asc", // lower total ranks first
    entry: "number",
    negatives: true, // scores can be negative (adds a ± sign toggle)
    doubling: true, // the round score can be doubled (×2 button)
    cellValue(cell) {
      const pts = Number(cell && cell.points) || 0;
      return cell && cell.doubled ? pts * 2 : pts;
    },
  },
  timesup: {
    rounds: 3, // ends after a fixed number of rounds (no score target)
    scoreOrder: "desc", // highest team total wins
    entry: "number",
    unit: "equipe", // played by teams, not individual players
    cellValue(cell) {
      return Number(cell && cell.points) || 0;
    },
  },
  qwirkle: {
    manualEnd: true, // no score target / fixed rounds: ended by the user
    turnBased: true, // scores entered one player at a time, in turn order
    scoreOrder: "desc", // highest total wins
    entry: "number",
    cellValue(cell) {
      return Number(cell && cell.points) || 0;
    },
  },
  contree: {
    scoreOrder: "desc", // highest team total wins
    entry: "contree", // bespoke flow: dealer → bid → team scores
    teams: true, // 4 players in two fixed teams (A: seats 1&3, B: 2&4)
    configurableTarget: true, // score target is chosen at creation
    cellValue(cell) {
      return Number(cell && cell.points) || 0;
    },
  },
  yams: {
    turnBased: true, // one player fills one category per turn, in turn order
    autoEndFilled: true, // ends when every player has filled all categories
    scoreOrder: "desc", // highest total wins
    entry: "yams", // bespoke flow: pick a mission, enter/auto its value, or scratch
    cellValue(cell) {
      return Number(cell && cell.points) || 0;
    },
    // The upper-section bonus (+35 at ≥63) is aggregate, so it lives outside
    // cellValue and is added on top of the cell sum in playerTotal.
    extraTotal(game, playerId) {
      return yamsUpperBonus(game, playerId);
    },
  },
  bombu: {
    scoreOrder: "asc", // points are penalties → the LOWEST total wins
    entry: "bombu", // bespoke flow: the chooser picks a contract, all 4 score
    fixedPlayers: 4, // Le Barbu is played by exactly 4
    negatives: true, // Réussite awards negative (good) points
    cellValue(cell) {
      return Number(cell && cell.points) || 0;
    },
    // Ends once every player has played all 7 contracts (4 × 7 = 28 deals).
    complete(game) {
      return bombuComplete(game);
    },
  },
};

/* ---------- Yams scorecard ----------
   The 13 "missions" of the contract. Upper section (As→Six) scores the sum of
   the matching dice (variable, entered by hand); the bonus rewards filling it
   generously. Lower section mixes fixed-value combos (Full, suites, Yams) and
   variable ones (Brelan, Carré, Chance). Any mission can be "barrée" (0 pts).
   A stored cell is { category, points }; points 0 means a scratched mission. */
const YAMS_CATEGORIES = [
  { key: "ones", label: "Un", section: "upper", fixed: null, face: 1 },
  { key: "twos", label: "Deux", section: "upper", fixed: null, face: 2 },
  { key: "threes", label: "Trois", section: "upper", fixed: null, face: 3 },
  { key: "fours", label: "Quatre", section: "upper", fixed: null, face: 4 },
  { key: "fives", label: "Cinq", section: "upper", fixed: null, face: 5 },
  { key: "sixes", label: "Six", section: "upper", fixed: null, face: 6 },
  { key: "brelan", label: "Brelan", section: "lower", fixed: 25 },
  { key: "carre", label: "Carré", section: "lower", fixed: 35 },
  { key: "full", label: "Full", section: "lower", fixed: 30 },
  { key: "petite", label: "Petite suite", section: "lower", fixed: 25 },
  { key: "grande", label: "Grande suite", section: "lower", fixed: 40 },
  { key: "yams", label: "Yam's", section: "lower", fixed: 50 },
  { key: "chance", label: "Chance", section: "lower", fixed: null, free: true },
];
const YAMS_UPPER_KEYS = ["ones", "twos", "threes", "fours", "fives", "sixes"];
const YAMS_BONUS_MIN = 63; // upper-section sum unlocking the bonus
const YAMS_BONUS = 35; // bonus points awarded once the threshold is reached
function yamsCat(key) {
  return YAMS_CATEGORIES.find((c) => c.key === key) || null;
}
// The Chance mission is optional, enabled per game at setup. Existing games
// (no flag) keep the classic 12-case card.
function yamsChanceEnabled(game) {
  return !!(game && game.yamsChance);
}
// Missions in play for a given game: the base card, plus Chance when enabled.
function yamsCategories(game) {
  return yamsChanceEnabled(game)
    ? YAMS_CATEGORIES
    : YAMS_CATEGORIES.filter((c) => !c.free);
}
// Text for a category's value badge. Fixed combos show their points; the upper
// section and Chance show the achievable point range (min–max) — scratching to
// 0 is excluded since any case can be barred. Upper: 1 die (face) → 5 dice
// (5 × face); Chance: the five-dice sum, 5 → 30.
function yamsBadge(cat) {
  if (cat.fixed != null) return String(cat.fixed);
  if (cat.free) return "5 à 30";
  const face = cat.face || 1;
  return `${face} à ${5 * face}`;
}
// Categories a player has already filled (set of keys).
function yamsFilled(game, playerId) {
  const s = new Set();
  game.rounds.forEach((r) => {
    const c = r.scores[playerId];
    if (c && c.category) s.add(c.category);
  });
  return s;
}
// Sum of a player's upper-section cells (As→Six), used for the bonus check.
function yamsUpperSum(game, playerId) {
  return game.rounds.reduce((sum, r) => {
    const c = r.scores[playerId];
    return c && YAMS_UPPER_KEYS.includes(c.category)
      ? sum + (Number(c.points) || 0)
      : sum;
  }, 0);
}
function yamsUpperBonus(game, playerId) {
  return yamsUpperSum(game, playerId) >= YAMS_BONUS_MIN ? YAMS_BONUS : 0;
}
// Every player has filled all missions → the game is over.
function yamsComplete(game) {
  return (
    game.players.length > 0 &&
    game.players.every(
      (p) => yamsFilled(game, p.id).size >= yamsCategories(game).length,
    )
  );
}

/* ---------- Bombu (Le Barbu) ----------
   Played with 32 cards. Each deal, the player "in hand" picks one of the 7
   contracts and may not reuse one they've already chosen; every player plays
   each contract once, so a full game is 4 × 7 = 28 deals. A stored round is
   { chooser, contract, scores: { [pid]: { points } } } — the chosen contract
   scores ALL four players. Points are PENALTIES (lowest total wins); only the
   Réussite awards negative (good) points. `sign` is just a UI accent: "neg" =
   a penalty contract, "pos" = the rewarding Réussite. */
const BOMBU_CONTRACTS = [
  { key: "noTricks", label: "Pas de plis", sign: "neg", badge: "2 /pli", note: "2 pts par pli" },
  { key: "lastTrick", label: "Dernier pli", sign: "neg", badge: "8", note: "8 pts au dernier pli" },
  { key: "noQueens", label: "Pas de dames", sign: "neg", badge: "2 /dame", note: "2 pts par dame" },
  { key: "noHearts", label: "Pas de cœurs", sign: "neg", badge: "1 /cœur", note: "1 pt par cœur" },
  { key: "barbu", label: "Barbu (Roi ♥)", sign: "neg", badge: "8", note: "8 pts au preneur du Roi ♥" },
  { key: "reussite", label: "Réussite", sign: "pos", badge: "−20 à 0", note: "−20 / −10 / −5 / 0 selon l'ordre d'arrivée" },
  { key: "generale", label: "Générale", sign: "neg", badge: "≈ 40", note: "tous les contrats cumulés (≈ 40 pts)" },
];
function bombuContract(key) {
  return BOMBU_CONTRACTS.find((c) => c.key === key) || null;
}
// Contracts a player has already chosen (as the deal's chooser).
function bombuTaken(game, playerId) {
  const s = new Set();
  game.rounds.forEach((r) => {
    if (r.chooser === playerId && r.contract) s.add(r.contract);
  });
  return s;
}
// Every player has chosen all 7 contracts → the game is over.
function bombuComplete(game) {
  return (
    game.players.length > 0 &&
    game.players.every(
      (p) => bombuTaken(game, p.id).size >= BOMBU_CONTRACTS.length,
    )
  );
}

// Trump suits for Contrée bids (4 colours, icons via Unicode pips).
const CONTREE_SUITS = [
  { key: "spades", label: "Pique", sym: "♠", red: false },
  { key: "hearts", label: "Cœur", sym: "♥", red: true },
  { key: "diamonds", label: "Carreau", sym: "♦", red: true },
  { key: "clubs", label: "Trèfle", sym: "♣", red: false },
];
function contreeSuit(key) {
  return CONTREE_SUITS.find((s) => s.key === key) || null;
}

// Wording for the competing entity, per ruleset (default: players).
const UNITS = {
  joueur: {
    one: "Joueur",
    many: "Joueurs",
    add: "Ajouter un joueur",
    placeholder: "Nom du joueur",
  },
  equipe: {
    one: "Équipe",
    many: "Équipes",
    add: "Ajouter une équipe",
    placeholder: "Nom de l'équipe",
  },
};

/* ---------- modes ----------
   A "mode" is a selectable entry in the new-game picker. Several modes can map
   to the same ruleset (Flip 7 variants share scoring, only their rules text
   differs). The mode key is stored on each game and used as a CSS modifier
   (mode-classic / mode-vengeance / mode-skyjo). Legacy games (no mode) are
   treated as "classic". */
const MODES = {
  classic: { label: "Flip 7", ruleset: "flip7", rules: () => rulesClassicHTML() },
  vengeance: {
    label: "Flip 7 Vengeance",
    ruleset: "flip7",
    rules: () => rulesVengeanceHTML(),
  },
  qwirkle: {
    label: "Qwirkle",
    ruleset: "qwirkle",
    rules: () => rulesQwirkleHTML(),
  },
  skyjo: { label: "Skyjo", ruleset: "skyjo", rules: () => rulesSkyjoHTML() },
  timesup: {
    label: "Time's Up!",
    ruleset: "timesup",
    rules: () => rulesTimesUpHTML(),
  },
  contree: {
    label: "Contrée",
    ruleset: "contree",
    rules: () => rulesContreeHTML(),
  },
  yams: {
    label: "Yam's",
    ruleset: "yams",
    rules: () => rulesYamsHTML(),
  },
  bombu: {
    label: "Bombu",
    ruleset: "bombu",
    rules: () => rulesBombuHTML(),
  },
};
const DEFAULT_MODE = "classic";

// The ruleset a game (or mode key) plays by.
function rulesetOf(mode) {
  return RULESETS[MODES[mode]?.ruleset] || RULESETS.flip7;
}
function defFor(game) {
  return rulesetOf(game && game.mode);
}
function modeLabel(mode) {
  return (MODES[mode] || MODES[DEFAULT_MODE]).label;
}
// CSS modifier class for a mode badge (falls back to the default mode).
function modeClass(mode) {
  return "mode-" + (MODES[mode] ? mode : DEFAULT_MODE);
}
function rulesFor(mode) {
  return (MODES[mode] || MODES[DEFAULT_MODE]).rules();
}
// Unit kind key ("joueur" | "equipe") for a mode/filter.
function unitKeyOf(mode) {
  return rulesetOf(mode).unit || "joueur";
}
// Wording for the competing entity (player vs team) for a mode/filter.
function unitOf(mode) {
  return UNITS[rulesetOf(mode).unit] || UNITS.joueur;
}
// Singular label for the score-table column (e.g. "Équipe" for Time's Up!).
function unitLabel(mode) {
  return unitOf(mode).one;
}
// New-game / edit "Type de partie" tab buttons, generated from the registry.
function modeTabsHTML() {
  return Object.entries(MODES)
    .map(
      ([key, m]) =>
        `<button type="button" class="mode-tab" data-mode="${key}">${esc(m.label)}</button>`,
    )
    .join("");
}

function rulesClassicHTML() {
  return `
    <p class="rules-intro"><b>Flip 7</b> est un jeu de cartes de <b>« stop ou encore »</b> (push-your-luck) rapide et nerveux. À chaque manche, on pioche des cartes pour accumuler le plus de points possible… mais piocher un <b>doublon</b> vous élimine et vous fait tout perdre. Faut-il tenter une carte de plus ou s'arrêter à temps ? Premier à <b>200 points</b> gagne.</p>

    <h3><i class="fa-regular fa-bullseye"></i> But du jeu</h3>
    <p>Être le premier joueur à atteindre <b>200 points</b>, cumulés sur plusieurs manches. Chaque manche, on essaie de banquer le plus de points sans se faire éliminer.</p>

    <h3><i class="fa-regular fa-cards"></i> Les cartes</h3>
    <ul>
      <li><b>Cartes numéro (0 à 12)</b> : il y a autant d'exemplaires d'un chiffre que sa valeur (douze « 12 », onze « 11 »… un seul « 1 »), plus une unique carte « 0 ».</li>
      <li><b>Cartes modificateur</b> : +2, +4, +6, +8, +10 et ×2 — elles font grimper le score de la manche.</li>
      <li><b>Cartes action</b> : Gel, Pioche Trois et Seconde Chance.</li>
    </ul>

    <h3><i class="fa-regular fa-arrows-rotate"></i> Déroulement d'une manche</h3>
    <p>À tour de rôle, chaque joueur choisit de <b>piocher</b> une carte de plus (« encore ») ou de <b>s'arrêter</b> (« stop ») pour banquer ses points. Une fois arrêté ou éliminé, on ne rejoue plus jusqu'à la manche suivante.</p>

    <h3><i class="fa-regular fa-burst"></i> Cartes numéro &amp; élimination</h3>
    <ul>
      <li>Chaque carte numéro vaut sa <b>valeur faciale</b> et s'ajoute à votre total de manche.</li>
      <li>Piocher un chiffre que vous <b>possédez déjà</b> (un doublon) vous <b>élimine</b> : 0 point pour la manche… sauf si vous détenez une Seconde Chance.</li>
    </ul>

    <h3><i class="fa-regular fa-star"></i> Le Flip 7</h3>
    <p>Réunir <b>7 cartes numéro différentes</b> déclenche un « Flip 7 » : la manche se termine <b>immédiatement</b> pour tout le monde et vous empochez un bonus de <b>+15 points</b>. C'est le gros coup de la partie.</p>

    <h3><i class="fa-regular fa-plus"></i> Cartes modificateur</h3>
    <ul>
      <li><b>+2 / +4 / +6 / +8 / +10</b> : ajoutent leur valeur à votre total de la manche.</li>
      <li><b>×2</b> : double la somme de vos cartes numéro (les cartes « + » s'ajoutent ensuite).</li>
    </ul>

    <h3><i class="fa-regular fa-clapperboard"></i> Cartes action</h3>
    <ul>
      <li><b>Gel</b> : un joueur que vous désignez doit s'arrêter immédiatement et banquer ses points.</li>
      <li><b>Pioche Trois</b> : un joueur doit piocher trois cartes d'affilée (en s'exposant aux doublons).</li>
      <li><b>Seconde Chance</b> : vous protège d'un doublon (vous le défaussez au lieu d'être éliminé). Si vous en recevez une deuxième, donnez-la à un joueur qui n'en a pas.</li>
    </ul>

    <h3><i class="fa-regular fa-flag-checkered"></i> Fin de la manche</h3>
    <p>La manche s'arrête quand tous les joueurs se sont arrêtés ou éliminés, ou dès qu'un joueur réalise un Flip 7. Score de chacun : somme des cartes numéro (doublée si ×2) + modificateurs + 15 si Flip 7. Un joueur éliminé marque <b>0</b>.</p>

    <h3><i class="fa-regular fa-trophy"></i> Fin de la partie</h3>
    <p>Dès qu'un joueur atteint <b>200 points</b> au total, il gagne. Si plusieurs franchissent 200 dans la même manche, le <b>plus haut total</b> l'emporte.</p>

    <h3><i class="fa-regular fa-mobile-screen-button"></i> Dans cette application</h3>
    <ul>
      <li>Saisissez le <b>total de chaque joueur</b> pour chaque manche.</li>
      <li>Cochez <b>« Flip 7 (+15) »</b> pour ajouter le bonus, ou <b>« Éliminé »</b> pour marquer 0.</li>
      <li>Dans le <b>détail des scores</b>, tapez <b>« +15 »</b> dans une case (ex. « 10+15 ») pour activer ou retirer le bonus Flip 7.</li>
    </ul>`;
}

function rulesVengeanceHTML() {
  return `
    <p class="rules-intro"><b>Flip 7 : With a Vengeance</b> est la suite de Flip 7. Le principe ne change pas (premier à <b>200 points</b>), mais le jeu ajoute des cartes plus chaotiques. Les bases (tours, élimination sur doublon, Flip 7 = +15) restent celles de l'onglet <b>Flip 7</b> — voici ce qui est <b>nouveau</b>.</p>

    <h3><i class="fa-regular fa-list-ol"></i> Nouvelles cartes numéro</h3>
    <ul>
      <li><b>Le 13</b> : les chiffres montent désormais jusqu'à 13 (treize cartes « 13 »).</li>
      <li><b>13 chanceux</b> : vous pouvez posséder <b>deux « 13 »</b> sans être éliminé ; un troisième vous élimine.</li>
      <li><b>Zéro (spécial)</b> : votre total de la manche devient <b>0</b>, et vous êtes obligé de continuer à piocher jusqu'à réaliser un Flip 7.</li>
      <li><b>7 malchanceux</b> : vous défaussez toutes vos cartes numéro et modificateur ; il ne vous reste que ce 7.</li>
    </ul>

    <h3><i class="fa-regular fa-plus"></i> Nouveaux modificateurs</h3>
    <ul>
      <li><b>÷2 (divisé par deux)</b> : divise par deux la somme de vos cartes numéro, <b>avant</b> les autres modificateurs (arrondi à l'inférieur).</li>
      <li><b>Modificateurs négatifs</b> : soustraient leur valeur de votre score.</li>
    </ul>

    <h3><i class="fa-regular fa-clapperboard"></i> Nouvelles cartes action</h3>
    <ul>
      <li><b>Encore une</b> : un joueur pioche une carte, puis s'arrête immédiatement.</li>
      <li><b>Échanger</b> : deux joueurs échangent une de leurs cartes face visible.</li>
      <li><b>Voler</b> : prenez une carte face visible d'un autre joueur.</li>
      <li><b>Défausser</b> : un joueur défausse une de ses cartes.</li>
      <li><b>Pioche Quatre</b> : un joueur pioche quatre cartes d'affilée (s'arrête s'il est éliminé ou réalise un Flip 7).</li>
    </ul>

    <h3><i class="fa-regular fa-calculator"></i> Calcul des points (dans l'ordre)</h3>
    <ul>
      <li>1. Additionnez la valeur de vos cartes numéro.</li>
      <li>2. Appliquez le <b>÷2</b> s'il est présent (arrondi à l'inférieur).</li>
      <li>3. Soustrayez les <b>modificateurs négatifs</b> (minimum 0 en jeu normal).</li>
      <li>4. Ajoutez <b>+15</b> si vous avez réalisé un Flip 7.</li>
    </ul>

    <h3><i class="fa-regular fa-face-angry-horns"></i> Mode Brutal (variante)</h3>
    <ul>
      <li>Les scores d'une manche peuvent être <b>négatifs</b>.</li>
      <li>Les modificateurs peuvent être donnés à un joueur même <b>éliminé</b>.</li>
      <li>En réalisant un Flip 7, au choix : <b>+15 pour vous</b> ou <b>−15 pour un adversaire</b>.</li>
    </ul>

    <h3><i class="fa-regular fa-mobile-screen-button"></i> Dans cette application</h3>
    <ul>
      <li>Saisissez le total final de chaque joueur pour chaque manche — toutes les variantes (÷2, négatifs, mode Brutal) sont donc gérées par votre saisie.</li>
      <li>Cochez <b>« Flip 7 (+15) »</b> pour le bonus, ou <b>« Éliminé »</b> pour marquer 0.</li>
      <li>Dans le <b>détail des scores</b>, tapez <b>« +15 »</b> dans une case (ex. « 10+15 ») pour activer ou retirer le bonus Flip 7.</li>
    </ul>`;
}

function rulesSkyjoHTML() {
  return `
    <p class="rules-intro"><b>Skyjo</b> est un jeu de cartes où l'on cherche à avoir <b>le moins de points possible</b>. La partie se joue en plusieurs manches ; elle s'arrête dès qu'un joueur atteint <b>100 points</b>, et c'est le joueur avec le <b>total le plus bas</b> qui gagne.</p>

    <h3><i class="fa-regular fa-bullseye"></i> But du jeu</h3>
    <p>Avoir le <b>plus petit total</b> de points à la fin de la partie. Contrairement à Flip 7, les points sont une malus : on veut les éviter.</p>

    <h3><i class="fa-regular fa-cards"></i> Les cartes</h3>
    <ul>
      <li>150 cartes de valeurs <b>−2 à 12</b> (les cartes négatives et les zéros font baisser votre score).</li>
      <li>Chaque joueur dispose d'une grille de <b>3 × 4 cartes</b> (12 cartes), d'abord face cachée.</li>
    </ul>

    <h3><i class="fa-regular fa-arrows-rotate"></i> Déroulement d'une manche</h3>
    <ul>
      <li>À son tour, on pioche une carte (de la pioche ou de la défausse) et on l'échange avec une carte de sa grille, ou on retourne une carte cachée.</li>
      <li><b>Colonne identique</b> : si une colonne de 3 cartes affiche la même valeur, elle est retirée et vaut <b>0</b>.</li>
      <li>La manche se termine quand un joueur a <b>retourné toutes ses cartes</b> ; les autres jouent un dernier tour.</li>
    </ul>

    <h3><i class="fa-regular fa-calculator"></i> Décompte d'une manche</h3>
    <ul>
      <li>Chaque joueur additionne la valeur des cartes restantes dans sa grille.</li>
      <li><b>Pénalité du premier sorti</b> : le joueur qui a terminé la manche <b>double son score de la manche</b> s'il n'a pas (seul) le plus petit total de la manche.</li>
    </ul>

    <h3><i class="fa-regular fa-trophy"></i> Fin de la partie</h3>
    <p>Dès qu'un joueur atteint ou dépasse <b>100 points</b> au cumul, la partie s'arrête. Le joueur avec le <b>total le plus bas</b> l'emporte.</p>

    <h3><i class="fa-regular fa-mobile-screen-button"></i> Dans cette application</h3>
    <ul>
      <li>Saisissez le <b>score de chaque joueur pour chaque manche</b> ; le bouton <b>±</b> permet d'entrer un score <b>négatif</b>.</li>
      <li>Le classement met le <b>plus petit total en tête</b> ; le vainqueur prévisionnel est signalé d'une couronne dès qu'un joueur atteindrait 100.</li>
    </ul>`;
}

function rulesTimesUpHTML() {
  return `
    <p class="rules-intro"><b>Time's Up!</b> est un jeu d'ambiance par <b>équipes</b> où l'on fait deviner des personnalités. La partie se joue en <b>3 manches</b> avec le <b>même paquet de cartes</b> à chaque fois ; à la fin, l'équipe au <b>plus haut total</b> gagne.</p>

    <h3><i class="fa-regular fa-bullseye"></i> But du jeu</h3>
    <p>En équipes, faire deviner un maximum de personnalités en un temps limité (≈ 30 s par tour). On cumule les cartes devinées sur les 3 manches ; l'équipe avec le <b>plus de points</b> l'emporte.</p>

    <h3><i class="fa-regular fa-users"></i> Mise en place</h3>
    <ul>
      <li>Formez <b>2 équipes ou plus</b>.</li>
      <li>Chaque joueur écrit quelques personnalités (réelles ou fictives, connues de tous) ; toutes les cartes forment le paquet commun.</li>
    </ul>

    <h3><i class="fa-regular fa-arrows-rotate"></i> Les 3 manches</h3>
    <ul>
      <li><b>Manche 1 — Description libre</b> : faire deviner en parlant librement (sans dire le nom).</li>
      <li><b>Manche 2 — Un seul mot</b> : un seul mot d'indice par carte.</li>
      <li><b>Manche 3 — Mime</b> : uniquement des gestes, sans parler.</li>
    </ul>
    <p>À chaque manche on rejoue avec <b>tout le paquet</b> : les cartes mémorisées aux manches précédentes deviennent plus faciles.</p>

    <h3><i class="fa-regular fa-stopwatch"></i> Déroulement d'un tour</h3>
    <p>À tour de rôle, une équipe désigne un « parleur » qui fait deviner le plus de cartes possible avant la fin du sablier. Chaque carte devinée = <b>1 point</b> pour l'équipe. La manche s'arrête quand le paquet est épuisé, puis on rebat les cartes pour la manche suivante.</p>

    <h3><i class="fa-regular fa-trophy"></i> Fin de la partie</h3>
    <p>Après la <b>3ᵉ manche</b>, on additionne les points des 3 manches. L'équipe au <b>plus haut total</b> gagne (égalité possible).</p>

    <h3><i class="fa-regular fa-mobile-screen-button"></i> Dans cette application</h3>
    <ul>
      <li>Saisissez les <b>noms d'équipes</b> dans les joueurs.</li>
      <li>À chaque manche, entrez le <b>nombre de cartes devinées</b> par chaque équipe.</li>
      <li>La partie se termine automatiquement après <b>3 manches</b> ; le plus haut total gagne.</li>
    </ul>`;
}

function rulesQwirkleHTML() {
  return `
    <p class="rules-intro"><b>Qwirkle</b> est un jeu de tuiles où l'on forme des lignes partageant une même <b>couleur</b> ou une même <b>forme</b>. On marque des points à chaque pose ; à la fin, le joueur au <b>plus haut total</b> l'emporte.</p>

    <h3><i class="fa-regular fa-bullseye"></i> But du jeu</h3>
    <p>Marquer un <b>maximum de points</b> en posant des tuiles pour créer ou prolonger des lignes de même couleur (formes différentes) ou de même forme (couleurs différentes).</p>

    <h3><i class="fa-regular fa-shapes"></i> Le matériel</h3>
    <ul>
      <li><b>108 tuiles</b> : 6 formes × 6 couleurs, chacune en 3 exemplaires.</li>
      <li>Chaque joueur garde <b>6 tuiles</b> en main, piochées dans le sac.</li>
    </ul>

    <h3><i class="fa-regular fa-arrows-rotate"></i> Déroulement d'un tour</h3>
    <ul>
      <li>À son tour, on pose une ou plusieurs tuiles <b>alignées</b> qui partagent la couleur <b>ou</b> la forme (jamais de doublon dans une même ligne), puis on complète sa main à 6.</li>
      <li>On peut aussi <b>échanger</b> tout ou partie de sa main (on passe alors son tour).</li>
    </ul>

    <h3><i class="fa-regular fa-calculator"></i> Décompte</h3>
    <ul>
      <li>On marque <b>1 point par tuile</b> de chaque ligne créée ou prolongée par sa pose (une tuile au croisement de deux lignes compte dans les deux).</li>
      <li><b>Qwirkle</b> : compléter une ligne de <b>6 tuiles</b> rapporte <b>6 points bonus</b> (soit 12 pour cette ligne).</li>
    </ul>

    <h3><i class="fa-regular fa-trophy"></i> Fin de la partie</h3>
    <p>La partie s'arrête quand un joueur <b>pose sa dernière tuile</b> alors que le sac est vide : il gagne <b>6 points bonus</b>. Le <b>plus haut total</b> gagne.</p>

    <h3><i class="fa-regular fa-mobile-screen-button"></i> Dans cette application</h3>
    <ul>
      <li>Au démarrage, choisissez <b>« Qui commence ? »</b> ; les tours s'enchaînent ensuite <b>dans l'ordre des joueurs</b>.</li>
      <li>À chaque tour, saisissez le <b>score du joueur courant</b> (« Score de … »), puis on passe automatiquement au suivant. Utilisez <b>« A pioché »</b> s'il a pioché sans marquer (0 point).</li>
      <li>Il n'y a pas de fin automatique : appuyez sur <b>« Terminer »</b> quand la partie est finie ; le joueur en tête est alors couronné.</li>
    </ul>`;
}

function rulesContreeHTML() {
  return `
    <p class="rules-intro">La <b>Contrée</b> (ou coinche) est un jeu de plis par <b>équipes de 2</b>. Une équipe annonce un <b>contrat</b> (un nombre de points dans une couleur d'atout) ; si elle le réalise, elle marque, sinon l'adversaire empoche. Première équipe au <b>score cible</b> gagne.</p>

    <h3><i class="fa-regular fa-users"></i> Mise en place</h3>
    <ul>
      <li><b>4 joueurs</b>, 2 équipes : les joueurs <b>1 & 3</b> contre les joueurs <b>2 & 4</b> (assis en alternance).</li>
      <li>On définit un <b>score cible</b> à atteindre (souvent 1000 ou 2000).</li>
    </ul>

    <h3><i class="fa-regular fa-gavel"></i> Les enchères</h3>
    <ul>
      <li>À tour de rôle, on annonce un <b>contrat</b> : une valeur (80, 90… 160, capot) et une <b>couleur d'atout</b> (♠ ♥ ♦ ♣).</li>
      <li>Les adversaires peuvent <b>contrer</b> (×2) ; l'équipe qui prend peut <b>surcontrer</b> (×4).</li>
    </ul>

    <h3><i class="fa-regular fa-share-from-square"></i> La distribution</h3>
    <p>On choisit qui <b>distribue en premier</b> ; la distribution tourne ensuite dans l'ordre des joueurs à chaque donne.</p>

    <h3><i class="fa-regular fa-mobile-screen-button"></i> Dans cette application</h3>
    <ul>
      <li>À la création : définissez le <b>score cible</b> et les <b>4 joueurs</b> (l'ordre fixe les équipes : 1 & 3 / 2 & 4).</li>
      <li>Sur la partie : choisissez <b>qui distribue</b>, puis saisissez la <b>mise</b> (contrat 80→160 ou <b>Capot</b>, atout, équipe qui prend, contré/surcontré). Elle est rappelée en haut du tableau.</li>
      <li>Pour le score, entrez les <b>points de plis</b> d'une équipe (l'autre se complète à <b>160</b>, arrondi à la dizaine) et signalez une éventuelle <b>Belote (+20)</b>.</li>
      <li>L'app <b>calcule automatiquement</b> le score de la donne (contrat réussi/chuté, contré ×2, surcontré ×4, capot) et indique si le contrat est tenu. La distribution passe ensuite au joueur suivant.</li>
    </ul>`;
}

function rulesYamsHTML() {
  return `
    <p class="rules-intro">Le <b>Yam's</b> (Yahtzee) est un jeu de <b>dés</b> : à chaque tour, on lance cinq dés (jusqu'à 3 lancers) pour réaliser une <b>combinaison</b>, puis on l'inscrit dans une <b>case du contrat</b>. Chaque case ne sert qu'<b>une seule fois</b>. Le plus haut total l'emporte.</p>

    <h3><i class="fa-regular fa-dice"></i> Le matériel</h3>
    <ul>
      <li><b>5 dés</b> et une <b>feuille de marque</b> par joueur (les 12 cases du contrat, ou 13 avec la Chance).</li>
      <li>À son tour : jusqu'à <b>3 lancers</b>, en gardant les dés voulus entre chaque relance.</li>
    </ul>

    <h3><i class="fa-regular fa-list-check"></i> Les missions</h3>
    <ul>
      <li><b>Section haute</b> — Un, Deux, Trois, Quatre, Cinq, Six : on marque la <b>somme des dés</b> de la valeur choisie.</li>
      <li><b>Brelan</b> (3 identiques) = <b>25</b> · <b>Carré</b> (4 identiques) = <b>35</b> · <b>Full</b> (brelan + paire) = <b>30</b>.</li>
      <li><b>Petite suite</b> (4 à la suite) = <b>25</b> · <b>Grande suite</b> (5 à la suite) = <b>40</b> · <b>Yam's</b> (5 identiques) = <b>50</b>.</li>
      <li><b>Chance</b> <i>(optionnelle, activée à la création)</i> — on marque la <b>somme des 5 dés</b>, quelle que soit la combinaison (à jouer quand rien d'autre ne paie).</li>
    </ul>

    <h3><i class="fa-regular fa-star"></i> Le bonus</h3>
    <p>Si le total de la <b>section haute</b> atteint <b>63 points</b>, on gagne un <b>bonus de +35</b>.</p>

    <h3><i class="fa-regular fa-trophy"></i> Fin de la partie</h3>
    <p>La partie s'arrête quand <b>tous les joueurs ont rempli toutes leurs cases</b>. Le joueur au <b>plus haut total</b> (cases + bonus) gagne.</p>

    <h3><i class="fa-regular fa-mobile-screen-button"></i> Dans cette application</h3>
    <ul>
      <li>Au démarrage, choisissez <b>« Qui commence ? »</b> ; les tours s'enchaînent ensuite <b>dans l'ordre des joueurs</b>.</li>
      <li>À chaque tour, choisissez la <b>mission</b> à inscrire. Pour la <b>section haute</b>, indiquez le <b>nombre de dés</b> de la face (l'app multiplie par la valeur) ; les figures fixes sont remplies automatiquement. Pour la <b>Chance</b>, saisissez directement la <b>somme des 5 dés</b>. Vous pouvez aussi <b>barrer</b> la case (0 point).</li>
      <li>Le <b>bonus de +35</b> est <b>calculé automatiquement</b> dès que la section haute atteint 63.</li>
      <li>La partie se <b>termine d'elle-même</b> une fois toutes les cases remplies ; le joueur en tête est couronné.</li>
    </ul>`;
}

function rulesBombuHTML() {
  return `
    <p class="rules-intro">Le <b>Bombu</b> (Le Barbu) est un jeu de <b>levées à contrats</b> à <b>4 joueurs</b> avec <b>32 cartes</b> (8 chacun). À chaque manche, le joueur <b>en main</b> choisit un <b>contrat</b> ; chacun doit réaliser <b>les 7 contrats une fois</b> (soit <b>28 manches</b>). Les points sont des <b>pénalités</b> : le <b>plus petit total</b> l'emporte.</p>

    <h3><i class="fa-regular fa-circle-minus"></i> Les contrats à éviter (pénalités)</h3>
    <ul>
      <li><b>Pas de plis</b> — <b>2 points par pli</b> ramassé.</li>
      <li><b>Dernier pli</b> — <b>8 points</b> à qui remporte le dernier pli.</li>
      <li><b>Pas de dames</b> — <b>2 points par dame</b> ramassée.</li>
      <li><b>Pas de cœurs</b> — <b>1 point par cœur</b> ramassé.</li>
      <li><b>Barbu</b> — <b>8 points</b> au preneur du <b>Roi ♥</b>.</li>
      <li><b>Générale</b> — <b>tous les contrats ci-dessus cumulés</b> dans la même manche (≈ 40 points en jeu).</li>
    </ul>

    <h3><i class="fa-regular fa-circle-plus"></i> Le contrat qui rapporte</h3>
    <ul>
      <li><b>Réussite</b> — on pose les cartes à la suite ; selon l'ordre où l'on se débarrasse de sa main : <b>−20</b> (1er), <b>−10</b> (2e), <b>−5</b> (3e), <b>0</b> (4e). Des points <b>négatifs</b>, donc bons à prendre.</li>
    </ul>

    <h3><i class="fa-regular fa-mobile-screen-button"></i> Dans cette application</h3>
    <ul>
      <li>Au démarrage, choisissez <b>qui commence</b> ; le choix du contrat tourne ensuite <b>dans l'ordre des joueurs</b>.</li>
      <li>À chaque manche, le joueur en main <b>choisit un contrat</b> (parmi ceux qu'il n'a pas encore pris), puis vous <b>saisissez le score de chaque joueur</b> (négatif possible pour la Réussite).</li>
      <li>La partie se <b>termine d'elle-même</b> une fois que les 4 joueurs ont joué leurs 7 contrats ; le joueur au <b>plus petit total</b> est couronné.</li>
    </ul>`;
}

export {
  RULESETS,
  YAMS_CATEGORIES,
  YAMS_UPPER_KEYS,
  YAMS_BONUS_MIN,
  YAMS_BONUS,
  yamsCat,
  yamsBadge,
  yamsCategories,
  yamsChanceEnabled,
  yamsFilled,
  yamsUpperSum,
  yamsUpperBonus,
  yamsComplete,
  BOMBU_CONTRACTS,
  bombuContract,
  bombuTaken,
  bombuComplete,
  CONTREE_SUITS,
  contreeSuit,
  UNITS,
  MODES,
  DEFAULT_MODE,
  rulesetOf,
  defFor,
  modeLabel,
  modeClass,
  rulesFor,
  unitKeyOf,
  unitOf,
  unitLabel,
  modeTabsHTML,
};
