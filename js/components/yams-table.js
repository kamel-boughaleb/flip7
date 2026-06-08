/* <app-yams-table> — the Yam's scorecard in the details screen (missions ×
   players, upper subtotal, +35 bonus, grand total). Each filled cell is a
   button; tapping it emits a bubbling "editturn" event ({pid, category}) so the
   details screen can open the turn editor to change the mission and/or value.
   Empty cells (missions not yet played) aren't editable. */
import { esc } from "../util.js";
import { winners, playerTotal } from "../scoring.js";
import {
  YAMS_BONUS_MIN,
  YAMS_BONUS,
  yamsBadge,
  yamsCategories,
  yamsUpperSum,
  yamsUpperBonus,
} from "../rules.js";

class AppYamsTable extends HTMLElement {
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
    const players = game.players;
    const winIds = new Set(winners(game).map((p) => p.id));
    // category key -> { [playerId]: { points } }
    const byCat = {};
    game.rounds.forEach((r) => {
      const pid = Object.keys(r.scores)[0];
      const cell = r.scores[pid];
      if (!cell || !cell.category) return;
      (byCat[cell.category] ||= {})[pid] = { points: Number(cell.points) || 0 };
    });

    const cellHtml = (catKey, pid) => {
      const e = byCat[catKey] && byCat[catKey][pid];
      if (!e) return `<td class="yams-cell yams-empty">·</td>`;
      const struck = e.points === 0 ? " struck" : "";
      return `<td class="yams-cell"><button type="button" class="yams-cell-edit${struck}" data-cat="${catKey}" data-pid="${pid}" aria-label="Modifier ce tour">${e.points}</button></td>`;
    };
    const rowFor = (cat) =>
      `<tr><td class="player-name">${esc(cat.label)} <span class="yams-fixed-tag">${yamsBadge(cat)}</span></td>${players.map((p) => cellHtml(cat.key, p.id)).join("")}</tr>`;

    const head = `<thead><tr><th class="player-name">Mission</th>${players
      .map(
        (p) =>
          `<th>${esc(p.name)}${winIds.has(p.id) ? ' <span class="crown"><i class="fa-regular fa-crown"></i></span>' : ""}</th>`,
      )
      .join("")}</tr></thead>`;
    const cats = yamsCategories(game);
    const upperRows = cats
      .filter((c) => c.section === "upper")
      .map(rowFor)
      .join("");
    const lowerRows = cats
      .filter((c) => c.section === "lower")
      .map(rowFor)
      .join("");
    const subtotal = `<tr class="yams-subtotal"><td class="player-name">Sous-total</td>${players
      .map(
        (p) =>
          `<td class="yams-cell"><span class="yams-pts">${yamsUpperSum(game, p.id)}</span></td>`,
      )
      .join("")}</tr>`;
    const bonus = `<tr class="yams-bonus"><td class="player-name">Bonus (≥${YAMS_BONUS_MIN})<span class="yams-fixed-tag">+${YAMS_BONUS}</span></td>${players
      .map((p) => {
        const b = yamsUpperBonus(game, p.id);
        return `<td class="yams-cell"><span class="yams-pts${b ? " yams-bonus-on" : ""}">${b ? "+" + b : "—"}</span></td>`;
      })
      .join("")}</tr>`;
    const total = `<tr class="yams-total"><td class="player-name">Total</td>${players
      .map(
        (p) =>
          `<td class="yams-cell"><span class="score-badge">${playerTotal(game, p.id)}</span></td>`,
      )
      .join("")}</tr>`;
    const section = (label) =>
      `<tr class="yams-section"><td colspan="${players.length + 1}">${label}</td></tr>`;

    this.innerHTML = `
      <div class="table-wrap">
        <table class="score yams-table">
          ${head}
          <tbody>
            ${section("Section haute")}${upperRows}${subtotal}${bonus}
            ${section("Section basse")}${lowerRows}${total}
          </tbody>
        </table>
      </div>`;

    // Tapping a filled cell asks the details screen to open the turn editor.
    this.querySelectorAll(".yams-cell-edit").forEach((btn) => {
      const { cat: catKey, pid } = btn.dataset;
      btn.addEventListener("click", () =>
        this.dispatchEvent(
          new CustomEvent("editturn", {
            detail: { pid, category: catKey },
            bubbles: true,
          }),
        ),
      );
    });
  }
}

customElements.define("app-yams-table", AppYamsTable);
