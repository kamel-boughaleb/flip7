/* ---------- scoring ----------
   Totals, standings, winners, end-of-game tests, Contrée teams, and
   turn-based ordering. Operates on game objects passed in (no store). */
import { esc } from "./util.js";
import {
  defFor,
  yamsComplete,
  yamsFilled,
  yamsCategories,
  bombuTaken,
  BOMBU_CONTRACTS,
  contreeSuit,
} from "./rules.js";

/* ---------- scoring ---------- */
function playerTotal(game, playerId) {
  const def = defFor(game);
  const base = game.rounds.reduce(
    (sum, r) => sum + def.cellValue(r.scores[playerId]),
    0,
  );
  // Some games (Yams) add an aggregate bonus on top of the per-cell sum.
  return base + (def.extraTotal ? def.extraTotal(game, playerId) : 0);
}
// Standings sorted by the game's order (Flip 7: highest first; Skyjo: lowest
// first). The leader — best by the game's rules — is always s[0]. Team games
// (Contrée) rank the two teams instead of individual players, so isGameOver /
// winners (which only read {id, total}) keep working unchanged.
function standings(game) {
  const def = defFor(game);
  if (def.teams) {
    return teamsOf(game)
      .map((t) => ({ ...t, total: teamTotal(game, t.id) }))
      .sort((a, b) => b.total - a.total);
  }
  const asc = def.scoreOrder === "asc";
  return game.players
    .map((p) => ({ ...p, total: playerTotal(game, p.id) }))
    .sort((a, b) => (asc ? a.total - b.total : b.total - a.total));
}

/* ---------- teams (Contrée) ---------- */
// The two fixed teams: A = seats 1 & 3, B = seats 2 & 4 (in roster order).
function teamsOf(game) {
  const ps = game.players;
  return [
    { id: "A", name: teamName(game, "A"), members: [ps[0], ps[2]].filter(Boolean) },
    { id: "B", name: teamName(game, "B"), members: [ps[1], ps[3]].filter(Boolean) },
  ];
}
// A team's display name: its members joined by "&", or "Équipe A/B" as fallback.
function teamName(game, id) {
  const ps = game.players;
  const members = (id === "A" ? [ps[0], ps[2]] : [ps[1], ps[3]])
    .filter(Boolean)
    .map((p) => p.name)
    .filter((n) => n && n.trim());
  return members.length ? members.join(" & ") : id === "A" ? "Équipe A" : "Équipe B";
}
// A team's cumulative score across all played deals.
function teamTotal(game, id) {
  return game.rounds.reduce(
    (sum, r) => sum + (Number(r.scores && r.scores[id]) || 0),
    0,
  );
}
// The player dealing the current deal: the chosen first dealer rotated by the
// number of deals already played (deal passes clockwise, in roster order).
function currentDealer(game) {
  if (!game.dealer) return null;
  const order = turnOrder({ players: game.players, starter: game.dealer });
  return order.length ? order[game.rounds.length % order.length] : null;
}
// Is the game finished? Target-based games (Flip 7, Skyjo) end once any player
// reaches the target; round-limited games (Time's Up!) end after N rounds;
// manual-end games (Qwirkle) end when the user closes them (game.ended).
function isGameOver(game, s) {
  const def = defFor(game);
  if (def.manualEnd) return !!game.ended; // user closes the game by hand
  if (def.autoEndFilled) return yamsComplete(game); // Yams: every card filled
  if (def.complete) return def.complete(game); // Bombu: every contract played
  if (def.rounds) return game.rounds.length >= def.rounds;
  return s.some((p) => p.total >= game.target);
}
// Winning players from a standings array already sorted by the game's order.
// A cancelled game is won by the current leader(s); otherwise, once the game is
// over, the leader(s) win (highest for Flip 7 / Time's Up!, lowest for Skyjo).
// Ties at the leading total are all returned.
function winnersFromStandings(game, s) {
  if (!s.length) return [];
  const best = s[0].total;
  if (game.cancelled) return s.filter((p) => p.total === best);
  if (isGameOver(game, s)) return s.filter((p) => p.total === best);
  return [];
}
function winners(game) {
  return winnersFromStandings(game, standings(game));
}
// Label for a list of winners: names joined by commas, the last one with "&"
// (e.g. "Lucas, Léna & Cindy").
function winnersLabel(ws) {
  const names = ws.map((p) => esc(p.name));
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}
// Single representative winner (or null). Truthy means the game is over.
function winner(game) {
  return winners(game)[0] || null;
}

/* ---------- turn-based games (Qwirkle) ---------- */
// The roster rotated so the chosen starter plays first; falls back to the
// roster order when no starter has been picked yet.
function turnOrder(game) {
  const ps = game.players;
  const i = ps.findIndex((p) => p.id === game.starter);
  return i <= 0 ? ps.slice() : ps.slice(i).concat(ps.slice(0, i));
}
// The player whose turn it is now, or null if the game hasn't started. The next
// player is the one following the last player who scored (robust to deleting a
// turn from the details screen); before any turn, it's the starter.
function currentPlayer(game) {
  if (!game.starter) return null;
  const order = turnOrder(game);
  if (!order.length) return null;
  // Where the next turn lands: just after the last player who scored, or the
  // starter before any turn (robust to deleting a turn from the details screen).
  let start;
  if (!game.rounds.length) start = 0;
  else {
    const lastPid = Object.keys(game.rounds[game.rounds.length - 1].scores)[0];
    const idx = order.findIndex((p) => p.id === lastPid);
    start = idx < 0 ? game.rounds.length % order.length : (idx + 1) % order.length;
  }
  // Yams: skip players whose card is already full (can happen after correcting
  // a finished game by clearing a cell). Other turn-based games never skip.
  const done =
    defFor(game).entry === "yams"
      ? (p) => yamsFilled(game, p.id).size >= yamsCategories(game).length
      : () => false;
  for (let n = 0; n < order.length; n++) {
    const cand = order[(start + n) % order.length];
    if (!done(cand)) return cand;
  }
  return null; // everyone is done
}
// Bombu: the player choosing the current deal's contract. A player plays ALL
// their contracts before the hand passes on, so the chooser is the first player
// (in turn order from the starter) who hasn't finished their card of 7 yet.
function bombuChooser(game) {
  if (!game.starter) return null;
  return (
    turnOrder(game).find(
      (p) => bombuTaken(game, p.id).size < BOMBU_CONTRACTS.length,
    ) || null
  );
}

// Noun for the scoring unit: "donne" (Contrée), "tour" (turn-based), else
// "manche".
function roundNoun(game) {
  const def = defFor(game);
  if (def.teams) return "donne";
  return def.turnBased ? "tour" : "manche";
}
// Count label with a variable plural, e.g. "1 manche" / "5 tours".
function roundCountLabel(game, n) {
  const noun = roundNoun(game);
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
// Numbered label for the round/turn in progress, e.g. "Manche 5" / "Tour 5".
function roundNumberLabel(game, n) {
  const noun = roundNoun(game);
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${n}`;
}
// Short status note shown on a game card / header for an ongoing game.
function roundNoteFor(game) {
  const def = defFor(game);
  if (def.teams) return game.dealer ? `Donne ${game.rounds.length + 1}` : "À démarrer";
  if (def.entry === "bombu")
    return game.starter ? `Manche ${game.rounds.length + 1}` : "À démarrer";
  if (!def.turnBased) return `Manche ${game.rounds.length + 1}`;
  if (!game.starter) return "À démarrer";
  const cur = currentPlayer(game);
  return cur ? `Tour de ${esc(cur.name)}` : "En cours";
}

// Competition-style rank labels for an ALREADY-SORTED list. `tied(prev, cur)`
// reports whether two adjacent entries share the same rank. Each result is
// { place, label }: `place` is the rank of the tie group's leader (1-based,
// gaps after ties — "1, 1, 3, 3, 5"…). Tied entries share that same number,
// so `label` equals `place` for every entry.
function rankLabels(sorted, tied) {
  let place = 0;
  return sorted.map((item, i) => {
    const isTie = i > 0 && tied(sorted[i - 1], item);
    if (!isTie) place = i + 1;
    return { place, label: String(place) };
  });
}

// Does a turn-based draft (Qwirkle: points/drawn; Yam's: a picked mission) hold
// any entered data?
function turnDraftHasData(d) {
  return !!(
    d &&
    ((d.points !== "" && d.points != null) || d.drawn || d.category)
  );
}

// One-line HTML for a Contrée bid: contract + trump suit + taking team + coinche.
function contreeBidHTML(bid, game) {
  const suit = contreeSuit(bid.suit);
  const team = teamsOf(game).find((t) => t.id === bid.team);
  const suitHTML = suit
    ? `<span class="suit${suit.red ? " red" : ""}">${suit.sym}</span>`
    : "";
  const coinche =
    bid.coinche === "surcoinche"
      ? '<span class="bid-coinche">Surcontré</span>'
      : bid.coinche === "coinche"
        ? '<span class="bid-coinche">Contré</span>'
        : "";
  const contractTxt =
    bid.contract === "capot" ? "Capot" : esc(String(bid.contract));
  return `<span class="bid-contract">${contractTxt}</span> ${suitHTML} · <b>${esc(team ? team.name : "")}</b> ${coinche}`;
}

// Elapsed time since the game was created: counts up live while ongoing, then
// freezes at the last (winning) round once over. Null if creation time unknown.
function gameDuration(game) {
  const start = game.createdAt;
  if (!start) return null;
  const r = game.rounds;
  const over = !!winner(game);
  const end = over ? (r.length ? r[r.length - 1].at : start) : Date.now();
  if (!end || end < start) return null;
  return end - start;
}

export {
  playerTotal, standings, teamsOf, teamName, teamTotal, currentDealer,
  isGameOver, winnersFromStandings, winners, winnersLabel, winner,
  turnOrder, currentPlayer, bombuChooser, roundNoun, roundCountLabel, roundNumberLabel,
  roundNoteFor, rankLabels, gameDuration, turnDraftHasData, contreeBidHTML,
};
