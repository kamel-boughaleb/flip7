/* <app-turn-table> — details for a turn-based game (Qwirkle): one row per turn,
   with the running total. Points stay editable and each turn can be removed.
   Data in via `.game`; mutations write to the store and emit a bubbling
   "changed" event so the details screen refreshes (no import back into app.js). */
import { esc } from "../util.js";
import { unitLabel, defFor } from "../rules.js";
import { getGame, upsertGame } from "../store.js";
import { confirmDialog } from "../ui.js";

class AppTurnTable extends HTMLElement {
  set game(g) {
    this._g = g;
    this.render();
  }
  get game() {
    return this._g;
  }

  changed() {
    this.dispatchEvent(new CustomEvent("changed", { bubbles: true }));
  }

  render() {
    const game = this._g;
    if (!game) return;
    const def = defFor(game);
    const running = {};
    const rows = !game.rounds.length
      ? `<tr><td colspan="5" class="turn-empty muted">Aucun tour joué pour l'instant.</td></tr>`
      : game.rounds
          .map((r, i) => {
            const pid = Object.keys(r.scores)[0];
            const cell = r.scores[pid] || { points: 0 };
            const p = game.players.find((x) => x.id === pid);
            const name = p ? esc(p.name) : "—";
            const val = def.cellValue(cell);
            running[pid] = (running[pid] || 0) + val;
            const drawnTag =
              val === 0 ? '<span class="draw-tag">Pioche</span>' : "";
            return `<tr>
              <td class="rank-col"><span class="turn-num">${i + 1}</span></td>
              <td class="player-name">${name}</td>
              <td><span class="cell-box"><input type="number" class="cell-input${val === 0 ? " cell-zero" : ""}" data-edit="${i}" value="${val}" />${drawnTag}</span></td>
              <td class="total-cell"><span class="score-badge">${running[pid]}</span></td>
              <td class="rank-col"><button class="btn btn-danger btn-icon" data-del="${i}" title="Supprimer le tour"><i class="fa-regular fa-xmark"></i></button></td>
            </tr>`;
          })
          .join("");
    this.innerHTML = `
      <div class="table-wrap">
        <table class="score turn-table">
          <thead><tr><th class="rank-col">Tour</th><th class="player-name">${unitLabel(game.mode)}</th><th>Points</th><th>Total</th><th class="rank-col"></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    this.querySelectorAll("input[data-edit]").forEach((input) => {
      input.addEventListener("input", () =>
        input.classList.toggle("cell-zero", (Number(input.value) || 0) === 0),
      );
      input.addEventListener("change", () => {
        const i = Number(input.dataset.edit);
        const g = getGame(game.id);
        const pid = Object.keys(g.rounds[i].scores)[0];
        const c = g.rounds[i].scores[pid] || { points: 0 };
        const v = Number(input.value) || 0;
        c.points = v;
        if (v !== 0) delete c.drawn; // a real score overrides "a pioché"
        g.rounds[i].scores[pid] = c;
        upsertGame(g);
        this.changed();
      });
    });

    this.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const i = Number(btn.dataset.del);
        const g0 = getGame(game.id);
        const pid = Object.keys(g0.rounds[i].scores)[0];
        const p = g0.players.find((x) => x.id === pid);
        const ok = await confirmDialog({
          title: `Supprimer le tour ${i + 1} ?`,
          body: `Le score de ${p ? p.name : "ce joueur"} pour ce tour sera supprimé.`,
          confirmLabel: "Supprimer",
          danger: true,
        });
        if (!ok) return;
        const g = getGame(game.id);
        g.rounds.splice(i, 1);
        upsertGame(g);
        this.changed();
      });
    });
  }
}

customElements.define("app-turn-table", AppTurnTable);
