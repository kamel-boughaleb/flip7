/* ---------- stats ----------
   Per-place aggregates keyed by player name, plus the selectable metrics
   (value column, sort, tie test). Pure-ish: reads games via the store. */
import { gamesForPlace } from "./store.js";
import { defFor, rulesetOf, RULESETS } from "./rules.js";
import { teamTotal, playerTotal, winners } from "./scoring.js";

/* ---------- Stats (per place, keyed by player name) ---------- */
// Stats filters. "flip7" (Général) pools both Flip 7 variants; the others are
// a single mode/game. `order` is how points rank (Skyjo: fewer is better).
// Legacy games (no stored mode) count as Flip 7 classic.
const STAT_FILTERS = {
  flip7: { match: (g) => rulesetOf(g.mode) === RULESETS.flip7, order: "desc" },
  classic: { match: (g) => (g.mode || "classic") === "classic", order: "desc" },
  vengeance: { match: (g) => g.mode === "vengeance", order: "desc" },
  skyjo: { match: (g) => g.mode === "skyjo", order: "asc" },
  timesup: { match: (g) => g.mode === "timesup", order: "desc" },
  qwirkle: { match: (g) => g.mode === "qwirkle", order: "desc" },
  contree: { match: (g) => g.mode === "contree", order: "desc" },
  yams: { match: (g) => g.mode === "yams", order: "desc" },
};
function computeStats(place, filter = "flip7") {
  const f = STAT_FILTERS[filter] || STAT_FILTERS.flip7;
  // "Best" depends on the ruleset's score order: lowest is best for Skyjo
  // (asc), highest for everyone else (desc). null means "no value yet".
  const isBetter = (v, cur) =>
    cur == null || (f.order === "asc" ? v < cur : v > cur);
  const games = gamesForPlace(place).filter(f.match);
  const map = {}; // key: lowercased trimmed name -> aggregate
  games.forEach((g) => {
    const def = defFor(g);
    // Team games (Contrée): a player's figures are those of their team
    // (seats 1 & 3 → team A, 2 & 4 → team B).
    const teamOfSeat = (idx) => (idx % 2 === 0 ? "A" : "B");
    g.players.forEach((p, idx) => {
      const name = p.name.trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (!map[key])
        map[key] = {
          name,
          games: 0,
          points: 0,
          wins: 0,
          elims: 0, // number of busted (eliminated) rounds across games
          flip7s: 0, // number of Flip 7 bonuses scored across games
          bestGame: null, // best single-game total (min for asc, max for desc)
          bestRound: null, // best single-round score (min for asc, max for desc)
        };
      const agg = map[key];
      agg.games += 1;
      if (def.teams) {
        const teamId = teamOfSeat(idx);
        const total = teamTotal(g, teamId);
        agg.points += total;
        if (g.rounds.length && isBetter(total, agg.bestGame))
          agg.bestGame = total;
        g.rounds.forEach((r) => {
          const rv = Number(r.scores && r.scores[teamId]) || 0;
          if (isBetter(rv, agg.bestRound)) agg.bestRound = rv;
        });
      } else {
        const total = playerTotal(g, p.id);
        agg.points += total;
        if (g.rounds.length && isBetter(total, agg.bestGame))
          agg.bestGame = total;
        g.rounds.forEach((r) => {
          const cell = r.scores[p.id];
          if (cell && cell.bust) agg.elims += 1;
          if (cell && cell.flip7 && !cell.bust) agg.flip7s += 1;
          const rv = def.cellValue(cell);
          if (isBetter(rv, agg.bestRound)) agg.bestRound = rv;
        });
      }
    });
    // Ties count as a win for every co-winner, not just one representative.
    if (def.teams) {
      const winTeams = new Set(winners(g).map((t) => t.id));
      g.players.forEach((p, idx) => {
        if (!winTeams.has(teamOfSeat(idx))) return;
        const key = p.name.trim().toLowerCase();
        if (map[key]) map[key].wins += 1;
      });
    } else {
      winners(g).forEach((w) => {
        const key = w.name.trim().toLowerCase();
        if (map[key]) map[key].wins += 1;
      });
    }
  });
  const ptsCmp =
    f.order === "asc"
      ? (a, b) => a.points - b.points
      : (a, b) => b.points - a.points;
  return Object.values(map).sort(
    (a, b) => b.wins - a.wins || ptsCmp(a, b) || b.games - a.games,
  );
}

// Stat "metrics" selectable for Flip 7: which table to show. Each defines its
// value column, sort order, and the tie test used for shared ranks.
// Label for the "best round" metric, named after each game's round unit.
function bestRoundLabel(mode) {
  return mode === "qwirkle"
    ? "Meilleur tour"
    : mode === "yams"
      ? "Meilleure case"
      : mode === "contree"
        ? "Meilleure donne"
        : "Meilleure manche";
}
// Average score per game, rounded to a whole number (0 if no game).
function avgScore(s) {
  if (!s.games) return 0;
  return Math.round(s.points / s.games);
}
// Win ratio as a whole-number percentage of games played (0 if no game).
function winRate(s) {
  if (!s.games) return 0;
  return Math.round((s.wins / s.games) * 100);
}

const STAT_METRICS = {
  wins: {
    label: "Nombre de victoires",
    valueHead: "Victoires",
    value: (s) => s.wins,
    sort: () => (a, b) => b.wins - a.wins || b.games - a.games,
    tie: (a, b) => a.wins === b.wins,
  },
  winrate: {
    label: "Taux de victoire",
    valueHead: "Taux",
    value: (s) => `${winRate(s)} %`,
    sort: () => (a, b) => winRate(b) - winRate(a) || b.games - a.games,
    tie: (a, b) => winRate(a) === winRate(b),
  },
  games: {
    label: "Nombre de parties",
    valueHead: "Parties",
    value: (s) => s.games,
    sort: () => (a, b) => b.games - a.games || b.wins - a.wins,
    tie: (a, b) => a.games === b.games,
  },
  points: {
    label: "Score total",
    valueHead: "Points",
    value: (s) => s.points,
    // Higher is better, except Skyjo (asc) where fewer points is better.
    sort: (order) => (a, b) =>
      (order === "asc" ? a.points - b.points : b.points - a.points) ||
      b.games - a.games,
    tie: (a, b) => a.points === b.points,
  },
  average: {
    label: "Moyenne par partie",
    valueHead: "Moyenne",
    value: (s) => avgScore(s),
    sort: (order) => (a, b) =>
      (order === "asc"
        ? avgScore(a) - avgScore(b)
        : avgScore(b) - avgScore(a)) || b.games - a.games,
    tie: (a, b) => avgScore(a) === avgScore(b),
  },
  elims: {
    label: "Le plus éliminé",
    valueHead: "Éliminations",
    value: (s) => s.elims,
    sort: () => (a, b) => b.elims - a.elims || b.games - a.games,
    tie: (a, b) => a.elims === b.elims,
  },
  flip7s: {
    label: "Nombre de Flip 7",
    valueHead: "Flip 7",
    value: (s) => s.flip7s,
    sort: () => (a, b) => b.flip7s - a.flip7s || b.games - a.games,
    tie: (a, b) => a.flip7s === b.flip7s,
  },
  bestGame: {
    label: "Meilleure partie",
    valueHead: "Meilleur total",
    value: (s) => s.bestGame ?? 0,
    // Best = lowest for asc (Skyjo), highest otherwise. null sorts last.
    sort: (order) => (a, b) =>
      (order === "asc"
        ? (a.bestGame ?? Infinity) - (b.bestGame ?? Infinity)
        : (b.bestGame ?? -Infinity) - (a.bestGame ?? -Infinity)) ||
      b.games - a.games,
    tie: (a, b) => a.bestGame === b.bestGame,
  },
  bestRound: {
    // A "round" is a "tour" in Qwirkle, a "donne" in Contrée, a "case" in
    // Yam's, a "manche" elsewhere.
    label: (mode) => bestRoundLabel(mode),
    valueHead: (mode) => bestRoundLabel(mode),
    value: (s) => s.bestRound ?? 0,
    sort: (order) => (a, b) =>
      (order === "asc"
        ? (a.bestRound ?? Infinity) - (b.bestRound ?? Infinity)
        : (b.bestRound ?? -Infinity) - (a.bestRound ?? -Infinity)) ||
      b.games - a.games,
    tie: (a, b) => a.bestRound === b.bestRound,
  },
};
// Which metrics each version offers in the selector (wins is the default/first).
const FLIP7_VERSIONS = new Set(["flip7", "classic", "vengeance"]);
function metricsForVersion(mode) {
  const base = ["wins", "winrate", "games", "points", "average"];
  if (FLIP7_VERSIONS.has(mode))
    return [...base, "elims", "flip7s", "bestGame", "bestRound"];
  // Games with a meaningful single-game / single-round high score.
  if (["skyjo", "qwirkle", "yams", "timesup", "contree"].includes(mode))
    return [...base, "bestGame", "bestRound"];
  return base;
}
// Resolve a metric label/valueHead that may be a string or a mode-aware fn.
function metricText(x, mode) {
  return typeof x === "function" ? x(mode) : x;
}

export { computeStats, STAT_FILTERS, STAT_METRICS, metricsForVersion, metricText };
