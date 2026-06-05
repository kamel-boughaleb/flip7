/* <app-yams-table> — the Yam's scorecard in the details screen (missions ×
   players, upper subtotal, +35 bonus, grand total). Upper cells are an editable
   die count (score = count × face); lower cells toggle value ↔ 0. Mutations
   write to the store and emit a bubbling "changed" event carrying the prior
   winner id so the details screen can refresh and celebrate a new win. */
import { esc } from "../util.js";
import { winner, winners, playerTotal } from "../scoring.js";
import { getGame, upsertGame } from "../store.js";
import {
  YAMS_CATEGORIES,
  YAMS_BONUS_MIN,
  YAMS_BONUS,
  yamsCat,
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

  // Rewrite a player's cell for a category, then ask the parent to refresh.
  setCellPoints(pid, catKey, pts) {
    const g = getGame(this._g.id);
    const before = (winner(g) || {}).id || null;
    const i = g.rounds.findIndex((r) => {
      const c = r.scores[pid];
      return c && c.category === catKey;
    });
    if (i < 0) return;
    g.rounds[i].scores[pid].points = pts;
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
      const cat = yamsCat(catKey);
      const struck = e.points === 0 ? " struck" : "";
      if (cat.section === "upper") {
        return `<td class="yams-cell"><input type="number" inputmode="numeric" class="cell-input yams-up-input${struck}" data-cat="${catKey}" data-pid="${pid}" data-face="${cat.face}" value="${e.points}" /></td>`;
      }
      const on = e.points !== 0;
      return `<td class="yams-cell"><button type="button" class="yams-toggle${on ? " active" : ""}" data-cat="${catKey}" data-pid="${pid}" data-fixed="${cat.fixed}">${cat.fixed}</button></td>`;
    };
    const rowFor = (cat) =>
      `<tr><td class="player-name">${esc(cat.label)}${cat.fixed != null ? ` <span class="yams-fixed-tag">${cat.fixed}</span>` : ""}</td>${players.map((p) => cellHtml(cat.key, p.id)).join("")}</tr>`;

    const head = `<thead><tr><th class="player-name">Mission</th>${players
      .map(
        (p) =>
          `<th>${esc(p.name)}${winIds.has(p.id) ? ' <span class="crown"><i class="fa-regular fa-crown"></i></span>' : ""}</th>`,
      )
      .join("")}</tr></thead>`;
    const upperRows = YAMS_CATEGORIES.filter((c) => c.section === "upper")
      .map(rowFor)
      .join("");
    const lowerRows = YAMS_CATEGORIES.filter((c) => c.section === "lower")
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

    // Upper-section cells: editable die count (score = count × face).
    this.querySelectorAll(".yams-up-input").forEach((input) => {
      const face = Number(input.dataset.face) || 1;
      const { cat: catKey, pid } = input.dataset;
      const points = Number(input.value) || 0;
      input.addEventListener("focus", () => {
        input.value = String(Math.round(points / face));
        input.select();
      });
      const commit = () => {
        const count = Math.max(
          0,
          Math.min(5, Math.round(Number(input.value) || 0)),
        );
        const pts = count * face;
        if (pts === points) {
          input.value = String(points);
          return;
        }
        this.setCellPoints(pid, catKey, pts);
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
      });
    });

    // Lower-section cells: toggle between the mission value and 0 (barré).
    this.querySelectorAll(".yams-toggle").forEach((btn) => {
      const { cat: catKey, pid } = btn.dataset;
      const fixed = Number(btn.dataset.fixed) || 0;
      btn.addEventListener("click", () => {
        const on = btn.classList.contains("active");
        this.setCellPoints(pid, catKey, on ? 0 : fixed);
      });
    });
  }
}

customElements.define("app-yams-table", AppYamsTable);
