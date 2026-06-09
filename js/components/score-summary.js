/* <app-score-summary> — the compact game scoreboard (rank · name · total).
   Data in via `.game`; it derives standings/winner itself. Shows the live
   projected total (and projected crown) while a round/turn is in progress. */
import { esc } from "../util.js";
import { defFor, unitLabel } from "../rules.js";
import {
  standings,
  winner,
  winners,
  winnersFromStandings,
  currentPlayer,
  rankLabels,
  turnDraftHasData,
} from "../scoring.js";

class AppScoreSummary extends HTMLElement {
  set game(g) {
    this._g = g;
    this.render();
  }
  get game() {
    return this._g;
  }

  render() {
    const game = this._g;
    if (!game) return;
    const st = standings(game);
    const w = winner(game);
    const hasRounds = game.rounds.length > 0;
    const winIds = new Set(winners(game).map((p) => p.id));
    const labels = rankLabels(st, (a, b) => a.total === b.total);
    const def = defFor(game);
    const draft = game.draftRound || {};
    // Turn-based games pre-save a single player's turn (the current player).
    const turnCur = def.turnBased ? currentPlayer(game) : null;
    const turnDraft =
      turnCur && turnDraftHasData(game.draftTurn) ? game.draftTurn : null;
    const draftCellFor = (p) => {
      if (def.turnBased)
        return turnDraft && p.id === turnCur.id
          ? {
              points: turnDraft.drawn ? 0 : Number(turnDraft.points) || 0,
              drawn: !!turnDraft.drawn,
            }
          : null;
      const dc = draft[p.id];
      return dc && ((dc.points !== "" && dc.points != null) || dc.flip7 || dc.bust)
        ? dc
        : null;
    };
    const hasDraftFor = (p) => !!draftCellFor(p);
    const projected = {};
    st.forEach((p) => {
      const dc = draftCellFor(p);
      projected[p.id] = p.total + (dc ? def.cellValue(dc) : 0);
    });
    // Projected winner(s): only while the game isn't won and a round is pending.
    const projWinnerIds = new Set();
    if (!w && st.some(hasDraftFor)) {
      const projStandings = st
        .map((p) => ({ id: p.id, total: projected[p.id] }))
        .sort((a, b) =>
          def.scoreOrder === "asc" ? a.total - b.total : b.total - a.total,
        );
      winnersFromStandings(game, projStandings).forEach((p) =>
        projWinnerIds.add(p.id),
      );
    }
    const rows = st
      .map((p, i) => {
        const { place, label } = labels[i];
        const won = winIds.has(p.id);
        const crown = won
          ? '<span class="crown"><i class="fa-regular fa-crown"></i></span>'
          : "";
        const rankClass = `rank${place}`;
        const rankBadge = hasRounds
          ? `<span class="badge ${rankClass}">${label}</span>`
          : "";
        const previewCrown = projWinnerIds.has(p.id)
          ? ' <span class="crown"><i class="fa-regular fa-crown"></i></span>'
          : "";
        const eliminated = !!(draft[p.id] && draft[p.id].bust);
        const drew = !!(
          turnDraft &&
          turnCur &&
          p.id === turnCur.id &&
          turnDraft.drawn
        );
        let preview = "";
        if (eliminated) {
          preview = "";
        } else if (drew) {
          preview = '<span class="elim-tag">Pioche</span>';
        } else if (hasDraftFor(p)) {
          preview = `<span class="score-preview"><i class="fa-regular fa-arrow-right-long"></i> ${projected[p.id]}${previewCrown}</span>`;
        }
        // Team games (Time's Up!): list the team's players under its name.
        const sub =
          p.members && p.members.length
            ? `<div class="name-sub muted">${p.members.map((m) => esc(m.name)).join(", ")}</div>`
            : "";
        return `<tr class="${won ? "winner-row" : ""}${eliminated || drew ? " eliminated-row" : ""}">
          <td class="rank-col">${rankBadge}</td>
          <td class="player-name">${esc(p.name)}${sub}</td>
          <td class="total-cell"><span class="score-badge ${rankClass}">${p.total}${crown}</span>${preview}</td>
        </tr>`;
      })
      .join("");
    this.innerHTML = `
      <div class="table-wrap">
        <table class="score summary-table">
          <thead><tr><th class="rank-col">#</th><th class="player-name">${unitLabel(game.mode)}</th><th>Total</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }
}

customElements.define("app-score-summary", AppScoreSummary);
