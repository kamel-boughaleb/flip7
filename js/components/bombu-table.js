/* <app-bombu-table> — the Bombu breakdown on the details screen: one row per
   deal (number + contract), one column per player, plus the grand total. The
   chooser's cell is marked. Cells are editable number inputs (scores can be
   negative); a change writes to the store and emits a bubbling "changed" event
   carrying the prior winner id so the details screen can refresh and celebrate. */
import { esc } from "../util.js";
import { winner, winners, playerTotal } from "../scoring.js";
import { getGame, upsertGame } from "../store.js";
import { bombuContract } from "../rules.js";

class AppBombuTable extends HTMLElement {
  set game(g) {
    this._g = g;
    this.render();
  }
  get game() {
    return this._g;
  }

  setCellPoints(roundIdx, pid, pts) {
    const g = getGame(this._g.id);
    const before = (winner(g) || {}).id || null;
    const r = g.rounds[roundIdx];
    if (!r || !r.scores[pid]) return;
    r.scores[pid].points = pts;
    upsertGame(g);
    this.dispatchEvent(
      new CustomEvent("changed", { detail: { before }, bubbles: true }),
    );
  }

  render() {
    const game = this._g;
    if (!game) return;
    const players = game.players;
    const winIds = new Set(winners(game).map((p) => p.id));

    const head = `<thead><tr><th class="player-name">Manche</th>${players
      .map(
        (p) =>
          `<th>${esc(p.name)}${winIds.has(p.id) ? ' <span class="crown"><i class="fa-regular fa-crown"></i></span>' : ""}</th>`,
      )
      .join("")}</tr></thead>`;

    const rows = game.rounds
      .map((r, i) => {
        const c = bombuContract(r.contract);
        const cells = players
          .map((p) => {
            const cell = r.scores[p.id];
            const pts = cell ? Number(cell.points) || 0 : 0;
            const chooser = r.chooser === p.id ? " chooser" : "";
            return `<td class="yams-cell"><input type="number" inputmode="numeric" class="cell-input bombu-cell-input${chooser}" data-round="${i}" data-pid="${p.id}" value="${pts}" /></td>`;
          })
          .join("");
        return `<tr><td class="player-name bombu-deal"><span class="bombu-deal-no">${i + 1}</span> <span class="bombu-deal-contract">${esc(c ? c.label : "?")}</span></td>${cells}</tr>`;
      })
      .join("");

    const total = `<tr class="yams-total"><td class="player-name">Total</td>${players
      .map(
        (p) =>
          `<td class="yams-cell"><span class="score-badge">${playerTotal(game, p.id)}</span></td>`,
      )
      .join("")}</tr>`;

    this.innerHTML = `
      <div class="table-wrap">
        <table class="score yams-table bombu-table">
          ${head}
          <tbody>${rows}${total}</tbody>
        </table>
      </div>`;

    // Editable cells: any integer (incl. negative); commit on blur/Enter.
    this.querySelectorAll(".bombu-cell-input").forEach((input) => {
      const { round, pid } = input.dataset;
      const points = Number(input.value) || 0;
      input.addEventListener("focus", () => input.select());
      const commit = () => {
        const pts = Math.round(Number(input.value) || 0);
        if (pts === points) {
          input.value = String(points);
          return;
        }
        this.setCellPoints(Number(round), pid, pts);
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
      });
    });
  }
}

customElements.define("app-bombu-table", AppBombuTable);
